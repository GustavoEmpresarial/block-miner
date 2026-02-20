const express = require("express");
const router = express.Router();
const faucetpayController = require("../controllers/faucetpayController");
const { requireAuth } = require("../middleware/auth");

// Link account with email
router.post("/link", requireAuth, faucetpayController.linkAccount);

// Unlink account
router.post("/unlink", requireAuth, faucetpayController.unlinkAccount);

// Get linked account
router.get("/account", requireAuth, faucetpayController.getLinkedAccount);

module.exports = router;
