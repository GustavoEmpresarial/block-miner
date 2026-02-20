const https = require("https");
const { run, get } = require("../models/db");
const { createAuditLog } = require("../models/auditLogModel");
const { getAnonymizedRequestIp } = require("../utils/clientIp");

const PRICE_TTL_MS = 2 * 60 * 1000;
const priceCache = new Map();

function fetchJson(url) {
  if (typeof fetch === "function") {
    return fetch(url, { headers: { accept: "application/json" } }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    });
  }

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { accept: "application/json" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function getPolUsdPrice() {
  const cached = priceCache.get("POL");
  if (cached && Date.now() - cached.timestamp < PRICE_TTL_MS) {
    return cached.price;
  }

  const coinGeckoIds = ["polygon-ecosystem-token", "matic-network"];
  for (const id of coinGeckoIds) {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
      const data = await fetchJson(url);
      const price = data?.[id]?.usd ?? null;
      if (price) {
        priceCache.set("POL", { price, timestamp: Date.now() });
        return price;
      }
    } catch {
      // Try next provider.
    }
  }

  const symbols = ["POL", "MATIC"];
  for (const symbol of symbols) {
    try {
      const url = `https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=USD`;
      const data = await fetchJson(url);
      const price = data?.USD ?? null;
      if (price) {
        priceCache.set("POL", { price, timestamp: Date.now() });
        return price;
      }
    } catch {
      // Try next symbol.
    }
  }

  const paprikaIds = ["pol-polygon-ecosystem-token", "matic-network"];
  for (const id of paprikaIds) {
    try {
      const url = `https://api.coinpaprika.com/v1/tickers/${id}`;
      const data = await fetchJson(url);
      const price = data?.quotes?.USD?.price ?? null;
      if (price) {
        priceCache.set("POL", { price, timestamp: Date.now() });
        return price;
      }
    } catch {
      // Try next provider.
    }
  }

  return null;
}

function parseAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return amount;
}

function resolveSwap(fromAsset, toAsset) {
  const from = String(fromAsset || "").toUpperCase();
  const to = String(toAsset || "").toUpperCase();

  if (from === "POL" && to === "USDC") {
    return { from, to };
  }
  if (from === "USDC" && to === "POL") {
    return { from, to };
  }
  return null;
}

async function getBalances(req, res) {
  try {
    const userId = req.user.id;
    const polRow = await get("SELECT balance FROM users_temp_power WHERE user_id = ?", [userId]);
    let polBalance = polRow?.balance ?? null;
    if (polBalance === null) {
      const polAlt = await get("SELECT pol_balance FROM users WHERE id = ?", [userId]);
      polBalance = polAlt?.pol_balance ?? 0;
    }
    const usdcRow = await get("SELECT usdc_balance FROM users WHERE id = ?", [userId]);

    res.json({
      ok: true,
      balances: {
        POL: polBalance ?? 0,
        USDC: usdcRow?.usdc_balance ?? 0
      }
    });
  } catch (error) {
    console.error("Error fetching swap balances:", error);
    res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function getQuote(req, res) {
  try {
    const { fromAsset, toAsset, amount } = req.body || {};
    const swap = resolveSwap(fromAsset, toAsset);
    if (!swap) {
      return res.status(400).json({ ok: false, message: "Unsupported swap pair" });
    }

    const amountNum = parseAmount(amount);
    if (!amountNum) {
      return res.status(400).json({ ok: false, message: "Invalid amount" });
    }

    const price = await getPolUsdPrice();
    if (!price || price <= 0) {
      return res.status(503).json({ ok: false, message: "Price unavailable" });
    }

    const rate = price;
    const output = swap.from === "POL" ? amountNum * rate : amountNum / rate;

    res.json({
      ok: true,
      rate,
      output
    });
  } catch (error) {
    console.error("Error fetching swap quote:", error);
    res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function executeSwap(req, res) {
  try {
    const userId = req.user.id;
    const { fromAsset, toAsset, amount } = req.body || {};
    const swap = resolveSwap(fromAsset, toAsset);
    if (!swap) {
      return res.status(400).json({ ok: false, message: "Unsupported swap pair" });
    }

    const amountNum = parseAmount(amount);
    if (!amountNum) {
      return res.status(400).json({ ok: false, message: "Invalid amount" });
    }

    const price = await getPolUsdPrice();
    if (!price || price <= 0) {
      return res.status(503).json({ ok: false, message: "Price unavailable" });
    }

    const rate = price;
    const output = swap.from === "POL" ? amountNum * rate : amountNum / rate;

    if (swap.from === "POL") {
      const polRow = await get("SELECT balance FROM users_temp_power WHERE user_id = ?", [userId]);
      let polBalance = polRow?.balance ?? null;
      if (polBalance === null) {
        const polAlt = await get("SELECT pol_balance FROM users WHERE id = ?", [userId]);
        polBalance = polAlt?.pol_balance ?? 0;
      }
      if (polBalance < amountNum) {
        return res.status(400).json({ ok: false, message: "Insufficient POL balance" });
      }

      await run("BEGIN");
      try {
        await run("UPDATE users_temp_power SET balance = balance - ? WHERE user_id = ?", [amountNum, userId]);
        await run("UPDATE users SET usdc_balance = usdc_balance + ? WHERE id = ?", [output, userId]);
        await run("COMMIT");
      } catch (error) {
        await run("ROLLBACK");
        throw error;
      }
    } else {
      const usdcRow = await get("SELECT usdc_balance FROM users WHERE id = ?", [userId]);
      const usdcBalance = usdcRow?.usdc_balance ?? 0;
      if (usdcBalance < amountNum) {
        return res.status(400).json({ ok: false, message: "Insufficient USDC balance" });
      }

      await run("BEGIN");
      try {
        await run("UPDATE users SET usdc_balance = usdc_balance - ? WHERE id = ?", [amountNum, userId]);
        await run("UPDATE users_temp_power SET balance = balance + ? WHERE user_id = ?", [output, userId]);
        await run("COMMIT");
      } catch (error) {
        await run("ROLLBACK");
        throw error;
      }
    }

    try {
      await createAuditLog({
        userId,
        action: "swap",
        ip: getAnonymizedRequestIp(req),
        userAgent: req.get("user-agent"),
        details: { fromAsset: swap.from, toAsset: swap.to, amount: amountNum, output, rate }
      });
    } catch (logError) {
      console.error("Failed to write swap audit log:", logError);
    }

    res.json({ ok: true, rate, output });
  } catch (error) {
    console.error("Error executing swap:", error);
    res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = {
  getBalances,
  getQuote,
  executeSwap
};
