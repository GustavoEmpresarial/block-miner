require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const http = require("http");
const { Server } = require("socket.io");
const { loadEnv } = require("./app/config/env");
const { createCorsPolicy } = require("./app/security/corsPolicy");
const { registerSecurityStack } = require("./app/security/registerSecurityStack");
const { registerAppRoutes } = require("./app/routes/registerAppRoutes");
const { detectImageExtensionFromMagic } = require("./app/utils/fileSignatures");
const { runWithConcurrency } = require("./app/utils/asyncPool");
const { startServer } = require("./app/startup/startServer");
const { setupGracefulShutdown } = require("./app/startup/gracefulShutdown");
const { setMiningEngine } = require("./src/runtime/miningRuntime");
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
const { adminPageAuth } = require("./middleware/adminPageAuth");
const { requireAdminAuth } = require("./middleware/adminAuth");
const { getTokenFromRequest } = require("./utils/token");
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
const { DEFAULT_RPC_URLS, buildRpcUrls, rpcCallWithFallback } = require("./utils/rpcClient");
const logger = require("./utils/logger");
const walletRouter = require("./routes/wallet");
const swapRouter = require("./routes/swap");
const ptpRouter = require("./routes/ptp");
const shortlinkRouter = require("./routes/shortlink");
const faucetRouter = require("./routes/faucet");
const autoMiningGpuRouter = require("./routes/auto-mining-gpu");
const adminAutoMiningRewardsRouter = require("./routes/admin-auto-mining-rewards");
const ptpController = require("./controllers/ptpController");
const zeradsController = require("./controllers/zeradsController");
const zeradsRouter = require("./routes/zerads");

const env = loadEnv(process.env);

const {
  PORT,
  CORS_ORIGINS,
  IS_PROD,
  HTTP_GLOBAL_RATE_WINDOW_MS,
  HTTP_GLOBAL_RATE_MAX,
  HTTP_API_RATE_WINDOW_MS,
  HTTP_API_RATE_MAX,
  BLOCK_DIRECT_API_NAVIGATION,
  SOCKET_MAX_HTTP_BUFFER_SIZE,
  SOCKET_PING_INTERVAL_MS,
  SOCKET_PING_TIMEOUT_MS,
  SOCKET_CONNECT_TIMEOUT_MS,
  SERVER_REQUEST_TIMEOUT_MS,
  SERVER_HEADERS_TIMEOUT_MS,
  SERVER_KEEPALIVE_TIMEOUT_MS,
  CHECKIN_RECEIVER,
  CHECKIN_AMOUNT_WEI,
  POLYGON_CHAIN_ID,
  POLYGON_RPC_URL,
  POLYGON_RPC_TIMEOUT_MS,
  ONLINE_START_DATE,
  MEMORY_GAME_REWARD_GH,
  YOUTUBE_WATCH_REWARD_GH,
  YOUTUBE_WATCH_CLAIM_INTERVAL_MS,
  YOUTUBE_WATCH_BOOST_DURATION_MS
} = env;

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const server = http.createServer(app);
const corsPolicy = createCorsPolicy({
  corsOrigins: CORS_ORIGINS,
  port: PORT,
  isProd: IS_PROD
});
const io = new Server(server, {
  cors: corsPolicy.socketCorsOptions,
  maxHttpBufferSize: SOCKET_MAX_HTTP_BUFFER_SIZE,
  pingInterval: SOCKET_PING_INTERVAL_MS,
  pingTimeout: SOCKET_PING_TIMEOUT_MS,
  connectTimeout: SOCKET_CONNECT_TIMEOUT_MS,
  allowEIO3: false,
  transports: ["websocket", "polling"]
});
const engine = new MiningEngine();
setMiningEngine(engine);
engine.setRewardLogger(logMiningReward); // Register reward logging callback
const publicStateService = createPublicStateService({ engine, get, run, all });

