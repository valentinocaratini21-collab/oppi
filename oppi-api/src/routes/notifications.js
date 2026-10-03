'use strict';

/**
 * Notificaciones.
 *
 * - GET /api/notifications — centro de notificaciones (polling).
 * - PATCH /api/notifications/:id — marcar leída/no leída.
 * - POST /api/notifications/generate-reminders — genera recordatorios para
 *   reservas confirmadas próximas (lo corre un cron/worker en producción).
 * - POST /api/notifications/send-due — envía por push las vencidas
 *   (PUSH_DRIVER; default mock = no hace nada afuera).
 * - POST /api/push-tokens — registrar el token del dispositivo.
 * - DELETE /api/push-tokens — dar de baja un token.
 *
 * Las rutas de negocio (reservas, ofertas, chat, etc.) encolan con
 * `notify(db, {...})` de src/lib/notifications.js: eso guarda en la DB y
 * queda visible acá. El push real sale por send-due.
 */
const express = require('express');
const { queryAll, queryOne, run, isUniqueViolation } = require('../db');
const { requireAuth } = require('../lib/auth');
const { NotificationService, NOTIF_PREF_KEYS, getNotificationPrefs } = require('../lib/notifications');

const router = express.Router();

function notifDto(n) {
  return {
    id: n.id, user_id: n.user_id, type: n.type, title: n.title, body: n.body,
    read: Boolean(n.read), scheduled_for: n.scheduled_for, created_at: n.created_at,
  };
}

/** 'AAAA-MM-DD HH:MM:SS' en hora local del servidor (igual formato que created_at). */
function stamp(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Auth para los endpoints de worker/cron: si CRON_SECRET está seteado, un
 * header `x-cron-secret` válido alcanza (para el scheduler externo); si no,
 * se exige el JWT de usuario como siempre.
 */
function cronOrAuth(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get('x-cron-secret') === secret) return next();
  return requireAuth(req, res, next);
}

// GET /api/notifications — mis notificaciones (?unread=1)
router.get('/notifications', requireAuth, async (req, res) => {
  const { unread } = req.query;
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [req.user.id];
  if (unread === '1' || unread === 'true') sql += ' AND read = 0';
  sql += ' ORDER BY created_at DESC LIMIT 100';
  return res.json({ notifications: (await queryAll(req.db, sql, params)).map(notifDto) });
});

