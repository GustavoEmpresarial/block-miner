require("dotenv").config();
const fs = require("fs/promises");
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
const { validateBody, validateQuery, validateParams } = require("./middleware/validate");
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
const { createDatabaseBackup, getBackupConfig } = require("./utils/backup");
const { createServerDatabaseController } = require("./controllers/database/serverDatabaseController");
const serverDatabaseModel = require("./models/database/serverDatabaseModel");
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
const YOUTUBE_WATCH_REWARD_GH = 3;
const YOUTUBE_WATCH_CLAIM_INTERVAL_MS = 60_000;
const YOUTUBE_WATCH_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;

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
      await serverDatabaseModel.markCheckinConfirmed(checkin.id, now);
      return { ...checkin, status: "confirmed" };
    }
  } catch (error) {
    logger.error("Failed to confirm check-in status", { error: error.message });
  }

  return checkin;
}

async function getTodayCheckinForUser(userId, todayKey) {
  let checkin = await serverDatabaseModel.findDailyCheckinByUserAndDate(userId, todayKey);

  if (checkin) {
    return checkin;
  }

  checkin = await serverDatabaseModel.findLatestDailyCheckinByUser(userId);

  if (!checkin) {
    return null;
  }

  const expectedDate = getBrazilCheckinDateKey(new Date(checkin.created_at));
  if (expectedDate !== checkin.checkin_date) {
    const normalizedCheckin = await serverDatabaseModel.findLatestDailyCheckinByUserAndDate(userId, expectedDate);

    if (normalizedCheckin) {
      checkin = normalizedCheckin;
    } else {
      await serverDatabaseModel.updateDailyCheckinDate(checkin.id, expectedDate);
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
    usersPowersGamesHasCheckinId = await serverDatabaseModel.hasUsersPowersGamesCheckinColumn();
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
  const isYoutubeWatchPage = req.path === "/games/youtube" || req.path === "/youtube-watch.html";
  res.setHeader("Referrer-Policy", isYoutubeWatchPage ? "strict-origin-when-cross-origin" : "no-referrer");
  next();
});

app.use(
  express.json({
    limit: "200kb",
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf).toString("utf8");
    }
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "100kb",
    parameterLimit: 30
  })
);

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
const chatSendLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });
const youtubeWatchClaimLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

const CHAT_MAX_MESSAGES = 100;

const serverDatabaseController = createServerDatabaseController({
  logger,
  io,
  publicStateService,
  engine,
  onlineStartDate: ONLINE_START_DATE,
  youtubeRewardGh: YOUTUBE_WATCH_REWARD_GH,
  youtubeWatchClaimIntervalMs: YOUTUBE_WATCH_CLAIM_INTERVAL_MS,
  youtubeWatchBoostDurationMs: YOUTUBE_WATCH_BOOST_DURATION_MS,
  chatMaxMessages: CHAT_MAX_MESSAGES
});

const MINER_IMAGE_ALLOWED_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"]
]);

function sanitizeMinerImageBaseName(fileName) {
  return path
    .basename(String(fileName || "miner-image"))
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "miner-image";
}

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

const chatMessageSchema = z
  .object({
    message: z.string().trim().min(1).max(500)
  })
  .strict();

const youtubeWatchClaimSchema = z
  .object({
    videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/).optional()
  })
  .strict();

const userIdParamSchema = z
  .object({
    id: z.coerce.number().int().positive()
  })
  .strict();

const financeActivityQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(5).max(100).optional(),
    limit: z.coerce.number().int().min(5).max(100).optional(),
    q: z.string().trim().max(120).optional(),
    type: z.string().trim().max(30).optional(),
    status: z.string().trim().max(30).optional(),
    from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  })
  .strict();

const backupsListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(5).max(200).optional(),
    q: z.string().trim().max(120).optional(),
    from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  })
  .strict();

const adminYoutubeHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(5).max(200).optional(),
    userId: z.coerce.number().int().positive().optional()
  })
  .strict();

const backupDeleteSchema = z
  .object({
    filename: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9._-]+$/)
  })
  .strict();

app.get("/api/health", healthController.health);
app.get("/api/shop/miners", requireAuth, shopListLimiter, shopController.listMiners);
app.post("/api/shop/purchase", requireAuth, shopLimiter, validateBody(purchaseSchema), shopController.purchaseMiner);

app.get("/api/admin/stats", requireAdminAuth, adminLimiter, adminController.getStats);
app.get("/api/admin/server-metrics", requireAdminAuth, adminLimiter, adminController.getServerMetrics);
app.get("/api/admin/users", requireAdminAuth, adminLimiter, adminController.listRecentUsers);
app.get("/api/admin/users/:id/details", requireAdminAuth, adminLimiter, validateParams(userIdParamSchema), serverDatabaseController.getAdminUserDetails);
app.get("/api/admin/audit", requireAdminAuth, adminLimiter, adminController.listAuditLogs);
app.put("/api/admin/users/:id/ban", requireAdminAuth, adminLimiter, adminController.setUserBan);

