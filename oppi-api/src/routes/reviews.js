'use strict';

/**
 * Reseñas.
 * - rating 1–5, sobre una reserva (booking) o un trabajo (job).
 * - El profesional/negocio reseñado (to_user) puede responder UNA sola vez;
 *   la respuesta se expone en el perfil público.
 */
const express = require('express');
const { queryAll, queryOne, run } = require('../db');
const { requireAuth } = require('../lib/auth');
const { notify } = require('../lib/notifications');
const { moderateReview } = require('../lib/moderator');

const router = express.Router();

const safeJsonParse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

const MAX_REVIEW_PHOTOS = 3;

/** Expone la reseña con `photos` como array (la columna se guarda como JSON text). */
function reviewDto(r) {
  if (!r) return null;
  return { ...r, photos: safeJsonParse(r.photos, []) };
}

/** URL válida de foto (http/https). */
function validPhotoUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

/**
 * Valida el array `photos` del body: máx 3, strings URL.
 * Devuelve { error } o { photos } (lista normalizada).
 */
function validatePhotos(photos) {
  if (photos === undefined) return { photos: [] };
  if (!Array.isArray(photos)) return { error: 'Las fotos tienen que ser una lista de URLs.' };
  if (photos.length > MAX_REVIEW_PHOTOS) {
    return { error: `Podés adjuntar hasta ${MAX_REVIEW_PHOTOS} fotos en la reseña.` };
  }
  if (!photos.every(validPhotoUrl)) {
    return { error: 'Cada foto tiene que ser una URL válida (http:// o https://).' };
  }
  return { photos: photos.map((u) => u.trim()) };
}

// GET /api/reviews — público, ?to_user=&booking_id=&job_id=
router.get('/reviews', async (req, res) => {
  const { to_user, booking_id, job_id } = req.query;
  let sql = `SELECT r.*, uf.name AS from_name, ut.name AS to_name FROM reviews r
             JOIN users uf ON uf.id = r.from_user JOIN users ut ON ut.id = r.to_user
             WHERE r.moderation_status = 'approved'`;
  const params = [];
  if (to_user) { sql += ' AND r.to_user = ?'; params.push(to_user); }
  if (booking_id) { sql += ' AND r.booking_id = ?'; params.push(booking_id); }
  if (job_id) { sql += ' AND r.job_id = ?'; params.push(job_id); }
  sql += ' ORDER BY r.created_at DESC';
  return res.json({ reviews: (await queryAll(req.db, sql, params)).map(reviewDto) });
});

// POST /api/reviews {booking_id?|job_id?, to_user, rating, text, photos?}
// photos: array de URLs del endpoint /api/uploads (máx 3).
router.post('/reviews', requireAuth, async (req, res) => {
  const { booking_id, job_id, to_user, rating, text, photos } = req.body || {};
  const db = req.db;
  if (!booking_id && !job_id) {
    return res.status(400).json({ error: 'La reseña tiene que estar ligada a una reserva o a un trabajo.' });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'El puntaje tiene que ser de 1 a 5 estrellas.' });
  }
  const { error: photosErr, photos: photoList } = validatePhotos(photos);
  if (photosErr) return res.status(400).json({ error: photosErr });
  if (!to_user || !await queryOne(db, 'SELECT id FROM users WHERE id = ?', [to_user])) {
    return res.status(400).json({ error: 'Falta a quién va dirigida la reseña.' });
  }
  if (to_user === req.user.id) {
    return res.status(400).json({ error: 'No podés dejarte una reseña a vos mismo.' });
  }
  // Verificar que el que reseña participó.
  if (booking_id) {
    const b = await queryOne(db, 'SELECT * FROM bookings WHERE id = ?', [booking_id]);
    if (!b) return res.status(404).json({ error: 'No encontramos esa reserva.' });
    if (b.client_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el cliente de la reserva puede dejar la reseña.' });
    }
  }
  if (job_id) {
    const j = await queryOne(db, 'SELECT * FROM jobs WHERE id = ?', [job_id]);
    if (!j) return res.status(404).json({ error: 'No encontramos ese trabajo.' });
    if (j.client_id !== req.user.id && j.handyman_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo los involucrados pueden dejar la reseña.' });
    }
  }
  // Moderador del equipo IA: se corre ANTES de insertar.
  const mod = await moderateReview({ rating, text: text || '', fromUserId: req.user.id, db });
  const held = mod.decision === 'retenida';
  const r = await run(db,
    `INSERT INTO reviews (booking_id, job_id, from_user, to_user, rating, text, photos,
                          moderation_status, moderation_reason)
     VALUES (?,?,?,?,?,?,?, ?,?)`,
    [booking_id || null, job_id || null, req.user.id, to_user, rating, text || '',
     JSON.stringify(photoList),
     held ? 'held' : 'approved', held ? mod.reasons.join(' ') : null]);
  const review = reviewDto(await queryOne(db, 'SELECT * FROM reviews WHERE id = ?', [r.id]));
  if (held) {
    // Retenida: no se publica ni se notifica al profesional todavía.
    return res.status(201).json({
      review,
      moderation: {
        held: true,
        message: 'Tu reseña quedó en revisión por el equipo de Oppi antes de publicarse.',
      },
    });
  }
  const fromName = (await queryOne(db, 'SELECT name FROM users WHERE id = ?', [req.user.id])).name;
  await notify(db, {
    userId: to_user, type: 'review',
    title: `⭐ Nueva reseña de ${fromName}`,
    body: `Te dejó ${rating} de 5 estrellas${text ? `: "${text.slice(0, 120)}"` : '.'} ¡Respondela para agradecer!`,
  });
  return res.status(201).json({ review });
});

// POST /api/reviews/:id/reply — el profesional/negocio responde UNA vez
router.post('/reviews/:id/reply', requireAuth, async (req, res) => {
  const { reply_text } = req.body || {};
  if (!reply_text || !reply_text.trim()) {
    return res.status(400).json({ error: 'Escribí tu respuesta.' });
  }
  const db = req.db;
  const review = await queryOne(db, 'SELECT * FROM reviews WHERE id = ?', [req.params.id]);
  if (!review) return res.status(404).json({ error: 'No encontramos esa reseña.' });
  if (review.to_user !== req.user.id) {
    return res.status(403).json({ error: 'Solo el profesional o negocio reseñado puede responder.' });
  }
  if (review.reply_text) {
    return res.status(400).json({ error: 'Ya respondiste esta reseña; solo se puede responder una vez.' });
  }
  await run(db, "UPDATE reviews SET reply_text = ?, reply_at = ? WHERE id = ?",
    [reply_text.trim(), new Date().toISOString().slice(0, 19).replace('T', ' '), review.id]);
  const toName = (await queryOne(db, 'SELECT name FROM users WHERE id = ?', [req.user.id])).name;
  await notify(db, {
    userId: review.from_user, type: 'review',
    title: `💬 ${toName} respondió tu reseña`,
    body: `"${reply_text.trim().slice(0, 140)}"`,
  });
  return res.json({ review: reviewDto(await queryOne(db, 'SELECT * FROM reviews WHERE id = ?', [review.id])) });
});

module.exports = router;
