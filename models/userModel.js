const { get, run } = require("./db");

async function getUserById(userId) {
  return get(
    `
      SELECT id, name, username, email, is_banned
      FROM users
      WHERE id = ?
    `,
    [userId]
  );
}

async function updateUserLoginMeta(userId, { ip, userAgent }) {
  const now = Date.now();
  await run(
    `
      UPDATE users
      SET last_login_at = ?, ip = ?, user_agent = ?
      WHERE id = ?
    `,
    [now, ip || null, userAgent || null, userId]
  );
}

module.exports = {
  getUserById,
  updateUserLoginMeta
};
