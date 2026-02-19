const express = require("express");
const router = express.Router();
const faucetpayController = require("../controllers/faucetpayController");
const { requireAuth } = require("../middleware/auth");

// Log all FaucetPay route requests
router.use((req, res, next) => {
  console.log("[FaucetPay Route] 📍 Request received:");
  console.log("  Method:", req.method);
  console.log("  Path:", req.path);
  console.log("  Full URL:", req.originalUrl);
  next();
});

// Link account with email
router.post("/link", requireAuth, faucetpayController.linkAccount);

// Unlink account
router.post("/unlink", requireAuth, faucetpayController.unlinkAccount);

// Get linked account
router.get("/account", requireAuth, faucetpayController.getLinkedAccount);

// Withdraw via FaucetPay
router.post("/withdraw", requireAuth, faucetpayController.withdrawViaFaucetPay);

// Get withdrawal history
router.get("/history", requireAuth, faucetpayController.getWithdrawalHistory);

module.exports = router;
