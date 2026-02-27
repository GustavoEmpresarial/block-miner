const { all, get, run } = require("./db");
const DEFAULT_MINER_IMAGE_URL = "/assets/machines/reward1.png";

async function listInventory(userId) {
  return all(
    "SELECT id, miner_id, miner_name, level, hash_rate, slot_size, image_url, acquired_at, updated_at FROM user_inventory WHERE user_id = ? ORDER BY acquired_at ASC",
    [userId]
  );
}

async function getInventoryItem(userId, inventoryId) {
  return get(
    "SELECT id, miner_id, miner_name, level, hash_rate, slot_size, image_url FROM user_inventory WHERE id = ? AND user_id = ?",
    [inventoryId, userId]
  );
}

async function addInventoryItem(userId, minerName, level, hashRate, slotSize, acquiredAt, updatedAt, minerId = null, imageUrl = null) {
  return run(
    "INSERT INTO user_inventory (user_id, miner_id, miner_name, level, hash_rate, slot_size, image_url, acquired_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, minerId, minerName, level, hashRate, slotSize, imageUrl, acquiredAt, updatedAt]
  );
}

async function removeInventoryItem(userId, inventoryId) {
  return run("DELETE FROM user_inventory WHERE id = ? AND user_id = ?", [inventoryId, userId]);
}

async function updateInventoryItemMeta(userId, inventoryId, minerName, slotSize, minerId = null) {
  // Optionally update image_url if minerId is provided
  let imageUrl = null;
  if (minerId) {
    const miner = await require("./minersModel").getMinerById(minerId);
    imageUrl = miner?.image_url || DEFAULT_MINER_IMAGE_URL;
  }
  if (imageUrl) {
    return run(
      "UPDATE user_inventory SET miner_name = ?, slot_size = ?, miner_id = ?, image_url = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      [minerName, slotSize, minerId, imageUrl, Date.now(), inventoryId, userId]
    );
  } else {
    return run(
      "UPDATE user_inventory SET miner_name = ?, slot_size = ?, miner_id = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      [minerName, slotSize, minerId, Date.now(), inventoryId, userId]
    );
  }
}

module.exports = {
  listInventory,
  getInventoryItem,
  addInventoryItem,
  removeInventoryItem,
  updateInventoryItemMeta
};
