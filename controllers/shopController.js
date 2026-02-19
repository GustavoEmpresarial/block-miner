const inventoryModel = require("../models/inventoryModel");
const minersModel = require("../models/minersModel");
const { get } = require("../models/db");
const { run } = require("../models/db");

function createShopController(io) {
  async function listMiners(req, res) {
    try {
      const rawPage = Number(req.query?.page || 1);
      const rawPageSize = Number(req.query?.pageSize || 24);
      const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
      const pageSize = Number.isInteger(rawPageSize) ? Math.min(Math.max(rawPageSize, 6), 48) : 24;

      const { miners, total } = await minersModel.listActiveMiners(page, pageSize);
      const items = miners.map((miner) => ({
        id: miner.id,
        name: miner.name,
        baseHashRate: Number(miner.base_hash_rate || 0),
        slotSize: Number(miner.slot_size || 1),
        price: Number(miner.price || 0),
        imageUrl: miner.image_url || `/assets/machines/${miner.id}.png`
      }));

      res.json({
        ok: true,
        page,
        pageSize,
        total,
        miners: items
      });
    } catch (error) {
      console.error("Error loading miners:", error);
      res.status(500).json({ ok: false, message: "Unable to load miners." });
    }
  }

  async function purchaseMiner(req, res) {
    try {
      const minerId = Number(req.body?.minerId);
      if (!Number.isInteger(minerId) || minerId <= 0) {
        res.status(400).json({ ok: false, message: "Invalid miner ID." });
        return;
      }

      const miner = await minersModel.getActiveMinerById(minerId);
      if (!miner) {
        res.status(404).json({ ok: false, message: "Miner not found." });
        return;
      }

      const price = Number(miner.price || 0);
      const baseHashRate = Number(miner.base_hash_rate || 0);
      const slotSize = Number(miner.slot_size || 1);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(baseHashRate) || baseHashRate <= 0) {
        res.status(500).json({ ok: false, message: "Miner data invalid." });
        return;
      }

      if (!Number.isInteger(slotSize) || slotSize < 1 || slotSize > 2) {
        res.status(500).json({ ok: false, message: "Miner slot size invalid." });
        return;
      }

      const now = Date.now();

      await run("BEGIN TRANSACTION");
      try {
        const balanceUpdate = await run(
          "UPDATE users_temp_power SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
          [price, now, req.user.id, price]
        );

        if (balanceUpdate.changes !== 1) {
          await run("ROLLBACK");
          res.status(400).json({ ok: false, message: "Insufficient balance." });
          return;
        }

        await inventoryModel.addInventoryItem(req.user.id, miner.name, 1, baseHashRate, slotSize, now, now, miner.id);
        await run("COMMIT");
      } catch (error) {
        await run("ROLLBACK");
        throw error;
      }

      const inventory = await inventoryModel.listInventory(req.user.id);
      io.to(`user:${req.user.id}`).emit("inventory:update", { inventory });

      const updatedProfile = await get("SELECT balance FROM users_temp_power WHERE user_id = ?", [req.user.id]);
      res.json({
        ok: true,
        message: `${miner.name} added to inventory!`,
        newBalance: Number(updatedProfile?.balance || 0)
      });
    } catch (error) {
      console.error("Error purchasing miner:", error);
      res.status(500).json({ ok: false, message: "Purchase error." });
    }
  }

  return {
    listMiners,
    purchaseMiner
  };
}

module.exports = {
  createShopController
};
