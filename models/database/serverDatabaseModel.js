const { get, all, run } = require("../db");

async function markCheckinConfirmed(checkinId, now) {
  return run("UPDATE daily_checkins SET status = ?, confirmed_at = ? WHERE id = ?", ["confirmed", now, checkinId]);
}

async function findDailyCheckinByUserAndDate(userId, dateKey) {
  return get(
    "SELECT id, status, tx_hash, checkin_date, created_at FROM daily_checkins WHERE user_id = ? AND checkin_date = ?",
    [userId, dateKey]
  );
}

async function findLatestDailyCheckinByUser(userId) {
  return get(
    "SELECT id, status, tx_hash, checkin_date, created_at FROM daily_checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
}

async function findLatestDailyCheckinByUserAndDate(userId, dateKey) {
  return get(
    "SELECT id, status, tx_hash, checkin_date, created_at FROM daily_checkins WHERE user_id = ? AND checkin_date = ? ORDER BY created_at DESC LIMIT 1",
    [userId, dateKey]
  );
}

async function updateDailyCheckinDate(checkinId, dateKey) {
  return run("UPDATE daily_checkins SET checkin_date = ? WHERE id = ?", [dateKey, checkinId]);
}

async function hasUsersPowersGamesCheckinColumn() {
  const row = await get("SELECT 1 as ok FROM pragma_table_info('users_powers_games') WHERE name = 'checkin_id' LIMIT 1");
  return Boolean(row?.ok);
}

async function fetchAdminUserDetails(userId, now) {
  const [user, faucet, shortlink, autoGpu, inventory, activeMachines, checkins, youtubeWatch, recentTx, recentPayouts] = await Promise.all([
    get(
      `
        SELECT
          u.id,
          u.name,
          u.username,
          u.email,
          u.ip,
          u.last_login_at,
          u.created_at,
          u.is_banned,
          COALESCE(utp.wallet_address, '') AS wallet_address,
          COALESCE(utp.balance, 0) AS pool_balance,
          COALESCE(utp.base_hash_rate, 0) AS base_hash_rate,
          COALESCE(utp.lifetime_mined, 0) AS lifetime_mined,
          COALESCE(utp.total_withdrawn, 0) AS total_withdrawn
        FROM users u
        LEFT JOIN users_temp_power utp ON utp.user_id = u.id
        WHERE u.id = ?
      `,
      [userId]
    ),
    get("SELECT COALESCE(total_claims, 0) AS total_claims, day_key FROM faucet_claims WHERE user_id = ?", [userId]),
    get(
      "SELECT COALESCE(daily_runs, 0) AS daily_runs, COALESCE(current_step, 0) AS current_step, completed_at, reset_at FROM shortlink_completions WHERE user_id = ?",
      [userId]
    ),
    get(
      "SELECT COUNT(*) AS claims, COALESCE(SUM(gpu_hash_rate), 0) AS total_hash FROM auto_mining_gpu_logs WHERE user_id = ? AND action = 'claim'",
      [userId]
    ),
    get("SELECT COUNT(*) AS count FROM user_inventory WHERE user_id = ?", [userId]),
    get("SELECT COUNT(*) AS count FROM user_miners WHERE user_id = ? AND is_active = 1", [userId]),
    get("SELECT COUNT(*) AS count FROM daily_checkins WHERE user_id = ?", [userId]),
    get(
      `
        SELECT
          COUNT(*) AS claims,
          COALESCE(SUM(hash_rate), 0) AS total_hash_granted,
          COALESCE(SUM(CASE WHEN expires_at > ? THEN hash_rate ELSE 0 END), 0) AS active_hash
        FROM youtube_watch_power_history
        WHERE user_id = ?
      `,
      [now, userId]
    ),
    all(
      `
        SELECT id, type, amount, status, address, tx_hash, created_at
        FROM transactions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `,
      [userId]
    ),
    all(
      `
        SELECT id, amount_pol, source, tx_hash, created_at
        FROM payouts
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `,
      [userId]
    )
  ]);

  return { user, faucet, shortlink, autoGpu, inventory, activeMachines, checkins, youtubeWatch, recentTx, recentPayouts };
}

async function fetchAdminFinanceOverview(sinceMs) {
  const [pool, payouts, withdrawals, pendingWithdrawals, deposits24h] = await Promise.all([
    get("SELECT COALESCE(SUM(balance), 0) AS total_pool, COALESCE(SUM(lifetime_mined), 0) AS lifetime_mined FROM users_temp_power"),
    get("SELECT COALESCE(SUM(amount_pol), 0) AS total_paid FROM payouts"),
    get("SELECT COALESCE(SUM(amount), 0) AS total_withdrawn FROM transactions WHERE type = 'withdrawal' AND status = 'completed'"),
    get("SELECT COALESCE(SUM(amount), 0) AS total_pending FROM transactions WHERE type = 'withdrawal' AND status IN ('pending','approved')"),
    get("SELECT COALESCE(SUM(amount), 0) AS total_deposits_24h FROM transactions WHERE type = 'deposit' AND created_at >= ?", [sinceMs])
  ]);

  return { pool, payouts, withdrawals, pendingWithdrawals, deposits24h };
}

async function fetchAdminFinanceActivity({ txWhereSql, txParams, payoutWhereSql, payoutParams, pageSize, offset }) {
  const [transactions, payoutsData, txTotalRow, payoutsTotalRow] = await Promise.all([
    all(
      `
        SELECT t.id, t.user_id, t.type, t.amount, t.status, t.tx_hash, t.created_at,
               COALESCE(NULLIF(TRIM(u.username), ''), u.email, ('User #' || t.user_id)) AS user_label
        FROM transactions t
        LEFT JOIN users u ON u.id = t.user_id
        ${txWhereSql}
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...txParams, pageSize, offset]
    ),
    all(
      `
        SELECT p.id, p.user_id, p.amount_pol, p.source, p.tx_hash, p.created_at,
               COALESCE(NULLIF(TRIM(u.username), ''), u.email, ('User #' || p.user_id)) AS user_label
        FROM payouts p
        LEFT JOIN users u ON u.id = p.user_id
        ${payoutWhereSql}
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...payoutParams, pageSize, offset]
    ),
    get(
      `
        SELECT COUNT(*) AS total
        FROM transactions t
        LEFT JOIN users u ON u.id = t.user_id
        ${txWhereSql}
      `,
      txParams
    ),
    get(
      `
        SELECT COUNT(*) AS total
        FROM payouts p
        LEFT JOIN users u ON u.id = p.user_id
        ${payoutWhereSql}
      `,
      payoutParams
    )
  ]);

  return { transactions, payoutsData, txTotalRow, payoutsTotalRow };
}

