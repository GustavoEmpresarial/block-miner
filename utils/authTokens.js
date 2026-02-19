const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "12h";
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const JWT_ISSUER = process.env.JWT_ISSUER || "blockminer";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "blockminer.app";
const JWT_SECRET = process.env.JWT_SECRET;

function requireJwtSecret() {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
  }
  return JWT_SECRET;
}

function signAccessToken(user) {
  const payload = {
    sub: String(user.id),
    name: user.name,
    email: user.email
  };

  return jwt.sign(payload, requireJwtSecret(), {
    expiresIn: ACCESS_TOKEN_TTL,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, requireJwtSecret(), {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });
}

function hashRefreshSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function createRefreshToken() {
  const tokenId = crypto.randomUUID();
  const secret = crypto.randomBytes(48).toString("hex");
  const token = `${tokenId}.${secret}`;
  const expiresAt = Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  return {
    token,
    tokenId,
    tokenHash: hashRefreshSecret(secret),
    expiresAt
  };
}

function parseRefreshToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") {
    return null;
  }

  const parts = rawToken.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [tokenId, secret] = parts;
  if (!tokenId || !secret) {
    return null;
  }

  return {
    tokenId,
    secret,
    tokenHash: hashRefreshSecret(secret)
  };
}

module.exports = {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS,
  signAccessToken,
  verifyAccessToken,
  createRefreshToken,
  parseRefreshToken
};
