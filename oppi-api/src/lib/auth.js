'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'oppi-dev-secret'; // ⚠️ en producción: variable de entorno
const JWT_EXPIRES_IN = '7d';

/** Hash de password con scrypt (built-in, sin bcrypt). Formato: salt:hash (hex). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

/** Código de referido único, ej. OPPI-7K2Q9A */
function generateReferralCode() {
  return 'OPPI-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/** Middleware: exige JWT válido en Authorization: Bearer <token>.
 * El rol se lee fresco de la DB (no del token): el rol puede cambiar sin
 * re-login (ej. te aceptan una oferta → pasás a ser handyman; das de alta tu
 * negocio → pasás a ser business). */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Necesitás iniciar sesión para hacer esto.' });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Tu sesión venció o no es válida. Iniciá sesión de nuevo.' });
  }
  try {
    // req.db lo setea app.js antes que los routers.
    const { queryOne } = require('../db');
    const row = req.db ? await queryOne(req.db, 'SELECT id, role, deleted_at FROM users WHERE id = ?', [payload.sub]) : null;
    if (!row) {
      return res.status(401).json({ error: 'Tu sesión ya no es válida. Iniciá sesión de nuevo.' });
    }
    if (row.deleted_at) {
      return res.status(401).json({ error: 'Esta cuenta fue eliminada.' });
    }
    req.user = { id: row.id, role: row.role || payload.role };
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Middleware: exige uno de los roles dados. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Tu cuenta no tiene permiso para hacer esto.' });
    }
    return next();
  };
}

/**
 * Middleware: exige ser administrador de la plataforma (users.is_admin = 1).
 * El flag se lee fresco de la DB en cada pedido.
 */
async function requireAdmin(req, res, next) {
  try {
    // req.db lo setea app.js antes que los routers.
    const { queryOne } = require('../db');
    const row = req.db ? await queryOne(req.db, 'SELECT is_admin FROM users WHERE id = ?', [req.user.id]) : null;
    if (!row || !row.is_admin) {
      return res.status(403).json({ error: 'Esta sección es solo para administradores de Oppi.' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Auth opcional: si hay JWT válido setea req.user; si no, sigue anónimo. */
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { queryOne } = require('../db');
    const row = req.db ? await queryOne(req.db, 'SELECT id, role, deleted_at FROM users WHERE id = ?', [payload.sub]) : null;
    if (row && !row.deleted_at) req.user = { id: row.id, role: row.role || payload.role };
  } catch { /* anónimo */ }
  return next();
}

module.exports = { hashPassword, verifyPassword, generateReferralCode, signToken, requireAuth, requireRole, requireAdmin, optionalAuth };
