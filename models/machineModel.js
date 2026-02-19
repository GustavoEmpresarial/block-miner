const { all, get, run } = require("./db");

async function listUserMachines(userId) {
  return all(
    `
      SELECT
        um.id,
        um.slot_index,
        um.level,
        um.hash_rate,
        um.is_active,
        um.purchased_at,
        um.slot_size,
        um.miner_id,
        m.name as miner_name,
        m.image_url as image_url
      FROM user_miners um
      LEFT JOIN miners m ON um.miner_id = m.id
      WHERE um.user_id = ?
      ORDER BY um.slot_index ASC
    `,
    [userId]
  );
}

async function getMachineById(userId, machineId) {
  return get(
    `
      SELECT
        um.id,
        um.slot_index,
        um.level,
        um.hash_rate,
        um.is_active,
        um.purchased_at,
        um.slot_size,
        um.miner_id,
        m.name as miner_name,
        m.image_url as image_url
      FROM user_miners um
      LEFT JOIN miners m ON um.miner_id = m.id
      WHERE um.id = ? AND um.user_id = ?
    `,
    [machineId, userId]
  );
}

async function getMachineBySlot(userId, slotIndex) {
  return get("SELECT id, slot_size FROM user_miners WHERE user_id = ? AND slot_index = ?", [userId, slotIndex]);
}

async function checkSlotAvailability(userId, slotIndex, slotsNeeded) {
  // For 2-cell machines, must start on even slots (0, 2, 4, 6)
  if (slotsNeeded === 2 && slotIndex % 2 !== 0) {
    return false;
  }
  
  // Check if the target slots are occupied
  for (let i = 0; i < slotsNeeded; i++) {
    const machine = await get(
      "SELECT id FROM user_miners WHERE user_id = ? AND slot_index = ?",
      [userId, slotIndex + i]
    );
    if (machine) {
      return false;
    }
  }
  
  // Check if a 2-cell machine from the previous slot occupies the current slot
  if (slotIndex % 2 === 1) {
    const previousMachine = await get(
      "SELECT slot_size FROM user_miners WHERE user_id = ? AND slot_index = ?",
      [userId, slotIndex - 1]
    );
    if (previousMachine && previousMachine.slot_size === 2) {
      return false;
    }
  }
  
  return true;
}

async function insertMachine(userId, slotIndex, level, hashRate, isActive, purchasedAt, slotSize = 1, minerId = null) {
  return run(
    "INSERT INTO user_miners (user_id, slot_index, level, hash_rate, is_active, purchased_at, slot_size, miner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, slotIndex, level, hashRate, isActive ? 1 : 0, purchasedAt, slotSize, minerId]
  );
}

async function updateMachineLevelHashRate(machineId, level, hashRate) {
  return run("UPDATE user_miners SET level = ?, hash_rate = ? WHERE id = ?", [level, hashRate, machineId]);
}

async function updateMachineActive(machineId, isActive) {
  return run("UPDATE user_miners SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, machineId]);
}

async function deleteMachine(machineId) {
  return run("DELETE FROM user_miners WHERE id = ?", [machineId]);
}

async function listMachinesBySlotRange(userId, startSlot, endSlot) {
  return all(
    `
      SELECT
        um.id,
        um.slot_index,
        um.level,
        um.hash_rate,
        um.is_active,
        um.purchased_at,
        um.slot_size,
        um.miner_id,
        m.name as miner_name,
        m.image_url as image_url
      FROM user_miners um
      LEFT JOIN miners m ON um.miner_id = m.id
      WHERE um.user_id = ? AND um.slot_index BETWEEN ? AND ?
      ORDER BY um.slot_index ASC
    `,
    [userId, startSlot, endSlot]
  );
}

async function deleteMachinesBySlotRange(userId, startSlot, endSlot) {
  return run("DELETE FROM user_miners WHERE user_id = ? AND slot_index BETWEEN ? AND ?", [userId, startSlot, endSlot]);
}

module.exports = {
  listUserMachines,
  getMachineById,
  getMachineBySlot,
  checkSlotAvailability,
  insertMachine,
  updateMachineLevelHashRate,
  updateMachineActive,
  deleteMachine,
  listMachinesBySlotRange,
  deleteMachinesBySlotRange
};
