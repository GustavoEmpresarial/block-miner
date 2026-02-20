function createRateLimiter({
  windowMs = 60_000,
  max = 30,
  keyGenerator,
  cleanupIntervalMs = 5 * 60_000,
  staleAfterMs = windowMs * 2,
  maxKeys = 10_000
} = {}) {
  const hits = new Map();
  const resolveKey =
    typeof keyGenerator === "function"
      ? keyGenerator
      : (req) => {
          const userId = req.user?.id ? `user:${req.user.id}` : "anon";
          return `${req.ip}:${req.path}:${userId}`;
        };

  let lastCleanupAt = Date.now();

  function cleanup(now) {
    // Remove stale entries.
    for (const [key, entry] of hits) {
      if (!entry || now - (entry.lastSeenAt || 0) > staleAfterMs) {
        hits.delete(key);
      }
    }

    // Hard cap to avoid unbounded growth in worst-case traffic patterns.
    if (maxKeys > 0 && hits.size > maxKeys) {
      const entries = Array.from(hits.entries()).map(([key, entry]) => [key, entry?.lastSeenAt || 0]);
      entries.sort((a, b) => a[1] - b[1]);
      const toRemove = hits.size - maxKeys;
      for (let i = 0; i < toRemove; i += 1) {
        hits.delete(entries[i][0]);
      }
    }
  }

  return (req, res, next) => {
    const now = Date.now();

    if (cleanupIntervalMs > 0 && now - lastCleanupAt >= cleanupIntervalMs) {
      cleanup(now);
      lastCleanupAt = now;
    }

    const key = resolveKey(req);
    const entry = hits.get(key) || { count: 0, resetAt: now + windowMs, lastSeenAt: now };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.lastSeenAt = now;

    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      res.status(429).json({ ok: false, message: "Too many requests. Slow down." });
      return;
    }

    next();
  };
}

module.exports = {
  createRateLimiter
};
