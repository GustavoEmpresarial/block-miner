const express = require("express");
const router = express.Router();
const ptpController = require("../controllers/ptpController");
const { requireAuth } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");
const { validateBody } = require("../middleware/validate");
const { z } = require("zod");

const ptpLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });
const ptpWriteLimiter = createRateLimiter({ windowMs: 60_000, max: 12 });

const createAdSchema = z
	.object({
		title: z.string().trim().min(2).max(80),
		url: z.string().trim().url().max(220),
		views: z.union([z.number(), z.string()]).optional()
	})
	.strict();

const trackViewSchema = z
	.object({
		adId: z.union([z.number(), z.string()]),
		viewerHash: z.string().trim().min(6).max(64),
		promoterId: z.union([z.number(), z.string()]).optional()
	})
	.strict();

// POST /api/ptp/create-ad - Criar anúncio (custa 0.10 USD)
router.post("/create-ad", requireAuth, ptpWriteLimiter, validateBody(createAdSchema), ptpController.createAd);

// GET /api/ptp/my-ads - Obter anúncios do usuário
router.get("/my-ads", requireAuth, ptpLimiter, ptpController.getMyAds);

// GET /api/ptp/promo-hash - Obter hash de promoção do usuário
router.get("/promo-hash", requireAuth, ptpLimiter, ptpController.getPromoHash);

// POST /api/ptp/track-view - Rastrear exibição de anúncio
router.post("/track-view", requireAuth, ptpWriteLimiter, validateBody(trackViewSchema), ptpController.trackView);

// GET /api/ptp/earnings - Obter ganhos do usuário
router.get("/earnings", requireAuth, ptpLimiter, ptpController.getEarnings);

module.exports = router;
