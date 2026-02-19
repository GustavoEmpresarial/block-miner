const machineModel = require("../models/machineModel");
const inventoryModel = require("../models/inventoryModel");
const { getOrCreateMinerProfile } = require("../models/minerProfileModel");
const { getMinerNameFromHashRate } = require("../utils/minerUtils");
const { run } = require("../models/db");

function createMachinesController(io) {
  const SLOTS_PER_RACK = 8;

  async function listMachines(req, res) {
    try {
      const machines = await machineModel.listUserMachines(req.user.id);
      const normalized = machines.map((machine) => ({
        ...machine,
        image_url: machine.image_url || (machine.miner_id ? `/assets/machines/${machine.miner_id}.png` : null)
      }));
      res.json({ ok: true, machines: normalized });
    } catch (error) {
      console.error("Error loading machines:", error);
      res.status(500).json({ ok: false, message: "Unable to load machines." });
    }
  }

  async function upgradeMachine(req, res) {
    try {
      const machineId = Number(req.body?.machineId);
      if (!Number.isInteger(machineId) || machineId <= 0) {
        res.status(400).json({ ok: false, message: "Invalid machine ID." });
        return;
      }

      const machine = await machineModel.getMachineById(req.user.id, machineId);
      if (!machine) {
        res.status(404).json({ ok: false, message: "Machine not found." });
        return;
      }

      const profile = await getOrCreateMinerProfile(req.user);
      const upgradeCost = 0.3 * machine.level;
      if (profile.balance < upgradeCost) {
        res.status(400).json({ ok: false, message: "Insufficient balance." });
        return;
      }

      const newLevel = machine.level + 1;
      const hashRateIncrease = 25;
      const newMachineHashRate = machine.hash_rate + hashRateIncrease;

      const now = Date.now();
      await machineModel.updateMachineLevelHashRate(machineId, newLevel, newMachineHashRate);

      const newBalance = profile.balance - upgradeCost;
      const newTotalHashRate = profile.base_hash_rate + hashRateIncrease;
      await run(
        "UPDATE users_temp_power SET balance = ?, base_hash_rate = ?, updated_at = ? WHERE user_id = ?",
        [newBalance, newTotalHashRate, now, req.user.id]
      );

      res.json({
        ok: true,
        message: `Machine upgraded to level ${newLevel}.`,
        newBalance,
        newHashRate: newTotalHashRate,
        newLevel,
        newMachineHashRate
      });
    } catch {
      res.status(500).json({ ok: false, message: "Unable to upgrade machine." });
    }
  }

  async function toggleMachine(req, res) {
    try {
      const machineId = Number(req.body?.machineId);
      const isActive = Boolean(req.body?.isActive);

      if (!Number.isInteger(machineId) || machineId <= 0) {
        res.status(400).json({ ok: false, message: "Invalid machine ID." });
        return;
      }

      const machine = await machineModel.getMachineById(req.user.id, machineId);
      if (!machine) {
        res.status(404).json({ ok: false, message: "Machine not found." });
        return;
      }

      if (machine.is_active === (isActive ? 1 : 0)) {
        res.json({ ok: true, message: "Machine already in desired state." });
        return;
      }

      await machineModel.updateMachineActive(machineId, isActive);

      const profile = await getOrCreateMinerProfile(req.user);
      const hashDelta = isActive ? machine.hash_rate : -machine.hash_rate;
      const newTotalHashRate = profile.base_hash_rate + hashDelta;
      const now = Date.now();

      await run(
        "UPDATE users_temp_power SET base_hash_rate = ?, updated_at = ? WHERE user_id = ?",
        [newTotalHashRate, now, req.user.id]
      );

      res.json({
        ok: true,
        message: isActive ? "Machine activated." : "Machine deactivated.",
        newHashRate: newTotalHashRate
      });
    } catch {
      res.status(500).json({ ok: false, message: "Unable to toggle machine." });
    }
  }

  async function removeMachine(req, res) {
    try {
      const machineId = Number(req.body?.machineId);

      if (!Number.isInteger(machineId) || machineId <= 0) {
        res.status(400).json({ ok: false, message: "Invalid miner ID." });
        return;
      }

      const machine = await machineModel.getMachineById(req.user.id, machineId);
      if (!machine) {
        res.status(404).json({ ok: false, message: "Miner not found." });
        return;
      }

      const now = Date.now();
      const minerName = machine.miner_name || getMinerNameFromHashRate(machine.hash_rate);
      const slotSize = Number(machine.slot_size || 1);
      await inventoryModel.addInventoryItem(
        req.user.id,
        minerName,
        machine.level,
        machine.hash_rate,
        slotSize,
        now,
        now,
        machine.miner_id || null
      );
      await machineModel.deleteMachine(machineId);

      const profile = await getOrCreateMinerProfile(req.user);
      const newTotalHashRate = Math.max(0, profile.base_hash_rate - machine.hash_rate);
      const newRigs = Math.max(0, profile.rigs - 1);

      await run(
        "UPDATE users_temp_power SET base_hash_rate = ?, rigs = ?, updated_at = ? WHERE user_id = ?",
        [newTotalHashRate, newRigs, now, req.user.id]
      );

      const [inventory, machines] = await Promise.all([
        inventoryModel.listInventory(req.user.id),
        machineModel.listUserMachines(req.user.id)
      ]);
      io.to(`user:${req.user.id}`).emit("inventory:update", { inventory });
      io.to(`user:${req.user.id}`).emit("machines:update", { machines });

      res.json({
        ok: true,
        message: "Miner sent to inventory!",
        newHashRate: newTotalHashRate
      });
    } catch (error) {
      console.error("Error removing miner:", error);
      res.status(500).json({ ok: false, message: "Error removing miner." });
    }
  }

  async function clearRack(req, res) {
    try {
      const rackIndex = Number(req.body?.rackIndex);
      if (!Number.isInteger(rackIndex) || rackIndex < 1 || rackIndex > 10) {
        res.status(400).json({ ok: false, message: "Invalid rack." });
        return;
      }

      const startSlot = (rackIndex - 1) * SLOTS_PER_RACK;
      const endSlot = startSlot + (SLOTS_PER_RACK - 1);
      const machines = await machineModel.listMachinesBySlotRange(req.user.id, startSlot, endSlot);

      if (!machines.length) {
        res.json({ ok: true, message: "Rack already empty." });
        return;
      }

      const now = Date.now();
      await run("BEGIN TRANSACTION");

      try {
        for (const machine of machines) {
          const minerName = machine.miner_name || getMinerNameFromHashRate(machine.hash_rate);
          const slotSize = Number(machine.slot_size || 1);
          await inventoryModel.addInventoryItem(
            req.user.id,
            minerName,
            machine.level,
            machine.hash_rate,
            slotSize,
            now,
            now,
            machine.miner_id || null
          );
        }

        await machineModel.deleteMachinesBySlotRange(req.user.id, startSlot, endSlot);

        const profile = await getOrCreateMinerProfile(req.user);
        const hashRemoved = machines.reduce((total, machine) => total + Number(machine.hash_rate || 0), 0);
        const rigsRemoved = machines.length;
        const newTotalHashRate = Math.max(0, profile.base_hash_rate - hashRemoved);
        const newRigs = Math.max(0, profile.rigs - rigsRemoved);

        await run(
          "UPDATE users_temp_power SET base_hash_rate = ?, rigs = ?, updated_at = ? WHERE user_id = ?",
          [newTotalHashRate, newRigs, now, req.user.id]
        );

        await run("COMMIT");
      } catch (error) {
        await run("ROLLBACK");
        throw error;
      }

      const [inventory, updatedMachines] = await Promise.all([
        inventoryModel.listInventory(req.user.id),
        machineModel.listUserMachines(req.user.id)
      ]);
      io.to(`user:${req.user.id}`).emit("inventory:update", { inventory });
      io.to(`user:${req.user.id}`).emit("machines:update", { machines: updatedMachines });

      res.json({ ok: true, message: `Rack ${rackIndex} cleared.` });
    } catch (error) {
      console.error("Error clearing rack:", error);
      res.status(500).json({ ok: false, message: "Error clearing rack." });
    }
  }

  return {
    listMachines,
    upgradeMachine,
    toggleMachine,
    removeMachine,
    clearRack
  };
}

module.exports = {
  createMachinesController
};
