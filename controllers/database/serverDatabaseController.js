const serverDatabaseModel = require("../../models/database/serverDatabaseModel");

function createServerDatabaseController({
  logger,
  io,
  publicStateService,
  engine,
  onlineStartDate,
  youtubeRewardGh,
  youtubeWatchClaimIntervalMs,
  youtubeWatchBoostDurationMs,
  chatMaxMessages
}) {
  async function getAdminUserDetails(req, res) {
    try {
      const userId = Number(req.params.id);
      const data = await serverDatabaseModel.fetchAdminUserDetails(userId, Date.now());
      const { user, faucet, shortlink, autoGpu, inventory, activeMachines, checkins, youtubeWatch, recentTx, recentPayouts } = data;

      if (!user) {
        res.status(404).json({ ok: false, message: "User not found." });
        return;
      }

      res.json({
        ok: true,
        user,
        metrics: {
          faucetClaims: Number(faucet?.total_claims || 0),
          shortlinkDailyRuns: Number(shortlink?.daily_runs || 0),
          shortlinkCurrentStep: Number(shortlink?.current_step || 0),
          autoGpuClaims: Number(autoGpu?.claims || 0),
          autoGpuTotalHash: Number(autoGpu?.total_hash || 0),
          youtubeWatchClaims: Number(youtubeWatch?.claims || 0),
          youtubeWatchTotalHashGranted: Number(youtubeWatch?.total_hash_granted || 0),
          youtubeWatchActiveHash: Number(youtubeWatch?.active_hash || 0),
          inventoryItems: Number(inventory?.count || 0),
          activeMachines: Number(activeMachines?.count || 0),
          totalCheckins: Number(checkins?.count || 0)
        },
        shortlink: {
          completedAt: shortlink?.completed_at || null,
          resetAt: shortlink?.reset_at || null
        },
        faucet: {
          dayKey: faucet?.day_key || null
        },
        recentTransactions: recentTx || [],
        recentPayouts: recentPayouts || []
      });
    } catch (error) {
      logger.error("Admin user details failed", { error: error?.message, userId: req.params?.id });
      res.status(500).json({ ok: false, message: "Unable to load user details." });
    }
  }

  async function getAdminFinanceOverview(_req, res) {
    try {
      const data = await serverDatabaseModel.fetchAdminFinanceOverview(Date.now() - 24 * 60 * 60 * 1000);
      const { pool, payouts, withdrawals, pendingWithdrawals, deposits24h } = data;

      res.json({
        ok: true,
        overview: {
          poolBalance: Number(pool?.total_pool || 0),
          lifetimeMined: Number(pool?.lifetime_mined || 0),
          totalPaidPayouts: Number(payouts?.total_paid || 0),
          totalWithdrawn: Number(withdrawals?.total_withdrawn || 0),
          pendingWithdrawals: Number(pendingWithdrawals?.total_pending || 0),
          deposits24h: Number(deposits24h?.total_deposits_24h || 0)
        }
      });
    } catch (error) {
      logger.error("Admin finance overview failed", { error: error?.message });
      res.status(500).json({ ok: false, message: "Unable to load finance overview." });
    }
  }

  async function getAdminFinanceActivity(req, res) {
    try {
      const page = Math.max(1, Number(req.query?.page || 1));
      const pageSize = Math.max(5, Math.min(100, Number(req.query?.pageSize || req.query?.limit || 30)));
      const offset = (page - 1) * pageSize;
      const search = String(req.query?.q || "").trim().toLowerCase();
      const txType = String(req.query?.type || "").trim().toLowerCase();
      const txStatus = String(req.query?.status || "").trim().toLowerCase();
      const fromDate = String(req.query?.from || "").trim();
      const toDate = String(req.query?.to || "").trim();

      const txWhereParts = [];
      const txParams = [];
      if (search) {
        txWhereParts.push("(LOWER(COALESCE(u.email, '')) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR CAST(t.user_id AS TEXT) LIKE ?)");
        const q = `%${search}%`;
        txParams.push(q, q, q);
      }
      if (txType) {
        txWhereParts.push("LOWER(COALESCE(t.type, '')) = ?");
        txParams.push(txType);
      }
      if (txStatus) {
        txWhereParts.push("LOWER(COALESCE(t.status, '')) = ?");
        txParams.push(txStatus);
      }
      if (fromDate) {
        const fromMs = Date.parse(`${fromDate}T00:00:00Z`);
        if (Number.isFinite(fromMs)) {
          txWhereParts.push("t.created_at >= ?");
          txParams.push(fromMs);
        }
      }
      if (toDate) {
        const toMs = Date.parse(`${toDate}T23:59:59.999Z`);
        if (Number.isFinite(toMs)) {
          txWhereParts.push("t.created_at <= ?");
          txParams.push(toMs);
        }
      }

      const payoutWhereParts = [];
      const payoutParams = [];
      if (search) {
        payoutWhereParts.push("(LOWER(COALESCE(u.email, '')) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR CAST(p.user_id AS TEXT) LIKE ?)");
        const q = `%${search}%`;
        payoutParams.push(q, q, q);
      }
      if (fromDate) {
        const fromMs = Date.parse(`${fromDate}T00:00:00Z`);
        if (Number.isFinite(fromMs)) {
          payoutWhereParts.push("p.created_at >= ?");
          payoutParams.push(fromMs);
        }
      }
      if (toDate) {
        const toMs = Date.parse(`${toDate}T23:59:59.999Z`);
        if (Number.isFinite(toMs)) {
          payoutWhereParts.push("p.created_at <= ?");
          payoutParams.push(toMs);
        }
      }

      const txWhereSql = txWhereParts.length > 0 ? `WHERE ${txWhereParts.join(" AND ")}` : "";
      const payoutWhereSql = payoutWhereParts.length > 0 ? `WHERE ${payoutWhereParts.join(" AND ")}` : "";

      const data = await serverDatabaseModel.fetchAdminFinanceActivity({
        txWhereSql,
        txParams,
        payoutWhereSql,
        payoutParams,
        pageSize,
        offset
      });

      res.json({
        ok: true,
        page,
        pageSize,
        transactionsTotal: Number(data.txTotalRow?.total || 0),
        payoutsTotal: Number(data.payoutsTotalRow?.total || 0),
        transactions: data.transactions,
        payouts: data.payoutsData
      });
    } catch (error) {
      logger.error("Admin finance activity failed", { error: error?.message });
      res.status(500).json({ ok: false, message: "Unable to load finance activity." });
    }
  }

  async function getAdminYoutubeStats(req, res) {
    try {
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const data = await serverDatabaseModel.fetchAdminYoutubeStats(now, dayAgo);

      res.json({
        ok: true,
        stats: {
          rewardPerMinuteGh: youtubeRewardGh,
          durationHours: Math.round((youtubeWatchBoostDurationMs / (60 * 60 * 1000)) * 100) / 100,
          activeHashRate: Number(data.activeHashRow?.total || 0),
          activeUsers: Number(data.activeUsersRow?.total || 0),
          claimsTotal: Number(data.totalsRow?.claims || 0),
          hashGrantedTotal: Number(data.totalsRow?.hash_granted || 0),
          claims24h: Number(data.dayRow?.claims_24h || 0),
          hashGranted24h: Number(data.dayRow?.hash_granted_24h || 0),
          users24h: Number(data.dayRow?.users_24h || 0)
        }
      });
    } catch (error) {
      logger.error("Admin YouTube stats failed", { error: error?.message, adminId: req.admin?.id || null });
      res.status(500).json({ ok: false, message: "Unable to load YouTube stats." });
    }
  }

  async function getAdminYoutubeHistory(req, res) {
    try {
      const page = Math.max(1, Number(req.query?.page || 1));
      const pageSize = Math.max(5, Math.min(200, Number(req.query?.pageSize || 30)));
      const offset = (page - 1) * pageSize;
      const userId = Number(req.query?.userId || 0);

      const whereParts = [];
      const params = [];
      if (userId > 0) {
        whereParts.push("h.user_id = ?");
        params.push(userId);
      }
      const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

      const data = await serverDatabaseModel.fetchAdminYoutubeHistory({ whereSql, params, pageSize, offset });
      res.json({ ok: true, page, pageSize, total: Number(data.totalRow?.total || 0), rows: data.rows });
    } catch (error) {
      logger.error("Admin YouTube history failed", { error: error?.message, adminId: req.admin?.id || null });
      res.status(500).json({ ok: false, message: "Unable to load YouTube history." });
    }
  }

  async function listChatMessages(_req, res) {
    try {
      const rows = await serverDatabaseModel.listChatMessages(chatMaxMessages);
      const messages = rows.reverse().map((row) => ({
        id: row.id,
        userId: Number(row.user_id || 0),
        username: String(row.username || "Miner"),
        message: String(row.message || ""),
        createdAt: Number(row.created_at || 0)
      }));

      res.json({ ok: true, messages });
    } catch (error) {
      logger.error("Chat messages load failed", { error: error?.message });
      res.status(500).json({ ok: false, message: "Unable to load chat messages." });
    }
  }

  async function createChatMessage(req, res) {
    try {
      const userId = Number(req.user?.id || 0);
      const username = String(req.user?.username || req.user?.name || `User#${userId || "guest"}`).trim();
      const message = String(req.body?.message || "").trim();

      if (!message) {
        res.status(400).json({ ok: false, message: "Message is required." });
        return;
      }

      const createdAt = Date.now();
      const insertResult = await serverDatabaseModel.insertChatMessage({ userId, username, message, createdAt });

      const item = {
        id: Number(insertResult?.lastID || 0),
        userId,
        username,
        message,
        createdAt
      };

      io.emit("chat:new-message", item);
      res.json({ ok: true, message: item });
    } catch (error) {
      logger.error("Chat message send failed", { error: error?.message, userId: req.user?.id || null });
      res.status(500).json({ ok: false, message: "Unable to send chat message." });
    }
  }

  async function getLandingStats(_req, res) {
    try {
      const { usersRow, payoutsRow, withdrawalsRow } = await serverDatabaseModel.getLandingStatsRows();
      const startMs = Date.parse(`${onlineStartDate}T00:00:00Z`);
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
  }

  async function getRecentPayments(_req, res) {
    try {
      const payments = await serverDatabaseModel.listRecentPayments(10);
      res.json({
        ok: true,
        payments: payments.map((payment) => ({
          id: payment.id,
          username: payment.username,
          amountPol: Number(payment.amount_pol || 0),
          source: payment.source || "mining",
          txHash: payment.tx_hash || null,
          createdAt: Number(payment.created_at || 0)
        }))
      });
    } catch {
      res.status(500).json({ ok: false, message: "Unable to load recent payments." });
    }
  }

  async function getNetworkStats(_req, res) {
    try {
      const data = await serverDatabaseModel.getNetworkStatsRows();
      const [miningRoomNetworkHash, miniGameNetworkHash, youtubeNetworkHash] = await Promise.all([
        publicStateService.getActiveMiningRoomHashRateTotal(),
        publicStateService.getActiveMiniGameHashRateTotal(),
        publicStateService.getActiveYoutubeHashRateTotal()
      ]);
      const totalBoostHash = Number(miniGameNetworkHash || 0) + Number(youtubeNetworkHash || 0);
      const startMs = Date.parse(`${onlineStartDate}T00:00:00Z`);
      const nowMs = Date.now();
      const daysOnline = Math.max(1, Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

      res.json({
        ok: true,
        registeredUsers: data.usersRow?.total || 0,
        totalPaid: Number(data.payoutsRow?.total || 0) + Number(data.withdrawalsRow?.total || 0),
        daysOnline,
        networkHashRate: Number(data.baseNetworkRow?.total || 0),
        miningRoomHashRate: Number(miningRoomNetworkHash || 0),
        activeGameHashRate: Number(miniGameNetworkHash || 0),
        activeYoutubeHashRate: Number(youtubeNetworkHash || 0),
        activeBoostHashRate: totalBoostHash
      });
    } catch {
      res.status(500).json({ ok: false, message: "Unable to load network stats." });
    }
  }

  async function getEstimatedReward(req, res) {
    try {
      const userId = req.user?.id;
      const rows = await serverDatabaseModel.getEstimatedRewardRows(userId);
      const [userMiniGameHash, userYoutubeHash, miniGameNetworkHash, youtubeNetworkHash] = await Promise.all([
        publicStateService.getUserMiniGameHashRate(userId),
        publicStateService.getUserYoutubeHashRate(userId),
        publicStateService.getActiveMiniGameHashRateTotal(),
        publicStateService.getActiveYoutubeHashRateTotal()
      ]);

      const userGameHash = Number(userMiniGameHash || 0) + Number(userYoutubeHash || 0);
      const gameNetworkHash = Number(miniGameNetworkHash || 0) + Number(youtubeNetworkHash || 0);
      const userHashRate = Number(rows.userBaseRow?.total || 0);
      const networkHashRate = Number(rows.baseNetworkRow?.total || 0);
      const share = networkHashRate > 0 ? userHashRate / networkHashRate : 0;
      const blockReward = Number(engine.rewardBase || 0);

      res.json({
        ok: true,
        userHashRate,
        networkHashRate,
        share,
        blockReward,
        estimatedReward: blockReward * share,
        tokenSymbol: engine.tokenSymbol,
        breakdown: {
          userMiniGameHashRate: Number(userMiniGameHash || 0),
          userYoutubeHashRate: Number(userYoutubeHash || 0),
          networkMiniGameHashRate: Number(miniGameNetworkHash || 0),
          networkYoutubeHashRate: Number(youtubeNetworkHash || 0)
        }
      });
    } catch {
      res.status(500).json({ ok: false, message: "Unable to load estimated reward." });
    }
  }

  async function getYoutubeStatus(req, res) {
    try {
      const userId = Number(req.user?.id || 0);
      const now = Date.now();
      const rows = await serverDatabaseModel.getYoutubeStatusRows(userId, now);

      const lastClaimedAt = Number(rows.latestClaim?.claimed_at || 0);
      const elapsedMs = lastClaimedAt > 0 ? now - lastClaimedAt : youtubeWatchClaimIntervalMs;
      const nextClaimInSeconds = elapsedMs >= youtubeWatchClaimIntervalMs
        ? 0
        : Math.ceil((youtubeWatchClaimIntervalMs - elapsedMs) / 1000);

      res.json({
        ok: true,
        rewardGh: youtubeRewardGh,
        rewardDurationSeconds: Math.round(youtubeWatchBoostDurationMs / 1000),
        nextClaimInSeconds,
        activeHashRate: Number(rows.activeRow?.total || 0)
      });
    } catch (error) {
      logger.error("YouTube status failed", { error: error?.message, userId: req.user?.id || null });
      res.status(500).json({ ok: false, message: "Unable to load YouTube watch status." });
    }
  }

  async function getYoutubeStats(req, res) {
    try {
      const userId = Number(req.user?.id || 0);
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const rows = await serverDatabaseModel.getYoutubeUserStatsRows(userId, now, dayAgo);

      const lastClaimedAt = Number(rows.latestClaim?.claimed_at || 0);
      const elapsedMs = lastClaimedAt > 0 ? now - lastClaimedAt : youtubeWatchClaimIntervalMs;
      const nextClaimInSeconds = elapsedMs >= youtubeWatchClaimIntervalMs
        ? 0
        : Math.ceil((youtubeWatchClaimIntervalMs - elapsedMs) / 1000);

      res.json({
        ok: true,
        rewardGh: youtubeRewardGh,
        rewardDurationSeconds: Math.round(youtubeWatchBoostDurationMs / 1000),
        activeHashRate: Number(rows.activeRow?.total || 0),
        claimsTotal: Number(rows.totalsRow?.claims || 0),
        hashGrantedTotal: Number(rows.totalsRow?.hash_granted || 0),
        claims24h: Number(rows.dayRow?.claims_24h || 0),
        hashGranted24h: Number(rows.dayRow?.hash_granted_24h || 0),
        nextClaimInSeconds,
        lastClaimAt: lastClaimedAt || null
      });
    } catch (error) {
      logger.error("YouTube user stats failed", { error: error?.message, userId: req.user?.id || null });
      res.status(500).json({ ok: false, message: "Unable to load YouTube stats." });
    }
  }

  async function claimYoutubeReward(req, res) {
    try {
      const userId = Number(req.user?.id || 0);
      const now = Date.now();
      const sourceVideoId = String(req.body?.videoId || "").trim() || null;

      const latestClaim = await serverDatabaseModel.getLatestYoutubeClaim(userId);
      const lastClaimedAt = Number(latestClaim?.claimed_at || 0);
      if (lastClaimedAt > 0) {
        const elapsedMs = now - lastClaimedAt;
        if (elapsedMs < youtubeWatchClaimIntervalMs) {
          const remainingSeconds = Math.ceil((youtubeWatchClaimIntervalMs - elapsedMs) / 1000);
          res.status(429).json({
            ok: false,
            message: `Wait ${remainingSeconds}s before claiming the next YouTube reward.`,
            nextClaimInSeconds: remainingSeconds
          });
          return;
        }
      }

      const expiresAt = now + youtubeWatchBoostDurationMs;
      await serverDatabaseModel.grantYoutubeReward({ userId, rewardGh: youtubeRewardGh, now, expiresAt, sourceVideoId });
      await publicStateService.syncUserBaseHashRate(userId);

      const activeRow = await serverDatabaseModel.getYoutubeStatusRows(userId, now);
      res.json({
        ok: true,
        rewardGh: youtubeRewardGh,
        rewardDurationSeconds: Math.round(youtubeWatchBoostDurationMs / 1000),
        activeHashRate: Number(activeRow.activeRow?.total || 0),
        expiresAt
      });
    } catch (error) {
      logger.error("YouTube claim failed", { error: error?.message, userId: req.user?.id || null });
      res.status(500).json({ ok: false, message: "Unable to claim YouTube watch reward." });
    }
  }

  return {
    getAdminUserDetails,
    getAdminFinanceOverview,
    getAdminFinanceActivity,
    getAdminYoutubeStats,
    getAdminYoutubeHistory,
    listChatMessages,
    createChatMessage,
    getLandingStats,
    getRecentPayments,
    getNetworkStats,
    getEstimatedReward,
    getYoutubeStatus,
    getYoutubeStats,
    claimYoutubeReward
  };
}

module.exports = {
  createServerDatabaseController
};