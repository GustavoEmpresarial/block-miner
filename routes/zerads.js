const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");
const zeradsController = require("../controllers/zeradsController");

const router = express.Router();

const linkLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });
const callbackLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

router.get("/ptc-link", requireAuth, linkLimiter, zeradsController.getPtcLink);
router.get("/offerwall-link", requireAuth, linkLimiter, zeradsController.getOfferwallLink);
router.get("/stats", requireAuth, linkLimiter, zeradsController.getStats);
router.get("/callback", callbackLimiter, zeradsController.handlePtcCallback);
router.post("/callback", callbackLimiter, zeradsController.handlePtcCallback);

module.exports = router;
