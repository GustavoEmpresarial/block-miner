const { get, run } = require("./db");

async function getOrCreateMinerProfile(user) {
  const existing = await get(
    `
      SELECT user_id, username, wallet_address, rigs, base_hash_rate, balance, lifetime_mined
      FROM users_temp_power
      WHERE user_id = ?
    `,
    [user.id]
  );

  if (existing) {
    return existing;
  }

  const now = Date.now();
  await run(
    `
      INSERT INTO users_temp_power (user_id, username, wallet_address, rigs, base_hash_rate, balance, lifetime_mined, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [user.id, user.name, null, 1, 55, 0, 0, now, now]
  );

  return {
    user_id: user.id,
    username: user.name,
    wallet_address: null,
    rigs: 1,
    base_hash_rate: 55,
    balance: 0,
    lifetime_mined: 0
  };
}

module.exports = {
  getOrCreateMinerProfile
};
