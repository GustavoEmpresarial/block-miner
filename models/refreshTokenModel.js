const { get, run } = require("./db");

async function createRefreshTokenRecord({ userId, tokenId, tokenHash, createdAt, expiresAt }) {
  await run(
    `
      INSERT INTO refresh_tokens (user_id, token_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    [userId, tokenId, tokenHash, createdAt, expiresAt]
  );
}

async function getRefreshTokenById(tokenId) {
  return get(
    `
      SELECT id, user_id, token_id, token_hash, created_at, expires_at, revoked_at, replaced_by
      FROM refresh_tokens
      WHERE token_id = ?
    `,
    [tokenId]
  );
}

async function revokeRefreshToken({ tokenId, revokedAt, replacedBy }) {
  await run(
    `
      UPDATE refresh_tokens
      SET revoked_at = ?, replaced_by = ?
      WHERE token_id = ?
    `,
    [revokedAt, replacedBy || null, tokenId]
  );
}

async function revokeRefreshTokensForUser(userId) {
  const now = Date.now();
  await run(
    `
      UPDATE refresh_tokens
      SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `,
    [now, userId]
  );
}

module.exports = {
  createRefreshTokenRecord,
  getRefreshTokenById,
  revokeRefreshToken,
  revokeRefreshTokensForUser
};
