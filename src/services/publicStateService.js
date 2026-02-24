function createPublicStateService({ engine, get, run, all }) {
  async function getActiveGameHashRateTotal() {
    const now = Date.now();
    const row = await get("SELECT COALESCE(SUM(hash_rate), 0) as total FROM users_powers_games WHERE expires_at > ?", [now]);
    return Number(row?.total || 0);
  }

  async function getUserGameHashRate(userId) {
    if (!userId) {
      return 0;
    }
    const now = Date.now();
    const row = await get(
      "SELECT COALESCE(SUM(hash_rate), 0) as total FROM users_powers_games WHERE user_id = ? AND expires_at > ?",
      [userId, now]
    );
    return Number(row?.total || 0);
  }

  async function syncUserBaseHashRate(userId) {
    if (!userId) {
      return 0;
    }

    const row = await get(
      "SELECT COALESCE(SUM(hash_rate), 0) as total FROM user_miners WHERE user_id = ? AND is_active = 1",
      [userId]
    );
    const total = Number(row?.total || 0);
    const now = Date.now();
    await run(
      "UPDATE users_temp_power SET base_hash_rate = ?, updated_at = ? WHERE user_id = ?",
      [total, now, userId]
    );
    return total;
  }

  async function buildPublicState(minerId) {
    const state = engine.getPublicState(minerId);
    const baseNetworkRow = await get("SELECT COALESCE(SUM(base_hash_rate), 0) as total FROM users_temp_power");
    const gameNetworkHash = await getActiveGameHashRateTotal();
    const networkHashRate = Number(baseNetworkRow?.total || 0) + Number(gameNetworkHash || 0);

    state.networkHashRate = networkHashRate;

    if (state.miner) {
      const miner = engine.miners.get(state.miner.id);
      const userId = miner?.userId;
      const userBaseRow = await get("SELECT COALESCE(base_hash_rate, 0) as total FROM users_temp_power WHERE user_id = ?", [
        userId
      ]);
      const userGameHash = await getUserGameHashRate(userId);
      const baseHash = Number(userBaseRow?.total || 0);
      const boostMultiplier = Number(state.miner.boostMultiplier || 1);

      state.miner.baseHashRate = baseHash;
      state.miner.estimatedHashRate = baseHash * boostMultiplier + userGameHash;
    }

    return state;
  }

  async function getNetworkPowerRanking(limit = 20) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const now = Date.now();
    const rankingRows = await allNetworkPowerRows(now, safeLimit);

    return rankingRows.map((row, index) => ({
      rank: index + 1,
      userId: Number(row.user_id || 0),
      username: String(row.username || `Miner-${row.user_id || "unknown"}`),
      baseHashRate: Number(row.base_hash_rate || 0),
      gameHashRate: Number(row.game_hash_rate || 0),
      totalHashRate: Number(row.total_hash_rate || 0)
    }));
  }

  async function allNetworkPowerRows(now, limit) {
    return all(
      `
        SELECT
          utp.user_id,
          COALESCE(NULLIF(TRIM(utp.username), ''), NULLIF(TRIM(u.username), ''), ('Miner-' || utp.user_id)) AS username,
          COALESCE(utp.base_hash_rate, 0) AS base_hash_rate,
          COALESCE(g.active_game_hash, 0) AS game_hash_rate,
          (COALESCE(utp.base_hash_rate, 0) + COALESCE(g.active_game_hash, 0)) AS total_hash_rate
        FROM users_temp_power utp
        LEFT JOIN users u ON u.id = utp.user_id
        LEFT JOIN (
          SELECT user_id, COALESCE(SUM(hash_rate), 0) AS active_game_hash
          FROM users_powers_games
          WHERE expires_at > ?
          GROUP BY user_id
        ) g ON g.user_id = utp.user_id
        WHERE (COALESCE(utp.base_hash_rate, 0) + COALESCE(g.active_game_hash, 0)) > 0
        ORDER BY total_hash_rate DESC, utp.user_id ASC
        LIMIT ?
      `,
      [now, limit]
    );
  }

  return {
    getActiveGameHashRateTotal,
    getUserGameHashRate,
    syncUserBaseHashRate,
    buildPublicState,
    getNetworkPowerRanking
  };
}

module.exports = {
  createPublicStateService
};
