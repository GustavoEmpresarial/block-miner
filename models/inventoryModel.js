const { all, get, run } = require("./db");

async function listInventory(userId) {
  return all(
    "SELECT id, miner_id, miner_name, level, hash_rate, slot_size, acquired_at, updated_at FROM user_inventory WHERE user_id = ? ORDER BY acquired_at ASC",
    [userId]
  );
}

async function getInventoryItem(userId, inventoryId) {
  return get(
    "SELECT id, miner_id, miner_name, level, hash_rate, slot_size FROM user_inventory WHERE id = ? AND user_id = ?",
    [inventoryId, userId]
  );
}

async function addInventoryItem(userId, minerName, level, hashRate, slotSize, acquiredAt, updatedAt, minerId = null) {
  return run(
    "INSERT INTO user_inventory (user_id, miner_id, miner_name, level, hash_rate, slot_size, acquired_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, minerId, minerName, level, hashRate, slotSize, acquiredAt, updatedAt]
  );
}

async function removeInventoryItem(userId, inventoryId) {
  return run("DELETE FROM user_inventory WHERE id = ? AND user_id = ?", [inventoryId, userId]);
}

async function updateInventoryItemMeta(userId, inventoryId, minerName, slotSize, minerId = null) {
  return run(
    "UPDATE user_inventory SET miner_name = ?, slot_size = ?, miner_id = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    [minerName, slotSize, minerId, Date.now(), inventoryId, userId]
  );
}

module.exports = {
  listInventory,
  getInventoryItem,
  addInventoryItem,
  removeInventoryItem,
  updateInventoryItemMeta
};
