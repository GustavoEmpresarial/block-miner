const { startMiningLoop } = require("./miningCron");
const { startGamePowerCleanup } = require("./gamePowerCleanup");
const { startDepositMonitoring } = require("./depositsCron");

function startCronTasks({ engine, io, persistMinerProfile, run, buildPublicState }) {
  const miningTimers = startMiningLoop({ engine, io, persistMinerProfile, buildPublicState });
  const cleanupTimers = startGamePowerCleanup({ run });
  const depositTimers = startDepositMonitoring();

  return {
    ...miningTimers,
    ...cleanupTimers,
    ...depositTimers
  };
}

module.exports = {
  startCronTasks
};
