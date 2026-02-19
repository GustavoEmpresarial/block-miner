const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const { requireAuth } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");
const { validateBody } = require("../middleware/validate");
const { z } = require("zod");

// Rate limiters for wallet routes
const walletGetLimiter = createRateLimiter({ windowMs: 60_000, max: 30 }); // 30 requests per minute
const walletPostLimiter = createRateLimiter({ windowMs: 60_000, max: 10 }); // 10 requests per minute
const withdrawalLimiter = createRateLimiter({ windowMs: 300_000, max: 5 }); // 5 withdrawals per 5 minutes

const walletAddressSchema = z
	.object({
		walletAddress: z.string().trim().max(120).nullable().optional()
	})
	.strict();

const withdrawalSchema = z
	.object({
		amount: z.union([z.string().trim(), z.number()]),
		address: z.string().trim().min(10).max(120)
	})
	.strict();

const depositSchema = z
	.object({
		txHash: z.string().trim().min(20).max(120),
		amount: z.union([z.string().trim(), z.number()]),
		fromAddress: z.string().trim().min(10).max(120)
	})
	.strict();

// Get balance and wallet info
router.get("/balance", requireAuth, walletGetLimiter, walletController.getBalance);

// Update wallet address
router.post("/address", requireAuth, walletPostLimiter, validateBody(walletAddressSchema), walletController.updateWalletAddress);

// Process withdrawal
router.post("/withdraw", requireAuth, withdrawalLimiter, validateBody(withdrawalSchema), walletController.withdraw);

// Get transaction history
router.get("/transactions", requireAuth, walletGetLimiter, walletController.getTransactions);

// Get deposit address
router.get("/deposit-address", requireAuth, walletGetLimiter, walletController.getDepositAddress);

// Record deposit transaction
router.post("/deposit", requireAuth, walletPostLimiter, validateBody(depositSchema), walletController.recordDeposit);

module.exports = router;
