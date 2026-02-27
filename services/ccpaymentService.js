const crypto = require("crypto");

const CCPAYMENT_ENABLED = String(process.env.CCPAYMENT_ENABLED || "false").trim().toLowerCase() === "true";
const CCPAYMENT_APP_ID = String(process.env.CCPAYMENT_APP_ID || "").trim();
const CCPAYMENT_APP_SECRET = String(process.env.CCPAYMENT_APP_SECRET || "").trim();
const CCPAYMENT_API_BASE_URL = String(process.env.CCPAYMENT_API_BASE_URL || "https://admin.ccpayment.com/ccpayment/v1").trim();
const CCPAYMENT_TIMEOUT_MS = Number(process.env.CCPAYMENT_TIMEOUT_MS || 15000);
const CCPAYMENT_WEBHOOK_VERIFY_SIGN = String(process.env.CCPAYMENT_WEBHOOK_VERIFY_SIGN || "true").trim().toLowerCase() === "true";
const CCPAYMENT_WEBHOOK_MAX_SKEW_SECONDS = Number(process.env.CCPAYMENT_WEBHOOK_MAX_SKEW_SECONDS || 300);

const CCPAYMENT_CREATE_USER_DEPOSIT_PATH =
  String(process.env.CCPAYMENT_CREATE_USER_DEPOSIT_PATH || "/payment/address/get").trim();
const CCPAYMENT_GET_USER_DEPOSIT_RECORD_PATH =
  String(process.env.CCPAYMENT_GET_USER_DEPOSIT_RECORD_PATH || "/payment/get_record").trim();

function isEnabled() {
  return CCPAYMENT_ENABLED;
}

function ensureEnabledAndConfigured() {
  if (!CCPAYMENT_ENABLED) {
    throw new Error("CCPayment integration is disabled");
  }

  if (!CCPAYMENT_APP_ID || !CCPAYMENT_APP_SECRET) {
    throw new Error("CCPayment app credentials are not configured");
  }
}

function normalizePath(pathname) {
  if (!pathname) {
    return "";
  }

  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function buildUrl(pathname) {
  const base = CCPAYMENT_API_BASE_URL.replace(/\/+$/, "");
  return `${base}${normalizePath(pathname)}`;
}

function buildBody(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const serialized = JSON.stringify(safePayload);
  return serialized === "{}" ? "" : serialized;
}

function buildSign({ appId, appSecret, timestamp, body }) {
  const textToSign = `${appId}${timestamp}${body || ""}`;
  return crypto.createHmac("sha256", appSecret).update(textToSign).digest("hex");
}

function timingSafeEqualsText(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

async function getSigned(pathname, params = {}) {
  ensureEnabledAndConfigured();

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = ""; // GET requests don't have a body
  const sign = buildSign({
    appId: CCPAYMENT_APP_ID,
    appSecret: CCPAYMENT_APP_SECRET,
    timestamp,
    body
  });

  const url = new URL(buildUrl(pathname));
  // Add query parameters
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Appid: CCPAYMENT_APP_ID,
      Sign: sign,
      Timestamp: timestamp,
      "Api-Version": "2"
    },
    signal: AbortSignal.timeout(CCPAYMENT_TIMEOUT_MS)
  });

  const rawText = await response.text();
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const preview = rawText.replace(/\s+/g, " ").trim().slice(0, 180);
  let parsed = null;

  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const apiMsg = String(parsed?.msg || parsed?.message || "").trim();
    const details = apiMsg || preview || "empty response";
    throw new Error(`CCPayment HTTP ${response.status} (${url.toString()}): ${details}`);
  }

  if (!parsed || typeof parsed !== "object") {
    const details = preview || "empty response";
    throw new Error(`Invalid JSON response from CCPayment (content-type: ${contentType || "unknown"}; body: ${details})`);
  }

  if (Number(parsed?.code) !== 10000) {
    const msg = String(parsed?.msg || "CCPayment request failed");
    throw new Error(msg);
  }

  return parsed.data || {};
}

async function postSigned(pathname, payload = {}) {
  ensureEnabledAndConfigured();

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = buildBody(payload);
  const sign = buildSign({
    appId: CCPAYMENT_APP_ID,
    appSecret: CCPAYMENT_APP_SECRET,
    timestamp,
    body
  });

  const requestUrl = buildUrl(pathname);
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Appid: CCPAYMENT_APP_ID,
      Sign: sign,
      Timestamp: timestamp,
      "Api-Version": "2"
    },
    body,
    signal: AbortSignal.timeout(CCPAYMENT_TIMEOUT_MS)
  });

  const rawText = await response.text();
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const preview = rawText.replace(/\s+/g, " ").trim().slice(0, 180);
  let parsed = null;

  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const apiMsg = String(parsed?.msg || parsed?.message || "").trim();
    const details = apiMsg || preview || "empty response";
    throw new Error(`CCPayment HTTP ${response.status} (${requestUrl}): ${details}`);
  }

  if (!parsed || typeof parsed !== "object") {
    const details = preview || "empty response";
    throw new Error(`Invalid JSON response from CCPayment (content-type: ${contentType || "unknown"}; body: ${details})`);
  }

  if (Number(parsed?.code) !== 10000) {
    const msg = String(parsed?.msg || "CCPayment request failed");
    throw new Error(msg);
  }

  return parsed.data || {};
}

function verifyWebhookSignature({ headers, rawBody }) {
  if (!CCPAYMENT_ENABLED || !CCPAYMENT_WEBHOOK_VERIFY_SIGN) {
    return true;
  }

  if (!CCPAYMENT_APP_ID || !CCPAYMENT_APP_SECRET) {
    return false;
  }

  const appId = String(headers?.appid || headers?.Appid || "").trim();
  const timestamp = String(headers?.timestamp || headers?.Timestamp || "").trim();
  const sign = String(headers?.sign || headers?.Sign || "").trim().toLowerCase();

  if (!appId || !timestamp || !sign) {
    return false;
  }

  if (appId !== CCPAYMENT_APP_ID) {
    return false;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > CCPAYMENT_WEBHOOK_MAX_SKEW_SECONDS) {
    return false;
  }

  const body = typeof rawBody === "string" ? rawBody : "";
  const expected = buildSign({
    appId: CCPAYMENT_APP_ID,
    appSecret: CCPAYMENT_APP_SECRET,
    timestamp,
    body
  }).toLowerCase();

  return timingSafeEqualsText(expected, sign);
}

async function createOrGetUserDepositAddress({ userId, chain }) {
  // CCPayment V2 uses 'referenceId' for unique user identification
  return getSigned(CCPAYMENT_CREATE_USER_DEPOSIT_PATH, {
    referenceId: String(userId),
    chain
  });
}

async function getUserDepositRecord({ recordId }) {
  return postSigned(CCPAYMENT_GET_USER_DEPOSIT_RECORD_PATH, {
    recordId
  });
}

module.exports = {
  isEnabled,
  verifyWebhookSignature,
  createOrGetUserDepositAddress,
  getUserDepositRecord
};
