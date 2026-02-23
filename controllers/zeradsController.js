const crypto = require("crypto");
const { get, all, run } = require("../models/db");
const logger = require("../utils/logger").child("ZerAdsController");

const ZERADS_SITE_ID = String(process.env.ZERADS_SITE_ID || "10776").trim();
const ZERADS_CALLBACK_PASSWORD = String(process.env.ZERADS_CALLBACK_PASSWORD || "password");
const ZERADS_ALLOWED_IPS = new Set(
  String(process.env.ZERADS_ALLOWED_IPS || "")
    .split(",")
    .map((value) => normalizeIp(value))
    .filter(Boolean)
);
const parsedExchangeRate = Number(process.env.ZERADS_PTC_EXCHANGE_RATE);
const ZERADS_PTC_EXCHANGE_RATE = Number.isFinite(parsedExchangeRate) && parsedExchangeRate >= 0 ? parsedExchangeRate : 0;
const ZERADS_REWARD_NAME = String(process.env.ZERADS_REWARD_NAME || "").trim();
const ZERADS_OFFERWALL_URL_TEMPLATE = String(
  process.env.ZERADS_OFFERWALL_URL_TEMPLATE || "https://zerads.com/?ref={siteId}&user={username}"
).trim();
const ZERADS_USER_TOKEN_SECRET = String(process.env.ZERADS_USER_TOKEN_SECRET || process.env.JWT_SECRET || "zerads-secret");
const FALLBACK_DUPLICATE_BUCKET_MS = 15 * 1000;

function normalizeIp(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (raw.startsWith("::ffff:")) {
    return raw.slice(7);
  }

  return raw;
}

function getRequestIp(req) {
  const ips = getRequestIps(req);
  return ips[0] || "";
}

