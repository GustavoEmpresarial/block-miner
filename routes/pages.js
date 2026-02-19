const path = require("path");
const express = require("express");
const { requirePageAuth } = require("../middleware/auth");

const router = express.Router();
const publicDir = path.join(__dirname, "..", "public");

const pageMap = {
  "/": "index.html",
  "/login": "login.html",
  "/register": "register.html",
  "/dashboard": "dashboard.html",
  "/games": "games.html",
  "/games/memory": "memory-game.html",
  "/games/memory/claim": "memory-claim.html",
  "/mining-stats": "mining-stats.html",
  "/shop": "shop.html",
  "/earnings/faucet": "earnings-faucet.html",
  "/earnings/ptc": "earnings-ptc.html",
  "/checkin": "checkin.html",
  "/wallet": "wallet.html",
  "/ptp": "ptp.html",
  "/swap": "swap.html",
  "/referral": "referral.html",
  "/settings": "settings.html",
  "/season-pass-coming-soon": "season-pass-coming-soon.html"
};

const protectedRoutes = new Set([
  "/dashboard",
  "/games",
  "/games/memory",
  "/games/memory/claim",
  "/mining-stats",
  "/shop",
  "/earnings/faucet",
  "/earnings/ptc",
  "/checkin",
  "/wallet",
  "/ptp",
  "/swap",
  "/referral",
  "/settings"
]);

for (const [routePath, fileName] of Object.entries(pageMap)) {
  const middlewares = protectedRoutes.has(routePath) ? [requirePageAuth] : [];
  router.get(routePath, ...middlewares, (_req, res) => {
    res.sendFile(path.join(publicDir, fileName));
  });
}

router.get(/^\/r-([A-Za-z0-9_-]+)$/, (req, res) => {
  const refCode = req.params?.[0];
  if (!refCode) {
    res.redirect(302, "/");
    return;
  }

  const maxAgeSeconds = 60 * 60 * 24 * 7;
  const cookieParts = [
    `bm_ref=${encodeURIComponent(refCode)}`,
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "SameSite=Lax"
  ];

  if (process.env.NODE_ENV === "production") {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
  res.redirect(302, "/");
});

router.get(/.*\.html$/, (req, res) => {
  const cleanPath = req.path.replace(/\.html$/, "");
  if (cleanPath === "/index") {
    res.redirect(301, "/");
    return;
  }

  if (Object.prototype.hasOwnProperty.call(pageMap, cleanPath)) {
    res.redirect(301, cleanPath);
    return;
  }

  res.status(404).send("Page not found");
});

module.exports = { pagesRouter: router };