const POLYGON_RPC_URLS = buildRpcUrls({
  primaryUrl: POLYGON_RPC_URL,
  defaultUrls: DEFAULT_RPC_URLS
});

let usersPowersGamesHasCheckinId = null;

const LOG_CATEGORY_DIRS = Object.freeze({
  audit: path.join(__dirname, "storage", "logs", "audit"),
  critical: path.join(__dirname, "storage", "logs", "critical"),
  general: path.join(__dirname, "storage", "logs", "general"),
  security: path.join(__dirname, "storage", "logs", "security"),
  transactions: path.join(__dirname, "storage", "logs", "transactions")
});
const LOG_LEVEL_SET = new Set(["ERROR", "WARN", "INFO", "DEBUG"]);
const LOG_LINE_REGEX = /^\[([^\]]+)]\s+\[([^\]]+)]\s+\[([^\]]+)]\s+([\s\S]*)$/;

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDateQuery(value) {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseLogLine(rawLine, category, fileName) {
  const line = String(rawLine || "").trim();
  if (!line) return null;

  const match = line.match(LOG_LINE_REGEX);
  if (!match) {
    return {
      timestamp: null,
      level: "INFO",
      module: "Unknown",
      message: line,
      details: null,
      category,
      file: fileName
    };
  }

  const timestampRaw = match[1] || "";
  const levelRaw = String(match[2] || "INFO").toUpperCase();
  const moduleName = match[3] || "Unknown";
  const payload = match[4] || "";
  const separatorIndex = payload.indexOf(" | ");
  const message = separatorIndex >= 0 ? payload.slice(0, separatorIndex).trim() : payload.trim();
  const detailsRaw = separatorIndex >= 0 ? payload.slice(separatorIndex + 3).trim() : "";

  let details = null;
  if (detailsRaw) {
    try {
      details = JSON.parse(detailsRaw);
    } catch {
      details = detailsRaw;
    }
  }

  const timestampMs = Date.parse(timestampRaw);

  return {
    timestamp: Number.isFinite(timestampMs) ? timestampMs : null,
    level: LOG_LEVEL_SET.has(levelRaw) ? levelRaw : "INFO",
    module: moduleName,
    message,
    details,
    category,
    file: fileName
  };
}

async function listCategoryLogFiles(category) {
  const categoryDir = LOG_CATEGORY_DIRS[category];
  if (!categoryDir) return [];

  const entries = await fs.readdir(categoryDir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.log(\.\d+)?$/i.test(name));

  const filesWithStats = await Promise.all(
    files.map(async (name) => {
      const filePath = path.join(categoryDir, name);
      const stat = await fs.stat(filePath).catch(() => null);
      return {
        name,
        filePath,
        modifiedAt: Number(stat?.mtimeMs || 0)
      };
    })
  );

  return filesWithStats
    .filter((item) => item.modifiedAt > 0)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

async function readTailLines(filePath, maxLines = 400, maxBytes = 256 * 1024) {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const fileSize = Number(stat?.size || 0);
    if (fileSize <= 0) return [];

    const readSize = Math.min(fileSize, maxBytes);
    const start = Math.max(0, fileSize - readSize);
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, start);

    const text = buffer.toString("utf8");
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length <= maxLines) {
      return lines;
    }

    return lines.slice(lines.length - maxLines);
  } finally {
    await handle.close();
  }
}

