function registerSecurityStack({
  app,
  path,
  projectRoot,
  cors,
  helmet,
  corsPolicy,
  createCspMiddleware,
  createCsrfMiddleware,
  createRateLimiter,
  logger,
  adminPageAuth,
  pagesRouter,
  isDirectApiNavigationRequest,
  env
}) {
  const { createRequestGuard } = require("../../middleware/requestGuard");

  app.use(cors(corsPolicy.expressCorsOptions));

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
      originAgentCluster: false,
      xContentTypeOptions: true,
      referrerPolicy: { policy: "no-referrer" }
    })
  );

  if (env.IS_PROD) {
    app.use((req, res, next) => {
      const forwarded = req.get("x-forwarded-proto");
      if (forwarded && forwarded !== "https") {
        return res.redirect(301, `https://${req.get("host")}${req.url}`);
      }
      next();
    });
  }

  app.use((req, res, next) => {
    if (req.secure) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    const isYoutubeWatchPage = req.path === "/games/youtube" || req.path === "/youtube-watch.html";
    res.setHeader("Referrer-Policy", isYoutubeWatchPage ? "strict-origin-when-cross-origin" : "no-referrer");
    next();
  });

  app.use(
    express.json({
      limit: "200kb",
      verify: (req, _res, buf) => {
        req.rawBody = Buffer.from(buf).toString("utf8");
      }
    })
  );

  app.use(
    express.urlencoded({
      extended: false,
      limit: "100kb",
      parameterLimit: 30
    })
  );

  app.use(createRequestGuard());

  app.use(createCspMiddleware());
  app.use(createCsrfMiddleware());

  const globalLimiterStaticPrefixes = ["/assets", "/css", "/js", "/includes", "/public"];
  const globalLimiter = createRateLimiter({
    windowMs: env.HTTP_GLOBAL_RATE_WINDOW_MS,
    max: env.HTTP_GLOBAL_RATE_MAX,
    keyGenerator: (req) => `${req.ip}:global`,
    skip: (req) => {
      if (req.method === "OPTIONS") return true;

      const routePath = req.path || "/";
      if (routePath === "/api/health") return true;
      if (routePath.startsWith("/socket.io/")) return true;

      return globalLimiterStaticPrefixes.some((prefix) => routePath.startsWith(prefix));
    }
  });

  const apiLimiter = createRateLimiter({
    windowMs: env.HTTP_API_RATE_WINDOW_MS,
    max: env.HTTP_API_RATE_MAX,
    keyGenerator: (req) => `${req.ip}:api`,
    skip: (req) => req.method === "OPTIONS"
  });

  app.use(globalLimiter);
  app.use("/api", apiLimiter);

  app.use("/api", (req, res, next) => {
    if (!env.BLOCK_DIRECT_API_NAVIGATION || req.method === "OPTIONS") {
      next();
      return;
    }

    if (isDirectApiNavigationRequest(req)) {
      logger.warn("Blocked direct backend navigation", {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get("user-agent") || ""
      });
      res.status(404).send("Not found");
      return;
    }

    next();
  });

  const blockedPrefixes = ["/controllers", "/models", "/src", "/utils", "/data", "/cron", "/routes"];
  const blockedExtensions = new Set([".js", ".map", ".sql", ".sqlite", ".db", ".env", ".log"]);
  const allowedStaticPrefixes = ["/public", "/admin", "/js", "/css", "/assets", "/includes"];
  app.use((req, res, next) => {
    const rawPath = req.path || "/";
    let decodedPath = rawPath;

    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      res.status(400).send("Bad request");
      return;
    }

    const normalizedPath = decodedPath.replace(/\\/g, "/");

    if (normalizedPath.includes("..")) {
      logger.warn("Blocked path traversal attempt", { method: req.method, path: rawPath });
      res.status(400).send("Bad request");
      return;
    }

    if (blockedPrefixes.some((prefix) => normalizedPath.startsWith(prefix))) {
      logger.warn("Blocked internal resource access attempt", { method: req.method, path: rawPath });
      res.status(403).send("Forbidden");
      return;
    }

    const extension = path.extname(normalizedPath).toLowerCase();
    if (extension && blockedExtensions.has(extension)) {
      const isAllowedStatic = allowedStaticPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
      if (!isAllowedStatic) {
        logger.warn("Blocked file extension access", { method: req.method, path: rawPath, extension });
        res.status(403).send("Forbidden");
        return;
      }
    }

    next();
  });

  app.use((req, res, next) => {
    if (req.path.endsWith(".css") || req.path.endsWith(".js")) {
      res.on("finish", () => {
        logger.debug(`Asset served: ${req.method} ${req.path}`, { statusCode: res.statusCode });
      });
    }

    next();
  });

  app.use(
    express.static(path.join(projectRoot, "public"), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".css")) {
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Type", "text/css; charset=utf-8");
        }
      }
    })
  );

  app.use("/public", express.static(path.join(projectRoot, "public")));

  app.get("/admin/login.html", (req, res) => res.sendFile(path.join(projectRoot, "admin", "login.html")));
  app.get("/admin/login", (req, res) => res.sendFile(path.join(projectRoot, "admin", "login.html")));
  app.get("/admin/login-styles.css", (req, res) => res.sendFile(path.join(projectRoot, "admin", "login-styles.css")));
  app.get("/admin/login.js", (req, res) => res.sendFile(path.join(projectRoot, "admin", "login.js")));

  app.use("/admin", adminPageAuth, express.static(path.join(projectRoot, "admin")));
  app.use(pagesRouter);
}

const express = require("express");

module.exports = {
  registerSecurityStack
};
