const DEFAULT_RPC_TIMEOUT_MS = Number(process.env.POLYGON_RPC_TIMEOUT_MS || 4500);

const DEFAULT_RPC_URLS = Object.freeze([
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.drpc.org",
  "https://poly.api.pocket.network",
  "https://1rpc.io/matic",
  "https://polygon.blockpi.network/v1/rpc/public",
  "https://polygon.meowrpc.com",
  "https://polygon-mainnet.public.blastapi.io",
  "https://rpc.ankr.com/polygon",
  "https://rpc-mainnet.matic.network"
]);

function normalizeRpcUrl(value) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseRpcUrls(value) {
  return String(value || "")
    .split(",")
    .map((entry) => normalizeRpcUrl(entry))
    .filter(Boolean);
}

function uniqueRpcUrls(urls = []) {
  return Array.from(new Set((Array.isArray(urls) ? urls : [urls]).map((value) => normalizeRpcUrl(value)).filter(Boolean)));
}

function buildRpcUrls({ primaryUrl = "", additionalUrls = [], defaultUrls = DEFAULT_RPC_URLS } = {}) {
  return uniqueRpcUrls([primaryUrl, ...additionalUrls, ...defaultUrls]);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_RPC_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function rpcCallWithFallback(rpcUrls, method, params = [], { timeoutMs = DEFAULT_RPC_TIMEOUT_MS } = {}) {
  let lastError = null;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

  for (const rpcUrl of uniqueRpcUrls(rpcUrls)) {
    try {
      const response = await fetchWithTimeout(
        rpcUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body
        },
        timeoutMs
      );

      if (!response.ok) {
        throw new Error(`RPC request failed (HTTP ${response.status})`);
      }

      const payload = await response.json();
      if (payload?.error) {
        throw new Error(payload.error.message || "RPC error");
      }

      return payload.result;
    } catch (error) {
      lastError = new Error(`${rpcUrl}: ${error?.message || String(error)}`);
    }
  }

  throw lastError || new Error("RPC request failed");
}

module.exports = {
  DEFAULT_RPC_URLS,
  DEFAULT_RPC_TIMEOUT_MS,
  parseRpcUrls,
  uniqueRpcUrls,
  buildRpcUrls,
  fetchWithTimeout,
  rpcCallWithFallback
};
