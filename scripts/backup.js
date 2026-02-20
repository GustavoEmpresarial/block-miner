const logger = require("../utils/logger").child("BackupCLI");
const { db, run } = require("../src/db/sqlite");
const { createDatabaseBackup, pruneBackups, getBackupConfig } = require("../utils/backup");

function closeDatabase() {
  return new Promise((resolve) => {
    if (!db || typeof db.close !== "function") {
      resolve();
      return;
    }
    db.close(() => resolve());
  });
}

async function main() {
  const config = getBackupConfig();
  const result = await createDatabaseBackup({ run, ...config, logger });
  logger.info("Database backup created", result);
  const pruned = await pruneBackups({ ...config, logger });
  if (pruned.deleted > 0) {
    logger.info("Old backups pruned", pruned);
  }
}

main()
  .catch((error) => {
    logger.error("Backup failed", { error: error.message });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
