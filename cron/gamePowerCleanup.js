const DEFAULT_CLEANUP_MS = 10 * 60 * 1000;
const cron = require('node-cron');
const config = require('../src/config');

function startGamePowerCleanup({ run }, options = {}) {
  const cleanupMs = Number(options.cleanupMs || DEFAULT_CLEANUP_MS);

  const cleanup = async () => {
    try {
      const now = Date.now();
      await run("DELETE FROM users_powers_games WHERE expires_at <= ?", [now]);
    } catch (error) {
      console.error("Failed to cleanup expired game powers:", error);
    }
  };

  // If a cron expression is provided, use it
  const cronExpr = config?.schedules?.gameCleanupCron;
  if (cronExpr) {
    try {
      const task = cron.schedule(cronExpr, () => {
        cleanup().catch(err => console.error('Game cleanup failed', err));
      }, { scheduled: true });

      // Run once on start
      cleanup();
      return { cleanupCronTask: task };
    } catch (error) {
      console.error('Invalid game cleanup cron, falling back to interval', { cronExpr, error: error.message });
    }
  }

  cleanup();
  const cleanupTimer = setInterval(cleanup, cleanupMs);

  return { cleanupTimer };
}

module.exports = {
  startGamePowerCleanup
};