function getRequestIps(req) {
  const ips = [];
  const appendIp = (value) => {
    const normalized = normalizeIp(value);
    if (!normalized || ips.includes(normalized)) {
      return;
    }
    ips.push(normalized);
  };

  appendIp(req.ip);
  appendIp(req.socket?.remoteAddress);

  const forwardedFor = req.headers?.["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    forwardedFor
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach(appendIp);
  } else if (Array.isArray(forwardedFor)) {
    forwardedFor
      .flatMap((item) => String(item || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach(appendIp);
  }

  return ips;
}

function getRequestValue(req, names = []) {
  for (const name of names) {
    if (!name) {
      continue;
    }

    const queryValue = req.query?.[name];
    if (queryValue !== undefined && queryValue !== null && String(queryValue).trim() !== "") {
      return String(queryValue).trim();
    }

    const bodyValue = req.body?.[name];
    if (bodyValue !== undefined && bodyValue !== null && String(bodyValue).trim() !== "") {
      return String(bodyValue).trim();
    }
  }

  return "";
}

function getRequestEntries(req) {
  const entries = [];
  const appendEntries = (source) => {
    if (!source || typeof source !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(source)) {
      const safeKey = String(key || "").trim();
      if (!safeKey) {
        continue;
      }

      if (safeKey.toLowerCase() === "pwd" || safeKey.toLowerCase() === "password" || safeKey.toLowerCase() === "pass") {
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => {
          entries.push([safeKey, String(item ?? "").trim()]);
        });
      } else {
        entries.push([safeKey, String(value ?? "").trim()]);
      }
    }
  };

  appendEntries(req.query);
  appendEntries(req.body);

  entries.sort((a, b) => {
    if (a[0] === b[0]) {
      return a[1].localeCompare(b[1]);
    }
    return a[0].localeCompare(b[0]);
  });

  return entries;
}

function getExternalCallbackId(req) {
  const externalId = getRequestValue(req, [
    "callback_id",
    "transaction_id",
    "txid",
    "trans_id",
    "click_id",
    "cid",
    "subid"
  ]);
  return String(externalId || "").trim();
}

function buildRequestFingerprint(req) {
  const entries = getRequestEntries(req);
  const raw = entries.map(([key, value]) => `${key}=${value}`).join("&");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function buildCallbackHash({ username, amount, clicks, requestIp, duplicateKey }) {
  const raw = `${username}|${amount}|${clicks}|${requestIp}|${duplicateKey}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function normalizeUsername(rawValue) {
  return String(rawValue || "").trim().toLowerCase();
}

function buildExternalUserToken(userId) {
  const safeUserId = Number(userId);
  const idPart = Number.isFinite(safeUserId) && safeUserId > 0 ? Math.floor(safeUserId) : 0;
  const signature = crypto
    .createHmac("sha256", ZERADS_USER_TOKEN_SECRET)
    .update(String(idPart))
    .digest("hex")
    .slice(0, 12);
  return `u${idPart}_${signature}`;
}

function parseExternalUserToken(token) {
  const raw = String(token || "").trim();
  const match = raw.match(/^u(\d+)_([a-f0-9]{12})$/i);
  if (!match) {
    return null;
  }

  const userId = Number(match[1]);
  const signature = String(match[2]).toLowerCase();
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", ZERADS_USER_TOKEN_SECRET)
    .update(String(userId))
    .digest("hex")
    .slice(0, 12);

  if (signature !== expected) {
    return null;
  }

  return { userId };
}

function parseClicks(value, amount) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    if (Number.isFinite(amount) && amount > 0) {
      return 1;
    }
    return 0;
  }

  return Math.floor(parsed);
}

function toFixedNumber(value, digits = 8) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(parsed.toFixed(digits));
}

function getPtcUrlForUsername(username) {
  const safeUser = encodeURIComponent(String(username || "").trim());
  return `https://zerads.com/ptc.php?ref=${encodeURIComponent(ZERADS_SITE_ID)}&user=${safeUser}`;
}

function getOfferwallUrlForUsername(username) {
  const safeUser = encodeURIComponent(String(username || "").trim());
  return ZERADS_OFFERWALL_URL_TEMPLATE
    .replaceAll("{siteId}", encodeURIComponent(ZERADS_SITE_ID))
    .replaceAll("{username}", safeUser);
}

async function getPtcLink(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ ok: false, message: "Unauthorized" });
      return;
    }

    const externalUser = buildExternalUserToken(userId);

    const ptcUrl = getPtcUrlForUsername(externalUser);
    res.json({ ok: true, siteId: ZERADS_SITE_ID, externalUser, ptcUrl, exchangeRate: ZERADS_PTC_EXCHANGE_RATE, rewardName: ZERADS_REWARD_NAME });
  } catch (error) {
    logger.error("Failed to get ZerAds PTC link", { error: error.message, userId: req.user?.id });
    res.status(500).json({ ok: false, message: "Unable to generate ZerAds link." });
  }
}

async function getStats(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ ok: false, message: "Unauthorized" });
      return;
    }

    const rows = await all(
      `
        SELECT payout_amount, clicks, callback_at
        FROM zerads_ptc_callbacks
        WHERE user_id = ?
        ORDER BY callback_at DESC
        LIMIT 100
      `,
      [userId]
    );

    const totalRewards = rows.reduce((sum, row) => sum + Number(row?.payout_amount || 0), 0);
    const totalClicks = rows.reduce((sum, row) => sum + Number(row?.clicks || 0), 0);

    res.json({
      ok: true,
      totalRewards: toFixedNumber(totalRewards, 8),
      totalClicks,
      callbackCount: rows.length,
      recentCallbacks: rows.slice(0, 10)
    });
  } catch (error) {
    logger.error("Failed to load ZerAds stats", { error: error.message, userId: req.user?.id });
    res.status(500).json({ ok: false, message: "Unable to load ZerAds stats." });
  }
}

async function getOfferwallLink(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ ok: false, message: "Unauthorized" });
      return;
    }

    const externalUser = buildExternalUserToken(userId);

    const offerwallUrl = getOfferwallUrlForUsername(externalUser);
    res.json({ ok: true, siteId: ZERADS_SITE_ID, externalUser, offerwallUrl });
  } catch (error) {
    logger.error("Failed to get ZerAds offerwall link", { error: error.message, userId: req.user?.id });
    res.status(500).json({ ok: false, message: "Unable to generate ZerAds Offerwall link." });
  }
}

