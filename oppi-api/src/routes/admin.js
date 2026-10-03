'use strict';

/**
 * Panel de administración de la plataforma (pieza "lista para lanzar" 1).
 *
 * Todo bajo requireAuth + requireAdmin (users.is_admin = 1).
 * Un usuario nace admin si su email coincide con ADMIN_EMAIL (ver
 * POST /api/auth/register); nunca hay emails hardcodeados.
 *
 * - GET  /api/admin/overview — métricas: usuarios, reservas de hoy/semana,
 *   ingresos brutos (Gs), no-shows, cuentas suspendidas.
 * - GET  /api/admin/verifications — negocios y profesionales pendientes de
 *   verificación, con sus documentos.
 * - POST /api/admin/verifications/:id {decision, reason?}
 *   — el :id es compuesto: "business:<id>" o "professional:<id>" (igual que
 *   el `id` que devuelve el GET). `decision` acepta 'approve'/'approved' y
 *   'reject'/'rejected' (la app móvil manda 'approved'/'rejected', la web
 *   'approve'/'reject'). Al aprobar se limpia el badge "En verificación"
 *   (businesses.verification_status='verified' /
 *   professionals.verified=1).
 * - GET  /api/admin/users?q= — búsqueda de usuarios (id, nombre, email,
 *   is_admin, suspended). Sin `q` devuelve los últimos 50.
 * - POST /api/admin/users/:id/suspend — suspende la cuenta (bloquea login y
 *   nuevas reservas; POST /api/bookings ya rechaza suspendidos).
 * - POST /api/admin/users/:id/unsuspend — levanta la suspensión.
 */
const express = require('express');
const { queryAll, queryOne, run } = require('../db');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { notify } = require('../lib/notifications');
const { precheckBusiness, precheckProfessional } = require('../lib/verifier');

const router = express.Router();
router.use(requireAuth, requireAdmin);

