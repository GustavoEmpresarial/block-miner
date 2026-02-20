const { getUserById } = require("../models/userModel");
const { verifyAccessToken } = require("../utils/authTokens");
const { getTokenFromRequest } = require("../utils/token");
const logger = require("../utils/logger").child("AuthMiddleware");

async function requireAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      res.status(401).json({ ok: false, message: "Session invalid." });
      return;
    }

    let payload = null;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        logger.debug("Token verification failed", { error: err.message });
      }
      payload = null;
    }

    const userId = Number(payload?.sub);
    
    if (!userId) {
      res.status(401).json({ ok: false, message: "Session invalid." });
      return;
    }

    const user = await getUserById(userId);
    
    if (!user) {
      res.status(401).json({ ok: false, message: "Session invalid." });
      return;
    }

    if (user.is_banned) {
      res.status(403).json({ ok: false, message: "Account disabled." });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error("Auth middleware error", { error: error.message });
    res.status(500).json({ ok: false, message: "Unable to authenticate." });
  }
}

async function requirePageAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      res.redirect(302, "/login");
      return;
    }

    let payload = null;
    try {
      payload = verifyAccessToken(token);
    } catch {
      payload = null;
    }

    const userId = Number(payload?.sub);
    if (!userId) {
      res.redirect(302, "/login");
      return;
    }

    const user = await getUserById(userId);
    if (!user) {
      res.redirect(302, "/login");
      return;
    }

    if (user.is_banned) {
      res.redirect(302, "/login");
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error("Page auth middleware error", { error: error.message });
    res.redirect(302, "/login");
  }
}

module.exports = {
  requireAuth,
  requirePageAuth
};
