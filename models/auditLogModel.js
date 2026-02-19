const { run } = require("./db");

async function createAuditLog({ userId, action, ip, userAgent, details }) {
  const now = Date.now();
  const detailsJson = details ? JSON.stringify(details) : null;

  await run(
    `
      INSERT INTO audit_logs (user_id, action, ip, user_agent, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [userId || null, action, ip || null, userAgent || null, detailsJson, now]
  );
}

module.exports = {
  createAuditLog
};
