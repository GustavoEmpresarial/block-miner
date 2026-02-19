const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");
const { validateBody } = require("../middleware/validate");
const swapController = require("../controllers/swapController");
const { z } = require("zod");

const swapLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

const swapSchema = z
	.object({
		fromAsset: z.string().trim().min(2).max(8),
		toAsset: z.string().trim().min(2).max(8),
		amount: z.union([z.string().trim(), z.number()])
	})
	.strict();

router.get("/balances", requireAuth, swapLimiter, swapController.getBalances);
router.post("/quote", requireAuth, swapLimiter, validateBody(swapSchema), swapController.getQuote);
router.post("/execute", requireAuth, swapLimiter, validateBody(swapSchema), swapController.executeSwap);

module.exports = router;
