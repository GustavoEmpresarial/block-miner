const DEFAULT_CLEANUP_MS = 10 * 60 * 1000;

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

  cleanup();
  const cleanupTimer = setInterval(cleanup, cleanupMs);

  return { cleanupTimer };
}

module.exports = {
  startGamePowerCleanup
};
