'use strict';

/**
 * Lista de espera: el cliente se anota para que le avisen si se libera
 * un turno con un profesional. Sin duplicados: UNIQUE(client, profesional, slot_desc).
 */
const express = require('express');
const { queryAll, queryOne, run, isUniqueViolation } = require('../db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

// GET /api/waitlist — mi lista de espera
router.get('/waitlist', requireAuth, async (req, res) => {
  const rows = await queryAll(req.db,
    `SELECT w.*, u.name AS professional_name, s.name AS service_name
     FROM waitlist w
     JOIN professionals p ON p.id = w.professional_id
     JOIN users u ON u.id = p.user_id
     LEFT JOIN services s ON s.id = w.service_id
     WHERE w.client_id = ? ORDER BY w.created_at DESC`, [req.user.id]);
  return res.json({ waitlist: rows });
});

// POST /api/waitlist {professional_id, service_id?, slot_desc} — duplicado → 409
router.post('/waitlist', requireAuth, async (req, res) => {
  const { professional_id, service_id, slot_desc } = req.body || {};
  if (!professional_id || !slot_desc || !String(slot_desc).trim()) {
    return res.status(400).json({ error: 'Indicá el profesional y cuándo te viene bien (ej. "sábado a la mañana").' });
  }
  const db = req.db;
  if (!await queryOne(db, 'SELECT id FROM professionals WHERE id = ?', [professional_id])) {
    return res.status(404).json({ error: 'No encontramos ese profesional.' });
  }
  try {
    const r = await run(db,
      'INSERT INTO waitlist (client_id, professional_id, service_id, slot_desc) VALUES (?,?,?,?)',
      [req.user.id, professional_id, service_id || null, String(slot_desc).trim()]);
    return res.status(201).json({ entry: await queryOne(db, 'SELECT * FROM waitlist WHERE id = ?', [r.id]) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Ya estás en la lista de espera para ese turno.' });
    }
    throw err;
  }
});

// DELETE /api/waitlist/:id — salirse
router.delete('/waitlist/:id', requireAuth, async (req, res) => {
  const r = await run(req.db, 'DELETE FROM waitlist WHERE id = ? AND client_id = ?', [req.params.id, req.user.id]);
  if (r.changes === 0) return res.status(404).json({ error: 'No encontramos esa entrada.' });
  return res.json({ ok: true });
});

module.exports = router;
