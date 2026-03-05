const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.DB_PATH = process.env.DB_PATH || "./data/blockminer.db";

const { startGamePowerCleanup } = require("../cron/gamePowerCleanup");

test("game power cleanup marks expired rows instead of deleting", async () => {
  const sqlCalls = [];

  const run = async (sql) => {
    sqlCalls.push(String(sql || ""));
    return { changes: 1 };
  };

  const timers = startGamePowerCleanup({ run }, { cleanupMs: 60_000 });

  // Wait one tick because cleanup runs immediately on startup.
  await new Promise((resolve) => setTimeout(resolve, 20));

  if (timers?.cleanupTimer) {
    clearInterval(timers.cleanupTimer);
  }

  const combinedSql = sqlCalls.join("\n");

  assert.match(combinedSql, /UPDATE\s+users_powers_games\s+SET\s+is_expired\s*=\s*1/i);
  assert.match(combinedSql, /UPDATE\s+youtube_watch_user_powers\s+SET\s+is_expired\s*=\s*1/i);
  assert.equal(/DELETE\s+FROM\s+users_powers_games/i.test(combinedSql), false);
  assert.equal(/DELETE\s+FROM\s+youtube_watch_user_powers/i.test(combinedSql), false);
});
