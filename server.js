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
const { initializeDatabase, run, get, all } = require("./src/db/sqlite");
const { createHealthController } = require("./controllers/healthController");
const { createShopController } = require("./controllers/shopController");
const { logMiningReward } = require("./utils/miningRewardsLogger");
const { createInventoryController } = require("./controllers/inventoryController");
const { createMachinesController } = require("./controllers/machinesController");
const { createMachinesDeprecatedController } = require("./controllers/machinesDeprecatedController");
const { createRacksController } = require("./controllers/racksController");
const { createAdminController } = require("./controllers/adminController");
const { createAdminAuthController } = require("./controllers/adminAuthController");
const { createCheckinController } = require("./controllers/checkinController");
const { requireAuth } = require("./middleware/auth");
const { createRateLimiter } = require("./middleware/rateLimit");
const { validateBody } = require("./middleware/validate");
const { createCsrfMiddleware } = require("./middleware/csrf");
const { createCspMiddleware } = require("./middleware/csp");
const { createAdminAuthRouter } = require("./routes/admin-auth");
const { requireAdmin } = require("./middleware/admin");
const { adminPageAuth } = require("./middleware/adminPageAuth");
const { requireAdminAuth } = require("./middleware/adminAuth");
const { getUserById } = require("./models/userModel");
const { verifyAccessToken } = require("./utils/authTokens");
const { getOrCreateMinerProfile } = require("./models/minerProfileModel");
const walletModel = require("./models/walletModel");
const { getBrazilCheckinDateKey } = require("./utils/checkinDate");
const { startCronTasks } = require("./cron");
const { createPublicStateService } = require("./src/services/publicStateService");
const { registerMinerSocketHandlers } = require("./src/socket/registerMinerSocketHandlers");
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
engine.setRewardLogger(logMiningReward); // Register reward logging callback
const publicStateService = createPublicStateService({ engine, get, run, all });

const CHECKIN_RECEIVER = process.env.CHECKIN_RECEIVER || "0x95EA8E99063A3EF1B95302aA1C5bE199653EEb13";
const CHECKIN_AMOUNT_WEI = BigInt(process.env.CHECKIN_AMOUNT_WEI || "10000000000000000");
const POLYGON_CHAIN_ID = Number(process.env.POLYGON_CHAIN_ID || 137);
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
const POLYGON_RPC_TIMEOUT_MS = Number(process.env.POLYGON_RPC_TIMEOUT_MS || 4500);

const DEFAULT_POLYGON_RPC_URLS = [
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.drpc.org",
  "https://poly.api.pocket.network",
  "https://1rpc.io/matic",
  "https://polygon.blockpi.network/v1/rpc/public",
  "https://polygon.meowrpc.com",
  "https://polygon-mainnet.public.blastapi.io",
  "https://rpc-mainnet.matic.network"
];
const POLYGON_RPC_URLS = Array.from(new Set([POLYGON_RPC_URL, ...DEFAULT_POLYGON_RPC_URLS]));

const ONLINE_START_DATE = process.env.ONLINE_START_DATE || "2026-02-13";
const parsedMemoryGameRewardGh = Number(process.env.MEMORY_GAME_REWARD_GH);
const MEMORY_GAME_REWARD_GH = Number.isFinite(parsedMemoryGameRewardGh) && parsedMemoryGameRewardGh > 0
  ? parsedMemoryGameRewardGh
  : 5;

let usersPowersGamesHasCheckinId = null;

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function rpcCall(method, params) {
  let lastError = null;

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params
  });

  for (const rpcUrl of POLYGON_RPC_URLS) {
    try {
      const response = await fetchWithTimeout(
        rpcUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body
        },
        POLYGON_RPC_TIMEOUT_MS
      );

      if (!response.ok) {
        throw new Error(`RPC request failed (HTTP ${response.status})`);
      }

      const payload = await response.json();
      if (payload.error) {
        throw new Error(payload.error.message || "RPC error");
      }

      return payload.result;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError || new Error("RPC request failed");
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
    const normalizedCheckin = await get(
      "SELECT id, status, tx_hash, checkin_date, created_at FROM daily_checkins WHERE user_id = ? AND checkin_date = ? ORDER BY created_at DESC LIMIT 1",
      [userId, expectedDate]
    );

    if (normalizedCheckin) {
      checkin = normalizedCheckin;
    } else {
      await run("UPDATE daily_checkins SET checkin_date = ? WHERE id = ?", [expectedDate, checkin.id]);
      checkin.checkin_date = expectedDate;
    }
  }

  return expectedDate === todayKey ? checkin : null;
}

