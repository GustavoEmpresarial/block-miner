const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");

const { requireAuth } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");
const { validateBody } = require("../middleware/validate");
const { get, run } = require("../src/db/sqlite");
const walletModel = require("../models/walletModel");
const FaucetPayService = require("../services/faucetpayService");
const { createAuditLog } = require("../models/auditLogModel");
const { getAnonymizedRequestIp } = require("../utils/clientIp");

const router = express.Router();

const faucetpayLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyGenerator: (req) => `${req.ip}:faucetpay` });
const faucetpayWithdrawLimiter = createRateLimiter({ windowMs: 300_000, max: 5, keyGenerator: (req) => `${req.ip}:faucetpay-withdraw` });

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function emailToUserId(email) {
  return crypto.createHash("sha256").update(email).digest("hex");
}

const linkSchema = z
  .object({
    faucetPayEmail: z.string().trim().email()
  })
  .strict();

const withdrawSchema = z
  .object({
    amount: z.union([z.string().trim(), z.number()])
  })
  .strict();

router.get("/account", requireAuth, faucetpayLimiter, async (req, res) => {
  try {
    const account = await get(
      "SELECT faucetpay_user_id, faucetpay_email, linked_at FROM faucetpay_accounts WHERE user_id = ?",
      [req.user.id]
    );

    res.json({ ok: true, account: account || null });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to load FaucetPay account." });
  }
});

router.post("/link", requireAuth, faucetpayLimiter, validateBody(linkSchema), async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.faucetPayEmail);
    const faucetpayUserId = emailToUserId(email);

    const existingByHash = await get(
      "SELECT user_id FROM faucetpay_accounts WHERE faucetpay_user_id = ?",
      [faucetpayUserId]
    );
    if (existingByHash && Number(existingByHash.user_id) !== Number(req.user.id)) {
      res.status(409).json({ ok: false, message: "This FaucetPay email is already linked to another account." });
      return;
    }

    const nowIso = new Date().toISOString();
    await run(
      `
        INSERT INTO faucetpay_accounts (user_id, faucetpay_user_id, faucetpay_email, linked_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          faucetpay_user_id = excluded.faucetpay_user_id,
          faucetpay_email = excluded.faucetpay_email,
          linked_at = excluded.linked_at
      `,
      [req.user.id, faucetpayUserId, email, nowIso]
    );

    await createAuditLog({
      userId: req.user.id,
      action: "faucetpay_link",
      ip: getAnonymizedRequestIp(req),
      userAgent: req.get("user-agent"),
      details: { email }
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Failed to link account." });
  }
});

router.post("/unlink", requireAuth, faucetpayLimiter, async (req, res) => {
  try {
    await run("DELETE FROM faucetpay_accounts WHERE user_id = ?", [req.user.id]);

    await createAuditLog({
      userId: req.user.id,
      action: "faucetpay_unlink",
      ip: getAnonymizedRequestIp(req),
      userAgent: req.get("user-agent"),
      details: {}
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Failed to unlink account." });
  }
});

router.post("/withdraw", requireAuth, faucetpayWithdrawLimiter, validateBody(withdrawSchema), async (req, res) => {
  try {
    const account = await get(
      "SELECT faucetpay_user_id, faucetpay_email FROM faucetpay_accounts WHERE user_id = ?",
      [req.user.id]
    );
    if (!account?.faucetpay_email) {
      res.status(400).json({ ok: false, message: "FaucetPay account not linked." });
      return;
    }

    const amountRaw = req.body?.amount;
    const amount = Number(String(amountRaw).trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ ok: false, message: "Invalid amount." });
      return;
    }

    const wallet = await walletModel.getUserBalance(req.user.id);
    if (!wallet || Number(wallet.balance || 0) < amount) {
      res.status(400).json({ ok: false, message: "Insufficient balance" });
      return;
    }

    // Attempt payout via FaucetPay (best-effort). If API key is missing, fail fast.
    const payoutResponse = await FaucetPayService.send(amount, account.faucetpay_email, "POL", req.ip);

    const nowIso = new Date().toISOString();
    await run(
      `
        INSERT INTO faucetpay_withdrawals (user_id, amount, faucetpay_user_id, status, api_response, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.user.id,
        amount,
        account.faucetpay_user_id,
        "completed",
        JSON.stringify(payoutResponse || null),
        nowIso,
        nowIso
      ]
    );

    await walletModel.deductBalance(req.user.id, amount);

    await createAuditLog({
      userId: req.user.id,
      action: "faucetpay_withdraw",
      ip: getAnonymizedRequestIp(req),
      userAgent: req.get("user-agent"),
      details: { amount, to: account.faucetpay_email, payoutId: payoutResponse?.payout_id || null }
    });

    res.json({ ok: true, message: "Withdrawal successful" });
  } catch (error) {
    res.status(503).json({ ok: false, message: "Payment service temporarily unavailable" });
  }
});

module.exports = router;
