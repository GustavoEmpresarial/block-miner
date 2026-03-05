const helmet = require("helmet");

function isAssetPath(pathname) {
  return Boolean(pathname && /\.(css|js|map|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf)$/i.test(pathname));
}

function getRouteGroup(pathname) {
  const path = String(pathname || "/");

  if (path.startsWith("/api/")) return "api";
  if (path.startsWith("/admin")) return "app";
  if (path.startsWith("/includes")) return "app";
  if (isAssetPath(path)) return "asset";

  // Public pages
  if (path === "/" || path === "/login" || path === "/register") return "public";
  if (path.startsWith("/r-")) return "public";

  // App pages (authenticated)
  return "app";
}

function baseDirectives({ allowWebSockets }) {
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"],
    frameSrc: [
      "'self'",
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
      "https://ad.a-ads.com",
      "https://neon.today",
      "https://*.neon.today",
      "https://webtrafic.ru",
      "https://*.webtrafic.ru"
    ],
    objectSrc: ["'none'"],
    imgSrc: ["'self'", "data:", "https:"],
    fontSrc: ["'self'", "https://cdn.jsdelivr.net", "data:"],

    // Keep compatibility with current HTML (inline styles) and CDN scripts.
    scriptSrc: [
      "'self'",
      "'unsafe-inline'",
      "https://cdn.jsdelivr.net",
      "https://webtrafic.ru",
      "https://*.webtrafic.ru",
      "https://www.googletagmanager.com",
      "https://static.surfe.pro"
    ],
    styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],

    connectSrc: allowWebSockets
      ? ["'self'", "https:", "ws:", "wss:", "https://static.surfe.pro"]
      : ["'self'", "https:", "https://static.surfe.pro"],
    upgradeInsecureRequests: []
  };
}

function createCspMiddleware() {
  const publicCsp = helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: baseDirectives({ allowWebSockets: false })
  });

  const appCsp = helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: baseDirectives({ allowWebSockets: true })
  });

  // API responses generally don't need CSP; leave it off to reduce noise.
  return (req, res, next) => {
    const group = getRouteGroup(req.path);
    if (group === "asset" || group === "api") {
      next();
      return;
    }

    const middleware = group === "public" ? publicCsp : appCsp;
    middleware(req, res, next);
  };
}

module.exports = {
  createCspMiddleware
};