function buildLogSummary(events, categories, bucketMinutes) {
  const byLevel = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 };
  const byCategory = Object.fromEntries(categories.map((category) => [category, 0]));
  const bucketSizeMs = Math.max(1, bucketMinutes) * 60 * 1000;
  const buckets = new Map();

  for (const event of events) {
    if (!event) continue;

    if (byLevel[event.level] !== undefined) {
      byLevel[event.level] += 1;
    }

    if (byCategory[event.category] !== undefined) {
      byCategory[event.category] += 1;
    }

    if (!event.timestamp) continue;
    const bucketTs = Math.floor(event.timestamp / bucketSizeMs) * bucketSizeMs;
    const bucket = buckets.get(bucketTs) || {
      timestamp: bucketTs,
      total: 0,
      errors: 0,
      warnings: 0,
      byCategory: Object.fromEntries(categories.map((category) => [category, 0]))
    };

    bucket.total += 1;
    if (event.level === "ERROR") bucket.errors += 1;
    if (event.level === "WARN") bucket.warnings += 1;
    bucket.byCategory[event.category] = Number(bucket.byCategory[event.category] || 0) + 1;
    buckets.set(bucketTs, bucket);
  }

  const series = Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
  const peakErrorBucket = series.reduce(
    (best, current) => (current.errors > (best?.errors || 0) ? current : best),
    null
  );

  return {
    total: events.length,
    byLevel,
    byCategory,
    peakErrorBucket,
    bucketMinutes,
    series
  };
}

function sanitizeText(value, maxLength = 64) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizePublicLeaderboard(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => ({
    username: sanitizeText(entry?.username || "Miner"),
    rigs: Number(entry?.rigs || 0),
    active: Boolean(entry?.active),
    lifetimeMined: Number(entry?.lifetimeMined || 0),
    currentHashRate: Number(entry?.currentHashRate || 0)
  }));
}

function sanitizeStatePayload(state, { includePrivateMiner = false } = {}) {
  const safeState = {
    serverTime: Number(state?.serverTime || Date.now()),
    tokenSymbol: sanitizeText(state?.tokenSymbol || "POL", 16),
    tokenPrice: Number(state?.tokenPrice || 0),
    blockReward: Number(state?.blockReward || 0),
    blockNumber: Number(state?.blockNumber || 0),
    blockTarget: Number(state?.blockTarget || 0),
    blockProgress: Number(state?.blockProgress || 0),
    blockDurationSeconds: Number(state?.blockDurationSeconds || 0),
    blockCountdownSeconds: Number(state?.blockCountdownSeconds || 0),
    totalMiners: Number(state?.totalMiners || 0),
    activeMiners: Number(state?.activeMiners || 0),
    networkHashRate: Number(state?.networkHashRate || 0),
    totalMinted: Number(state?.totalMinted || 0),
    lastReward: Number(state?.lastReward || 0),
    blockEtaSeconds: Number(state?.blockEtaSeconds || 0),
    blockHistory: Array.isArray(state?.blockHistory) ? state.blockHistory : [],
    leaderboard: sanitizePublicLeaderboard(state?.leaderboard)
  };

  if (!includePrivateMiner || !state?.miner) {
    safeState.miner = null;
    return safeState;
  }

  safeState.miner = {
    id: sanitizeText(state.miner.id, 80),
    username: sanitizeText(state.miner.username, 64),
    walletAddress: sanitizeText(state.miner.walletAddress, 128),
    rigs: Number(state.miner.rigs || 0),
    active: Boolean(state.miner.active),
    baseHashRate: Number(state.miner.baseHashRate || 0),
    boostMultiplier: Number(state.miner.boostMultiplier || 1),
    boostEndsAt: Number(state.miner.boostEndsAt || 0),
    balance: Number(state.miner.balance || 0),
    lifetimeMined: Number(state.miner.lifetimeMined || 0),
    connected: Boolean(state.miner.connected),
    estimatedHashRate: Number(state.miner.estimatedHashRate || 0)
  };

  return safeState;
}

function resolveAuthenticatedUserId(req) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return null;
    }

    const payload = verifyAccessToken(token);
    const userId = Number(payload?.sub || 0);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

