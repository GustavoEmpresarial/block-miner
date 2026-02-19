function getMinerNameFromHashRate(hashRate) {
  const rate = Number(hashRate || 0);
  if (rate >= 100) return "Elite Miner";
  if (rate >= 80) return "Pro Miner";
  return "Basic Miner";
}

function getHashRateForMinerName(minerName) {
  if (!minerName) return 55;
  if (minerName.includes("Elite")) return 120;
  if (minerName.includes("Pro")) return 85;
  return 55;
}

function getSlotSizeForMiner(hashRate) {
  const rate = Number(hashRate || 0);
  // Elite Miner (hash_rate >= 100) occupies 2 slots
  if (rate >= 100) return 2;
  // Basic and Pro Miners occupy 1 slot
  return 1;
}

module.exports = {
  getMinerNameFromHashRate,
  getHashRateForMinerName,
  getSlotSizeForMiner
};
