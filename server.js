require("dotenv").config();
const path = require("path");
const os = require("os");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const http = require("http");
const { Server } = require("socket.io");
const { z } = require("zod");
const { MiningEngine } = require("./src/miningEngine");
const { pagesRouter } = require("./routes/pages");
const { authRouter } = require("./routes/auth");
const { initializeDatabase, run, get } = require("./src/db/sqlite");
const { createHealthController } = require("./controllers/healthController");
const { createShopController } = require("./controllers/shopController");
const { createInventoryController } = require("./controllers/inventoryController");
const { createMachinesController } = require("./controllers/machinesController");
const { createMachinesDeprecatedController } = require("./controllers/machinesDeprecatedController");
const { createRacksController } = require("./controllers/racksController");
const { createAdminController } = require("./controllers/adminController");
const { createCheckinController } = require("./controllers/checkinController");
const { requireAuth } = require("./middleware/auth");
const { createRateLimiter } = require("./middleware/rateLimit");
const { validateBody } = require("./middleware/validate");
const { getUserById } = require("./models/userModel");
const { verifyAccessToken } = require("./utils/authTokens");
const { getOrCreateMinerProfile } = require("./models/minerProfileModel");
const { getBrazilCheckinDateKey } = require("./utils/checkinDate");
const { startCronTasks } = require("./cron");
const logger = require("./utils/logger");

// Validate JWT_SECRET before starting
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error("CRITICAL: JWT_SECRET environment variable is required");
  throw new Error("CRITICAL: JWT_SECRET environment variable is required");
}
if (JWT_SECRET.length < 32) {
  logger.error("CRITICAL: JWT_SECRET must be at least 32 characters long for security");
  throw new Error("CRITICAL: JWT_SECRET must be at least 32 characters long for security");
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server);
const engine = new MiningEngine();

const CHECKIN_RECEIVER = process.env.CHECKIN_RECEIVER || "0x95EA8E99063A3EF1B95302aA1C5bE199653EEb13";
const CHECKIN_AMOUNT_WEI = BigInt(process.env.CHECKIN_AMOUNT_WEI || "10000000000000000");
const POLYGON_CHAIN_ID = Number(process.env.POLYGON_CHAIN_ID || 137);
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
const ONLINE_START_DATE = process.env.ONLINE_START_DATE || "2026-02-13";
const MEMORY_GAME_REWARD_GH = Number(process.env.MEMORY_GAME_REWARD_GH || 5);

async function rpcCall(method, params) {
  const response = await fetch(POLYGON_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error("RPC request failed");
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || "RPC error");
  }

  return payload.result;
}

async function ensureCheckinConfirmed(checkin) {
  if (!checkin || checkin.status === "confirmed" || !checkin.tx_hash) {
    return checkin;
  }

  try {
    const receipt = await rpcCall("eth_getTransactionReceipt", [checkin.tx_hash]);
    if (receipt && receipt.status === "0x1") {
      const now = Date.now();
      await run("UPDATE daily_checkins SET status = ?, confirmed_at = ? WHERE id = ?", ["confirmed", now, checkin.id]);
      return { ...checkin, status: "confirmed" };
    }
  } catch (error) {
    logger.error("Failed to confirm check-in status", { error: error.message });
  }

  return checkin;
}

async function getTodayCheckinForUser(userId, todayKey) {
  let checkin = await get(
    "SELECT id, status, tx_hash, checkin_date, created_at FROM daily_checkins WHERE user_id = ? AND checkin_date = ?",
    [userId, todayKey]
  );

  if (checkin) {
    return checkin;
  }

  checkin = await get(
    "SELECT id, status, tx_hash, checkin_date, created_at FROM daily_checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );

  if (!checkin) {
    return null;
  }

  const expectedDate = getBrazilCheckinDateKey(new Date(checkin.created_at));
  if (expectedDate !== checkin.checkin_date) {
    await run("UPDATE daily_checkins SET checkin_date = ? WHERE id = ?", [expectedDate, checkin.id]);
    checkin.checkin_date = expectedDate;
  }

  return expectedDate === todayKey ? checkin : null;
}

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const portForCors = Number(process.env.PORT || 3000);
const localOrigins = (() => {
  const origins = new Set([`http://localhost:${portForCors}`, `http://127.0.0.1:${portForCors}`]);
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const net of entries || []) {
      if (net.family === "IPv4" && !net.internal) {
        origins.add(`http://${net.address}:${portForCors}`);
      }
    }
  }
  return Array.from(origins);
})();

