const crypto = require("crypto");

const CSRF_COOKIE_NAME = "blockminer_csrf";

function parseCookie(headerValue) {
  if (!headerValue) {
    return {};
  }

  return headerValue.split(";").reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) {
      return acc;
    }

    acc[rawKey] = decodeURIComponent(rawValue.join("=") || "");
    return acc;
  }, {});
}

function hasBearerAuth(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ");
}

function isUnsafeMethod(method) {
  const m = String(method || "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

function buildCsrfCookie(token) {
  const parts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Strict"
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function appendSetCookie(res, cookieValue) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookieValue]);
    return;
  }

  res.setHeader("Set-Cookie", [existing, cookieValue]);
}

function ensureCsrfCookie(req, res) {
  const cookies = parseCookie(req.headers.cookie || "");
  const existing = cookies[CSRF_COOKIE_NAME];
  if (existing && typeof existing === "string" && existing.length >= 16) {
    return existing;
  }

  const token = crypto.randomBytes(24).toString("base64url");
  appendSetCookie(res, buildCsrfCookie(token));
  return token;
}

function createCsrfMiddleware({
  accessCookieName = "blockminer_access",
  refreshCookieName = "blockminer_refresh"
} = {}) {
  return (req, res, next) => {
    const cookies = parseCookie(req.headers.cookie || "");
    const hasAuthCookie = Boolean(cookies[accessCookieName] || cookies[refreshCookieName]);

    // Always ensure a CSRF cookie exists (so the SPA can read and echo it).
    const csrfCookie = ensureCsrfCookie(req, res);

    // Enforce CSRF only for unsafe requests authenticated via cookies.
    // If Authorization: Bearer is present, CSRF is not required (cross-site requests cannot set it).
    if (!hasAuthCookie || !isUnsafeMethod(req.method) || hasBearerAuth(req)) {
      res.locals.csrfToken = csrfCookie;
      next();
      return;
    }

    const headerToken = String(req.headers["x-csrf-token"] || "").trim();
    if (!headerToken || headerToken !== csrfCookie) {
      res.status(403).json({ ok: false, message: "CSRF validation failed." });
      return;
    }

    res.locals.csrfToken = csrfCookie;
    next();
  };
}

module.exports = {
  CSRF_COOKIE_NAME,
  createCsrfMiddleware
};
