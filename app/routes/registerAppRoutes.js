const fs = require("fs/promises");
const path = require("path");
const { z } = require("zod");
const { resolveMinerImageExtension, sanitizeMinerImageBaseName } = require("../utils/minerImage");
const { all } = require("../../src/db/sqlite");

function registerAppRoutes({
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
}) {
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

  app.get("/ptp-promo/:hash", ptpController.viewPromoPage);
  app.get("/ptp/promote-:userId", ptpController.viewPromotePage);
  app.get("/ptp-r-:userId", ptpController.viewPromotePage);

  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminAuthRouter);

  const inventoryLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
  const machinesLimiter = createRateLimiter({ windowMs: 60_000, max: 40 });
  const shopLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  const shopListLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
  const checkinLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  const adminLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });
  const zeradsCallbackLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });
  const zeradsTestLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });
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

  const purchaseSchema = z.object({ minerId: z.union([z.number(), z.string()]) }).strict();
  const inventoryInstallSchema = z
    .object({
      slotIndex: z.union([z.number(), z.string()]),
      inventoryId: z.union([z.number(), z.string()])
    })
    .strict();
  const inventoryRemoveSchema = z.object({ inventoryId: z.union([z.number(), z.string()]) }).strict();
  const machineIdSchema = z.object({ machineId: z.union([z.number(), z.string()]) }).strict();
  const machineToggleSchema = z.object({ machineId: z.union([z.number(), z.string()]), isActive: z.boolean() }).strict();
  const clearRackSchema = z.object({ rackIndex: z.union([z.number(), z.string()]) }).strict();
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
  const chatMessageSchema = z.object({ message: z.string().trim().min(1).max(500) }).strict();
  const youtubeWatchClaimSchema = z.object({ videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/).optional() }).strict();
  const userIdParamSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
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
  const adminManualCreditSchema = z
    .object({
      userId: z.coerce.number().int().positive(),
      amount: z.coerce.number().positive().max(1_000_000),
      reason: z.string().trim().min(5).max(240),
      txHash: z.string().trim().regex(/^0x[a-fA-F0-9]{64}$/).optional().or(z.literal(""))
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

  app.get("/api/admin/backups", requireAdminAuth, adminLimiter, validateQuery(backupsListQuerySchema), async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query?.page || 1));
      const pageSize = Math.max(5, Math.min(200, Number(req.query?.pageSize || 30)));
      const offset = (page - 1) * pageSize;
      const queryText = String(req.query?.q || "").trim().toLowerCase();
      const fromDate = String(req.query?.from || "").trim();
      const toDate = String(req.query?.to || "").trim();
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

  app.get("/api/admin/logs", requireAdminAuth, adminLimiter, async (req, res) => {
    try {
      const requestedCategories = parseCsvList(req.query?.categories).map((entry) => entry.toLowerCase());
      const validCategories = Object.keys(LOG_CATEGORY_DIRS);
      const categories = requestedCategories.length
        ? requestedCategories.filter((entry) => validCategories.includes(entry))
        : validCategories;

      if (categories.length === 0) {
        return res.status(400).json({ ok: false, message: "Invalid categories filter." });
      }

      const requestedLevels = parseCsvList(req.query?.levels).map((entry) => entry.toUpperCase());
      const levels = requestedLevels.length
        ? requestedLevels.filter((entry) => LOG_LEVEL_SET.has(entry))
        : Array.from(LOG_LEVEL_SET);

      if (levels.length === 0) {
        return res.status(400).json({ ok: false, message: "Invalid levels filter." });
      }

      const search = String(req.query?.search || "").trim().toLowerCase();
      const fromMs = parseDateQuery(req.query?.from);
      const toMs = parseDateQuery(req.query?.to);
      const page = clampInt(req.query?.page, 1, 10_000, 1);
      const pageSize = clampInt(req.query?.pageSize, 10, 200, 50);
      const bucketMinutes = clampInt(req.query?.bucketMinutes, 1, 240, 15);
      const maxFilesPerCategory = clampInt(req.query?.maxFilesPerCategory, 1, 5, 2);
      const maxLinesPerFile = clampInt(req.query?.maxLinesPerFile, 50, 2000, 500);
      const readConcurrency = clampInt(req.query?.readConcurrency, 1, 8, 4);

      const events = [];

      const categoryFiles = await Promise.all(
        categories.map(async (category) => {
          const files = await listCategoryLogFiles(category);
          return files.slice(0, maxFilesPerCategory).map((file) => ({ category, file }));
        })
      );

      const filesToRead = categoryFiles.flat();

      await runWithConcurrency(filesToRead, readConcurrency, async ({ category, file }) => {
        const lines = await readTailLines(file.filePath, maxLinesPerFile);
        const parsedEvents = [];

        for (const line of lines) {
          const parsed = parseLogLine(line, category, file.name);
          if (!parsed) continue;
          if (!levels.includes(parsed.level)) continue;
          if (fromMs && parsed.timestamp && parsed.timestamp < fromMs) continue;
          if (toMs && parsed.timestamp && parsed.timestamp > toMs) continue;

          if (search) {
            const detailsText = parsed.details
              ? typeof parsed.details === "string"
                ? parsed.details
                : JSON.stringify(parsed.details)
              : "";
            const haystack = `${parsed.message} ${parsed.module} ${parsed.file} ${detailsText}`.toLowerCase();
            if (!haystack.includes(search)) continue;
          }

          parsedEvents.push(parsed);
        }

        events.push(...parsedEvents);
      });

      events.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

      const summary = buildLogSummary(events, categories, bucketMinutes);
      const total = events.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * pageSize;
      const paged = events.slice(offset, offset + pageSize);

      res.json({
        ok: true,
        filters: {
          categories,
          levels,
          search,
          from: fromMs,
          to: toMs,
          bucketMinutes,
          readConcurrency
        },
        summary: {
          total: summary.total,
          byLevel: summary.byLevel,
          byCategory: summary.byCategory,
          peakErrorBucket: summary.peakErrorBucket,
          filesScanned: filesToRead.length
        },
        series: summary.series,
        pagination: {
          page: safePage,
          pageSize,
          total,
          totalPages
        },
        events: paged
      });
    } catch (error) {
      logger.error("Admin logs query failed", {
        error: error?.message || "unknown_error",
        adminId: req.admin?.id || null
      });

      res.status(500).json({ ok: false, message: "Unable to load logs." });
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
    require("express").raw({
      type: () => true,
      limit: "12mb"
    }),
    (error, req, res, next) => {
      if (!error) {
        next();
        return;
      }

      if (error.type === "entity.too.large") {
        res.status(413).json({ ok: false, message: "Image too large. Max 12MB." });
        return;
      }

      res.status(400).json({ ok: false, message: "Invalid image payload." });
    },
    async (req, res) => {
      try {
        const contentType = String(req.headers["content-type"] || "").split(";")[0].trim();
        const originalName = String(req.headers["x-file-name"] || "").trim();
        const declaredExt = resolveMinerImageExtension(contentType, originalName);

        if (!declaredExt) {
          res.status(415).json({ ok: false, message: "Unsupported image type. Use PNG, JPG, WEBP, or GIF." });
          return;
        }

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ ok: false, message: "Image file is required." });
          return;
        }

        const maxSizeBytes = 12 * 1024 * 1024;
        if (req.body.length > maxSizeBytes) {
          res.status(400).json({ ok: false, message: "Image too large. Max 12MB." });
          return;
        }

        const magicExt = detectImageExtensionFromMagic(req.body);
        if (!magicExt || magicExt !== declaredExt) {
          res.status(415).json({ ok: false, message: "Invalid image signature." });
          return;
        }

        const baseName = sanitizeMinerImageBaseName(originalName);
        const uploadsDir = path.join(process.cwd(), "public", "assets", "machines", "uploaded");
        await fs.mkdir(uploadsDir, { recursive: true });

        let fileName = `${baseName}${declaredExt}`;
        let filePath = path.join(uploadsDir, fileName);
        for (let suffix = 2; suffix <= 9999; suffix += 1) {
          try {
            await fs.access(filePath);
            fileName = `${baseName}-${suffix}${declaredExt}`;
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
  app.patch("/api/admin/miners/:id/shop", requireAdminAuth, adminLimiter, adminController.setMinerShopVisibility);
  app.get("/api/admin/miners/image-duplicates", requireAdminAuth, adminLimiter, adminController.auditMinerImageDuplicates);
  app.post("/api/admin/miners/fix-image-duplicates", requireAdminAuth, adminLimiter, adminController.fixMinerImageDuplicates);

  app.get("/api/admin/withdrawals/pending", requireAdminAuth, adminLimiter, adminController.listPendingWithdrawals);
  app.post(
    "/api/admin/wallet/manual-credit",
    requireAdminAuth,
    adminLimiter,
    validateBody(adminManualCreditSchema),
    adminController.creditUserBalanceManually
  );
  app.post("/api/admin/withdrawals/:withdrawalId/approve", requireAdminAuth, adminLimiter, adminController.approveWithdrawal);
  app.post("/api/admin/withdrawals/:withdrawalId/reject", requireAdminAuth, adminLimiter, adminController.rejectWithdrawal);
  app.post("/api/admin/withdrawals/:withdrawalId/complete", requireAdminAuth, adminLimiter, adminController.completeWithdrawalManually);

  app.get("/api/inventory", requireAuth, inventoryLimiter, inventoryController.listInventory);
  app.post("/api/inventory/install", requireAuth, inventoryLimiter, validateBody(inventoryInstallSchema), inventoryController.installInventoryItem);
  app.post("/api/inventory/remove", requireAuth, inventoryLimiter, validateBody(inventoryRemoveSchema), inventoryController.removeInventoryItem);

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
  app.get("/zerads", zeradsTestLimiter, zeradsController.redirectToTestPtcLink);

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
      const rawMinerId = String(req.query?.minerId || "").trim();
      const minerId = rawMinerId || undefined;
      const state = await publicStateService.buildPublicState(minerId);

      const token = resolveAuthenticatedUserId(req);
      let canViewPrivateMiner = false;

      if (minerId && token && state?.miner) {
        const engineMiner = engine.miners.get(minerId);
        canViewPrivateMiner = Boolean(engineMiner && Number(engineMiner.userId) === Number(token));
      }

      const safePayload = sanitizeStatePayload(state, { includePrivateMiner: canViewPrivateMiner });
      res.json(safePayload);
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
  app.get("/api/dashboard/updates/latest", requireAuth, async (_req, res) => {
    try {
      const now = Date.now();
      const updates = await all(
        `
          SELECT id, version, title, description, created_at, updated_at
          FROM dashboard_updates
          WHERE is_active = 1
            AND (starts_at IS NULL OR starts_at <= ?)
            AND (ends_at IS NULL OR ends_at >= ?)
          ORDER BY COALESCE(starts_at, created_at) DESC, id DESC
          LIMIT 5
        `,
        [now, now]
      );

      res.json({
        ok: true,
        updates: updates.map((row) => ({
          id: Number(row.id),
          version: String(row.version || ""),
          title: String(row.title || ""),
          description: String(row.description || ""),
          createdAt: Number(row.created_at || 0),
          updatedAt: Number(row.updated_at || 0)
        }))
      });
    } catch (error) {
      logger.error("Failed to load dashboard updates", { error: error?.message || "unknown_error" });
      res.status(500).json({ ok: false, message: "Unable to load dashboard updates." });
    }
  });
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
}

module.exports = {
  registerAppRoutes
};
