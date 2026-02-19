const { all, get, run } = require("./db");

async function listActiveMiners(page, pageSize) {
  const offset = (page - 1) * pageSize;
  const miners = await all(
    "SELECT id, name, base_hash_rate, price, slot_size, image_url FROM miners WHERE is_active = 1 ORDER BY id ASC LIMIT ? OFFSET ?",
    [pageSize, offset]
  );
  const totalRow = await get("SELECT COUNT(*) as total FROM miners WHERE is_active = 1");

  return {
    miners,
    total: Number(totalRow?.total || 0)
  };
}

async function getActiveMinerById(minerId) {
  return get(
    "SELECT id, name, base_hash_rate, price, slot_size, image_url FROM miners WHERE id = ? AND is_active = 1",
    [minerId]
  );
}

async function getMinerByName(name) {
  return get(
    "SELECT id, name, slug, base_hash_rate, price, slot_size, image_url, is_active FROM miners WHERE LOWER(name) = LOWER(?)",
    [name]
  );
}

async function getMinerBySlug(slug) {
  return get(
    "SELECT id, name, slug, base_hash_rate, price, slot_size, image_url, is_active FROM miners WHERE slug = ?",
    [slug]
  );
}

async function listAllMiners() {
  return all(
    "SELECT id, name, slug, base_hash_rate, price, slot_size, image_url, is_active FROM miners ORDER BY id ASC"
  );
}

async function getMinerById(minerId) {
  return get(
    "SELECT id, name, slug, base_hash_rate, price, slot_size, image_url, is_active FROM miners WHERE id = ?",
    [minerId]
  );
}

async function createMiner({ name, slug, baseHashRate, price, slotSize, imageUrl, isActive }) {
  const now = Date.now();
  const result = await run(
    "INSERT INTO miners (name, slug, base_hash_rate, price, slot_size, image_url, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [name, slug, baseHashRate, price, slotSize, imageUrl, isActive ? 1 : 0, now]
  );
  return getMinerById(result.lastID);
}

async function updateMiner(minerId, { name, slug, baseHashRate, price, slotSize, imageUrl, isActive }) {
  await run(
    "UPDATE miners SET name = ?, slug = ?, base_hash_rate = ?, price = ?, slot_size = ?, image_url = ?, is_active = ? WHERE id = ?",
    [name, slug, baseHashRate, price, slotSize, imageUrl, isActive ? 1 : 0, minerId]
  );
  return getMinerById(minerId);
}

module.exports = {
  listActiveMiners,
  getActiveMinerById,
  listAllMiners,
  getMinerById,
  createMiner,
  updateMiner,
  getMinerByName,
  getMinerBySlug
};
