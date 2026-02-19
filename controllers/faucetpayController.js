const axios = require("axios");
const FaucetPayModel = require("../models/faucetpayModel");
const walletModel = require("../models/walletModel");
const { createAuditLog } = require("../models/auditLogModel");

const FAUCETPAY_API_URL = process.env.FAUCETPAY_API_URL || "https://api.faucetpay.io";
const FAUCETPAY_API_KEY = process.env.FAUCETPAY_API_KEY;
const FAUCETPAY_MERCHANT_ID = process.env.FAUCETPAY_MERCHANT_ID;

// Initialize FaucetPay client
function getFaucetPayClient() {
  if (!FAUCETPAY_API_KEY || !FAUCETPAY_MERCHANT_ID) {
    throw new Error("FaucetPay API credentials not configured");
  }

  return axios.create({
    baseURL: FAUCETPAY_API_URL,
    headers: {
      Authorization: `Bearer ${FAUCETPAY_API_KEY}`,
      "Content-Type": "application/json"
    }
  });
}

// Get FaucetPay authorization URL
async function getAuthUrl(req, res) {
  try {
    const userId = req.user.id;
    
    // In production, generate a state token tied to userId for CSRF protection
    const state = Buffer.from(JSON.stringify({ userId, timestamp: Date.now() })).toString("base64");
    
    const authUrl = `https://faucetpay.io/oauth/authorize?client_id=${FAUCETPAY_MERCHANT_ID}&redirect_uri=${encodeURIComponent(
      `${process.env.APP_URL || "http://localhost:3000"}/api/faucetpay/callback`
    )}&response_type=code&state=${state}`;

    res.json({
      ok: true,
      authUrl
    });
  } catch (error) {
    console.error("Error generating FaucetPay auth URL:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to generate authorization URL"
    });
  }
}

// OAuth callback handler
async function handleCallback(req, res) {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).json({ ok: false, message: "Missing code or state" });
    }

    // Decode and verify state
    const stateData = JSON.parse(Buffer.from(state, "base64").toString());
    const userId = stateData.userId;

    if (!userId) {
      return res.status(400).json({ ok: false, message: "Invalid state" });
    }

    // Exchange code for access token
    const client = getFaucetPayClient();
    const tokenResponse = await client.post("/oauth/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: `${process.env.APP_URL || "http://localhost:3000"}/api/faucetpay/callback`,
      client_id: FAUCETPAY_MERCHANT_ID,
      client_secret: process.env.FAUCETPAY_CLIENT_SECRET
    });

    const accessToken = tokenResponse.data.access_token;

    // Get user info from FaucetPay
    const userResponse = await axios.get(`${FAUCETPAY_API_URL}/user/info`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { id: faucetPayUserId, email: faucetPayEmail } = userResponse.data;

    // Store FaucetPay account link
    await FaucetPayModel.linkFaucetPayAccount(userId, faucetPayUserId, faucetPayEmail);

    // Redirect back to wallet page with success
    res.redirect(`/wallet?faucetpay=connected`);
  } catch (error) {
    console.error("Error in FaucetPay callback:", error);
    res.redirect(`/wallet?faucetpay=error`);
  }
}

// Link FaucetPay account via email only
async function linkAccount(req, res) {
  console.log("[FaucetPay Backend] 🚀 linkAccount called");
  console.log("[FaucetPay Backend] req.user:", req.user);
  console.log("[FaucetPay Backend] req.body:", req.body);
  
  try {
    const userId = req.user.id;
    const { faucetPayEmail } = req.body;
    
    console.log("[FaucetPay Backend] userId:", userId);
    console.log("[FaucetPay Backend] faucetPayEmail:", faucetPayEmail);

    if (!faucetPayEmail) {
      console.log("[FaucetPay Backend] ❌ Email missing");
      return res.status(400).json({
        ok: false,
        message: "FaucetPay email is required"
      });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(faucetPayEmail)) {
      console.log("[FaucetPay Backend] ❌ Invalid email format");
      return res.status(400).json({
        ok: false,
        message: "Invalid email format"
      });
    }

    console.log("[FaucetPay Backend] ✅ Email valid, calling linkFaucetPayAccount...");
    // Use email as faucetPayUserId (FaucetPay accepts email as identifier)
    await FaucetPayModel.linkFaucetPayAccount(userId, faucetPayEmail, faucetPayEmail);

    console.log("[FaucetPay Backend] ✅ Account linked successfully!");
    res.json({
      ok: true,
      message: "FaucetPay account linked successfully"
    });
  } catch (error) {
    console.error("[FaucetPay Backend] ❌ Error linking FaucetPay account:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to link FaucetPay account"
    });
  }
}

