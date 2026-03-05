const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function sanitizeString(value) {
  if (typeof value !== "string") {
    return value;
  }

  // Remove null bytes and dangerous bidi control chars often abused in spoofing.
  return value
    .replace(/\u0000/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
}

function inspectAndSanitize(value, state, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }

  state.nodes += 1;
  if (state.nodes > state.maxNodes) {
    throw new Error("payload_too_complex");
  }

  if (depth > state.maxDepth) {
    throw new Error("payload_too_deep");
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    if (value.length > state.maxArrayLength) {
      throw new Error("array_too_large");
    }

    for (let i = 0; i < value.length; i += 1) {
      value[i] = inspectAndSanitize(value[i], state, depth + 1);
    }
    return value;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  for (const key of Object.keys(value)) {
    const lowered = String(key).toLowerCase();
    if (FORBIDDEN_KEYS.has(lowered)) {
      throw new Error("forbidden_key");
    }
    value[key] = inspectAndSanitize(value[key], state, depth + 1);
  }

  return value;
}

function createRequestGuard({ maxDepth = 12, maxNodes = 5000, maxArrayLength = 1000 } = {}) {
  return (req, res, next) => {
    try {
      const state = { maxDepth, maxNodes, maxArrayLength, nodes: 0 };

      if (req.body && (isPlainObject(req.body) || Array.isArray(req.body))) {
        req.body = inspectAndSanitize(req.body, state, 0);
      }

      if (req.query && isPlainObject(req.query)) {
        req.query = inspectAndSanitize(req.query, state, 0);
      }

      if (req.params && isPlainObject(req.params)) {
        req.params = inspectAndSanitize(req.params, state, 0);
      }

      next();
    } catch {
      res.status(400).json({ ok: false, message: "Invalid or unsafe request payload." });
    }
  };
}

module.exports = {
  createRequestGuard
};