/** 'AAAA-MM-DD HH:MM:SS' (mismo formato que created_at en ambas DBs). */
function stamp(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function dayStart(d) {
  return `${d.toISOString().slice(0, 10)} 00:00:00`;
}

// Etiquetas legibles para los tipos de documento del checklist de negocios.
const DOC_LABELS = {
  ruc: 'RUC',
  habilitacion: 'Habilitación municipal',
  identidad: 'Cédula de identidad',
};
function docLabel(type) {
  if (DOC_LABELS[type]) return DOC_LABELS[type];
  const s = String(type || 'documento');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// GET /api/admin/overview
router.get('/admin/overview', async (req, res) => {
  const db = req.db;
  const today = dayStart(new Date());
  const weekAgo = dayStart(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const users = await queryOne(db, 'SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL');
  const bookingsToday = await queryOne(db, 'SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?', [today]);
  const bookingsWeek = await queryOne(db, 'SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?', [weekAgo]);
  const gross = await queryOne(db,
    "SELECT COALESCE(SUM(total_gs), 0) AS n FROM bookings WHERE status = 'completed'");
  const noShows = await queryOne(db,
    "SELECT COUNT(*) AS n FROM bookings WHERE status IN ('no_show_client', 'no_show_pro')");
  const suspended = await queryOne(db,
    'SELECT COUNT(*) AS n FROM users WHERE suspended = 1 AND deleted_at IS NULL');
  return res.json({
    users: Number(users.n),
    bookings_today: Number(bookingsToday.n),
    bookings_week: Number(bookingsWeek.n),
    gross_income_gs: Number(gross.n),
    no_shows: Number(noShows.n),
    suspended: Number(suspended.n),
  });
});

// GET /api/admin/verifications
router.get('/admin/verifications', async (req, res) => {
  const db = req.db;
  const items = [];
  const businesses = await queryAll(db,
    `SELECT b.*, u.name AS owner_name, u.email AS owner_email, u.created_at AS submitted_at
     FROM businesses b JOIN users u ON u.id = b.user_id
     WHERE b.verification_status = 'pending'
     ORDER BY b.id ASC`);
  for (const b of businesses) {
    const docs = await queryAll(db,
      "SELECT * FROM business_documents WHERE business_id = ? AND status = 'pending' ORDER BY id ASC",
      [b.id]);
    items.push({
      id: `business:${b.id}`,
      type: 'business',
      name: b.name,
      owner: { name: b.owner_name, email: b.owner_email },
      documents: docs.map((d) => ({ label: docLabel(d.type), url: null })),
      precheck: precheckBusiness(b, docs),
      submitted_at: b.submitted_at,
    });
  }
  const pros = await queryAll(db,
    `SELECT p.*, u.name AS user_name, u.email AS user_email, u.created_at AS user_created_at,
            u.foto_url AS user_foto_url
     FROM professionals p JOIN users u ON u.id = p.user_id
     WHERE p.verified = 0
     ORDER BY u.created_at ASC`);
  for (const p of pros) {
    const services = await queryAll(db,
      'SELECT * FROM services WHERE professional_id = ? ORDER BY id ASC', [p.id]);
    items.push({
      id: `professional:${p.id}`,
      type: 'professional',
      name: p.user_name,
      owner: { name: p.user_name, email: p.user_email },
      documents: [],
      precheck: precheckProfessional({ name: p.user_name, foto_url: p.user_foto_url }, p, services),
      submitted_at: p.user_created_at,
    });
  }
  return res.json({ verifications: items });
});

// POST /api/admin/verifications/:id
// `decision` acepta 'approve'/'approved' y 'reject'/'rejected'.
const DECISION_ALIASES = { approve: 'approve', approved: 'approve', reject: 'reject', rejected: 'reject' };
router.post('/admin/verifications/:id', async (req, res) => {
  const m = /^(business|professional):(\d+)$/.exec(String(req.params.id || ''));
  if (!m) {
    return res.status(400).json({ error: 'Identificador no válido (formato "business:<id>" o "professional:<id>").' });
  }
  const [, kind, num] = m;
  const id = Number(num);
  const { reason } = req.body || {};
  const decision = DECISION_ALIASES[String(req.body?.decision || '').toLowerCase()];
  if (!decision) {
    return res.status(400).json({ error: 'La decisión tiene que ser "approve"/"approved" o "reject"/"rejected".' });
  }
  const note = reason !== undefined && reason !== null ? String(reason).slice(0, 500) : null;
  const db = req.db;

  if (kind === 'business') {
    const b = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [id]);
    if (!b) return res.status(404).json({ error: 'No encontramos ese negocio.' });
    if (decision === 'approve') {
      // Limpia el badge "En verificación" que muestra la app
      // (verification_status === 'verified').
      await run(db, "UPDATE businesses SET verification_status = 'verified', verification_note = NULL WHERE id = ?", [id]);
      await run(db, "UPDATE business_documents SET status = 'approved' WHERE business_id = ? AND status = 'pending'", [id]);
    } else {
      await run(db, 'UPDATE businesses SET verification_note = ? WHERE id = ?', [note, id]);
      await run(db, "UPDATE business_documents SET status = 'rejected' WHERE business_id = ? AND status = 'pending'", [id]);
    }
    const fresh = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [id]);
    return res.json({ ok: true, verification_status: fresh.verification_status });
  }

  const p = await queryOne(db, 'SELECT * FROM professionals WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'No encontramos ese profesional.' });
  if (decision === 'approve') {
    await run(db, 'UPDATE professionals SET verified = 1, verification_note = NULL WHERE id = ?', [id]);
  } else {
    await run(db, 'UPDATE professionals SET verification_note = ? WHERE id = ?', [note, id]);
  }
  const fresh = await queryOne(db, 'SELECT * FROM professionals WHERE id = ?', [id]);
  return res.json({ ok: true, verified: Boolean(fresh.verified) });
});

function publicUserAdmin(row) {
  return {
    id: row.id, name: row.name, email: row.email, phone: row.phone,
    role: row.role, is_admin: Boolean(row.is_admin), suspended: Boolean(row.suspended),
  };
}

// GET /api/admin/users?q= — búsqueda de usuarios para el panel admin.
// Devuelve { users: [{ id, name, email, is_admin, suspended }] }.
// Con `q` filtra por nombre, email o id exacto (case-insensitive); sin `q`,
// los últimos 50. Las cuentas eliminadas no aparecen.
router.get('/admin/users', async (req, res) => {
  const db = req.db;
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    rows = await queryAll(db,
      `SELECT id, name, email, is_admin, suspended FROM users
       WHERE deleted_at IS NULL
         AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR CAST(id AS TEXT) = ?)
       ORDER BY id DESC LIMIT 50`,
      [like, like, q]);
  } else {
    rows = await queryAll(db,
      `SELECT id, name, email, is_admin, suspended FROM users
       WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 50`);
  }
  return res.json({
    users: rows.map((u) => ({
      id: u.id, name: u.name, email: u.email,
      is_admin: Boolean(u.is_admin), suspended: Boolean(u.suspended),
    })),
  });
});

// POST /api/admin/users/:id/suspend
router.post('/admin/users/:id/suspend', async (req, res) => {
  const db = req.db;
  const u = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!u || u.deleted_at) return res.status(404).json({ error: 'No encontramos ese usuario.' });
  if (u.id === req.user.id) {
    return res.status(400).json({ error: 'No podés suspender tu propia cuenta de administrador.' });
  }
  await run(db, 'UPDATE users SET suspended = 1 WHERE id = ?', [u.id]);
  return res.json({ ok: true, user: publicUserAdmin({ ...u, suspended: 1 }) });
});

