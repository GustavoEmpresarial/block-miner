const { startMiningLoop } = require("./miningCron");
const { startGamePowerCleanup } = require("./gamePowerCleanup");
const { startDepositMonitoring } = require("./depositsCron");
const { startWithdrawalMonitoring } = require("./withdrawalsCron");
const { startBackupCron } = require("./backupCron");

function startCronTasks({ engine, io, persistMinerProfile, run, buildPublicState }) {
  const miningTimers = startMiningLoop({ engine, io, persistMinerProfile, buildPublicState });
  const cleanupTimers = startGamePowerCleanup({ run });
  const depositTimers = startDepositMonitoring();
  // NOTE: Withdrawal monitoring disabled - now using manual admin approval
  // const withdrawalTimers = startWithdrawalMonitoring();
  const backupTimers = startBackupCron({ run });

  return {
    ...miningTimers,
    ...cleanupTimers,
    ...depositTimers,
    // ...withdrawalTimers,
    ...backupTimers
  };
}

module.exports = {
  startCronTasks
};
