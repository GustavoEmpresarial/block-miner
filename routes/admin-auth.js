const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimit");

function createAdminAuthRouter(adminAuthController) {
  const router = express.Router();

  // Rate limiting para login (5 tentativas por 15 minutos)
  const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Muitas tentativas de login. Tente novamente em 15 minutos."
  });

  // POST /api/admin/login - Autenticar
  router.post("/login", loginLimiter, adminAuthController.login);

  return router;
}

module.exports = { createAdminAuthRouter };
