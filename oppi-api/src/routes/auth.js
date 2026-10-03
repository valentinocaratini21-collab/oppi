'use strict';

const express = require('express');
const { queryAll, queryOne, run, isUniqueViolation } = require('../db');
const { hashPassword, verifyPassword, generateReferralCode, signToken, requireAuth } = require('../lib/auth');
const { REFERRAL_BONUS_GS } = require('./referrals');
const { getComplianceStats, wildcardSummary, pointsBalance } = require('../lib/policy-store');
const { complianceScore, hasTrustedSeal } = require('../lib/cancellation');

const router = express.Router();
const VALID_ROLES = ['client', 'pro', 'handyman', 'business'];

function publicUser(row) {
  return {
    id: row.id, name: row.name, email: row.email, phone: row.phone,
    role: row.role, referral_code: row.referral_code, credit_gs: row.credit_gs,
    is_admin: Boolean(row.is_admin),
  };
}

/** 'AAAA-MM-DD HH:MM:SS' (mismo formato que datetime('now')). */
function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

router.post('/auth/register', async (req, res) => {
  const { name, email, phone, password, role, terms_accepted } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Completá nombre, email y contraseña para crear tu cuenta.' });
  }
  if (terms_accepted !== true) {
    return res.status(400).json({ error: 'Tenés que aceptar los términos y condiciones para crear tu cuenta.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Ese email no parece válido. Revisalo e intentá de nuevo.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'La contraseña tiene que tener al menos 6 caracteres.' });
  }
  const finalRole = role || 'client';
  if (!VALID_ROLES.includes(finalRole)) {
    return res.status(400).json({ error: 'El rol no es válido.' });
  }
  const db = req.db;
  try {
    const referralCode = generateReferralCode();
    const r = await run(db,
      `INSERT INTO users (name, email, phone, password_hash, role, referral_code, terms_accepted_at)
       VALUES (?,?,?,?,?,?,?)`,
      [name.trim(), email.trim().toLowerCase(), phone || null, hashPassword(password), finalRole, referralCode, nowStamp()]);
    await run(db, 'INSERT INTO referrals (code, owner_user_id, max_uses) VALUES (?,?,?)',
      [referralCode, r.id, 50]);
    // Seed de admin: si ADMIN_EMAIL coincide con este email, nace admin.
    // Nunca hay emails hardcodeados: sale 100% de la variable de entorno.
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (adminEmail && email.trim().toLowerCase() === adminEmail) {
      await run(db, 'UPDATE users SET is_admin = 1 WHERE id = ?', [r.id]);
    }
    const user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [r.id]);
    return res.status(201).json({ user: publicUser(user), token: signToken(user) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Ese email ya está registrado. ¿Querés iniciar sesión?' });
    }
    throw err;
  }
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Pasame tu email y contraseña.' });
  }
  const db = req.db;
  const user = await queryOne(db, 'SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (!user || user.deleted_at || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  }
  if (user.suspended) {
    return res.status(403).json({ error: 'Tu cuenta está suspendida. Escribinos por el chat de ayuda para regularizar tu situación y volver a usar Oppi.' });
  }
  return res.json({ user: publicUser(user), token: signToken(user) });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await queryOne(req.db, 'SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(401).json({ error: 'Tu sesión ya no es válida.' });
  return res.json({ user: publicUser(user) });
});

/** Estados de pago en español para el historial del cliente. */
const ESTADO_PAGO_ES = {
  pending: 'Pendiente', held: 'Retenido', captured: 'Cobrado',
  released: 'Liberado', refunded: 'Reembolsado', failed: 'Fallido',
};

// GET /api/me/payments — historial de pagos del cliente, fecha desc.
// Junta la tabla `payments` (cobros del total y reembolsos de mis reservas
// y trabajos) con los créditos por referido canjeados.
router.get('/me/payments', requireAuth, async (req, res) => {
  const db = req.db;
  const uid = req.user.id;
  const pays = await queryAll(db,
    `SELECT p.*, s.name AS service_name
     FROM payments p
     LEFT JOIN bookings b ON b.id = p.reference_id AND p.reference_type = 'booking'
     LEFT JOIN services s ON s.id = b.service_id
     LEFT JOIN jobs j ON j.id = p.reference_id AND p.reference_type = 'job'
     WHERE (p.reference_type = 'booking' AND b.client_id = ?)
        OR (p.reference_type = 'job' AND j.client_id = ?)
     ORDER BY p.created_at DESC`,
    [uid, uid]);
  const payments = pays.map((p) => {
    const concepto = p.reference_type === 'booking'
      ? `${p.kind === 'refund' ? 'Reembolso del cobro' : 'Cobro'} — ${p.service_name || `reserva #${p.reference_id}`}`
      : `Cobro — trabajo #${p.reference_id}`;
    const item = {
      id: p.id,
      fecha: p.created_at,
      concepto,
      monto_gs: p.amount_gs,
      estado: ESTADO_PAGO_ES[p.status] || p.status,
      tipo: 'pago',
    };
    if (p.reference_type === 'booking') item.booking_id = p.reference_id;
    return item;
  });

  // Créditos por referido: se sintetizan desde los canjes (la acreditación a
  // users.credit_gs vive en POST /api/referrals/redeem).
  const reds = await queryAll(db,
    'SELECT id, code, created_at FROM referral_redemptions WHERE user_id = ? ORDER BY created_at DESC',
    [uid]);
  const creditos = reds.map((r) => ({
    id: `ref-${r.id}`,
    fecha: r.created_at,
    concepto: `Crédito por referido (${r.code})`,
    monto_gs: REFERRAL_BONUS_GS,
    estado: 'Crédito',
    tipo: 'credito',
  }));

  const all = [...payments, ...creditos]
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  return res.json({ payments: all });
});

// GET /api/me/compliance — puntaje de cumplimiento de la nueva política.
// { score_pct, cumplidas, tardias_sin_comodin, no_shows, sello_confiable, estrellas_separadas }
router.get('/me/compliance', requireAuth, async (req, res) => {
  const stats = await getComplianceStats(req.db, req.user.id);
  const score = complianceScore(stats);
  return res.json({
    score_pct: score,
    cumplidas: stats.cumplidas,
    tardias_sin_comodin: stats.tardiasSinComodin,
    no_shows: stats.noShows,
    sello_confiable: hasTrustedSeal(score),
    estrellas_separadas: true,
  });
});

// GET /api/me/wildcards — mis comodines del trimestre.
// { balance, trimester, completed_since_last, proximo_en, reset_fecha }
router.get('/me/wildcards', requireAuth, async (req, res) => {
  const db = req.db;
  let ownerType = 'user';
  let ownerId = req.user.id;
  if (req.user.role === 'business') {
    const biz = await queryOne(db, 'SELECT id FROM businesses WHERE user_id = ?', [req.user.id]);
    if (biz) { ownerType = 'business'; ownerId = biz.id; }
  }
  return res.json(await wildcardSummary(db, ownerType, ownerId));
});

// GET /api/me/summary — resumen del cliente.
// { reservas_completadas, total_gastado_gs, oppi_points, cumplimiento_url }
//  - reservas_completadas: reservas en estado 'completed' como cliente.
//  - total_gastado_gs: suma de total_gs de esas reservas.
//  - oppi_points: saldo disponible (ganados menos usados).
//  - cumplimiento_url: el frontend linkea a '/mi-cumplimiento' (ver
//    GET /api/me/compliance para el puntaje).
router.get('/me/summary', requireAuth, async (req, res) => {
  const db = req.db;
  const uid = req.user.id;
  const row = await queryOne(db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_gs), 0) AS gastado
     FROM bookings WHERE client_id = ? AND status = 'completed'`,
    [uid]);
  return res.json({
    reservas_completadas: Number(row.n) || 0,
    total_gastado_gs: Number(row.gastado) || 0,
    oppi_points: await pointsBalance(db, uid),
    cumplimiento_url: '/mi-cumplimiento',
  });
});

// PATCH /api/me — editar el perfil propio (nombre, telefono, barrio, foto_url)
router.patch('/me', requireAuth, async (req, res) => {
  const db = req.db;
  const user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(401).json({ error: 'Tu sesión ya no es válida.' });

  const { nombre, telefono, barrio, foto_url } = req.body || {};
  const updates = {};

  // null o '' vacía el campo opcional; undefined lo deja como está.
  const optionalText = (value, max, fieldName, validate) => {
    if (value === undefined) return null; // no se toca
    if (value === null || String(value).trim() === '') return { clear: true };
    const v = String(value).trim();
    if (v.length > max) {
      return { error: `El ${fieldName} no puede tener más de ${max} caracteres.` };
    }
    if (validate) {
      const err = validate(v);
      if (err) return { error: err };
    }
    return { value: v };
  };

  if (nombre !== undefined) {
    const v = String(nombre).trim();
    if (v.length < 2 || v.length > 60) {
      return res.status(400).json({ error: 'El nombre tiene que tener entre 2 y 60 caracteres.' });
    }
    updates.name = v;
  }
  const tel = optionalText(telefono, 20, 'teléfono',
    (v) => /^[0-9+\-\s]{6,20}$/.test(v)
      ? null
      : 'El teléfono solo puede tener números, espacios, + y -, entre 6 y 20 caracteres.');
  if (tel) {
    if (tel.error) return res.status(400).json({ error: tel.error });
    updates.phone = tel.clear ? null : tel.value;
  }
  const bar = optionalText(barrio, 60, 'barrio');
  if (bar) {
    if (bar.error) return res.status(400).json({ error: bar.error });
    updates.barrio = bar.clear ? null : bar.value;
  }
  const foto = optionalText(foto_url, 500, 'la URL de la foto', (v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:')
        ? null
        : 'La URL de la foto no es válida (tiene que empezar con http:// o https://).';
    } catch {
      return 'La URL de la foto no es válida (tiene que empezar con http:// o https://).';
    }
  });
  if (foto) {
    if (foto.error) return res.status(400).json({ error: foto.error });
    updates.foto_url = foto.clear ? null : foto.value;
  }

  const keys = Object.keys(updates);
  if (keys.length > 0) {
    await run(db, `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((k) => updates[k]), user.id]);
  }
  const fresh = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [user.id]);
  return res.json({
    user: {
      id: fresh.id, nombre: fresh.name, email: fresh.email,
      telefono: fresh.phone || null, barrio: fresh.barrio || null,
      foto_url: fresh.foto_url || null, rol: fresh.role,
    },
  });
});

// DELETE /api/me — eliminar mi cuenta (pieza "lista para lanzar" 3).
// Pide la contraseña como confirmación. ANONIMIZA en lugar de borrar:
// nombre → "Usuario eliminado", email/teléfono → NULL, deleted_at marcado.
// Las reservas históricas se conservan (apuntan al usuario anonimizado).
// La sesión queda invalidada: requireAuth rechaza cuentas con deleted_at.
router.delete('/me', requireAuth, async (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'Pasame tu contraseña para confirmar que querés eliminar tu cuenta.' });
  }
  const db = req.db;
  const user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(401).json({ error: 'Tu sesión ya no es válida.' });
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'La contraseña no es correcta.' });
  }
  await run(db,
    `UPDATE users
     SET name = 'Usuario eliminado', email = NULL, phone = NULL,
         deleted_at = ?, suspended = 1
     WHERE id = ?`,
    [nowStamp(), user.id]);
  return res.json({ ok: true });
});

module.exports = router;