app.get("/api/admin/finance/overview", requireAdminAuth, adminLimiter, serverDatabaseController.getAdminFinanceOverview);
app.get("/api/admin/finance/activity", requireAdminAuth, adminLimiter, validateQuery(financeActivityQuerySchema), serverDatabaseController.getAdminFinanceActivity);
app.get("/api/admin/youtube/stats", requireAdminAuth, adminLimiter, serverDatabaseController.getAdminYoutubeStats);
app.get("/api/admin/youtube/history", requireAdminAuth, adminLimiter, validateQuery(adminYoutubeHistoryQuerySchema), serverDatabaseController.getAdminYoutubeHistory);

app.get("/api/admin/miners", requireAdminAuth, adminLimiter, adminController.listMiners);
app.get("/api/admin/export-db", requireAdminAuth, adminLimiter, async (req, res) => {
  let backupFile = null;

  try {
    const backupConfig = getBackupConfig();
    const exportResult = await createDatabaseBackup({
      run,
      backupDir: backupConfig.backupDir,
      filenamePrefix: "admin-export-db-",
      logger
    });

    backupFile = exportResult?.backupFile || null;
    if (!backupFile) {
      res.status(500).json({ ok: false, message: "Unable to export database." });
      return;
    }

    logger.info("Admin requested database export", {
      adminId: req.admin?.id || null,
      backupFile,
      method: exportResult?.method || null
    });

    res.download(backupFile, path.basename(backupFile), async () => {
      if (!backupFile) return;
      try {
        await fs.unlink(backupFile);
      } catch {
        // ignore cleanup errors
      }
    });
  } catch (error) {
    logger.error("Admin database export failed", {
      adminId: req.admin?.id || null,
      error: error?.message || "unknown_error"
    });

    if (!res.headersSent) {
      res.status(500).json({ ok: false, message: "Unable to export database." });
    }

    if (backupFile) {
      try {
        await fs.unlink(backupFile);
      } catch {
        // ignore cleanup errors
      }
    }
  }
});

app.get("/api/admin/backups", requireAdminAuth, adminLimiter, validateQuery(backupsListQuerySchema), async (_req, res) => {
  try {
    const page = Math.max(1, Number(_req.query?.page || 1));
    const pageSize = Math.max(5, Math.min(200, Number(_req.query?.pageSize || 30)));
    const offset = (page - 1) * pageSize;
    const queryText = String(_req.query?.q || "").trim().toLowerCase();
    const fromDate = String(_req.query?.from || "").trim();
    const toDate = String(_req.query?.to || "").trim();
    const backupConfig = getBackupConfig();
    const entries = await fs.readdir(backupConfig.backupDir, { withFileTypes: true }).catch(() => []);
    const files = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = String(entry.name || "");
      if (!name.endsWith(".db") && !name.endsWith(".tar.gz")) continue;

      const fullPath = path.join(backupConfig.backupDir, name);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;

      files.push({
        name,
        size: Number(stat.size || 0),
        modifiedAt: Number(stat.mtimeMs || 0)
      });
    }

    let filtered = files;

    if (queryText) {
      filtered = filtered.filter((entry) => String(entry.name || "").toLowerCase().includes(queryText));
    }

    if (fromDate) {
      const fromMs = Date.parse(`${fromDate}T00:00:00Z`);
      if (Number.isFinite(fromMs)) {
        filtered = filtered.filter((entry) => Number(entry.modifiedAt || 0) >= fromMs);
      }
    }

    if (toDate) {
      const toMs = Date.parse(`${toDate}T23:59:59.999Z`);
      if (Number.isFinite(toMs)) {
        filtered = filtered.filter((entry) => Number(entry.modifiedAt || 0) <= toMs);
      }
    }

    filtered.sort((a, b) => b.modifiedAt - a.modifiedAt);
    const total = filtered.length;
    const paged = filtered.slice(offset, offset + pageSize);
    res.json({ ok: true, files: paged, page, pageSize, total });
  } catch (error) {
    logger.error("Admin backups list failed", { error: error?.message });
    res.status(500).json({ ok: false, message: "Unable to list backups." });
  }
});

