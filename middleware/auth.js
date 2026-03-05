const { getUserById } = require("../models/userModel");
const { signAccessToken, parseRefreshToken, verifyAccessToken } = require("../utils/authTokens");
const { getTokenFromRequest, getRefreshTokenFromRequest, ACCESS_COOKIE_NAME } = require("../utils/token");
const { getRefreshTokenById } = require("../models/refreshTokenModel");
const logger = require("../utils/logger").child("AuthMiddleware");

function buildCookie(name, value, maxAgeSeconds, options = {}) {
  const {
    sameSite = "Strict",
    path = "/"
  } = options;

  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    `Path=${path}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Priority=High"
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function buildAccessCookie(accessToken) {
  const payload = verifyAccessToken(accessToken);
  const expSeconds = Number(payload?.exp || 0);
  const maxAgeSeconds = Math.max(0, expSeconds - Math.floor(Date.now() / 1000));
  return buildCookie(ACCESS_COOKIE_NAME, accessToken, maxAgeSeconds, { sameSite: "Strict", path: "/" });
}

async function authenticateFromRefreshCookie(req, res) {
  try {
    const rawRefreshToken = getRefreshTokenFromRequest(req);
    const parsed = parseRefreshToken(rawRefreshToken);
    if (!parsed?.tokenId || !parsed?.tokenHash) {
      return null;
    }

    const tokenRecord = await getRefreshTokenById(parsed.tokenId);
    if (!tokenRecord || tokenRecord.revoked_at || Number(tokenRecord.expires_at || 0) <= Date.now()) {
      return null;
    }

    if (String(tokenRecord.token_hash || "") !== String(parsed.tokenHash || "")) {
      return null;
    }

    const user = await getUserById(tokenRecord.user_id);
    if (!user || user.is_banned) {
      return null;
    }

    const accessToken = signAccessToken({ id: user.id, name: user.name, email: user.email });
    res.append("Set-Cookie", buildAccessCookie(accessToken));
    return user;
  } catch (error) {
    logger.debug("Refresh-cookie auth fallback failed", { error: error?.message || "unknown_error" });
    return null;
  }
}

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
      const userFromRefresh = await authenticateFromRefreshCookie(req, res);
      if (!userFromRefresh) {
        res.status(401).json({ ok: false, message: "Session invalid." });
        return;
      }

      req.user = userFromRefresh;
      next();
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
      const userFromRefresh = await authenticateFromRefreshCookie(req, res);
      if (!userFromRefresh) {
        res.redirect(302, "/login");
        return;
      }

      req.user = userFromRefresh;
      next();
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
