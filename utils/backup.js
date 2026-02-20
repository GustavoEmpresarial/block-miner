const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatTimestamp(date) {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultDbPath() {
  return path.resolve(process.env.DB_PATH || path.join(process.cwd(), "data", "blockminer.db"));
}

function getBackupConfig() {
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), "backups"));
  const retentionDays = parseNumber(process.env.BACKUP_RETENTION_DAYS, 7);
  const filenamePrefix = process.env.BACKUP_FILENAME_PREFIX || "blockminer-db-";
  return {
    backupDir,
    retentionDays,
    filenamePrefix
  };
}

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function createDatabaseBackup({ run, backupDir, filenamePrefix, logger }) {
  const startedAt = Date.now();
  await ensureDir(backupDir);

  const stamp = formatTimestamp(new Date());
  const backupFile = path.join(backupDir, `${filenamePrefix}${stamp}.db`);

  // Preferred: consistent SQLite backup without racing a live WAL file.
  try {
    const sqlPath = escapeSqlString(backupFile);
    await run(`VACUUM INTO '${sqlPath}'`);
    return { backupFile, method: "vacuum-into", durationMs: Date.now() - startedAt };
  } catch (error) {
    if (logger && logger.warn) {
      logger.warn("VACUUM INTO failed; falling back to file copy", { error: error.message });
    }
  }

  // Fallback: best-effort file copy (may be inconsistent if SQLite is writing).
  const dbPath = getDefaultDbPath();
  await ensureDir(path.dirname(backupFile));
  await fsp.copyFile(dbPath, backupFile);
  return { backupFile, method: "copy-file", durationMs: Date.now() - startedAt };
}

async function pruneBackups({ backupDir, retentionDays, filenamePrefix, logger }) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) {
    return { deleted: 0 };
  }

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(backupDir)) {
    return { deleted: 0 };
  }

  const entries = await fsp.readdir(backupDir, { withFileTypes: true });
  const backupRegex = new RegExp(`^${escapeRegExp(filenamePrefix)}\\d{8}-\\d{6}\\.db$`);
  let deleted = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!backupRegex.test(entry.name)) continue;

    const fullPath = path.join(backupDir, entry.name);
    let stat;
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      continue;
    }

    if (stat.mtimeMs < cutoffMs) {
      try {
        await fsp.unlink(fullPath);
        deleted += 1;
      } catch (error) {
        if (logger && logger.warn) {
          logger.warn("Failed to delete old backup", { file: fullPath, error: error.message });
        }
      }
    }
  }

  return { deleted };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  getBackupConfig,
  createDatabaseBackup,
  pruneBackups
};
