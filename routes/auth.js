const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { z } = require("zod");
const { run, get } = require("../src/db/sqlite");
const { getTokenFromRequest, getRefreshTokenFromRequest, ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } = require("../utils/token");
const { signAccessToken, createRefreshToken, parseRefreshToken, verifyAccessToken } = require("../utils/authTokens");
const { createRefreshTokenRecord, getRefreshTokenById, revokeRefreshToken } = require("../models/refreshTokenModel");
const { updateUserLoginMeta } = require("../models/userModel");
const { createAuditLog } = require("../models/auditLogModel");
const { createRateLimiter } = require("../middleware/rateLimit");
const { validateBody } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { getUserByRefCode, createReferral, listReferredUsers } = require("../models/referralModel");
const { getMinerBySlug } = require("../models/minersModel");
const { addInventoryItem } = require("../models/inventoryModel");
const { getAnonymizedRequestIp } = require("../utils/clientIp");
const logger = require("../utils/logger").child("AuthRoutes");

const authRouter = express.Router();

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const MAX_FAILED_ATTEMPTS_EMAIL = parseIntOr(process.env.MAX_FAILED_ATTEMPTS_EMAIL, 5);
const MAX_FAILED_ATTEMPTS_IP = parseIntOr(process.env.MAX_FAILED_ATTEMPTS_IP, 15);
const LOCKOUT_DURATION_MS = parseIntOr(process.env.LOCKOUT_DURATION_MS, 15 * 60 * 1000); // 15 minutes
const ATTEMPT_TTL_MS = parseIntOr(process.env.LOGIN_ATTEMPT_TTL_MS, 60 * 60 * 1000); // 1 hour

const CLEANUP_SAMPLE_RATE = Math.min(1, Math.max(0, Number(process.env.LOGIN_ATTEMPT_CLEANUP_RATE || 0.03)));

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function maskEmail(email) {
  const value = normalizeEmail(email);
  const at = value.indexOf("@");
  if (at <= 1) return value ? "***" : "";
  const user = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${user[0]}***@${domain}`;
}

async function maybeCleanupLockouts() {
  if (CLEANUP_SAMPLE_RATE <= 0) return;
  if (Math.random() > CLEANUP_SAMPLE_RATE) return;

  const now = Date.now();
  const cutoff = now - ATTEMPT_TTL_MS;

  try {
    await run(
      "DELETE FROM auth_lockouts WHERE last_at < ? AND (locked_until IS NULL OR locked_until <= ?)",
      [cutoff, now]
    );
  } catch (error) {
    logger.debug("Failed to cleanup auth_lockouts", { error: error.message });
  }
}

async function getLockout(kind, value) {
  const row = await get(
    "SELECT count, locked_until, last_at FROM auth_lockouts WHERE kind = ? AND value = ?",
    [kind, value]
  );

  if (!row) return null;

  const now = Date.now();
  const lockedUntil = Number(row.locked_until || 0);
  const lastAt = Number(row.last_at || 0);

  // Expired or stale records can be ignored.
  if ((lockedUntil && now >= lockedUntil) || (lastAt && now - lastAt > ATTEMPT_TTL_MS && now >= lockedUntil)) {
    try {
      await run("DELETE FROM auth_lockouts WHERE kind = ? AND value = ?", [kind, value]);
    } catch {
      // ignore
    }
    return null;
  }

  return {
    count: Number(row.count || 0),
    lockedUntil,
    lastAt
  };
}

async function isLocked(kind, value) {
  const record = await getLockout(kind, value);
  return Boolean(record && record.lockedUntil && Date.now() < record.lockedUntil);
}

async function recordFailed(kind, value, maxFails) {
  const now = Date.now();
  const current = await getLockout(kind, value);
  const nextCount = (current?.count || 0) + 1;
  const shouldLock = nextCount >= maxFails;
  const lockedUntil = shouldLock ? now + LOCKOUT_DURATION_MS : Number(current?.lockedUntil || 0);

  await run(
    `
      INSERT INTO auth_lockouts (kind, value, count, locked_until, last_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(kind, value) DO UPDATE SET
        count = excluded.count,
        locked_until = excluded.locked_until,
        last_at = excluded.last_at
    `,
    [kind, value, nextCount, lockedUntil, now]
  );

  return { count: nextCount, lockedUntil, lastAt: now };
}

async function clearFailures(kind, value) {
  if (!value) return;
  await run("DELETE FROM auth_lockouts WHERE kind = ? AND value = ?", [kind, value]);
}

async function auditAuthEvent(req, { userId, action, details }) {
  const ipPrefix = getAnonymizedRequestIp(req);
  const userAgent = req.get("user-agent");
  try {
    await createAuditLog({
      userId: userId || null,
      action,
      ip: ipPrefix,
      userAgent,
      details
    });
  } catch (error) {
    logger.warn("Failed to write auth audit log", { action, error: error.message });
  }
}

function buildCookie(name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
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
  return buildCookie(ACCESS_COOKIE_NAME, accessToken, maxAgeSeconds);
}

function buildRefreshCookie(refreshToken, expiresAt) {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return buildCookie(REFRESH_COOKIE_NAME, refreshToken, maxAgeSeconds);
}

function clearAuthCookies() {
  const access = buildCookie(ACCESS_COOKIE_NAME, "", 0);
  const refresh = buildCookie(REFRESH_COOKIE_NAME, "", 0);
  return [access, refresh];
}

async function generateUniqueRefCode() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = crypto.randomBytes(5).toString("hex");
    const exists = await get("SELECT id FROM users WHERE ref_code = ?", [code]);
    if (!exists) {
      return code;
    }
  }

  throw new Error("Unable to generate referral code");
}

async function ensureUserRefCode(userId) {
  if (!userId) {
    return null;
  }

  const existing = await get("SELECT ref_code FROM users WHERE id = ?", [userId]);
  if (existing?.ref_code) {
    return existing.ref_code;
  }

  const refCode = await generateUniqueRefCode();
  await run("UPDATE users SET ref_code = ? WHERE id = ?", [refCode, userId]);
  return refCode;
}

const registerSchema = z
  .object({
    username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    name: z.string().trim().min(3).max(24).optional(),
    email: z.string().trim().email(),
    password: z.string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain uppercase letter")
      .regex(/[a-z]/, "Password must contain lowercase letter")
      .regex(/[0-9]/, "Password must contain number")
      .regex(/[!@#$%^&*()_+\-=\[\]{};:'",.<>?\\/\|`~]/, "Password must contain special character"),
    refCode: z.string().trim().max(32).optional()
  })
  .strict()
  .refine((data) => data.username || data.name, { message: "Username required", path: ["username"] });

const loginSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8)
  })
  .strict();

const authLimiter = createRateLimiter({ windowMs: 60_000, max: 12, keyGenerator: (req) => `${req.ip}:auth` });
const refreshLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyGenerator: (req) => `${req.ip}:refresh` });

authRouter.post("/register", authLimiter, validateBody(registerSchema), async (req, res) => {
  try {
    const username = String(req.body?.username || req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const refCodeInput = String(req.body?.refCode || "").trim();

    if (username.length < 3 || !email || password.length < 6) {
      res.status(400).json({ ok: false, message: "Invalid registration data." });
      return;
    }

    const existingEmail = await get("SELECT id FROM users WHERE email = ?", [email]);
    if (existingEmail) {
      res.status(409).json({ ok: false, message: "Email already registered." });
      return;
    }

    const existingUsername = await get("SELECT id FROM users WHERE lower(username) = ?", [username.toLowerCase()]);
    if (existingUsername) {
      res.status(409).json({ ok: false, message: "Username already registered." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const createdAt = Date.now();
    const refCode = await generateUniqueRefCode();
    let referredBy = null;

    if (refCodeInput && /^[a-zA-Z0-9_-]{4,32}$/.test(refCodeInput)) {
      const referrer = await getUserByRefCode(refCodeInput);
      if (referrer?.id) {
        referredBy = referrer.id;
      }
    }

    const insertResult = await run(
      "INSERT INTO users (name, username, email, password_hash, created_at, ref_code, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [username, username, email, passwordHash, createdAt, refCode, referredBy]
    );

    if (referredBy) {
      await createReferral(referredBy, insertResult.lastID);

      const atlasMiner = await getMinerBySlug("atlas-duo");
      if (atlasMiner) {
        const now = Date.now();
        await addInventoryItem(
          insertResult.lastID,
          atlasMiner.name,
          1,
          atlasMiner.base_hash_rate,
          atlasMiner.slot_size,
          now,
          now,
          atlasMiner.id
        );
      }
    }

    const accessToken = signAccessToken({ id: insertResult.lastID, name: username, email });
    const refreshToken = createRefreshToken();
    await createRefreshTokenRecord({
      userId: insertResult.lastID,
      tokenId: refreshToken.tokenId,
      tokenHash: refreshToken.tokenHash,
      createdAt: Date.now(),
      expiresAt: refreshToken.expiresAt
    });

    const ipPrefix = getAnonymizedRequestIp(req);
    const userAgent = req.get("user-agent");
    await updateUserLoginMeta(insertResult.lastID, { ip: ipPrefix, userAgent });
    try {
      await createAuditLog({
        userId: insertResult.lastID,
        action: "register",
        ip: ipPrefix,
        userAgent,
        details: { email, referredBy: referredBy || null }
      });
    } catch (logError) {
      console.error("Failed to write register audit log:", logError);
    }

    res.setHeader("Set-Cookie", [
      buildAccessCookie(accessToken),
      buildRefreshCookie(refreshToken.token, refreshToken.expiresAt)
    ]);

    res.status(201).json({
      ok: true,
      message: "Registration successful.",
      token: accessToken,
      user: { id: insertResult.lastID, name: username, username, email }
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to register right now." });
  }
});

authRouter.post("/login", authLimiter, validateBody(loginSchema), async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const ipKey = String(req.ip || "unknown");

    await maybeCleanupLockouts();

    if (!email || !password) {
      res.status(400).json({ ok: false, message: "Email and password are required." });
      return;
    }

    // Check lockout by email/IP
    if (await isLocked("email", email) || await isLocked("ip", ipKey)) {
      await auditAuthEvent(req, {
        userId: null,
        action: "login_locked",
        details: { email: maskEmail(email) }
      });
      res.status(429).json({ ok: false, message: "Account temporarily locked. Try again later." });
      return;
    }

    const user = await get("SELECT id, name, email, password_hash FROM users WHERE email = ?", [email]);
    if (!user) {
      await recordFailed("email", email, MAX_FAILED_ATTEMPTS_EMAIL);
      await recordFailed("ip", ipKey, MAX_FAILED_ATTEMPTS_IP);
      await auditAuthEvent(req, {
        userId: null,
        action: "login_failed",
        details: { email: maskEmail(email), reason: "user_not_found" }
      });
      res.status(401).json({ ok: false, message: "Invalid email or password." });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      await recordFailed("email", email, MAX_FAILED_ATTEMPTS_EMAIL);
      await recordFailed("ip", ipKey, MAX_FAILED_ATTEMPTS_IP);
      await auditAuthEvent(req, {
        userId: user.id,
        action: "login_failed",
        details: { email: maskEmail(email), reason: "bad_password" }
      });
      res.status(401).json({ ok: false, message: "Invalid email or password." });
      return;
    }

    // Clear failed attempts on successful login
    await Promise.allSettled([
      clearFailures("email", email),
      clearFailures("ip", ipKey)
    ]);

    const accessToken = signAccessToken({ id: user.id, name: user.name, email: user.email });
    const refreshToken = createRefreshToken();
    await createRefreshTokenRecord({
      userId: user.id,
      tokenId: refreshToken.tokenId,
      tokenHash: refreshToken.tokenHash,
      createdAt: Date.now(),
      expiresAt: refreshToken.expiresAt
    });

    const ipPrefix = getAnonymizedRequestIp(req);
    const userAgent = req.get("user-agent");

    await updateUserLoginMeta(user.id, {
      ip: ipPrefix,
      userAgent
    });

    await auditAuthEvent(req, { userId: user.id, action: "login", details: { email: maskEmail(email) } });

    res.setHeader("Set-Cookie", [
      buildAccessCookie(accessToken),
      buildRefreshCookie(refreshToken.token, refreshToken.expiresAt)
    ]);

    res.json({
      ok: true,
      message: "Login successful.",
      token: accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to login right now." });
  }
});

authRouter.get("/session", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ ok: false, message: "Session not found." });
      return;
    }

    let payload = null;
    try {
      payload = verifyAccessToken(token);
    } catch {
      payload = null;
    }

    if (!payload?.sub) {
      res.status(401).json({ ok: false, message: "Session not found." });
      return;
    }

    const user = await get("SELECT id, name, email, is_banned FROM users WHERE id = ?", [payload.sub]);
    if (!user) {
      res.status(401).json({ ok: false, message: "Session not found." });
      return;
    }

    if (user.is_banned) {
      res.status(403).json({ ok: false, message: "Account disabled." });
      return;
    }

    res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to check session." });
  }
});

authRouter.post("/refresh", refreshLimiter, async (req, res) => {
  try {
    const rawToken = getRefreshTokenFromRequest(req);
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) {
      await auditAuthEvent(req, { userId: null, action: "refresh_failed", details: { reason: "parse_failed" } });
      res.status(401).json({ ok: false, message: "Refresh token invalid." });
      return;
    }

    const existing = await getRefreshTokenById(parsed.tokenId);
    if (!existing || existing.revoked_at || existing.expires_at <= Date.now()) {
      await auditAuthEvent(req, { userId: null, action: "refresh_failed", details: { reason: "token_missing_or_revoked" } });
      res.status(401).json({ ok: false, message: "Refresh token invalid." });
      return;
    }

    if (existing.token_hash !== parsed.tokenHash) {
      await auditAuthEvent(req, { userId: existing.user_id || null, action: "refresh_failed", details: { reason: "hash_mismatch" } });
      res.status(401).json({ ok: false, message: "Refresh token invalid." });
      return;
    }

    const user = await get("SELECT id, name, email, is_banned FROM users WHERE id = ?", [existing.user_id]);
    if (!user) {
      await auditAuthEvent(req, { userId: existing.user_id || null, action: "refresh_failed", details: { reason: "user_missing" } });
      res.status(401).json({ ok: false, message: "Refresh token invalid." });
      return;
    }

    if (user.is_banned) {
      await auditAuthEvent(req, { userId: user.id, action: "refresh_failed", details: { reason: "user_banned" } });
      res.status(403).json({ ok: false, message: "Account disabled." });
      return;
    }

    const accessToken = signAccessToken({ id: user.id, name: user.name, email: user.email });
    const refreshToken = createRefreshToken();

    await revokeRefreshToken({ tokenId: parsed.tokenId, revokedAt: Date.now(), replacedBy: refreshToken.tokenId });
    await createRefreshTokenRecord({
      userId: user.id,
      tokenId: refreshToken.tokenId,
      tokenHash: refreshToken.tokenHash,
      createdAt: Date.now(),
      expiresAt: refreshToken.expiresAt
    });

    res.setHeader("Set-Cookie", [
      buildAccessCookie(accessToken),
      buildRefreshCookie(refreshToken.token, refreshToken.expiresAt)
    ]);

    await auditAuthEvent(req, { userId: user.id, action: "refresh", details: {} });

    res.json({ ok: true, token: accessToken });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to refresh session." });
  }
});

