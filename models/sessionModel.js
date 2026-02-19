const { get } = require("./db");

async function getSessionUserByToken(token) {
  if (!token) {
    return null;
  }

  const now = Date.now();
  return get(
    `
      SELECT u.id, u.name, u.email
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?
    `,
    [token, now]
  );
}

module.exports = {
  getSessionUserByToken
};
