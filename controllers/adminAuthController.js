const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const logger = require("../utils/logger").child("AdminAuthController");
const { ADMIN_SESSION_COOKIE } = require("../utils/token");

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function createAdminAuthController() {
  const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const ADMIN_SECURITY_CODE = String(process.env.ADMIN_SECURITY_CODE || "").trim();
  const JWT_SECRET = process.env.JWT_SECRET;
  const JWT_EXPIRES_IN = process.env.ADMIN_JWT_EXPIRES_IN || "24h";

  function buildAdminCookie(token) {
    const parts = [
      `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict"
    ];

    if (process.env.NODE_ENV === "production") {
      parts.push("Secure");
    }

    return parts.join("; ");
  }

  // Validar configuração
  if (!ADMIN_EMAIL || !ADMIN_SECURITY_CODE) {
    logger.warn("Admin authentication disabled: ADMIN_EMAIL or ADMIN_SECURITY_CODE not configured");
    logger.security("Admin authentication disabled", {
      reason: "Missing ADMIN_EMAIL or ADMIN_SECURITY_CODE environment variables"
    });
  }

  async function login(req, res) {
    try {
      // Validar configuração
      if (!ADMIN_EMAIL || !ADMIN_SECURITY_CODE) {
        logger.warn("Admin login attempt but credentials not configured");
        logger.security("Admin login blocked - not configured", {
          ip: req.ip,
          userAgent: req.get("user-agent")
        });
        return res.status(503).json({
          ok: false,
          message: "Admin authentication not configured"
        });
      }

      const { email, securityCode } = req.body;

      // Validar entrada
      if (typeof email !== "string" || typeof securityCode !== "string") {
        return res.status(400).json({
          ok: false,
          message: "Email e código de segurança são obrigatórios"
        });
      }

      const userEmail = String(email || "").trim().toLowerCase();
      const userCode = String(securityCode || "").trim();

      // Validar tamanho mínimo
      if (!userEmail || userEmail.length < 5) {
        logger.warn(`Admin login attempt with invalid email: ${userEmail}`);
        logger.security("Admin login failed - invalid email format", {
          email: userEmail,
          ip: req.ip,
          userAgent: req.get("user-agent")
        });
        return res.status(401).json({
          ok: false,
          message: "Credenciais inválidas"
        });
      }

      if (!userCode || userCode.length < 4) {
        logger.warn(`Admin login attempt with invalid code length`);
        logger.security("Admin login failed - invalid security code length", {
          email: userEmail,
          codeLength: userCode.length,
          ip: req.ip,
          userAgent: req.get("user-agent")
        });
        return res.status(401).json({
          ok: false,
          message: "Credenciais inválidas"
        });
      }

      // Validar credenciais (timing-safe comparison para evitar timing attacks)
      const emailMatch = timingSafeStringEqual(userEmail, ADMIN_EMAIL);
      const codeMatch = timingSafeStringEqual(userCode, ADMIN_SECURITY_CODE);

      if (!emailMatch || !codeMatch) {
        logger.warn(`Failed admin login attempt from email: ${userEmail}`);
        logger.security("Admin login failed - invalid credentials", {
          email: userEmail,
          emailMatch,
          codeMatch,
          ip: req.ip,
          userAgent: req.get("user-agent")
        });
        return res.status(401).json({
          ok: false,
          message: "Credenciais inválidas"
        });
      }

      // Gerar JWT token
      const token = jwt.sign(
        {
          role: "admin",
          type: "admin_session"
        },
        JWT_SECRET,
        {
          expiresIn: JWT_EXPIRES_IN,
          issuer: "blockminer-admin"
        }
      );

      logger.info("Admin successfully authenticated");
      logger.audit("admin_login_success", userEmail, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
        expiresIn: JWT_EXPIRES_IN
      });

      res.setHeader("Set-Cookie", buildAdminCookie(token));

      // Retornar token (pode ser salvo em localStorage ou cookie)
      return res.json({
        ok: true,
        message: "Autenticado com sucesso",
        token,
        expiresIn: JWT_EXPIRES_IN
      });
    } catch (error) {
      logger.error("Admin login error", { error: error.message });
      return res.status(500).json({
        ok: false,
        message: "Erro interno do servidor"
      });
    }
  }

  return {
    login
  };
}

module.exports = { createAdminAuthController };