authRouter.get("/referral", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ ok: false, message: "Session not found." });
      return;
    }

    let payload = null;
    try {
      payload = verifyAccessToken(token);
    } catch {
      payload = null;
    }

    if (!payload?.sub) {
      res.status(401).json({ ok: false, message: "Session not found." });
      return;
    }

    const refCode = await ensureUserRefCode(payload.sub);
    res.json({ ok: true, refCode });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to load referral data." });
  }
});

authRouter.get("/referral/invited", requireAuth, async (req, res) => {
  try {
    const limit = Number(req.query?.limit || 50);
    const rows = await listReferredUsers(req.user.id, limit);
    const invited = rows.map((row) => ({
      id: row.id,
      username: row.username || row.name || `User #${row.id}`,
      joinedAt: row.user_created_at,
      referredAt: row.referred_at
    }));
    res.json({ ok: true, invited });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to load invited users." });
  }
});

authRouter.post("/logout", async (req, res) => {
  try {
    const refreshRaw = getRefreshTokenFromRequest(req);
    const parsed = parseRefreshToken(refreshRaw);
    if (parsed?.tokenId) {
      await revokeRefreshToken({ tokenId: parsed.tokenId, revokedAt: Date.now(), replacedBy: null });
    }

    await auditAuthEvent(req, { userId: null, action: "logout", details: {} });

    res.setHeader("Set-Cookie", clearAuthCookies());
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to logout." });
  }
});

module.exports = { authRouter };