async function hasUsersPowersGamesCheckinColumn() {
  if (usersPowersGamesHasCheckinId !== null) {
    return usersPowersGamesHasCheckinId;
  }

  try {
    const row = await get(
      "SELECT 1 as ok FROM pragma_table_info('users_powers_games') WHERE name = 'checkin_id' LIMIT 1"
    );
    usersPowersGamesHasCheckinId = Boolean(row?.ok);
  } catch {
    usersPowersGamesHasCheckinId = false;
  }

  return usersPowersGamesHasCheckinId;
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

const isProd = process.env.NODE_ENV === "production";
const corsAllowList = allowedOrigins.length > 0 ? allowedOrigins : isProd ? [] : localOrigins;
const allowedOriginSet = new Set(corsAllowList);

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  // If CORS_ORIGINS is not set:
  // - production: deny all cross-site browser origins by default
  // - non-production: allow localhost/LAN dev origins
  if (allowedOrigins.length === 0 && isProd) {
    return false;
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
    contentSecurityPolicy: false,
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
  // Only send HSTS over HTTPS; otherwise browsers can cache bad policy for localhost/dev.
  if (req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Note: X-XSS-Protection is deprecated in modern browsers, but harmless for legacy clients.
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(express.json({ limit: "200kb" }));

// CSP per-route (public vs authenticated pages)
app.use(createCspMiddleware());

// CSRF protection for cookie-authenticated unsafe requests
app.use(createCsrfMiddleware());

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
      logger.debug(`Asset served: ${req.method} ${req.path}`, { statusCode: res.statusCode });
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
// Admin login routes accessible without authentication
app.get("/admin/login.html", (req, res) => res.sendFile(path.join(__dirname, "admin", "login.html")));
app.get("/admin/login", (req, res) => res.sendFile(path.join(__dirname, "admin", "login.html")));
app.get("/admin/login-styles.css", (req, res) => res.sendFile(path.join(__dirname, "admin", "login-styles.css")));
app.get("/admin/login.js", (req, res) => res.sendFile(path.join(__dirname, "admin", "login.js")));
// Admin dashboard with authentication required (uses admin JWT token)
app.use("/admin", adminPageAuth, express.static(path.join(__dirname, "admin")));
app.use(pagesRouter);

// Import wallet router
const walletRouter = require("./routes/wallet");
const swapRouter = require("./routes/swap");

// Import PTP router
const ptpRouter = require("./routes/ptp");
const shortlinkRouter = require("./routes/shortlink");

const faucetRouter = require("./routes/faucet");
const autoMiningGpuRouter = require("./routes/auto-mining-gpu");
const adminAutoMiningRewardsRouter = require("./routes/admin-auto-mining-rewards");
const ptpController = require("./controllers/ptpController");
const zeradsController = require("./controllers/zeradsController");
const zeradsRouter = require("./routes/zerads");

// PTP Promo routes
app.get("/ptp-promo/:hash", ptpController.viewPromoPage);
app.get("/ptp/promote-:userId", ptpController.viewPromotePage);
app.get("/ptp-r-:userId", ptpController.viewPromotePage);

const healthController = createHealthController();
const shopController = createShopController(io);
const inventoryController = createInventoryController({ io, syncUserBaseHashRate: publicStateService.syncUserBaseHashRate });
const machinesController = createMachinesController({ io, syncUserBaseHashRate: publicStateService.syncUserBaseHashRate });
const machinesDeprecatedController = createMachinesDeprecatedController();
const racksController = createRacksController();
const adminController = createAdminController();
const adminAuthController = createAdminAuthController();
const adminAuthRouter = createAdminAuthRouter(adminAuthController);
const checkinController = createCheckinController({
  polygonRpcUrl: POLYGON_RPC_URL,
  polygonChainId: POLYGON_CHAIN_ID,
  checkinReceiver: CHECKIN_RECEIVER,
  checkinAmountWei: CHECKIN_AMOUNT_WEI
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminAuthRouter);

const inventoryLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
const machinesLimiter = createRateLimiter({ windowMs: 60_000, max: 40 });
const shopLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const shopListLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
const checkinLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const adminLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });
const zeradsCallbackLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

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
    customName: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 -]*$/)
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

app.get("/api/admin/stats", requireAdminAuth, adminLimiter, adminController.getStats);
app.get("/api/admin/users", requireAdminAuth, adminLimiter, adminController.listRecentUsers);
app.get("/api/admin/audit", requireAdminAuth, adminLimiter, adminController.listAuditLogs);
app.put("/api/admin/users/:id/ban", requireAdminAuth, adminLimiter, adminController.setUserBan);

app.get("/api/admin/miners", requireAdminAuth, adminLimiter, adminController.listMiners);
app.post("/api/admin/miners", requireAdminAuth, adminLimiter, adminController.createMiner);
app.put("/api/admin/miners/:id", requireAdminAuth, adminLimiter, adminController.updateMiner);

