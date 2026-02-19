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
const { getUserByRefCode, createReferral } = require("../models/referralModel");
const { getMinerBySlug } = require("../models/minersModel");
const { addInventoryItem } = require("../models/inventoryModel");

const authRouter = express.Router();

// Track failed login attempts for brute-force protection
const failedAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function checkAccountLockout(email) {
  const record = failedAttempts.get(email);
  if (!record) return false;
  
  if (Date.now() < record.lockedUntil) {
    return true; // Account is locked
  }
  
  // Lockout expired, clear it
  failedAttempts.delete(email);
  return false;
}

function recordFailedAttempt(email) {
  const record = failedAttempts.get(email) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  
  failedAttempts.set(email, record);
}

function clearFailedAttempts(email) {
  failedAttempts.delete(email);
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
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      res.status(400).json({ ok: false, message: "Email and password are required." });
      return;
    }

    // Check if account is locked due to failed attempts
    if (checkAccountLockout(email)) {
      res.status(429).json({ 
        ok: false, 
        message: "Account temporarily locked. Try again in 15 minutes." 
      });
      return;
    }

    const user = await get("SELECT id, name, email, password_hash FROM users WHERE email = ?", [email]);
    if (!user) {
      recordFailedAttempt(email);
      res.status(401).json({ ok: false, message: "Invalid email or password." });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      recordFailedAttempt(email);
      res.status(401).json({ ok: false, message: "Invalid email or password." });
      return;
    }

    // Clear failed attempts on successful login
    clearFailedAttempts(email);

    const accessToken = signAccessToken({ id: user.id, name: user.name, email: user.email });
    const refreshToken = createRefreshToken();
    await createRefreshTokenRecord({
      userId: user.id,
      tokenId: refreshToken.tokenId,
      tokenHash: refreshToken.tokenHash,
      createdAt: Date.now(),
      expiresAt: refreshToken.expiresAt
    });

    await updateUserLoginMeta(user.id, {
      ip: req.ip,
      userAgent: req.get("user-agent")
    });

    try {
      await createAuditLog({
        userId: user.id,
        action: "login",
        ip: req.ip,
        userAgent: req.get("user-agent"),
        details: { email }
      });
    } catch (logError) {
      console.error("Failed to write login audit log:", logError);
    }

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
      res.status(401).json({ ok: false, message: "Refresh token invalid." });
      return;
    }

    const existing = await getRefreshTokenById(parsed.tokenId);
    if (!existing || existing.revoked_at || existing.expires_at <= Date.now()) {
      res.status(401).json({ ok: false, message: "Refresh token invalid." });
      return;
    }

    if (existing.token_hash !== parsed.tokenHash) {
      res.status(401).json({ ok: false, message: "Refresh token invalid." });
      return;
    }

    const user = await get("SELECT id, name, email, is_banned FROM users WHERE id = ?", [existing.user_id]);
    if (!user) {
      res.status(401).json({ ok: false, message: "Refresh token invalid." });
      return;
    }

    if (user.is_banned) {
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

authRouter.post("/logout", async (req, res) => {
  try {
    const refreshRaw = getRefreshTokenFromRequest(req);
    const parsed = parseRefreshToken(refreshRaw);
    if (parsed?.tokenId) {
      await revokeRefreshToken({ tokenId: parsed.tokenId, revokedAt: Date.now(), replacedBy: null });
    }

    res.setHeader("Set-Cookie", clearAuthCookies());
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to logout." });
  }
});

module.exports = { authRouter };
