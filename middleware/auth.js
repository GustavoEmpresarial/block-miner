const { getUserById } = require("../models/userModel");
const { verifyAccessToken } = require("../utils/authTokens");
const { getTokenFromRequest } = require("../utils/token");

async function requireAuth(req, res, next) {
  console.log("[Auth Middleware] 🔐 requireAuth called");
  console.log("[Auth Middleware] Method:", req.method);
  console.log("[Auth Middleware] Path:", req.path);
  console.log("[Auth Middleware] Headers:", req.headers);
  
  try {
    const token = getTokenFromRequest(req);
    console.log("[Auth Middleware] Token:", token ? "EXISTS (length: " + token.length + ")" : "NOT FOUND");
    
    if (!token) {
      console.log("[Auth Middleware] ❌ No token, returning 401");
      res.status(401).json({ ok: false, message: "Session invalid." });
      return;
    }

    let payload = null;
    try {
      payload = verifyAccessToken(token);
      console.log("[Auth Middleware] ✅ Token verified, payload:", payload);
    } catch (err) {
      console.log("[Auth Middleware] ❌ Token verification failed:", err.message);
      payload = null;
    }

    const userId = Number(payload?.sub);
    console.log("[Auth Middleware] User ID from token:", userId);
    
    if (!userId) {
      console.log("[Auth Middleware] ❌ No userId, returning 401");
      res.status(401).json({ ok: false, message: "Session invalid." });
      return;
    }

    const user = await getUserById(userId);
    console.log("[Auth Middleware] User from DB:", user ? `Found (id: ${user.id})` : "NOT FOUND");
    
    if (!user) {
      console.log("[Auth Middleware] ❌ User not found, returning 401");
      res.status(401).json({ ok: false, message: "Session invalid." });
      return;
    }

    if (user.is_banned) {
      console.log("[Auth Middleware] ❌ User is banned, returning 403");
      res.status(403).json({ ok: false, message: "Account disabled." });
      return;
    }

    req.user = user;
    console.log("[Auth Middleware] ✅ Authentication successful, calling next()");
    next();
  } catch (error) {
    console.error("[Auth Middleware] ❌ Auth middleware error:", error);
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
    console.error("Page auth middleware error:", error);
    res.redirect(302, "/login");
  }
}

module.exports = {
  requireAuth,
  requirePageAuth
};