// Manual withdrawal management
app.get("/api/admin/withdrawals/pending", requireAdminAuth, adminLimiter, adminController.listPendingWithdrawals);
app.post("/api/admin/withdrawals/:withdrawalId/approve", requireAdminAuth, adminLimiter, adminController.approveWithdrawal);
app.post("/api/admin/withdrawals/:withdrawalId/reject", requireAdminAuth, adminLimiter, adminController.rejectWithdrawal);
app.post("/api/admin/withdrawals/:withdrawalId/complete", requireAdminAuth, adminLimiter, adminController.completeWithdrawalManually);

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

app.get("/zeradsptc.php", zeradsCallbackLimiter, zeradsController.handlePtcCallback);
app.post("/zeradsptc.php", zeradsCallbackLimiter, zeradsController.handlePtcCallback);

app.use("/api/ptp", ptpRouter);
app.use("/api/shortlink", shortlinkRouter);
app.use("/api/zerads", zeradsRouter);
app.use("/api/faucet", faucetRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/swap", swapRouter);
app.use("/api/auto-mining-gpu", autoMiningGpuRouter);
app.use("/api/admin/auto-mining-rewards", adminAutoMiningRewardsRouter);

app.get("/api/state", async (req, res) => {
  try {
    const { minerId } = req.query;
    const state = await publicStateService.buildPublicState(minerId);
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
    const gameNetworkHash = await publicStateService.getActiveGameHashRateTotal();

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

app.get("/api/network-ranking", async (req, res) => {
  try {
    const limitRaw = Number(req.query?.limit || 20);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
    const ranking = await publicStateService.getNetworkPowerRanking(limit);

    res.json({
      ok: true,
      ranking
    });
  } catch {
    res.status(500).json({ ok: false, message: "Unable to load network ranking." });
  }
});

app.get("/api/estimated-reward", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userBaseRow = await get("SELECT COALESCE(base_hash_rate, 0) as total FROM users_temp_power WHERE user_id = ?", [
      userId
    ]);
    const baseNetworkRow = await get("SELECT COALESCE(SUM(base_hash_rate), 0) as total FROM users_temp_power");
    const userGameHash = await publicStateService.getUserGameHashRate(userId);
    const gameNetworkHash = await publicStateService.getActiveGameHashRateTotal();

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
    const hasCheckinIdColumn = await hasUsersPowersGamesCheckinColumn();

    if (hasCheckinIdColumn) {
      await run(
        "INSERT INTO users_powers_games (user_id, game_id, hash_rate, played_at, expires_at, checkin_id) VALUES (?, ?, ?, ?, ?, ?)",
        [user.id, game.id, MEMORY_GAME_REWARD_GH, now, expiresAt, boosted ? confirmedCheckin.id : null]
      );
    } else {
      await run(
        "INSERT INTO users_powers_games (user_id, game_id, hash_rate, played_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        [user.id, game.id, MEMORY_GAME_REWARD_GH, now, expiresAt]
      );
    }

    res.json({
      ok: true,
      rewardGh: MEMORY_GAME_REWARD_GH,
      boosted,
      expiresAt
    });
  } catch (error) {
    logger.error("Memory reward claim failed", {
      userId: req.user?.id,
      error: error?.message
    });
    res.status(500).json({ ok: false, message: "Unable to claim reward." });
  }
});

async function getOrCreateGame(slug, name) {
  const existing = await get("SELECT id, name, slug FROM games WHERE slug = ?", [slug]);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  let insert;

  try {
    insert = await run(
      "INSERT INTO games (name, slug, is_active, created_at) VALUES (?, ?, ?, ?)",
      [name, slug, 1, now]
    );
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (!message.includes("is_active") && !message.includes("created_at")) {
      throw error;
    }

    insert = await run("INSERT INTO games (name, slug) VALUES (?, ?)", [name, slug]);
  }

  return { id: insert.lastID, name, slug };
}

async function restoreMiningEngineState() {
  try {
    const maxBlockRow = await get("SELECT COALESCE(MAX(block_number), 0) AS max_block FROM mining_rewards_log");
    const totalMintedRow = await get("SELECT COALESCE(SUM(reward_amount), 0) AS total_minted FROM mining_rewards_log");
    const recentBlocks = await all(
      `
        SELECT
          block_number,
          COALESCE(SUM(reward_amount), 0) AS reward,
          COUNT(DISTINCT user_id) AS miner_count,
          MAX(created_at) AS timestamp
        FROM mining_rewards_log
        GROUP BY block_number
        ORDER BY block_number DESC
        LIMIT 12
      `
    );

    const maxBlock = Number(maxBlockRow?.max_block || 0);
    const restoredBlockNumber = Math.max(1, maxBlock + 1);
    engine.blockNumber = restoredBlockNumber;

    engine.totalMinted = Number(totalMintedRow?.total_minted || 0);

    engine.blockHistory = recentBlocks.map((block) => ({
      blockNumber: Number(block.block_number || 0),
      reward: Number(block.reward || 0),
      minerCount: Number(block.miner_count || 0),
      timestamp: Number(block.timestamp || Date.now())
    }));

    if (engine.blockHistory.length > 0) {
      const latestBlock = engine.blockHistory[0];
      engine.lastReward = Number(latestBlock.reward || 0);
      engine.lastBlockAt = Number(latestBlock.timestamp || Date.now());
    }

    logger.info("Mining engine state restored", {
      blockNumber: engine.blockNumber,
      totalMinted: engine.totalMinted,
      restoredHistory: engine.blockHistory.length
    });
  } catch (error) {
    logger.warn("Failed to restore mining engine state; using in-memory defaults", {
      error: error.message
    });
  }
}

async function persistMinerProfile(miner) {
  if (!miner?.userId) {
    return;
  }

  const now = Date.now();
  try {
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

    await run("UPDATE users SET pol_balance = ? WHERE id = ?", [miner.balance, miner.userId]);

    logger.debug("Miner profile persisted", {
      userId: miner.userId,
      username: miner.username,
      balance: miner.balance.toFixed(8),
      lifetimeMined: miner.lifetimeMined.toFixed(8)
    });
  } catch (error) {
    logger.error("Failed to persist miner profile", {
      userId: miner.userId,
      error: error.message
    });
  }
}

async function syncEngineMiners() {
  const profiles = await all(
    "SELECT user_id, username, wallet_address, rigs, base_hash_rate, balance, lifetime_mined FROM users_temp_power"
  );

  let createdCount = 0;
  let updatedCount = 0;

  for (const profile of profiles) {
    if (!profile?.user_id) {
      continue;
    }

    const existingMiner = engine.findMinerByUserId(profile.user_id);
    if (!existingMiner) {
      engine.createOrGetMiner({
        userId: profile.user_id,
        username: profile.username,
        walletAddress: profile.wallet_address,
        profile: {
          rigs: profile.rigs,
          baseHashRate: profile.base_hash_rate,
          balance: profile.balance,
          lifetimeMined: profile.lifetime_mined
        }
      });
      createdCount += 1;
      continue;
    }

    existingMiner.username = profile.username || existingMiner.username;
    existingMiner.walletAddress = profile.wallet_address || null;
    existingMiner.rigs = Number(profile.rigs || 1);
    existingMiner.baseHashRate = Number(profile.base_hash_rate || 0);
    existingMiner.balance = Number(profile.balance || 0);
    existingMiner.lifetimeMined = Number(profile.lifetime_mined || 0);
    updatedCount += 1;
  }

  if (createdCount > 0 || updatedCount > 0) {
    logger.debug("Engine miners synced", {
      totalMiners: profiles.length,
      created: createdCount,
      updated: updatedCount,
      engineMiners: engine.miners.size
    });
  }
}

registerMinerSocketHandlers({
  io,
  engine,
  verifyAccessToken,
  getUserById,
  getOrCreateMinerProfile,
  syncUserBaseHashRate: publicStateService.syncUserBaseHashRate,
  persistMinerProfile,
  buildPublicState: publicStateService.buildPublicState
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
  .then(async () => {
    await restoreMiningEngineState();

    try {
      const result = await walletModel.failAllPendingWithdrawals();
      if (result.totalPending > 0) {
        logger.warn("Startup: marked pending withdrawals as failed", result);
      }
    } catch (error) {
      logger.error("Startup: failed to mark pending withdrawals as failed", { error: error.message });
    }

    await syncEngineMiners();

    // Sync baseHashRate for all users on startup
    try {
      const users = await all("SELECT DISTINCT user_id FROM users_temp_power WHERE user_id IS NOT NULL");
      const userIds = users.map((u) => u.user_id);
      logger.info("Syncing baseHashRate for all users on startup", { userCount: userIds.length });
      await Promise.all(userIds.map((userId) => publicStateService.syncUserBaseHashRate(userId)));
      logger.info("BaseHashRate sync completed");
    } catch (error) {
      logger.error("Failed to sync baseHashRate on startup", { error: error.message });
    }

    startCronTasks({
      engine,
      io,
      persistMinerProfile,
      run,
      buildPublicState: publicStateService.buildPublicState,
      syncEngineMiners,
      syncUserBaseHashRate: publicStateService.syncUserBaseHashRate
    });
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
