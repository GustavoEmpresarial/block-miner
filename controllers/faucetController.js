const { get, run } = require("../models/db");
const { addInventoryItem } = require("../models/inventoryModel");
const minersModel = require("../models/minersModel");
const { getBrazilCheckinDateKey } = require("../utils/checkinDate");

const DEFAULT_FAUCET_COOLDOWN_MS = 60 * 60 * 1000;

async function getActiveReward() {
  const reward = await get(
    "SELECT id, miner_id, cooldown_ms FROM faucet_rewards WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
  );
  if (!reward?.miner_id) {
    return null;
  }

  const miner = await minersModel.getMinerById(reward.miner_id);
  if (!miner) {
    return null;
  }

  return {
    rewardId: reward.id,
    cooldownMs: Number(reward.cooldown_ms || DEFAULT_FAUCET_COOLDOWN_MS),
    miner
  };
}

function buildStatusPayload(record, now, cooldownMs) {
  if (!record) {
    return {
      available: true,
      remainingMs: 0,
      nextClaimAt: null,
      totalClaims: 0
    };
  }

  const nextClaimAt = Number(record.claimed_at) + cooldownMs;
  const remainingMs = Math.max(0, nextClaimAt - now);

  return {
    available: remainingMs === 0,
    remainingMs,
    nextClaimAt,
    totalClaims: Number(record.total_claims || 0)
  };
}

async function normalizeFaucetRecord(userId, record) {
  const todayKey = getBrazilCheckinDateKey();
  if (!record) {
    return { record: null, todayKey };
  }

  const recordKey = String(record.day_key || "").trim();
  if (recordKey && recordKey === todayKey) {
    return { record, todayKey };
  }

  await run(
    "UPDATE faucet_claims SET claimed_at = 0, total_claims = 0, day_key = ? WHERE user_id = ?",
    [todayKey, userId]
  );

  return {
    record: { ...record, claimed_at: 0, total_claims: 0, day_key: todayKey },
    todayKey
  };
}

async function getStatus(req, res) {
  try {
    const record = await get("SELECT claimed_at, total_claims, day_key FROM faucet_claims WHERE user_id = ?", [req.user.id]);
    const reward = await getActiveReward();
    if (!reward) {
      res.status(500).json({ ok: false, message: "Faucet reward not configured." });
      return;
    }

    const normalized = await normalizeFaucetRecord(req.user.id, record);
    const statusRecord = normalized.record;

    const payload = buildStatusPayload(statusRecord, Date.now(), reward.cooldownMs);
    res.json({
      ok: true,
      ...payload,
      reward: {
        id: reward.rewardId,
        minerId: reward.miner.id,
        name: reward.miner.name,
        hashRate: Number(reward.miner.base_hash_rate || 0),
        slotSize: Number(reward.miner.slot_size || 1),
        imageUrl: reward.miner.image_url || `/assets/machines/${reward.miner.id}.png`
      }
    });
  } catch (error) {
    console.error("Error loading faucet status:", error);
    res.status(500).json({ ok: false, message: "Unable to load faucet status." });
  }
}

async function claim(req, res) {
  try {
    const now = Date.now();
    const record = await get("SELECT claimed_at, total_claims, day_key FROM faucet_claims WHERE user_id = ?", [req.user.id]);
    const reward = await getActiveReward();
    if (!reward) {
      res.status(500).json({ ok: false, message: "Faucet reward not configured." });
      return;
    }

    const normalized = await normalizeFaucetRecord(req.user.id, record);
    const status = buildStatusPayload(normalized.record, now, reward.cooldownMs);

    if (!status.available) {
      res.status(429).json({ ok: false, message: "Faucet cooldown active.", remainingMs: status.remainingMs });
      return;
    }

    const miner = reward.miner;
    await addInventoryItem(
      req.user.id,
      miner.name,
      1,
      Number(miner.base_hash_rate || 0),
      Number(miner.slot_size || 1),
      now,
      now,
      miner.id
    );

    if (normalized.record) {
      await run(
        "UPDATE faucet_claims SET claimed_at = ?, total_claims = total_claims + 1, day_key = ? WHERE user_id = ?",
        [now, normalized.todayKey, req.user.id]
      );
    } else {
      await run(
        "INSERT INTO faucet_claims (user_id, claimed_at, total_claims, day_key) VALUES (?, ?, 1, ?)",
        [req.user.id, now, normalized.todayKey]
      );
    }

    res.json({
      ok: true,
      message: `Faucet claimed. ${miner.name} was added to your inventory.`,
      reward: {
        id: reward.rewardId,
        minerId: miner.id,
        name: miner.name,
        hashRate: Number(miner.base_hash_rate || 0),
        slotSize: Number(miner.slot_size || 1),
        imageUrl: miner.image_url || `/assets/machines/${miner.id}.png`
      },
      nextAvailableAt: now + reward.cooldownMs
    });
  } catch (error) {
    console.error("Error claiming faucet:", error);
    res.status(500).json({ ok: false, message: "Unable to claim faucet." });
  }
}

module.exports = {
  getStatus,
  claim
};