function isDirectApiNavigationRequest(req) {
  const secFetchDest = String(req.get("sec-fetch-dest") || "").toLowerCase();
  const secFetchMode = String(req.get("sec-fetch-mode") || "").toLowerCase();
  const acceptHeader = String(req.get("accept") || "").toLowerCase();

  if (secFetchDest === "document" || secFetchMode === "navigate") {
    return true;
  }

  if (acceptHeader.includes("text/html") && !acceptHeader.includes("application/json")) {
    return true;
  }

  return false;
}

async function rpcCall(method, params) {
  return rpcCallWithFallback(POLYGON_RPC_URLS, method, params, { timeoutMs: POLYGON_RPC_TIMEOUT_MS });
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

registerSecurityStack({
  app,
  path,
  projectRoot: __dirname,
  cors,
  helmet,
  corsPolicy,
  createCspMiddleware,
  createCsrfMiddleware,
  createRateLimiter,
  logger,
  adminPageAuth,
  pagesRouter,
  isDirectApiNavigationRequest,
  env: {
    IS_PROD,
    HTTP_GLOBAL_RATE_WINDOW_MS,
    HTTP_GLOBAL_RATE_MAX,
    HTTP_API_RATE_WINDOW_MS,
    HTTP_API_RATE_MAX,
    BLOCK_DIRECT_API_NAVIGATION
  }
});

registerAppRoutes({
  app,
  logger,
  runWithConcurrency,
  detectImageExtensionFromMagic,
  createRateLimiter,
  requireAuth,
  requireAdminAuth,
  validateBody,
  validateQuery,
  validateParams,
  getBackupConfig,
  createDatabaseBackup,
  parseCsvList,
  parseDateQuery,
  clampInt,
  parseLogLine,
  listCategoryLogFiles,
  readTailLines,
  buildLogSummary,
  sanitizeStatePayload,
  resolveAuthenticatedUserId,
  LOG_CATEGORY_DIRS,
  LOG_LEVEL_SET,
  ensureCheckinConfirmed,
  getTodayCheckinForUser,
  hasUsersPowersGamesCheckinColumn,
  getBrazilCheckinDateKey,
  engine,
  publicStateService,
  serverDatabaseModel,
  createHealthController,
  createShopController,
  createInventoryController,
  createMachinesController,
  createMachinesDeprecatedController,
  createRacksController,
  createAdminController,
  createAdminAuthController,
  createAdminAuthRouter,
  createServerDatabaseController,
  createCheckinController,
  authRouter,
  walletRouter,
  swapRouter,
  ptpRouter,
  shortlinkRouter,
  faucetRouter,
  autoMiningGpuRouter,
  adminAutoMiningRewardsRouter,
  ptpController,
  zeradsController,
  zeradsRouter,
  io,
  run,
  POLYGON_RPC_URL,
  POLYGON_CHAIN_ID,
  CHECKIN_RECEIVER,
  CHECKIN_AMOUNT_WEI,
  ONLINE_START_DATE,
  YOUTUBE_WATCH_REWARD_GH,
  YOUTUBE_WATCH_CLAIM_INTERVAL_MS,
  YOUTUBE_WATCH_BOOST_DURATION_MS,
  MEMORY_GAME_REWARD_GH
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

server.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;
server.headersTimeout = Math.max(SERVER_HEADERS_TIMEOUT_MS, SERVER_KEEPALIVE_TIMEOUT_MS + 1_000);
server.keepAliveTimeout = SERVER_KEEPALIVE_TIMEOUT_MS;

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

startServer({
  initializeDatabase,
  restoreMiningEngineState,
  walletModel,
  syncEngineMiners,
  serverDatabaseModel,
  publicStateService,
  startCronTasks,
  engine,
  io,
  persistMinerProfile,
  run,
  logger,
  server,
  port: PORT,
  getLocalIpv4Addresses
})
  .then(({ cronHandles }) => {
    setupGracefulShutdown({
      logger,
      server,
      io,
      cronHandles
    });
  })
  .catch((error) => {
    logger.error("Failed to initialize database", { error: error.message });
    process.exit(1);
  });
