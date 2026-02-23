const jwt = require("jsonwebtoken");
const { getAdminTokenFromRequest } = require("../utils/token");
const logger = require("../utils/logger").child("AdminAuthMiddleware");

function requireAdminAuth(req, res, next) {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error("Admin JWT secret is missing");
      return res.status(503).json({ ok: false, message: "Admin auth unavailable." });
    }

    const token = getAdminTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({ ok: false, message: "Admin session invalid." });
    }

    let payload = null;
    try {
      payload = jwt.verify(token, jwtSecret, {
        issuer: "blockminer-admin",
        algorithms: ["HS256"]
      });
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        logger.debug("Admin token verification failed", { error: err.message });
      }
      return res.status(401).json({ ok: false, message: "Admin session invalid." });
    }

    // Verificar se é um token de admin
    if (payload.role !== "admin" || payload.type !== "admin_session") {
      logger.warn("Attempted to access admin with invalid token type");
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    req.admin = { role: "admin" };
    next();
  } catch (error) {
    logger.error("Admin auth middleware error", { error: error.message });
    return res.status(500).json({ ok: false, message: "Unable to authenticate." });
  }
}

module.exports = {
  requireAdminAuth
};
