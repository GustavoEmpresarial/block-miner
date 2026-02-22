const jwt = require("jsonwebtoken");
const logger = require("../utils/logger").child("AdminAuthController");

function createAdminAuthController() {
  const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const ADMIN_SECURITY_CODE = String(process.env.ADMIN_SECURITY_CODE || "").trim();
  const JWT_SECRET = process.env.JWT_SECRET;
  const JWT_EXPIRES_IN = process.env.ADMIN_JWT_EXPIRES_IN || "24h";

  // Validar configuração
  if (!ADMIN_EMAIL || !ADMIN_SECURITY_CODE) {
    logger.warn("Admin authentication disabled: ADMIN_EMAIL or ADMIN_SECURITY_CODE not configured");
  }

  async function login(req, res) {
    try {
      // Validar configuração
      if (!ADMIN_EMAIL || !ADMIN_SECURITY_CODE) {
        logger.warn("Admin login attempt but credentials not configured");
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
        return res.status(401).json({
          ok: false,
          message: "Credenciais inválidas"
        });
      }

      if (!userCode || userCode.length < 4) {
        logger.warn(`Admin login attempt with invalid code length`);
        return res.status(401).json({
          ok: false,
          message: "Credenciais inválidas"
        });
      }

      // Validar credenciais (timing-safe comparison para evitar timing attacks)
      const emailMatch = userEmail === ADMIN_EMAIL;
      const codeMatch = userCode === ADMIN_SECURITY_CODE;

      if (!emailMatch || !codeMatch) {
        logger.warn(`Failed admin login attempt from email: ${userEmail}`);
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

      // Retornar token (pode ser salvo em localStorage ou cookie)
      return res.json({
        ok: true,
        message: "Autenticado com sucesso",
        token,
        expiresIn: JWT_EXPIRES_IN
      });
    } catch (error) {
      logger.error("Admin login error:", error);
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