async function handlePtcCallback(req, res) {
  const requestIps = getRequestIps(req);
  const requestIp = getRequestIp(req);
  const receivedPassword = getRequestValue(req, ["pwd", "password", "pass"]);
  const rawUser = getRequestValue(req, ["user", "username", "uid", "userid"]);
  const normalizedUser = normalizeUsername(rawUser);
  const amount = Number(getRequestValue(req, ["amount", "reward", "value", "payout", "earnings"]));
  const clicks = parseClicks(getRequestValue(req, ["clicks", "click", "total_clicks"]), amount);

  if (!receivedPassword || receivedPassword !== ZERADS_CALLBACK_PASSWORD) {
    logger.warn("Rejected ZerAds callback by password", { requestIp, user: normalizedUser || null });
    res.status(401).send("invalid_password");
    return;
  }

  if (!normalizedUser) {
    res.status(400).send("invalid_user");
    return;
  }

  if (!Number.isFinite(amount) || amount < 0) {
    res.status(400).send("invalid_amount");
    return;
  }

  if (ZERADS_ALLOWED_IPS.size > 0 && !requestIps.some((ip) => ZERADS_ALLOWED_IPS.has(ip))) {
    logger.warn("Rejected ZerAds callback by IP", { requestIp, requestIps, user: normalizedUser });
    res.status(403).send("forbidden_ip");
    return;
  }

  let user = null;
  const parsedToken = parseExternalUserToken(normalizedUser);
  if (parsedToken?.userId) {
    user = await get("SELECT id, username FROM users WHERE id = ? LIMIT 1", [parsedToken.userId]);
  }

  // Backward compatibility with old username-based links.
  if (!user?.id) {
    user = await get("SELECT id, username FROM users WHERE LOWER(username) = ? LIMIT 1", [normalizedUser]);
  }

  if (!user?.id) {
    logger.warn("Rejected ZerAds callback for unknown user", { requestIp, user: normalizedUser });
    res.status(404).send("user_not_found");
    return;
  }

  const payoutAmount = toFixedNumber(amount * ZERADS_PTC_EXCHANGE_RATE, 8);
  const externalCallbackId = getExternalCallbackId(req);
  const requestFingerprint = buildRequestFingerprint(req);
  const fallbackBucket = Math.floor(Date.now() / FALLBACK_DUPLICATE_BUCKET_MS);
  const duplicateKey = externalCallbackId
    ? `ext:${externalCallbackId.toLowerCase()}`
    : `req:${requestFingerprint}:${fallbackBucket}`;
  const callbackHash = buildCallbackHash({
    username: normalizedUser,
    amount: toFixedNumber(amount, 8),
    clicks,
    requestIp,
    duplicateKey
  });

  await run("BEGIN IMMEDIATE");
  try {
    await run(
      `
        INSERT INTO zerads_ptc_callbacks
          (user_id, username, amount_zer, exchange_rate, payout_amount, clicks, request_ip, callback_hash, callback_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        user.id,
        normalizedUser,
        toFixedNumber(amount, 8),
        ZERADS_PTC_EXCHANGE_RATE,
        payoutAmount,
        clicks,
        requestIp || null,
        callbackHash,
        Date.now()
      ]
    );

    if (payoutAmount > 0) {
      await run("UPDATE users SET usdc_balance = usdc_balance + ? WHERE id = ?", [payoutAmount, user.id]);
    }

    if (amount > 0) {
      await run("UPDATE users SET zer_balance = zer_balance + ? WHERE id = ?", [toFixedNumber(amount, 8), user.id]);
    }

    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK").catch(() => undefined);

    if (String(error?.message || "").toLowerCase().includes("unique")) {
      logger.info("Duplicate ZerAds callback ignored", { requestIp, user: normalizedUser, callbackHash });
      res.status(200).send("ok_duplicate");
      return;
    }

    logger.error("Failed to process ZerAds callback", {
      error: error.message,
      user: normalizedUser,
      requestIp,
      amount
    });
    res.status(500).send("server_error");
    return;
  }

  logger.info("ZerAds callback credited", {
    userId: user.id,
    username: normalizedUser,
    amountZer: toFixedNumber(amount, 8),
    payoutAmount,
    clicks,
    requestIp
  });

  res.status(200).send("ok");
}

module.exports = {
  getPtcLink,
  getOfferwallLink,
  getStats,
  handlePtcCallback
};
