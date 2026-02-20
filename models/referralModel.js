const { run, get, all } = require("./db");

async function getUserByRefCode(refCode) {
  if (!refCode) return null;
  return get("SELECT id, username, ref_code FROM users WHERE ref_code = ?", [refCode]);
}

async function createReferral(referrerId, referredId) {
  const now = Date.now();
  return run(
    "INSERT OR IGNORE INTO referrals (referrer_id, referred_id, created_at) VALUES (?, ?, ?)",
    [referrerId, referredId, now]
  );
}

async function getReferralByReferredId(referredId) {
  return get("SELECT id, referrer_id, referred_id, created_at FROM referrals WHERE referred_id = ?", [referredId]);
}

async function addReferralEarning(referrerId, referredId, amount, source) {
  const now = Date.now();
  return run(
    "INSERT INTO referral_earnings (referrer_id, referred_id, amount, source, created_at) VALUES (?, ?, ?, ?, ?)",
    [referrerId, referredId, amount, source, now]
  );
}

async function listReferralEarnings(referrerId, limit = 50) {
  return all(
    "SELECT id, referrer_id, referred_id, amount, source, created_at FROM referral_earnings WHERE referrer_id = ? ORDER BY created_at DESC LIMIT ?",
    [referrerId, limit]
  );
}

async function listReferredUsers(referrerId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return all(
    `
      SELECT
        u.id AS id,
        u.username AS username,
        u.name AS name,
        u.created_at AS user_created_at,
        r.created_at AS referred_at
      FROM referrals r
      JOIN users u ON u.id = r.referred_id
      WHERE r.referrer_id = ?
      ORDER BY r.created_at DESC
      LIMIT ?
    `,
    [referrerId, safeLimit]
  );
}

module.exports = {
  getUserByRefCode,
  createReferral,
  getReferralByReferredId,
  addReferralEarning,
  listReferralEarnings,
  listReferredUsers
};
