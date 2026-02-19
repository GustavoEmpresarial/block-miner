const ACCESS_COOKIE_NAME = "blockminer_access";
const REFRESH_COOKIE_NAME = "blockminer_refresh";
const LEGACY_SESSION_COOKIE = "blockminer_session";

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

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  const headerToken = req.headers["x-session-token"] || null;
  if (headerToken) {
    return headerToken;
  }

  const cookies = parseCookie(req.headers.cookie || "");
  return cookies[ACCESS_COOKIE_NAME] || cookies[LEGACY_SESSION_COOKIE] || null;
}

function getRefreshTokenFromRequest(req) {
  const cookies = parseCookie(req.headers.cookie || "");
  return cookies[REFRESH_COOKIE_NAME] || null;
}

module.exports = {
  getTokenFromRequest,
  getRefreshTokenFromRequest,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME
};
