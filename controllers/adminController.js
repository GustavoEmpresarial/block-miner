const minersModel = require("../models/minersModel");
const { get, all, run } = require("../models/db");

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
  async function getStats(_req, res) {
    try {
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

      const [
        usersTotal,
        usersBanned,
        usersNew24h,
        minersTotal,
        minersActive,
        inventoryTotal,
        balances,
        tx24h,
        referralsTotal,
        audit24h
      ] = await Promise.all([
        get("SELECT COUNT(*) AS count FROM users"),
        get("SELECT COUNT(*) AS count FROM users WHERE is_banned = 1"),
        get("SELECT COUNT(*) AS count FROM users WHERE created_at >= ?", [dayAgo]),
        get("SELECT COUNT(*) AS count FROM miners"),
        get("SELECT COUNT(*) AS count FROM miners WHERE is_active = 1"),
        get("SELECT COUNT(*) AS count FROM user_inventory"),
        get(
          "SELECT COALESCE(SUM(balance), 0) AS balance, COALESCE(SUM(lifetime_mined), 0) AS lifetime, COALESCE(SUM(total_withdrawn), 0) AS withdrawn FROM users_temp_power"
        ),
        get(
          "SELECT COUNT(*) AS count FROM transactions WHERE created_at >= ?",
          [dayAgo]
        ),
        get("SELECT COUNT(*) AS count FROM referrals"),
        get("SELECT COUNT(*) AS count FROM audit_logs WHERE created_at >= ?", [dayAgo])
      ]);

      const lockoutsWeek = await get(
        "SELECT COUNT(*) AS count FROM auth_lockouts WHERE last_at >= ?",
        [weekAgo]
      ).catch(() => ({ count: 0 }));

      res.json({
        ok: true,
        stats: {
          usersTotal: Number(usersTotal?.count || 0),
          usersBanned: Number(usersBanned?.count || 0),
          usersNew24h: Number(usersNew24h?.count || 0),
          minersTotal: Number(minersTotal?.count || 0),
          minersActive: Number(minersActive?.count || 0),
          inventoryTotal: Number(inventoryTotal?.count || 0),
          balanceTotal: Number(balances?.balance || 0),
          lifetimeMinedTotal: Number(balances?.lifetime || 0),
          totalWithdrawn: Number(balances?.withdrawn || 0),
          transactions24h: Number(tx24h?.count || 0),
          referralsTotal: Number(referralsTotal?.count || 0),
          auditEvents24h: Number(audit24h?.count || 0),
          lockouts7d: Number(lockoutsWeek?.count || 0)
        }
      });
    } catch (error) {
      console.error("Admin stats error:", error);
      res.status(500).json({ ok: false, message: "Unable to load admin stats." });
    }
  }

  async function listRecentUsers(req, res) {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 25)));
      const users = await all(
        `
          SELECT id, username, name, email, is_banned, created_at, last_login_at
          FROM users
          ORDER BY created_at DESC
          LIMIT ?
        `,
        [limit]
      );

      res.json({ ok: true, users });
    } catch (error) {
      console.error("Admin list users error:", error);
      res.status(500).json({ ok: false, message: "Unable to load users." });
    }
  }

  async function listAuditLogs(req, res) {
    try {
      const limit = Math.max(1, Math.min(300, Number(req.query?.limit || 50)));
      const logs = await all(
        `
          SELECT a.id, a.user_id, u.email AS user_email, a.action, a.ip, a.created_at
          FROM audit_logs a
          LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.created_at DESC
          LIMIT ?
        `,
        [limit]
      );
      res.json({ ok: true, logs });
    } catch (error) {
      console.error("Admin list audit logs error:", error);
      res.status(500).json({ ok: false, message: "Unable to load audit logs." });
    }
  }

  async function setUserBan(req, res) {
    try {
      const userId = Number(req.params?.id);
      if (!Number.isInteger(userId) || userId <= 0) {
        res.status(400).json({ ok: false, message: "Invalid user id" });
        return;
      }

      const isBanned = Boolean(req.body?.isBanned);
      await run("UPDATE users SET is_banned = ? WHERE id = ?", [isBanned ? 1 : 0, userId]);
      const updated = await get("SELECT id, email, is_banned FROM users WHERE id = ?", [userId]);
      res.json({ ok: true, user: updated });
    } catch (error) {
      console.error("Admin set user ban error:", error);
      res.status(500).json({ ok: false, message: "Unable to update user." });
    }
  }

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

  // === Manual Withdrawal Management ===

  async function listPendingWithdrawals(req, res) {
    try {
      const walletModel = require("../models/walletModel");
      const withdrawals = await walletModel.getPendingWithdrawals();
      res.json({ ok: true, withdrawals });
    } catch (error) {
      console.error("Admin list pending withdrawals error:", error);
      res.status(500).json({ ok: false, message: "Unable to load pending withdrawals." });
    }
  }

  async function approveWithdrawal(req, res) {
    try {
      const { withdrawalId } = req.params;
      
      if (!withdrawalId) {
        return res.status(400).json({ ok: false, message: "Missing withdrawal ID" });
      }

      // Get the withdrawal
      const withdrawal = await get(
        "SELECT id, user_id, amount, address, status FROM transactions WHERE id = ? AND type = 'withdrawal'",
        [withdrawalId]
      );

      if (!withdrawal) {
        return res.status(404).json({ ok: false, message: "Withdrawal not found" });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({ ok: false, message: `Withdrawal is already ${withdrawal.status}` });
      }

      // Just mark as approved - NO automatic blockchain processing
      // User will manually pay and confirm with completeWithdrawalManually()
      await run(
        "UPDATE transactions SET status = 'approved', updated_at = ? WHERE id = ?",
        [Date.now(), withdrawalId]
      );

      res.json({ 
        ok: true, 
        message: "Withdrawal approved. Ready to pay manually. Click '✓ Confirm Paid' after you send the funds.",
        withdrawal: {
          id: withdrawalId,
          status: "approved",
          amount: withdrawal.amount,
          address: withdrawal.address
        }
      });
    } catch (error) {
      console.error("Admin approve withdrawal error:", error);
      res.status(500).json({ ok: false, message: "Unable to approve withdrawal." });
    }
  }

  async function rejectWithdrawal(req, res) {
    try {
      const walletModel = require("../models/walletModel");
      const { withdrawalId } = req.params;
      
      if (!withdrawalId) {
        return res.status(400).json({ ok: false, message: "Missing withdrawal ID" });
      }

      // Get the withdrawal
      const withdrawal = await get(
        "SELECT id, user_id, amount, address, status FROM transactions WHERE id = ? AND type = 'withdrawal'",
        [withdrawalId]
      );

      if (!withdrawal) {
        return res.status(404).json({ ok: false, message: "Withdrawal not found" });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({ ok: false, message: `Withdrawal is already ${withdrawal.status}` });
      }

      // Mark as failed (this will refund the balance)
      await walletModel.updateTransactionStatus(withdrawalId, "failed");

      res.json({ 
        ok: true, 
        message: "Withdrawal rejected and balance refunded",
        withdrawal: {
          id: withdrawalId,
          status: "failed"
        }
      });
    } catch (error) {
      console.error("Admin reject withdrawal error:", error);
      res.status(500).json({ ok: false, message: "Unable to reject withdrawal." });
    }
  }

  async function completeWithdrawalManually(req, res) {
    try {
      const walletModel = require("../models/walletModel");
      const { withdrawalId } = req.params;
      const { txHash } = req.body || {};
      
      if (!withdrawalId) {
        return res.status(400).json({ ok: false, message: "Missing withdrawal ID" });
      }

      // Get the withdrawal
      const withdrawal = await get(
        "SELECT id, user_id, amount, address, status FROM transactions WHERE id = ? AND type = 'withdrawal'",
        [withdrawalId]
      );

      if (!withdrawal) {
        return res.status(404).json({ ok: false, message: "Withdrawal not found" });
      }

      if (withdrawal.status === "completed") {
        return res.status(400).json({ ok: false, message: "Withdrawal is already completed" });
      }

      if (withdrawal.status === "failed") {
        return res.status(400).json({ ok: false, message: "Withdrawal is already failed" });
      }

      // Mark as completed (with optional tx_hash)
      await walletModel.updateTransactionStatus(withdrawalId, "completed", txHash || null);

      res.json({ 
        ok: true, 
        message: "Withdrawal marked as completed",
        withdrawal: {
          id: withdrawalId,
          status: "completed",
          txHash: txHash || null
        }
      });
    } catch (error) {
      console.error("Admin complete withdrawal error:", error);
      res.status(500).json({ ok: false, message: "Unable to complete withdrawal." });
    }
  }

  return {
    getStats,
    listRecentUsers,
    listAuditLogs,
    setUserBan,
    listMiners,
    createMiner,
    updateMiner,
    listPendingWithdrawals,
    approveWithdrawal,
    rejectWithdrawal,
    completeWithdrawalManually
  };
}

module.exports = {
  createAdminController
};
