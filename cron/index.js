const { startMiningLoop } = require("./miningCron");
const { startGamePowerCleanup } = require("./gamePowerCleanup");
const { startDepositMonitoring } = require("./depositsCron");
const { startBackupCron } = require("./backupCron");

function startCronTasks({ engine, io, persistMinerProfile, run, buildPublicState }) {
  const miningTimers = startMiningLoop({ engine, io, persistMinerProfile, buildPublicState });
  const cleanupTimers = startGamePowerCleanup({ run });
  const depositTimers = startDepositMonitoring();
  const backupTimers = startBackupCron({ run });

  return {
    ...miningTimers,
    ...cleanupTimers,
    ...depositTimers,
    ...backupTimers
  };
}

module.exports = {
  startCronTasks
};