// POST /api/admin/users/:id/unsuspend
router.post('/admin/users/:id/unsuspend', async (req, res) => {
  const db = req.db;
  const u = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!u || u.deleted_at) return res.status(404).json({ error: 'No encontramos ese usuario.' });
  await run(db, 'UPDATE users SET suspended = 0 WHERE id = ?', [u.id]);
  return res.json({ ok: true, user: publicUserAdmin({ ...u, suspended: 0 }) });
});

// GET /api/admin/moderation — cola de reseñas retenidas por el moderador IA.
// Incluye datos de la reseña, el autor y el profesional/negocio reseñado.
router.get('/admin/moderation', async (req, res) => {
  const db = req.db;
  const queue = await queryAll(db,
    `SELECT r.id, r.rating, r.text, r.photos, r.moderation_status, r.moderation_reason,
            r.created_at, r.from_user, r.to_user,
            uf.name AS from_name, uf.email AS from_email,
            ut.name AS to_name, ut.email AS to_email
     FROM reviews r
     JOIN users uf ON uf.id = r.from_user
     JOIN users ut ON ut.id = r.to_user
     WHERE r.moderation_status = 'held'
     ORDER BY r.created_at DESC`);
  return res.json({ queue });
});

// POST /api/admin/moderation/:id {decision: 'approve'|'reject'}
// approve → se publica y se notifica al profesional (mismo texto que POST /api/reviews).
// reject → queda marcada como rechazada, no se publica.
router.post('/admin/moderation/:id', async (req, res) => {
  const { decision } = req.body || {};
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'La decisión tiene que ser "approve" o "reject".' });
  }
  const db = req.db;
  const review = await queryOne(db, 'SELECT * FROM reviews WHERE id = ?', [req.params.id]);
  if (!review) return res.status(404).json({ error: 'No encontramos esa reseña.' });
  if (review.moderation_status !== 'held') {
    return res.status(400).json({ error: 'Esa reseña no está retenida en revisión.' });
  }
  if (decision === 'approve') {
    await run(db, "UPDATE reviews SET moderation_status = 'approved', moderation_reason = NULL WHERE id = ?",
      [review.id]);
    const fromName = (await queryOne(db, 'SELECT name FROM users WHERE id = ?', [review.from_user])).name;
    await notify(db, {
      userId: review.to_user, type: 'review',
      title: `⭐ Nueva reseña de ${fromName}`,
      body: `Te dejó ${review.rating} de 5 estrellas${review.text ? `: "${review.text.slice(0, 120)}"` : '.'} ¡Respondela para agradecer!`,
    });
  } else {
    await run(db, "UPDATE reviews SET moderation_status = 'rejected' WHERE id = ?", [review.id]);
  }
  return res.json({ ok: true, review: await queryOne(db, 'SELECT * FROM reviews WHERE id = ?', [review.id]) });
});

module.exports = router;
