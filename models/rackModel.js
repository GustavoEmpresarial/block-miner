const { all, get, run } = require("./db");

async function listRacks(userId) {
  return all(
    "SELECT rack_index, custom_name FROM rack_configs WHERE user_id = ? ORDER BY rack_index ASC",
    [userId]
  );
}

async function getRack(userId, rackIndex) {
  return get("SELECT id FROM rack_configs WHERE user_id = ? AND rack_index = ?", [userId, rackIndex]);
}

async function upsertRackName(userId, rackIndex, customName, now) {
  const existing = await getRack(userId, rackIndex);
  if (existing) {
    return run(
      "UPDATE rack_configs SET custom_name = ?, updated_at = ? WHERE user_id = ? AND rack_index = ?",
      [customName, now, userId, rackIndex]
    );
  }

  return run(
    "INSERT INTO rack_configs (user_id, rack_index, custom_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [userId, rackIndex, customName, now, now]
  );
}

module.exports = {
  listRacks,
  upsertRackName
};