// PATCH /api/notifications/:id {read: true|false}
router.patch('/notifications/:id', requireAuth, async (req, res) => {
  const db = req.db;
  const n = await queryOne(db, 'SELECT * FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!n) return res.status(404).json({ error: 'No encontramos esa notificación.' });
  await run(db, 'UPDATE notifications SET read = ? WHERE id = ?', [req.body?.read ? 1 : 0, n.id]);
  return res.json({ notification: notifDto(await queryOne(db, 'SELECT * FROM notifications WHERE id = ?', [n.id])) });
});

// POST /api/notifications/generate-reminders
// Crea recordatorios para reservas confirmadas con turno en las próximas 48h
// que todavía no tengan recordatorio. En producción lo corre un cron/worker.
router.post('/notifications/generate-reminders', cronOrAuth, async (req, res) => {
  const db = req.db;
  const service = new NotificationService(db);
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 3600 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
  // Comparación portable (sqlite y postgres): 'AAAA-MM-DD HH:MM' como string.
  const upcoming = await queryAll(db,
    `SELECT b.*, s.date AS slot_date, s.time AS slot_time, sv.name AS service_name
     FROM bookings b
     JOIN slots s ON s.id = b.slot_id
     JOIN services sv ON sv.id = b.service_id
     WHERE b.status = 'confirmed' AND b.slot_id IS NOT NULL
       AND (s.date || ' ' || s.time) >= ? AND (s.date || ' ' || s.time) <= ?`,
    [stamp(now).slice(0, 16), stamp(in48h).slice(0, 16)]);
  let created = 0;
  for (const b of upcoming) {
    const exists = await queryOne(db,
      `SELECT id FROM notifications WHERE user_id = ? AND type = 'reminder'
       AND body LIKE ? AND created_at > ?`,
      [b.client_id, `%reserva #${b.id}%`, stamp(twoDaysAgo)]);
    if (exists) continue;
    await service.enqueue({
      userId: b.client_id, type: 'reminder',
      title: `⏰ Tu turno es pronto: ${b.service_name}`,
      body: `Tu reserva #${b.id} es el ${b.slot_date} a las ${b.slot_time}. ¡Te esperamos!`,
      scheduledFor: `${b.slot_date}T${b.slot_time}:00`,
    });
    created += 1;
  }
  return res.json({ ok: true, created, message: created ? `Se generaron ${created} recordatorios.` : 'No hay reservas próximas sin recordatorio.' });
});

// POST /api/notifications/send-due — despacha por push las vencidas (worker/cron)
router.post('/notifications/send-due', cronOrAuth, async (req, res) => {
  const { sent, failed } = await new NotificationService(req.db).sendDue();
  return res.json({ ok: true, sent, failed });
});

// POST /api/push-tokens {token, platform} — registrar dispositivo para push
router.post('/push-tokens', requireAuth, async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token || !String(token).trim()) {
    return res.status(400).json({ error: 'Falta el token del dispositivo.' });
  }
  const plat = ['android', 'ios', 'web'].includes(platform) ? platform : 'android';
  try {
    await run(req.db, 'INSERT INTO push_tokens (user_id, token, platform) VALUES (?,?,?)',
      [req.user.id, String(token).trim(), plat]);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err; // duplicado → ok idempotente
  }
  return res.status(201).json({ ok: true, message: '¡Listo! Te vamos a avisar por push cuando haya novedades.' });
});

// DELETE /api/push-tokens {token} — dar de baja un dispositivo
router.delete('/push-tokens', requireAuth, async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Falta el token.' });
  await run(req.db, 'DELETE FROM push_tokens WHERE user_id = ? AND token = ?', [req.user.id, String(token)]);
  return res.json({ ok: true });
});

// ---------- PREFERENCIAS DE NOTIFICACIONES (pieza "lista para lanzar" 5) ----------
// GET /api/me/notification-prefs → {reminders, offers, messages, promos}
// (sin fila guardada → todo true). El encolado (NotificationService.enqueue)
// respeta estas preferencias: lo apagado no se encola.
router.get('/me/notification-prefs', requireAuth, async (req, res) => {
  return res.json(await getNotificationPrefs(req.db, req.user.id));
});

// PATCH /api/me/notification-prefs {reminders?, offers?, messages?, promos?}
// Cada valor tiene que ser booleano; los no enviados quedan como están.
router.patch('/me/notification-prefs', requireAuth, async (req, res) => {
  const body = req.body || {};
  const updates = {};
  for (const k of NOTIF_PREF_KEYS) {
    if (body[k] === undefined) continue;
    if (typeof body[k] !== 'boolean') {
      return res.status(400).json({ error: `La preferencia "${k}" tiene que ser true o false.` });
    }
    updates[k] = body[k] ? 1 : 0;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Pasame al menos una preferencia (reminders, offers, messages, promos).' });
  }
  const db = req.db;
  const keys = Object.keys(updates);
  const existing = await queryOne(db, 'SELECT user_id FROM notification_prefs WHERE user_id = ?', [req.user.id]);
  if (existing) {
    await run(db, `UPDATE notification_prefs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`,
      [...keys.map((k) => updates[k]), req.user.id]);
  } else {
    const row = { reminders: 1, offers: 1, messages: 1, promos: 1, ...updates };
    await run(db, 'INSERT INTO notification_prefs (user_id, reminders, offers, messages, promos) VALUES (?,?,?,?,?)',
      [req.user.id, row.reminders, row.offers, row.messages, row.promos]);
  }
  return res.json(await getNotificationPrefs(db, req.user.id));
});

module.exports = router;
