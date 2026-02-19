const inventoryModel = require("../models/inventoryModel");
const machineModel = require("../models/machineModel");
const minersModel = require("../models/minersModel");
const { getOrCreateMinerProfile } = require("../models/minerProfileModel");
const { getSlotSizeForMiner } = require("../utils/minerUtils");
const { run } = require("../models/db");

function createInventoryController(io) {
  async function listInventory(req, res) {
    try {
      const inventory = await inventoryModel.listInventory(req.user.id);
      const miners = await minersModel.listAllMiners();

      const minersById = new Map(miners.map((miner) => [Number(miner.id), miner]));
      const minersByName = new Map(
        miners.map((miner) => [String(miner.name || "").toLowerCase(), miner])
      );

      const legacyNames = new Set(["basic miner", "pro miner", "elite miner"]);

      const normalized = await Promise.all(
        inventory.map(async (item) => {
          const currentName = String(item.miner_name || "").trim();
          const lowerName = currentName.toLowerCase();
          const minerId = Number(item.miner_id || 0);
          let matchedMiner = Number.isFinite(minerId) && minerId > 0 ? minersById.get(minerId) || null : null;
          if (!matchedMiner) {
            matchedMiner = minersByName.get(lowerName) || null;
          }

          if (!matchedMiner && legacyNames.has(lowerName) && miners.length > 0) {
            matchedMiner = miners.reduce((closest, miner) => {
              const currentDiff = Math.abs(Number(miner.base_hash_rate || 0) - Number(item.hash_rate || 0));
              if (!closest) return miner;
              const closestDiff = Math.abs(Number(closest.base_hash_rate || 0) - Number(item.hash_rate || 0));
              return currentDiff < closestDiff ? miner : closest;
            }, null);
          }

          if (matchedMiner) {
            const desiredName = matchedMiner.name;
            const desiredSlotSize = Number(matchedMiner.slot_size || item.slot_size || 1);

            if (
              desiredName !== currentName ||
              Number(item.slot_size || 1) !== desiredSlotSize ||
              Number(item.miner_id || 0) !== Number(matchedMiner.id)
            ) {
              await inventoryModel.updateInventoryItemMeta(
                req.user.id,
                item.id,
                desiredName,
                desiredSlotSize,
                matchedMiner.id
              );
            }

            return {
              ...item,
              miner_id: matchedMiner.id,
              miner_name: desiredName,
              slot_size: desiredSlotSize,
              image_url: matchedMiner.image_url || `/assets/machines/${matchedMiner.id}.png`
            };
          }

          return item;
        })
      );

      res.json({ ok: true, inventory: normalized });
    } catch (error) {
      console.error("Error loading inventory:", error);
      res.status(500).json({ ok: false, message: "Unable to load inventory." });
    }
  }

  async function installInventoryItem(req, res) {
    try {
      const slotIndex = Number(req.body?.slotIndex);
      const inventoryId = Number(req.body?.inventoryId);

      if (!Number.isInteger(slotIndex) || slotIndex < 0) {
        res.status(400).json({ ok: false, message: "Invalid slot." });
        return;
      }

      // Maximum 10 racks = 80 slots (0-79)
      if (slotIndex >= 80) {
        res.status(400).json({ ok: false, message: "Maximum rack limit reached. You can only have up to 10 racks (80 slots)." });
        return;
      }

      if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
        res.status(400).json({ ok: false, message: "Invalid inventory item." });
        return;
      }

      const inventoryItem = await inventoryModel.getInventoryItem(req.user.id, inventoryId);
      if (!inventoryItem) {
        res.status(404).json({ ok: false, message: "Item not found in inventory." });
        return;
      }

      // Determine slot size based on hash rate
      const slotSize = Number.isInteger(inventoryItem.slot_size)
        ? inventoryItem.slot_size
        : getSlotSizeForMiner(inventoryItem.hash_rate);

      const matchedMiner = await minersModel.getMinerByName(inventoryItem.miner_name);
      const minerId = matchedMiner?.id || null;

      // 2-cell machines must start on even slots (0, 2, 4, 6 internally, shown as 1, 3, 5, 7 to user)
      if (slotSize === 2 && slotIndex % 2 !== 0) {
        res.status(400).json({ ok: false, message: `This miner occupies 2 horizontal slots and must start on an odd slot (1, 3, 5, 7...).` });
        return;
      }

      // Check if required slots are available
      const slotsAvailable = await machineModel.checkSlotAvailability(req.user.id, slotIndex, slotSize);
      if (!slotsAvailable) {
        res.status(400).json({ ok: false, message: `Slot ${slotIndex + 1} is already occupied or doesn't have enough space.` });
        return;
      }

      const now = Date.now();
      await machineModel.insertMachine(
        req.user.id,
        slotIndex,
        inventoryItem.level,
        inventoryItem.hash_rate,
        true,
        now,
        slotSize,
        minerId
      );
      await inventoryModel.removeInventoryItem(req.user.id, inventoryId);

      const profile = await getOrCreateMinerProfile(req.user);
      const newTotalHashRate = profile.base_hash_rate + inventoryItem.hash_rate;
      const newRigs = profile.rigs + 1;

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

      const slotsText = slotSize > 1 ? `slots ${slotIndex + 1}-${slotIndex + slotSize}` : `slot ${slotIndex + 1}`;
      res.json({
        ok: true,
        message: `${inventoryItem.miner_name} installed in ${slotsText}!`,
        newHashRate: newTotalHashRate
      });
    } catch (error) {
      console.error("Error installing miner:", error);
      res.status(500).json({ ok: false, message: "Error installing miner." });
    }
  }

  async function removeInventoryItem(req, res) {
    try {
      const inventoryId = Number(req.body?.inventoryId);
      if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
        res.status(400).json({ ok: false, message: "Invalid inventory item." });
        return;
      }

      const existing = await inventoryModel.getInventoryItem(req.user.id, inventoryId);
      if (!existing) {
        res.status(404).json({ ok: false, message: "Item not found in inventory." });
        return;
      }

      await inventoryModel.removeInventoryItem(req.user.id, inventoryId);
      const inventory = await inventoryModel.listInventory(req.user.id);
      io.to(`user:${req.user.id}`).emit("inventory:update", { inventory });
      res.json({ ok: true, message: "Item removed from inventory." });
    } catch (error) {
      console.error("Error removing from inventory:", error);
      res.status(500).json({ ok: false, message: "Error removing from inventory." });
    }
  }

  return {
    listInventory,
    installInventoryItem,
    removeInventoryItem
  };
}

module.exports = {
  createInventoryController
};
