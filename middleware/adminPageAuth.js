const { getAdminTokenFromRequest } = require("../utils/token");
const jwt = require("jsonwebtoken");
const logger = require("../utils/logger").child("AdminPageAuth");

function adminPageAuth(req, res, next) {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error("Admin page auth unavailable: JWT secret missing");
      res.redirect(302, "/admin/login");
      return;
    }

    const token = getAdminTokenFromRequest(req);

    if (!token) {
      // Sem token de admin, redireciona para login
      res.redirect(302, "/admin/login");
      return;
    }

    let payload = null;
    try {
      payload = jwt.verify(token, jwtSecret, {
        issuer: "blockminer-admin",
        algorithms: ["HS256"]
      });
    } catch (err) {
      // Token inválido, redireciona para login
      res.redirect(302, "/admin/login");
      return;
    }

    // Verificar se é um token de admin válido
    if (payload.role !== "admin" || payload.type !== "admin_session") {
      res.redirect(302, "/admin/login");
      return;
    }

    req.admin = { role: "admin" };
    next();
  } catch (error) {
    logger.error("Admin page auth error", { error: error.message });
    res.redirect(302, "/admin/login");
  }
}

module.exports = {
  adminPageAuth
};
