const express = require("express");
const faucetController = require("../controllers/faucetController");
const { requireAuth } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const faucetLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
const faucetClaimLimiter = createRateLimiter({ windowMs: 60_000, max: 6 });

router.get("/status", requireAuth, faucetLimiter, faucetController.getStatus);
router.post("/claim", requireAuth, faucetClaimLimiter, faucetController.claim);

module.exports = router;
