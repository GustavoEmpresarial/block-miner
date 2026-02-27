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
  "/games/youtube": "youtube-watch.html",
  "/ranking": "ranking.html",
  "/mining-stats": "mining-stats.html",
  "/events": "events.html",
  "/marketplace": "marketplace.html",
  "/staking": "staking.html",
  "/chat": "chat.html",
  "/shop": "shop.html",
  "/earnings/faucet": "earnings-faucet.html",
  "/earnings/ptc": "earnings-ptc.html",
  "/ganhos/ptc": "ganhos-ptc.html",
  "/auto-mining-gpu": "auto-mining-gpu.html",
  "/checkin": "checkin.html",
  "/wallet": "wallet.html",
  "/ptp": "ptp.html",
  "/shortlink": "shortlink.html",
  "/shortlink/internal-shortlink/step1": "shortlink-step1.html",
  "/shortlink/internal-shortlink/step2": "shortlink-step2.html",
  "/shortlink/internal-shortlink/step3": "shortlink-step3.html",
  "/swap": "swap.html",
  "/referral": "referral.html",
  "/blog": "blog.html",
  "/roadmap": "roadmap.html",
  "/tutorial": "tutorial.html",
  "/settings": "settings.html",
  "/season-pass-coming-soon": "season-pass-coming-soon.html"
};

const protectedRoutes = new Set([
  "/dashboard",
  "/games",
  "/games/memory",
  "/games/memory/claim",
  "/games/youtube",
  "/ranking",
  "/mining-stats",
  "/events",
  "/marketplace",
  "/staking",
  "/chat",
  "/shop",
  "/earnings/faucet",
  "/earnings/ptc",
  "/ganhos/ptc",
  "/auto-mining-gpu",
  "/checkin",
  "/wallet",
  "/ptp",
  "/shortlink",
  "/shortlink/internal-shortlink/step1",
  "/shortlink/internal-shortlink/step2",
  "/shortlink/internal-shortlink/step3",
  "/swap",
  "/referral",
  "/blog",
  "/roadmap",
  "/tutorial",
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
