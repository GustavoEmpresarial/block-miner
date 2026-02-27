const logger = require("../utils/logger").child("BackupCron");
const {
  createDatabaseBackup,
  createFullSiteBackup,
  pruneBackups,
  getBackupConfig,
  replicateBackupToExternal,
  runCloudBackupCommand
} = require("../utils/backup");
const { createCronActionRunner } = require("./cronActionRunner");
const cron = require('node-cron');
const config = require('../src/config');

const DEFAULT_STARTUP_DELAY_MS = 60_000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function getIntervalMs() {
  const intervalMs = parseNumber(process.env.BACKUP_INTERVAL_MS, NaN);
  if (Number.isFinite(intervalMs) && intervalMs > 0) return intervalMs;

  const intervalHours = parseNumber(process.env.BACKUP_INTERVAL_HOURS, NaN);
  if (Number.isFinite(intervalHours) && intervalHours > 0) return intervalHours * 60 * 60 * 1000;

  return DEFAULT_INTERVAL_MS;
}

async function runFullSiteBackupOnStartup() {
  const defaultEnabled = process.env.NODE_ENV === "production";
  const enabled = parseBoolean(process.env.BACKUP_FULL_SITE_ON_STARTUP, defaultEnabled);
  if (!enabled) {
    logger.info("Full site backup on startup disabled");
    return;
  }

  const delay = Math.max(0, parseNumber(process.env.BACKUP_FULL_SITE_STARTUP_DELAY_MS, 15000));

  setTimeout(async () => {
    try {
      logger.info("Starting full site backup on startup...");
      const backupConfig = getBackupConfig();
      
      const result = await createFullSiteBackup({
        backupDir: backupConfig.backupDir,
        filenamePrefix: "blockminer-full-",
        logger
      });

      logger.info("Full site backup created", {
        backupFile: result.backupFile,
        durationMs: result.durationMs
      });

      // Upload to cloud if enabled
      if (backupConfig.cloudBackupEnabled && backupConfig.cloudCommandTemplate) {
        const cloudResult = await runCloudBackupCommand({
          backupFile: result.backupFile,
          commandTemplate: backupConfig.cloudCommandTemplate,
          timeoutMs: backupConfig.cloudTimeoutMs
        });

        if (cloudResult.success) {
          logger.info("Full site backup uploaded to cloud", {
            durationMs: cloudResult.durationMs
          });
        } else {
          logger.warn("Full site backup cloud upload failed", {
            error: cloudResult.error || cloudResult.stderr
          });
        }
      }
    } catch (error) {
      logger.error("Full site backup on startup failed", {
        error: error.message
      });
    }
  }, delay);
}

function startBackupCron({ run }) {
  const runCronAction = createCronActionRunner({ logger, cronName: "BackupCron" });
  const enabled = parseBoolean(process.env.BACKUP_ENABLED, true);
  if (!enabled) {
    logger.info("Backup cron disabled via BACKUP_ENABLED");
    return {};
  }

  const defaultRunOnStartup = process.env.NODE_ENV === "production";
  const runOnStartup = parseBoolean(process.env.BACKUP_RUN_ON_STARTUP, defaultRunOnStartup);

  const startupDelayMs = Math.max(0, parseNumber(process.env.BACKUP_STARTUP_DELAY_MS, DEFAULT_STARTUP_DELAY_MS));
  const intervalMs = getIntervalMs();

  const tick = async () => {
    await runCronAction({
      action: "backup_tick",
      meta: { trigger: "scheduler" },
      prepare: async () => ({ backupConfig: getBackupConfig(), hasRunFn: typeof run === "function" }),
      validate: async ({ hasRunFn }) => {
        if (!hasRunFn) {
          return { ok: false, reason: "missing_run_function" };
        }
        return { ok: true };
      },
      sanitize: async ({ backupConfig }) => ({
        backupConfig
      }),
      execute: async ({ backupConfig }) => {
        const result = await createDatabaseBackup({ run, ...backupConfig, logger });
        await pruneBackups({ ...backupConfig, logger });

        const external = {
          enabled: Boolean(backupConfig.externalBackupEnabled && backupConfig.externalBackupDir),
          backupFile: null,
          error: null
        };

        if (external.enabled) {
          try {
            const externalResult = await replicateBackupToExternal({
              backupFile: result.backupFile,
              externalBackupDir: backupConfig.externalBackupDir
            });

            external.backupFile = externalResult.backupFile;

            await pruneBackups({
              backupDir: backupConfig.externalBackupDir,
              retentionDays: backupConfig.externalRetentionDays,
              filenamePrefix: backupConfig.filenamePrefix,
              logger
            });
          } catch (error) {
            external.error = error.message;
            logger.warn("External backup replication failed", {
              error: error.message,
              externalBackupDir: backupConfig.externalBackupDir
            });
          }
        }

        const cloud = {
          enabled: Boolean(backupConfig.cloudBackupEnabled),
          executed: false,
          success: false,
          exitCode: null,
          error: null
        };

        if (cloud.enabled) {
          const cloudResult = await runCloudBackupCommand({
            backupFile: result.backupFile,
            commandTemplate: backupConfig.cloudCommandTemplate,
            timeoutMs: backupConfig.cloudTimeoutMs
          });

          cloud.executed = Boolean(cloudResult.executed);
          cloud.success = Boolean(cloudResult.success);
          cloud.exitCode = cloudResult.exitCode ?? null;

          if (!cloudResult.success) {
            cloud.error = cloudResult.timedOut
              ? "cloud_backup_timeout"
              : cloudResult.error || cloudResult.stderr || "cloud_backup_failed";

            logger.warn("Cloud backup command failed", {
              exitCode: cloudResult.exitCode,
              timedOut: cloudResult.timedOut,
              error: cloud.error
            });
          }
        }

        return {
          ...result,
          external,
          cloud
        };
      },
      confirm: async ({ executionResult }) => ({
        ok: Boolean(executionResult?.backupFile),
        reason: executionResult?.backupFile ? null : "missing_backup_file",
        details: {
          backupFile: executionResult?.backupFile || null,
          method: executionResult?.method || null,
          externalBackupFile: executionResult?.external?.backupFile || null,
          externalError: executionResult?.external?.error || null,
          cloudExecuted: Boolean(executionResult?.cloud?.executed),
          cloudSuccess: Boolean(executionResult?.cloud?.success),
          cloudError: executionResult?.cloud?.error || null
        }
      })
    });
  };

  // If configuration provides a cron expression, schedule with node-cron
  const cronExpr = config?.schedules?.backupCron;
  if (cronExpr) {
    try {
      const task = cron.schedule(cronExpr, () => {
        tick().catch(err => logger.error('Backup tick failed', { error: err.message }));
      }, { scheduled: true });

      if (runOnStartup) setTimeout(() => tick(), startupDelayMs);

      logger.info('Backup cron started (cron)', { cron: cronExpr, runOnStartup, startupDelayMs });
      return { backupCronTask: task };
    } catch (error) {
      logger.error('Invalid backup cron expression, falling back to interval', { cronExpr, error: error.message });
    }
  }

  const startupTimer = runOnStartup
    ? setTimeout(() => {
        tick();
      }, startupDelayMs)
    : null;

  const backupTimer = setInterval(() => {
    tick();
  }, intervalMs);

  logger.info("Backup cron started", { runOnStartup, startupDelayMs, intervalMs });

  return { backupTimer, backupStartupTimer: startupTimer };
}

module.exports = {
  startBackupCron,
  runFullSiteBackupOnStartup
};