app.delete("/api/admin/backups", requireAdminAuth, adminLimiter, validateBody(backupDeleteSchema), async (req, res) => {
  try {
    const backupConfig = getBackupConfig();
    const filename = String(req.body.filename || "").trim();

    const safeName = path.basename(filename);
    if (safeName !== filename || (!safeName.endsWith(".db") && !safeName.endsWith(".tar.gz"))) {
      res.status(400).json({ ok: false, message: "Invalid backup filename." });
      return;
    }

    const target = path.join(backupConfig.backupDir, safeName);
    await fs.unlink(target);
    res.json({ ok: true, deleted: safeName });
  } catch (error) {
    logger.error("Admin backup delete failed", { error: error?.message });
    res.status(500).json({ ok: false, message: "Unable to delete backup." });
  }
});
app.post(
  "/api/admin/miners/upload-image",
  requireAdminAuth,
  adminLimiter,
  express.raw({
    type: (req) => MINER_IMAGE_ALLOWED_TYPES.has(String(req.headers["content-type"] || "").split(";")[0].trim()),
    limit: "8mb"
  }),
  async (req, res) => {
    try {
      const contentType = String(req.headers["content-type"] || "").split(";")[0].trim();
      const ext = MINER_IMAGE_ALLOWED_TYPES.get(contentType);

      if (!ext) {
        res.status(415).json({ ok: false, message: "Unsupported image type. Use PNG, JPG, WEBP, or GIF." });
        return;
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ ok: false, message: "Image file is required." });
        return;
      }

      const maxSizeBytes = 8 * 1024 * 1024;
      if (req.body.length > maxSizeBytes) {
        res.status(400).json({ ok: false, message: "Image too large. Max 8MB." });
        return;
      }

      const originalName = String(req.headers["x-file-name"] || "").trim();
      const baseName = sanitizeMinerImageBaseName(originalName);
      const uploadsDir = path.join(__dirname, "public", "assets", "machines", "uploaded");
      await fs.mkdir(uploadsDir, { recursive: true });

      let fileName = `${baseName}${ext}`;
      let filePath = path.join(uploadsDir, fileName);
      for (let suffix = 2; suffix <= 9999; suffix += 1) {
        try {
          await fs.access(filePath);
          fileName = `${baseName}-${suffix}${ext}`;
          filePath = path.join(uploadsDir, fileName);
        } catch {
          break;
        }
      }

      await fs.writeFile(filePath, req.body);

      res.json({
        ok: true,
        imageUrl: `/assets/machines/uploaded/${fileName}`
      });
    } catch (error) {
      logger.error("Admin miner image upload failed", {
        error: error?.message,
        adminId: req.admin?.id || null
      });
      res.status(500).json({ ok: false, message: "Unable to upload image." });
    }
  }
);
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

app.get("/api/chat/messages", requireAuth, serverDatabaseController.listChatMessages);
app.post("/api/chat/messages", requireAuth, chatSendLimiter, validateBody(chatMessageSchema), serverDatabaseController.createChatMessage);

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

app.get("/api/landing-stats", serverDatabaseController.getLandingStats);
app.get("/api/recent-payments", serverDatabaseController.getRecentPayments);
app.get("/api/network-stats", serverDatabaseController.getNetworkStats);

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

app.get("/api/estimated-reward", requireAuth, serverDatabaseController.getEstimatedReward);
app.get("/api/games/youtube/status", requireAuth, serverDatabaseController.getYoutubeStatus);
app.get("/api/games/youtube/stats", requireAuth, serverDatabaseController.getYoutubeStats);
app.post("/api/games/youtube/claim", requireAuth, youtubeWatchClaimLimiter, validateBody(youtubeWatchClaimSchema), serverDatabaseController.claimYoutubeReward);

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
    const game = await serverDatabaseModel.getOrCreateGame("memory-game", "Memory Game");
    const hasCheckinIdColumn = await hasUsersPowersGamesCheckinColumn();
    await serverDatabaseModel.insertMemoryClaim({
      userId: user.id,
      gameId: game.id,
      rewardGh: MEMORY_GAME_REWARD_GH,
      now,
      expiresAt,
      checkinId: hasCheckinIdColumn && boosted ? confirmedCheckin.id : null
    });
    await publicStateService.syncUserBaseHashRate(user.id);

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

async function restoreMiningEngineState() {
  try {
    const { maxBlockRow, totalMintedRow, recentBlocks } = await serverDatabaseModel.getMiningEngineStateRows();

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
    await serverDatabaseModel.upsertMinerProfile(miner, now);
    await serverDatabaseModel.updateUserPolBalance(miner.userId, miner.balance);

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
  const profiles = await serverDatabaseModel.listTempPowerProfiles();

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
    if (!Number.isFinite(existingMiner.balance)) {
      existingMiner.balance = Number(profile.balance || 0);
    }
    if (!Number.isFinite(existingMiner.lifetimeMined)) {
      existingMiner.lifetimeMined = Number(profile.lifetime_mined || 0);
    }
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
      const users = await serverDatabaseModel.listDistinctTempPowerUserIds();
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
