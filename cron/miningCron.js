const DEFAULT_TICK_MS = 1000;
const DEFAULT_PERSIST_MS = 15000;
const logger = require("../utils/logger").child("MiningCron");
const { createCronActionRunner } = require("./cronActionRunner");

function startMiningLoop({ engine, io, persistMinerProfile, buildPublicState }, options = {}) {
  const tickMs = Number(options.tickMs || DEFAULT_TICK_MS);
  const persistMs = Number(options.persistMs || DEFAULT_PERSIST_MS);
  const startupProbeMs = Number(options.startupProbeMs || 10_000);
  const syncEngineMiners = typeof options.syncEngineMiners === "function" ? options.syncEngineMiners : null;
  const syncUserBaseHashRate = typeof options.syncUserBaseHashRate === "function" ? options.syncUserBaseHashRate : null;
  const runCronAction = createCronActionRunner({ logger, cronName: "MiningCron" });
  const startedAt = Date.now();
  const startupMetrics = {
    tickSuccess: 0,
    tickFailed: 0,
    persistSuccess: 0,
    persistFailed: 0,
    firstTickAt: null,
    firstPersistAt: null,
    lastTickReason: null,
    lastPersistReason: null
  };

  const tick = async () => {
    const result = await runCronAction({
      action: "mining_tick",
      logStart: false,
      logSuccess: false,
      skippedLogLevel: "debug",
      validateFailureLogLevel: "debug",
      validate: async () => {
        if (!engine || typeof engine.tick !== "function") {
          return { ok: false, reason: "invalid_engine" };
        }
        if (!io || typeof io.emit !== "function") {
          return { ok: false, reason: "invalid_socket_io" };
        }
        return { ok: true };
      },
      sanitize: async () => ({ hasPublicStateBuilder: typeof buildPublicState === "function" }),
      execute: async ({ hasPublicStateBuilder }) => {
        engine.tick();
        if (hasPublicStateBuilder) {
          const state = await buildPublicState();
          io.emit("state:update", state);
          return { emitted: true, source: "publicStateService" };
        }
        io.emit("state:update", engine.getPublicState());
        return { emitted: true, source: "engine" };
      },
      confirm: async ({ executionResult }) => ({
        ok: Boolean(executionResult?.emitted),
        reason: executionResult?.emitted ? null : "state_not_emitted"
      })
    });

    if (result.ok) {
      startupMetrics.tickSuccess += 1;
      if (!startupMetrics.firstTickAt) {
        startupMetrics.firstTickAt = Date.now();
      }
    } else {
      startupMetrics.tickFailed += 1;
      startupMetrics.lastTickReason = result.reason || result.stage || "tick_failed";
    }

    return result;
  };

  tick();
  const tickTimer = setInterval(() => {
    tick().catch((error) => {
      console.error("Mining tick error:", error);
    });
  }, tickMs);

  const persist = async () => {
    const result = await runCronAction({
      action: "persist_miners",
      logStart: false,
      logSuccess: false,
      skippedLogLevel: "debug",
      validateFailureLogLevel: "debug",
      validate: async () => {
        if (!engine || !engine.miners || typeof engine.miners.values !== "function") {
          return { ok: false, reason: "invalid_engine_miners" };
        }
        if (typeof persistMinerProfile !== "function") {
          return { ok: false, reason: "invalid_persist_function" };
        }
        return { ok: true };
      },
      sanitize: async () => ({
        miners: [...engine.miners.values()]
      }),
      execute: async ({ miners }) => {
        // Sync baseHashRate for all users with machines before persisting
        if (syncUserBaseHashRate) {
          const userIds = [...new Set(miners.map((m) => m.userId).filter(Boolean))];
          await Promise.all(userIds.map((userId) => syncUserBaseHashRate(userId)));
        }
        
        // Sync engine miners from database
        if (syncEngineMiners) {
          await syncEngineMiners();
        }
        
        // Persist all miner profiles
        const saves = miners.map((miner) => persistMinerProfile(miner));
        const settled = await Promise.allSettled(saves);
        const fulfilled = settled.filter((entry) => entry.status === "fulfilled").length;
        const rejected = settled.length - fulfilled;
        return { total: settled.length, fulfilled, rejected };
      },
      confirm: async ({ executionResult }) => ({
        ok: executionResult.rejected === 0,
        reason: executionResult.rejected === 0 ? null : "miner_persist_partial_failure",
        details: executionResult
      })
    });

    if (result.ok) {
      startupMetrics.persistSuccess += 1;
      if (!startupMetrics.firstPersistAt) {
        startupMetrics.firstPersistAt = Date.now();
      }
    } else {
      startupMetrics.persistFailed += 1;
      startupMetrics.lastPersistReason = result.reason || result.stage || "persist_failed";
    }

    return result;
  };

  const persistTimer = setInterval(persist, persistMs);

  const startupProbeTimer = setTimeout(() => {
    const uptimeMs = Date.now() - startedAt;
    const tickOk = startupMetrics.tickSuccess > 0 && startupMetrics.tickFailed === 0;

    const persistWindowReached = uptimeMs >= persistMs;
    const persistOk = persistWindowReached
      ? startupMetrics.persistSuccess > 0 && startupMetrics.persistFailed === 0
      : true;

    const payoutDone = Number(engine?.lastReward || 0) > 0;
    const payoutStatus = payoutDone
      ? "ok"
      : Date.now() < Number(engine?.nextBlockAt || 0)
        ? "not_due_yet"
        : "not_confirmed";

    const payload = {
      uptimeMs,
      tick: {
        ok: tickOk,
        success: startupMetrics.tickSuccess,
        failed: startupMetrics.tickFailed,
        lastReason: startupMetrics.lastTickReason
      },
      persist: {
        ok: persistOk,
        checked: persistWindowReached,
        success: startupMetrics.persistSuccess,
        failed: startupMetrics.persistFailed,
        lastReason: startupMetrics.lastPersistReason
      },
      payout: {
        status: payoutStatus,
        lastReward: Number(engine?.lastReward || 0),
        nextBlockAt: Number(engine?.nextBlockAt || 0),
        blockNumber: Number(engine?.blockNumber || 0)
      }
    };

    const startupOk = tickOk && persistOk && payoutStatus !== "not_confirmed";
    if (startupOk) {
      logger.info("Mining startup check (10s)", payload);
      return;
    }

    logger.warn("Mining startup check (10s)", payload);
  }, startupProbeMs);

  logger.info("Mining cron started", { tickMs, persistMs, startupProbeMs });

  return { tickTimer, persistTimer, startupProbeTimer };
}

module.exports = {
  startMiningLoop
};
