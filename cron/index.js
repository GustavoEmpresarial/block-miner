const { startMiningLoop } = require("./miningCron");
const { startGamePowerCleanup } = require("./gamePowerCleanup");
// const { startDepositMonitoring } = require("./depositsCron"); // DISABLED
const { startWithdrawalMonitoring } = require("./withdrawalsCron");
const { startBackupCron, runFullSiteBackupOnStartup } = require("./backupCron");
const { startCallbackQueueProcessing } = require("./callbackQueueCron");
const { startShortlinkResetCron } = require("./shortlinkResetCron");

function startCronTasks({ engine, io, persistMinerProfile, run, buildPublicState, syncEngineMiners, syncUserBaseHashRate }) {
  const miningTimers = startMiningLoop(
    { engine, io, persistMinerProfile, buildPublicState },
    { syncEngineMiners, syncUserBaseHashRate }
  );
  const cleanupTimers = startGamePowerCleanup({ run });
  // const depositTimers = startDepositMonitoring(); // DISABLED
  const depositTimers = [];
  // NOTE: Withdrawal monitoring disabled - now using manual admin approval
  // const withdrawalTimers = startWithdrawalMonitoring();
  const backupTimers = startBackupCron({ run });
  const callbackQueueTimers = startCallbackQueueProcessing();
  const shortlinkResetTimers = startShortlinkResetCron();

  // Run full site backup on startup (includes DB + all files)
  runFullSiteBackupOnStartup();

  return {
    ...miningTimers,
    ...cleanupTimers,
    ...depositTimers,
    // ...withdrawalTimers,
    ...backupTimers,
    ...callbackQueueTimers,
    ...shortlinkResetTimers
  };
}

module.exports = {
  startCronTasks
};
