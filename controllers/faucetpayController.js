const axios = require("axios");
const FaucetPayModel = require("../models/faucetpayModel");
const logger = require("../utils/logger").getLogger("FaucetPayController");

const FAUCETPAY_API_URL = process.env.FAUCETPAY_API_URL || "https://faucetpay.io/api/v1";
const FAUCETPAY_MERCHANT_ID = process.env.FAUCETPAY_MERCHANT_ID;

// Initialize FaucetPay OAuth client
function getFaucetPayClient() {
  if (!FAUCETPAY_MERCHANT_ID || !process.env.FAUCETPAY_CLIENT_SECRET) {
    throw new Error("FaucetPay OAuth credentials not configured");
  }

  return axios.create({
    baseURL: FAUCETPAY_API_URL,
    headers: {
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
  try {
    const userId = req.user.id;
    const { faucetPayEmail } = req.body;
    
    logger.info("linkAccount called", { userId, faucetPayEmail });

    if (!faucetPayEmail) {
      logger.warn("Email missing in linkAccount", { userId });
      return res.status(400).json({
        ok: false,
        message: "FaucetPay email is required"
      });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(faucetPayEmail)) {
      logger.warn("Invalid email format", { userId, faucetPayEmail });
      return res.status(400).json({
        ok: false,
        message: "Invalid email format"
      });
    }

    // Use email as faucetPayUserId (FaucetPay accepts email as identifier)
    await FaucetPayModel.linkFaucetPayAccount(userId, faucetPayEmail, faucetPayEmail);

    logger.info("FaucetPay account linked successfully", { userId, faucetPayEmail });
    res.json({
      ok: true,
      message: "FaucetPay account linked successfully"
    });
  } catch (error) {
    logger.error("Error linking FaucetPay account", { userId: req.user?.id, error: error.message });
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
    logger.error("Error fetching FaucetPay account", { userId, error: error.message });
    res.status(500).json({
      ok: false,
      message: "Failed to fetch account"
    });
  }
}

module.exports = {
  linkAccount,
  unlinkAccount,
  getLinkedAccount
};
