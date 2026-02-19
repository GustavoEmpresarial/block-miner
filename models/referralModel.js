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

module.exports = {
  getUserByRefCode,
  createReferral,
  getReferralByReferredId,
  addReferralEarning,
  listReferralEarnings
};
