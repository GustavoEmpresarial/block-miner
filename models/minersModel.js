const { all, get, run } = require("./db");

async function listActiveMiners(page, pageSize) {
  const offset = (page - 1) * pageSize;
  const miners = await all(
    `SELECT id, name, base_hash_rate, price, slot_size, image_url
     FROM miners
     WHERE is_active = 1
       AND show_in_shop = 1
       AND id NOT IN (SELECT DISTINCT miner_id FROM faucet_rewards)
       AND id NOT IN (SELECT DISTINCT miner_id FROM shortlink_rewards)
     ORDER BY id ASC
     LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const totalRow = await get(
    `SELECT COUNT(*) as total
     FROM miners
     WHERE is_active = 1
       AND show_in_shop = 1
       AND id NOT IN (SELECT DISTINCT miner_id FROM faucet_rewards)
       AND id NOT IN (SELECT DISTINCT miner_id FROM shortlink_rewards)`
  );

  return {
    miners,
    total: Number(totalRow?.total || 0)
  };
}

async function getActiveMinerById(minerId) {
  return get(
    `SELECT id, name, base_hash_rate, price, slot_size, image_url
     FROM miners
     WHERE id = ?
       AND is_active = 1
       AND show_in_shop = 1
       AND id NOT IN (SELECT DISTINCT miner_id FROM faucet_rewards)
       AND id NOT IN (SELECT DISTINCT miner_id FROM shortlink_rewards)`,
    [minerId]
  );
}

async function getMinerByName(name) {
  return get(
    "SELECT id, name, slug, base_hash_rate, price, slot_size, image_url, is_active, show_in_shop FROM miners WHERE LOWER(name) = LOWER(?)",
    [name]
  );
}

async function getMinerBySlug(slug) {
  return get(
    "SELECT id, name, slug, base_hash_rate, price, slot_size, image_url, is_active, show_in_shop FROM miners WHERE slug = ?",
    [slug]
  );
}

async function listAllMiners() {
  return all(
    "SELECT id, name, slug, base_hash_rate, price, slot_size, image_url, is_active, show_in_shop FROM miners ORDER BY id ASC"
  );
}

async function getMinerById(minerId) {
  return get(
    "SELECT id, name, slug, base_hash_rate, price, slot_size, image_url, is_active, show_in_shop FROM miners WHERE id = ?",
    [minerId]
  );
}

async function createMiner({ name, slug, baseHashRate, price, slotSize, imageUrl, isActive, showInShop = true }) {
  const now = Date.now();
  const result = await run(
    "INSERT INTO miners (name, slug, base_hash_rate, price, slot_size, image_url, is_active, show_in_shop, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [name, slug, baseHashRate, price, slotSize, imageUrl, isActive ? 1 : 0, showInShop ? 1 : 0, now]
  );
  return getMinerById(result.lastID);
}

async function updateMiner(minerId, { name, slug, baseHashRate, price, slotSize, imageUrl, isActive, showInShop }) {
  const current = await getMinerById(minerId);
  const resolvedShowInShop = typeof showInShop === "boolean"
    ? showInShop
    : Number(current?.show_in_shop || 0) === 1;

  await run(
    "UPDATE miners SET name = ?, slug = ?, base_hash_rate = ?, price = ?, slot_size = ?, image_url = ?, is_active = ?, show_in_shop = ? WHERE id = ?",
    [name, slug, baseHashRate, price, slotSize, imageUrl, isActive ? 1 : 0, resolvedShowInShop ? 1 : 0, minerId]
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
