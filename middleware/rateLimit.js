function createRateLimiter({ windowMs = 60_000, max = 30, keyGenerator } = {}) {
  const hits = new Map();
  const resolveKey =
    typeof keyGenerator === "function"
      ? keyGenerator
      : (req) => {
          const userId = req.user?.id ? `user:${req.user.id}` : "anon";
          return `${req.ip}:${req.path}:${userId}`;
        };

  return (req, res, next) => {
    const now = Date.now();
    const key = resolveKey(req);
    const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

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
