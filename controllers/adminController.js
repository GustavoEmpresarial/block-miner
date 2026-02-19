const minersModel = require("../models/minersModel");

function toTrimmedString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseSlotSize(value) {
  const num = Number(value);
  if (!Number.isInteger(num)) return null;
  if (num !== 1 && num !== 2) return null;
  return num;
}

function parseIsActive(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return Boolean(value);
}

function normalizeImageUrl(value) {
  const text = toTrimmedString(value);
  return text.length > 0 ? text : null;
}

function validateMinerPayload(body) {
  const name = toTrimmedString(body?.name);
  const slug = toTrimmedString(body?.slug);
  const baseHashRate = parseNumber(body?.baseHashRate);
  const price = parseNumber(body?.price);
  const slotSize = parseSlotSize(body?.slotSize);
  const imageUrl = normalizeImageUrl(body?.imageUrl);
  const isActive = parseIsActive(body?.isActive);

  if (!name || !slug) {
    return { ok: false, message: "Name and slug are required." };
  }

  if (!/^[a-z0-9-]{3,60}$/i.test(slug)) {
    return { ok: false, message: "Slug must be 3-60 chars, letters, numbers, or hyphens." };
  }

  if (baseHashRate === null || baseHashRate <= 0) {
    return { ok: false, message: "Base hash rate must be greater than 0." };
  }

  if (price === null || price < 0) {
    return { ok: false, message: "Price must be 0 or higher." };
  }

  if (!slotSize) {
    return { ok: false, message: "Slot size must be 1 or 2." };
  }

  return {
    ok: true,
    value: {
      name,
      slug,
      baseHashRate,
      price,
      slotSize,
      imageUrl,
      isActive
    }
  };
}

function createAdminController() {
  async function listMiners(_req, res) {
    try {
      const miners = await minersModel.listAllMiners();
      res.json({ ok: true, miners });
    } catch (error) {
      console.error("Admin list miners error:", error);
      res.status(500).json({ ok: false, message: "Unable to load miners." });
    }
  }

  async function createMiner(req, res) {
    const validation = validateMinerPayload(req.body);
    if (!validation.ok) {
      res.status(400).json({ ok: false, message: validation.message });
      return;
    }

    try {
      const miner = await minersModel.createMiner(validation.value);
      res.json({ ok: true, miner });
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed: miners.slug")) {
        res.status(409).json({ ok: false, message: "Slug already exists." });
        return;
      }
      console.error("Admin create miner error:", error);
      res.status(500).json({ ok: false, message: "Unable to create miner." });
    }
  }

  async function updateMiner(req, res) {
    const minerId = Number(req.params?.id);
    if (!Number.isInteger(minerId) || minerId <= 0) {
      res.status(400).json({ ok: false, message: "Invalid miner ID." });
      return;
    }

    const validation = validateMinerPayload(req.body);
    if (!validation.ok) {
      res.status(400).json({ ok: false, message: validation.message });
      return;
    }

    try {
      const existing = await minersModel.getMinerById(minerId);
      if (!existing) {
        res.status(404).json({ ok: false, message: "Miner not found." });
        return;
      }

      const miner = await minersModel.updateMiner(minerId, validation.value);
      res.json({ ok: true, miner });
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed: miners.slug")) {
        res.status(409).json({ ok: false, message: "Slug already exists." });
        return;
      }
      console.error("Admin update miner error:", error);
      res.status(500).json({ ok: false, message: "Unable to update miner." });
    }
  }

  return {
    listMiners,
    createMiner,
    updateMiner
  };
}

module.exports = {
  createAdminController
};