// Unlink FaucetPay account
async function unlinkAccount(req, res) {
  try {
    const userId = req.user.id;
    
    // Delete the account link
    await FaucetPayModel.unlinkFaucetPayAccount(userId);

    res.json({
      ok: true,
      message: "FaucetPay account unlinked successfully"
    });
  } catch (error) {
    console.error("Error unlinking FaucetPay account:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to unlink FaucetPay account"
    });
  }
}

// Get linked FaucetPay account
async function getLinkedAccount(req, res) {
  try {
    const userId = req.user.id;
    const account = await FaucetPayModel.getFaucetPayAccount(userId);

    res.json({
      ok: true,
      account: account || null
    });
  } catch (error) {
    console.error("Error fetching FaucetPay account:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to fetch account"
    });
  }
}

// Process withdrawal via FaucetPay
async function withdrawViaFaucetPay(req, res) {
  try {
    const userId = req.user.id;
    const { amount } = req.body;

    // Validate amount
    if (!amount || amount < 0.1) {
      return res.status(400).json({
        ok: false,
        message: "Minimum withdrawal is 0.1"
      });
    }

    // Check if FaucetPay is linked
    const account = await FaucetPayModel.getFaucetPayAccount(userId);
    if (!account) {
      return res.status(400).json({
        ok: false,
        message: "FaucetPay account not linked"
      });
    }

    // Check user balance
    const userBalance = await walletModel.getUserBalance(userId);
    if (userBalance.balance < amount) {
      return res.status(400).json({
        ok: false,
        message: "Insufficient balance"
      });
    }

    // Create withdrawal record
    const withdrawal = await FaucetPayModel.createFaucetPayWithdrawal(
      userId,
      amount,
      account.faucetpay_user_id
    );

    // Call FaucetPay API to process withdrawal
    try {
      const client = getFaucetPayClient();
      const fpResponse = await client.post("/transfer/send", {
        recipient_email: account.faucetpay_email, // Use email instead of ID
        amount: Number(amount),
        currency: "POL",
        memo: `BlockMiner withdrawal #${withdrawal.id}`
      });

      // Update withdrawal status
      await FaucetPayModel.updateFaucetPayWithdrawalStatus(withdrawal.id, "completed", fpResponse.data);

      // Deduct from user balance
      await walletModel.deductBalance(userId, amount);

      // Audit log
      try {
        await createAuditLog({
          userId,
          action: "withdrawal_faucetpay",
          ip: req.ip,
          userAgent: req.get("user-agent"),
          details: { amount, faucetPayEmail: account.faucetpay_email }
        });
      } catch (logError) {
        console.error("Failed to write audit log:", logError);
      }

      res.json({
        ok: true,
        message: "Withdrawal processed successfully via FaucetPay",
        withdrawal: {
          id: withdrawal.id,
          amount,
          status: "completed",
          faucetpay_email: account.faucetpay_email
        }
      });
    } catch (fpError) {
      console.error("FaucetPay API error:", fpError.response?.data || fpError.message);

      // Update withdrawal status to failed
      await FaucetPayModel.updateFaucetPayWithdrawalStatus(
        withdrawal.id,
        "failed",
        fpError.response?.data
      );

      res.status(400).json({
        ok: false,
        message: fpError.response?.data?.message || "FaucetPay withdrawal failed"
      });
    }
  } catch (error) {
    console.error("Error processing FaucetPay withdrawal:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to process withdrawal"
    });
  }
}

// Get FaucetPay withdrawal history
async function getWithdrawalHistory(req, res) {
  try {
    const userId = req.user.id;
    const withdrawals = await FaucetPayModel.getFaucetPayWithdrawals(userId);

    res.json({
      ok: true,
      withdrawals
    });
  } catch (error) {
    console.error("Error fetching withdrawal history:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to fetch withdrawal history"
    });
  }
}

module.exports = {
  linkAccount,
  unlinkAccount,
  getLinkedAccount,
  withdrawViaFaucetPay,
  getWithdrawalHistory
};