const allowedOriginSet = new Set([...allowedOrigins, ...localOrigins]);

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.length === 0) {
    return true;
  }

  return allowedOriginSet.has(origin);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "https://cdn.jsdelivr.net", "data:"],
        connectSrc: ["'self'", "https:", "ws:", "wss:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
    originAgentCluster: false,
    xContentTypeOptions: true,
    referrerPolicy: { policy: "no-referrer" }
  })
);

// Enforce HTTPS in production
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    const forwarded = req.get("x-forwarded-proto");
    if (forwarded && forwarded !== "https") {
      return res.redirect(301, `https://${req.get("host")}${req.url}`);
    }
    next();
  });
}

// Additional security headers middleware
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(express.json({ limit: "200kb" }));
const blockedPrefixes = ["/controllers", "/models", "/src", "/utils", "/data", "/cron", "/routes"];
const blockedExtensions = new Set([".js", ".map", ".sql", ".sqlite", ".db", ".env", ".log"]);
const allowedStaticPrefixes = ["/public", "/admin", "/js", "/css", "/assets", "/includes"];
app.use((req, res, next) => {
  const rawPath = req.path || "/";
  let decodedPath = rawPath;

  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch (error) {
    res.status(400).send("Bad request");
    return;
  }

  const normalizedPath = decodedPath.replace(/\\/g, "/");

  if (normalizedPath.includes("..")) {
    logger.warn("Blocked path traversal attempt", { method: req.method, path: rawPath });
    res.status(400).send("Bad request");
    return;
  }

  if (blockedPrefixes.some((prefix) => normalizedPath.startsWith(prefix))) {
    logger.warn("Blocked internal resource access attempt", { method: req.method, path: rawPath });
    res.status(403).send("Forbidden");
    return;
  }

  const extension = path.extname(normalizedPath).toLowerCase();
  if (extension && blockedExtensions.has(extension)) {
    const isAllowedStatic = allowedStaticPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
    if (!isAllowedStatic) {
      logger.warn("Blocked file extension access", { method: req.method, path: rawPath, extension });
      res.status(403).send("Forbidden");
      return;
    }
  }

  next();
});
app.use((req, res, next) => {
  if (req.path.endsWith(".css") || req.path.endsWith(".js")) {
    res.on("finish", () => {
      logger.debug(`Asset served: ${req.method} ${req.path}", { statusCode: res.statusCode });
    });
  }

  next();
});
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".css")) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      }
    }
  })
);
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/admin", express.static(path.join(__dirname, "admin")));
app.use(pagesRouter);

// Import wallet router
const walletRouter = require("./routes/wallet");
const swapRouter = require("./routes/swap");

// Import PTP router
const ptpRouter = require("./routes/ptp");

// Import FaucetPay router
const faucetpayRouter = require("./routes/faucetpay");
const faucetRouter = require("./routes/faucet");
const ptpController = require("./controllers/ptpController");

// PTP Promo routes
app.get("/ptp-promo/:hash", ptpController.viewPromoPage);
app.get("/ptp/promote-:userId", ptpController.viewPromotePage);
app.get("/ptp-r-:userId", ptpController.viewPromotePage);

app.use("/api/auth", authRouter);

const healthController = createHealthController();
const shopController = createShopController(io);
const inventoryController = createInventoryController(io);
const machinesController = createMachinesController(io);
const machinesDeprecatedController = createMachinesDeprecatedController();
const racksController = createRacksController();
const adminController = createAdminController();
const checkinController = createCheckinController({
  polygonRpcUrl: POLYGON_RPC_URL,
  polygonChainId: POLYGON_CHAIN_ID,
  checkinReceiver: CHECKIN_RECEIVER,
  checkinAmountWei: CHECKIN_AMOUNT_WEI
});

const inventoryLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
const machinesLimiter = createRateLimiter({ windowMs: 60_000, max: 40 });
const shopLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const shopListLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
const checkinLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const adminLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

const purchaseSchema = z
  .object({
    minerId: z.union([z.number(), z.string()])
  })
  .strict();

const inventoryInstallSchema = z
  .object({
    slotIndex: z.union([z.number(), z.string()]),
    inventoryId: z.union([z.number(), z.string()])
  })
  .strict();

const inventoryRemoveSchema = z
  .object({
    inventoryId: z.union([z.number(), z.string()])
  })
  .strict();

const machineIdSchema = z
  .object({
    machineId: z.union([z.number(), z.string()])
  })
  .strict();

const machineToggleSchema = z
  .object({
    machineId: z.union([z.number(), z.string()]),
    isActive: z.boolean()
  })
  .strict();

const clearRackSchema = z
  .object({
    rackIndex: z.union([z.number(), z.string()])
  })
  .strict();

const rackUpdateSchema = z
  .object({
    rackIndex: z.union([z.number(), z.string()]),
    customName: z.string().trim().min(1).max(30)
  })
  .strict();

const checkinVerifySchema = z
  .object({
    txHash: z.string().trim().min(10).max(120),
    chainId: z.union([z.number(), z.string()]).optional()
  })
  .strict();

app.get("/api/health", healthController.health);
app.get("/api/shop/miners", requireAuth, shopListLimiter, shopController.listMiners);
app.post("/api/shop/purchase", requireAuth, shopLimiter, validateBody(purchaseSchema), shopController.purchaseMiner);

app.get("/api/admin/miners", requireAuth, adminLimiter, adminController.listMiners);
app.post("/api/admin/miners", requireAuth, adminLimiter, adminController.createMiner);
app.put("/api/admin/miners/:id", requireAuth, adminLimiter, adminController.updateMiner);

app.get("/api/inventory", requireAuth, inventoryLimiter, inventoryController.listInventory);
app.post(
  "/api/inventory/install",
  requireAuth,
  inventoryLimiter,
  validateBody(inventoryInstallSchema),
  inventoryController.installInventoryItem
);
app.post(
  "/api/inventory/remove",
  requireAuth,
  inventoryLimiter,
  validateBody(inventoryRemoveSchema),
  inventoryController.removeInventoryItem
);

app.get("/api/machines", requireAuth, machinesLimiter, machinesController.listMachines);
app.post("/api/machines/upgrade", requireAuth, machinesLimiter, validateBody(machineIdSchema), machinesController.upgradeMachine);
app.post("/api/machines/toggle", requireAuth, machinesLimiter, validateBody(machineToggleSchema), machinesController.toggleMachine);
app.post("/api/machines/remove", requireAuth, machinesLimiter, validateBody(machineIdSchema), machinesController.removeMachine);
app.post("/api/machines/clear-rack", requireAuth, machinesLimiter, validateBody(clearRackSchema), machinesController.clearRack);
app.post("/api/machines/add", requireAuth, machinesLimiter, machinesDeprecatedController.addMachine);
app.post("/api/machines/purchase", requireAuth, machinesLimiter, machinesDeprecatedController.purchaseMachine);

app.get("/api/racks", requireAuth, racksController.listRacks);
app.post("/api/racks/update", requireAuth, validateBody(rackUpdateSchema), racksController.updateRack);

app.get("/api/checkin/status", requireAuth, checkinLimiter, checkinController.getStatus);
app.post("/api/checkin/verify", requireAuth, checkinLimiter, validateBody(checkinVerifySchema), checkinController.verify);

app.use("/api/ptp", ptpRouter);
app.use("/api/faucet", faucetRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/swap", swapRouter);
app.use("/api/faucetpay", faucetpayRouter);

async function getActiveGameHashRateTotal() {
  const now = Date.now();
  const row = await get("SELECT COALESCE(SUM(hash_rate), 0) as total FROM users_powers_games WHERE expires_at > ?", [now]);
  return Number(row?.total || 0);
}

async function getUserGameHashRate(userId) {
  if (!userId) {
    return 0;
  }
  const now = Date.now();
  const row = await get(
    "SELECT COALESCE(SUM(hash_rate), 0) as total FROM users_powers_games WHERE user_id = ? AND expires_at > ?",
    [userId, now]
  );
  return Number(row?.total || 0);
}

async function syncUserBaseHashRate(userId) {
  if (!userId) {
    return 0;
  }

  const row = await get(
    "SELECT COALESCE(SUM(hash_rate), 0) as total FROM user_miners WHERE user_id = ? AND is_active = 1",
    [userId]
  );
  const total = Number(row?.total || 0);
  const now = Date.now();
  await run(
    "UPDATE users_temp_power SET base_hash_rate = ?, updated_at = ? WHERE user_id = ?",
    [total, now, userId]
  );
  return total;
}

async function buildPublicState(minerId) {
  const state = engine.getPublicState(minerId);
  const baseNetworkRow = await get("SELECT COALESCE(SUM(base_hash_rate), 0) as total FROM users_temp_power");
  const gameNetworkHash = await getActiveGameHashRateTotal();
  const networkHashRate = Number(baseNetworkRow?.total || 0) + Number(gameNetworkHash || 0);

  state.networkHashRate = networkHashRate;

  if (state.miner) {
    const miner = engine.miners.get(state.miner.id);
    const userId = miner?.userId;
    const userBaseRow = await get("SELECT COALESCE(base_hash_rate, 0) as total FROM users_temp_power WHERE user_id = ?", [
      userId
    ]);
    const userGameHash = await getUserGameHashRate(userId);
    const baseHash = Number(userBaseRow?.total || 0);
    const boostMultiplier = Number(state.miner.boostMultiplier || 1);

    state.miner.baseHashRate = baseHash;
    state.miner.estimatedHashRate = baseHash * boostMultiplier + userGameHash;
  }

  return state;
}

app.get("/api/state", async (req, res) => {
  try {
    const { minerId } = req.query;
    const state = await buildPublicState(minerId);
    res.json(state);
  } catch {
    res.status(500).json({ ok: false, message: "Unable to load state." });
  }
});

app.get("/api/landing-stats", async (_req, res) => {
  try {
    const usersRow = await get("SELECT COUNT(*) as total FROM users");
    const payoutsRow = await get("SELECT COALESCE(SUM(amount_pol), 0) as total FROM payouts");
    const withdrawalsRow = await get(
      "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'withdrawal' AND status = 'completed'"
    );

    const startMs = Date.parse(`${ONLINE_START_DATE}T00:00:00Z`);
    const nowMs = Date.now();
    const daysOnline = Math.max(1, Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

    res.json({
      ok: true,
      registeredUsers: usersRow?.total || 0,
      totalPaid: Number(payoutsRow?.total || 0) + Number(withdrawalsRow?.total || 0),
      daysOnline
    });
  } catch {
    res.status(500).json({ ok: false, message: "Unable to load landing stats." });
  }
});

app.get("/api/network-stats", async (_req, res) => {
  try {
    const usersRow = await get("SELECT COUNT(*) as total FROM users");
    const payoutsRow = await get("SELECT COALESCE(SUM(amount_pol), 0) as total FROM payouts");
    const withdrawalsRow = await get(
      "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'withdrawal' AND status = 'completed'"
    );
    const baseNetworkRow = await get("SELECT COALESCE(SUM(base_hash_rate), 0) as total FROM users_temp_power");
    const gameNetworkHash = await getActiveGameHashRateTotal();

    const startMs = Date.parse(`${ONLINE_START_DATE}T00:00:00Z`);
    const nowMs = Date.now();
    const daysOnline = Math.max(1, Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

    res.json({
      ok: true,
      registeredUsers: usersRow?.total || 0,
      totalPaid: Number(payoutsRow?.total || 0) + Number(withdrawalsRow?.total || 0),
      daysOnline,
      networkHashRate: Number(baseNetworkRow?.total || 0) + Number(gameNetworkHash || 0),
      activeGameHashRate: Number(gameNetworkHash || 0)
    });
  } catch {
    res.status(500).json({ ok: false, message: "Unable to load network stats." });
  }
});

app.get("/api/estimated-reward", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userBaseRow = await get("SELECT COALESCE(base_hash_rate, 0) as total FROM users_temp_power WHERE user_id = ?", [
      userId
    ]);
    const baseNetworkRow = await get("SELECT COALESCE(SUM(base_hash_rate), 0) as total FROM users_temp_power");
    const userGameHash = await getUserGameHashRate(userId);
    const gameNetworkHash = await getActiveGameHashRateTotal();

    const userHashRate = Number(userBaseRow?.total || 0) + Number(userGameHash || 0);
    const networkHashRate = Number(baseNetworkRow?.total || 0) + Number(gameNetworkHash || 0);
    const share = networkHashRate > 0 ? userHashRate / networkHashRate : 0;
    const blockReward = Number(engine.rewardBase || 0);

    res.json({
      ok: true,
      userHashRate,
      networkHashRate,
      share,
      blockReward,
      estimatedReward: blockReward * share,
      tokenSymbol: engine.tokenSymbol
    });
  } catch {
    res.status(500).json({ ok: false, message: "Unable to load estimated reward." });
  }
});

app.post("/api/games/memory/claim", requireAuth, async (req, res) => {
  try {
    const user = req.user;

    const now = Date.now();
    const today = getBrazilCheckinDateKey();
    const checkin = await getTodayCheckinForUser(user.id, today);
    const confirmedCheckin = await ensureCheckinConfirmed(checkin);
    const boosted = Boolean(confirmedCheckin && confirmedCheckin.status === "confirmed");
    const expiresInMs = boosted ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const expiresAt = now + expiresInMs;
    const game = await getOrCreateGame("memory-game", "Memory Game");

    await run(
      "INSERT INTO users_powers_games (user_id, game_id, hash_rate, played_at, expires_at, checkin_id) VALUES (?, ?, ?, ?, ?, ?)",
      [user.id, game.id, MEMORY_GAME_REWARD_GH, now, expiresAt, boosted ? confirmedCheckin.id : null]
    );

    res.json({
      ok: true,
      rewardGh: MEMORY_GAME_REWARD_GH,
      boosted,
      expiresAt
    });
  } catch {
    res.status(500).json({ ok: false, message: "Unable to claim reward." });
  }
});

async function getOrCreateGame(slug, name) {
  const existing = await get("SELECT id, name, slug FROM games WHERE slug = ?", [slug]);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const insert = await run(
    "INSERT INTO games (name, slug, is_active, created_at) VALUES (?, ?, ?, ?)",
    [name, slug, 1, now]
  );

  return { id: insert.lastID, name, slug };
}

async function persistMinerProfile(miner) {
  if (!miner?.userId) {
    return;
  }

  const now = Date.now();
  await run(
    `
      INSERT INTO users_temp_power (user_id, username, wallet_address, rigs, base_hash_rate, balance, lifetime_mined, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        wallet_address = excluded.wallet_address,
        rigs = excluded.rigs,
        base_hash_rate = excluded.base_hash_rate,
        balance = excluded.balance,
        lifetime_mined = excluded.lifetime_mined,
        updated_at = excluded.updated_at
    `,
    [
      miner.userId,
      miner.username,
      miner.walletAddress,
      miner.rigs,
      miner.baseHashRate,
      miner.balance,
      miner.lifetimeMined,
      now,
      now
    ]
  );
}

io.on("connection", (socket) => {
  socket.on("miner:join", async ({ token } = {}, callback) => {
    try {
      if (!token) {
        callback?.({ ok: false, message: "Sessao invalida. Faça login novamente." });
        return;
      }

      const payload = verifyAccessToken(token);
      const userId = Number(payload?.sub);
      if (!userId) {
        callback?.({ ok: false, message: "Sessao invalida. Faça login novamente." });
        return;
      }

      const user = await getUserById(userId);
      if (!user) {
        callback?.({ ok: false, message: "Sessão inválida. Faça login novamente." });
        return;
      }

      const profile = await getOrCreateMinerProfile(user);
      await syncUserBaseHashRate(user.id);
      const miner = engine.createOrGetMiner({
        userId: user.id,
        username: profile.username || user.name,
        walletAddress: profile.wallet_address,
        profile: {
          rigs: profile.rigs,
          baseHashRate: profile.base_hash_rate,
          balance: profile.balance,
          lifetimeMined: profile.lifetime_mined
        }
      });

      engine.setConnected(miner.id, true);
      socket.data.minerId = miner.id;
      socket.data.userId = user.id;
      socket.join(`user:${user.id}`);
      const state = await buildPublicState(miner.id);
      callback?.({ ok: true, minerId: miner.id, state });
    } catch {
      callback?.({ ok: false, message: "Não foi possível carregar sua sala de mineração." });
    }
  });

  socket.on("miner:toggle", async ({ active } = {}, callback) => {
    const minerId = socket.data.minerId;
    if (!minerId) {
      callback?.({ ok: false, message: "Conecte-se primeiro." });
      return;
    }

    const miner = engine.setActive(minerId, active);
    await persistMinerProfile(miner);
    callback?.({ ok: true, state: engine.getPublicState(minerId) });
  });

  socket.on("miner:boost", (_payload, callback) => {
    const minerId = socket.data.minerId;
    if (!minerId) {
      callback?.({ ok: false, message: "Conecte-se primeiro." });
      return;
    }

    const result = engine.applyBoost(minerId);
    callback?.({ ...result, state: engine.getPublicState(minerId) });
  });

  socket.on("miner:upgrade-rig", async (_payload, callback) => {
    const minerId = socket.data.minerId;
    if (!minerId) {
      callback?.({ ok: false, message: "Conecte-se primeiro." });
      return;
    }

    const result = engine.upgradeRig(minerId);
    if (result?.ok) {
      const miner = engine.miners.get(minerId);
      await persistMinerProfile(miner);
    }
    callback?.({ ...result, state: engine.getPublicState(minerId) });
  });

  socket.on("miner:wallet-link", async ({ walletAddress } = {}, callback) => {
    const minerId = socket.data.minerId;
    if (!minerId) {
      callback?.({ ok: false, message: "Conecte-se primeiro." });
      return;
    }

    const miner = engine.setWallet(minerId, walletAddress);
    await persistMinerProfile(miner);
    callback?.({ ok: true, message: "Carteira conectada para depósito e saque.", state: engine.getPublicState(minerId) });
  });

  socket.on("disconnect", async () => {
    const minerId = socket.data.minerId;
    if (minerId) {
      const miner = engine.miners.get(minerId);
      await persistMinerProfile(miner);
      engine.setConnected(minerId, false);
    }
  });
});

const PORT = process.env.PORT || 3000;

function getLocalIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const net of entries || []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  return addresses;
}

initializeDatabase()
  .then(() => {
    startCronTasks({ engine, io, persistMinerProfile, run, buildPublicState });
    server.listen(PORT, "0.0.0.0", () => {
      logger.info(`BlockMiner server started on port ${PORT}`, { env: process.env.NODE_ENV });
      const localAddresses = getLocalIpv4Addresses();
      if (localAddresses.length) {
        for (const address of localAddresses) {
          logger.info(`BlockMiner LAN accessible at http://${address}:${PORT}`, { address });
        }
      } else {
        logger.warn("Unable to detect local IP address for LAN access");
      }
    });
  })
  .catch((error) => {
    logger.error("Failed to initialize database", { error: error.message });
    process.exit(1);
  });