async function fetchAdminYoutubeStats(now, dayAgo) {
  const [activeHashRow, activeUsersRow, totalsRow, dayRow] = await Promise.all([
    get("SELECT COALESCE(SUM(hash_rate), 0) AS total FROM youtube_watch_user_powers WHERE expires_at > ?", [now]),
    get("SELECT COUNT(DISTINCT user_id) AS total FROM youtube_watch_user_powers WHERE expires_at > ?", [now]),
    get("SELECT COUNT(*) AS claims, COALESCE(SUM(hash_rate), 0) AS hash_granted FROM youtube_watch_power_history"),
    get(
      "SELECT COUNT(*) AS claims_24h, COALESCE(SUM(hash_rate), 0) AS hash_granted_24h, COUNT(DISTINCT user_id) AS users_24h FROM youtube_watch_power_history WHERE claimed_at >= ?",
      [dayAgo]
    )
  ]);

  return { activeHashRow, activeUsersRow, totalsRow, dayRow };
}

async function fetchAdminYoutubeHistory({ whereSql, params, pageSize, offset }) {
  const [rows, totalRow] = await Promise.all([
    all(
      `
        SELECT
          h.id,
          h.user_id,
          h.hash_rate,
          h.claimed_at,
          h.expires_at,
          h.source_video_id,
          h.status,
          COALESCE(NULLIF(TRIM(u.username), ''), u.email, ('User #' || h.user_id)) AS user_label
        FROM youtube_watch_power_history h
        LEFT JOIN users u ON u.id = h.user_id
        ${whereSql}
        ORDER BY h.claimed_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, pageSize, offset]
    ),
    get(
      `
        SELECT COUNT(*) AS total
        FROM youtube_watch_power_history h
        ${whereSql}
      `,
      params
    )
  ]);

  return { rows, totalRow };
}

async function listChatMessages(limit) {
  return all(
    `
      SELECT id, user_id, username, message, created_at
      FROM chat_messages
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [limit]
  );
}

async function insertChatMessage({ userId, username, message, createdAt }) {
  return run(
    `
      INSERT INTO chat_messages (user_id, username, message, created_at)
      VALUES (?, ?, ?, ?)
    `,
    [userId, username, message, createdAt]
  );
}

async function getLandingStatsRows() {
  const [usersRow, payoutsRow, withdrawalsRow] = await Promise.all([
    get("SELECT COUNT(*) as total FROM users"),
    get("SELECT COALESCE(SUM(amount_pol), 0) as total FROM payouts"),
    get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'withdrawal' AND status = 'completed'")
  ]);
  return { usersRow, payoutsRow, withdrawalsRow };
}

async function listRecentPayments(limit = 10) {
  return all(
    `
      SELECT
        p.id,
        p.amount_pol,
        p.source,
        p.tx_hash,
        p.created_at,
        COALESCE(NULLIF(TRIM(u.username), ''), u.name, 'Miner') AS username
      FROM payouts p
      INNER JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
    [limit]
  );
}

async function getNetworkStatsRows() {
  const [usersRow, payoutsRow, withdrawalsRow, baseNetworkRow] = await Promise.all([
    get("SELECT COUNT(*) as total FROM users"),
    get("SELECT COALESCE(SUM(amount_pol), 0) as total FROM payouts"),
    get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'withdrawal' AND status = 'completed'"),
    get("SELECT COALESCE(SUM(base_hash_rate), 0) as total FROM users_temp_power")
  ]);
  return { usersRow, payoutsRow, withdrawalsRow, baseNetworkRow };
}

async function getEstimatedRewardRows(userId) {
  const [userBaseRow, baseNetworkRow] = await Promise.all([
    get("SELECT COALESCE(base_hash_rate, 0) as total FROM users_temp_power WHERE user_id = ?", [userId]),
    get("SELECT COALESCE(SUM(base_hash_rate), 0) as total FROM users_temp_power")
  ]);
  return { userBaseRow, baseNetworkRow };
}

async function getYoutubeStatusRows(userId, now) {
  const [activeRow, latestClaim] = await Promise.all([
    get(
      "SELECT COALESCE(SUM(hash_rate), 0) AS total FROM youtube_watch_user_powers WHERE user_id = ? AND expires_at > ?",
      [userId, now]
    ),
    get("SELECT claimed_at FROM youtube_watch_power_history WHERE user_id = ? ORDER BY claimed_at DESC LIMIT 1", [userId])
  ]);

  return { activeRow, latestClaim };
}

async function getYoutubeUserStatsRows(userId, now, dayAgo) {
  const [activeRow, totalsRow, dayRow, latestClaim] = await Promise.all([
    get(
      "SELECT COALESCE(SUM(hash_rate), 0) AS total FROM youtube_watch_user_powers WHERE user_id = ? AND expires_at > ?",
      [userId, now]
    ),
    get(
      "SELECT COUNT(*) AS claims, COALESCE(SUM(hash_rate), 0) AS hash_granted FROM youtube_watch_power_history WHERE user_id = ?",
      [userId]
    ),
    get(
      "SELECT COUNT(*) AS claims_24h, COALESCE(SUM(hash_rate), 0) AS hash_granted_24h FROM youtube_watch_power_history WHERE user_id = ? AND claimed_at >= ?",
      [userId, dayAgo]
    ),
    get("SELECT claimed_at FROM youtube_watch_power_history WHERE user_id = ? ORDER BY claimed_at DESC LIMIT 1", [userId])
  ]);

  return { activeRow, totalsRow, dayRow, latestClaim };
}

async function getLatestYoutubeClaim(userId) {
  return get("SELECT claimed_at FROM youtube_watch_power_history WHERE user_id = ? ORDER BY claimed_at DESC LIMIT 1", [userId]);
}

async function grantYoutubeReward({ userId, rewardGh, now, expiresAt, sourceVideoId }) {
  return Promise.all([
    run(
      "INSERT INTO youtube_watch_user_powers (user_id, hash_rate, claimed_at, expires_at, source_video_id) VALUES (?, ?, ?, ?, ?)",
      [userId, rewardGh, now, expiresAt, sourceVideoId]
    ),
    run(
      "INSERT INTO youtube_watch_power_history (user_id, hash_rate, claimed_at, expires_at, source_video_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [userId, rewardGh, now, expiresAt, sourceVideoId, "granted", now]
    )
  ]);
}

async function getOrCreateGame(slug, name) {
  const existing = await get("SELECT id, name, slug FROM games WHERE slug = ?", [slug]);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  let insert;

  try {
    insert = await run("INSERT INTO games (name, slug, is_active, created_at) VALUES (?, ?, ?, ?)", [name, slug, 1, now]);
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (!message.includes("is_active") && !message.includes("created_at")) {
      throw error;
    }

    insert = await run("INSERT INTO games (name, slug) VALUES (?, ?)", [name, slug]);
  }

  return { id: insert.lastID, name, slug };
}

async function insertMemoryClaim({ userId, gameId, rewardGh, now, expiresAt, checkinId }) {
  if (checkinId) {
    return run(
      "INSERT INTO users_powers_games (user_id, game_id, hash_rate, played_at, expires_at, checkin_id) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, gameId, rewardGh, now, expiresAt, checkinId]
    );
  }

  return run(
    "INSERT INTO users_powers_games (user_id, game_id, hash_rate, played_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [userId, gameId, rewardGh, now, expiresAt]
  );
}

async function getMiningEngineStateRows() {
  const [maxBlockRow, totalMintedRow, recentBlocks] = await Promise.all([
    get("SELECT COALESCE(MAX(block_number), 0) AS max_block FROM mining_rewards_log"),
    get("SELECT COALESCE(SUM(reward_amount), 0) AS total_minted FROM mining_rewards_log"),
    all(
      `
        SELECT
          block_number,
          COALESCE(SUM(reward_amount), 0) AS reward,
          COUNT(DISTINCT user_id) AS miner_count,
          MAX(created_at) AS timestamp
        FROM mining_rewards_log
        GROUP BY block_number
        ORDER BY block_number DESC
        LIMIT 12
      `
    )
  ]);

  return { maxBlockRow, totalMintedRow, recentBlocks };
}

async function upsertMinerProfile(miner, now) {
  return run(
    `
      INSERT INTO users_temp_power (user_id, username, wallet_address, rigs, base_hash_rate, balance, lifetime_mined, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        wallet_address = excluded.wallet_address,
        rigs = excluded.rigs,
        base_hash_rate = excluded.base_hash_rate,
        balance = excluded.balance,
        lifetime_mined = excluded.lifetime_mined,
        updated_at = excluded.updated_at
    `,
    [
      miner.userId,
      miner.username,
      miner.walletAddress,
      miner.rigs,
      miner.baseHashRate,
      miner.balance,
      miner.lifetimeMined,
      now,
      now
    ]
  );
}

async function updateUserPolBalance(userId, balance) {
  return run("UPDATE users SET pol_balance = ? WHERE id = ?", [balance, userId]);
}

async function listTempPowerProfiles() {
  return all("SELECT user_id, username, wallet_address, rigs, base_hash_rate, balance, lifetime_mined FROM users_temp_power");
}

async function listDistinctTempPowerUserIds() {
  return all("SELECT DISTINCT user_id FROM users_temp_power WHERE user_id IS NOT NULL");
}

module.exports = {
  markCheckinConfirmed,
  findDailyCheckinByUserAndDate,
  findLatestDailyCheckinByUser,
  findLatestDailyCheckinByUserAndDate,
  updateDailyCheckinDate,
  hasUsersPowersGamesCheckinColumn,
  fetchAdminUserDetails,
  fetchAdminFinanceOverview,
  fetchAdminFinanceActivity,
  fetchAdminYoutubeStats,
  fetchAdminYoutubeHistory,
  listChatMessages,
  insertChatMessage,
  getLandingStatsRows,
  listRecentPayments,
  getNetworkStatsRows,
  getEstimatedRewardRows,
  getYoutubeStatusRows,
  getYoutubeUserStatsRows,
  getLatestYoutubeClaim,
  grantYoutubeReward,
  getOrCreateGame,
  insertMemoryClaim,
  getMiningEngineStateRows,
  upsertMinerProfile,
  updateUserPolBalance,
  listTempPowerProfiles,
  listDistinctTempPowerUserIds
};