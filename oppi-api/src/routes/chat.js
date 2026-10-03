'use strict';

/**
 * Chat: conversaciones y mensajes.
 *
 * - photos[]: metadata de fotos {filename, url} (el archivo real lo guarda el
 *   storage; acá solo la referencia).
 * - quotes: {amount_gs, detail, status: pending|accepted|rejected}.
 *
 * SEPARACIÓN DE ROLES (validada en la API):
 *  - Solo un usuario con rol 'handyman' puede CREAR un quote en un mensaje.
 *  - Solo un usuario con rol 'client' (participante de la conversación) puede
 *    ACEPTAR o RECHAZAR un quote.
 *  - Cualquier otro intento → 403.
 */
const express = require('express');
const { queryAll, queryOne, run } = require('../db');
const { requireAuth } = require('../lib/auth');
const { notify } = require('../lib/notifications');

const router = express.Router();
const safeJsonParse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const participantsOf = (conv) => safeJsonParse(conv.participants, []);
const isParticipant = (conv, userId) => participantsOf(conv).includes(userId);

function messageDto(m, senderName) {
  return {
    id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id,
    sender_name: senderName || null, text: m.text,
    photos: safeJsonParse(m.photos, []),
    quote: m.quote ? safeJsonParse(m.quote, null) : null,
    created_at: m.created_at,
  };
}

// GET /api/conversations — mis conversaciones
router.get('/conversations', requireAuth, async (req, res) => {
  const rows = await queryAll(req.db, 'SELECT * FROM conversations ORDER BY created_at DESC');
  const mine = rows.filter((c) => isParticipant(c, req.user.id)).map((c) => ({
    id: c.id, participants: participantsOf(c), task_id: c.task_id, created_at: c.created_at,
  }));
  return res.json({ conversations: mine });
});

// POST /api/conversations {participants:[userIds], task_id?} — te incluye automáticamente
router.post('/conversations', requireAuth, async (req, res) => {
  const { participants, task_id } = req.body || {};
  const ids = Array.from(new Set([req.user.id, ...((participants || []).map(Number).filter(Boolean))]));
  if (ids.length < 2) {
    return res.status(400).json({ error: 'Una conversación necesita al menos dos participantes.' });
  }
  const db = req.db;
  for (const id of ids) {
    if (!await queryOne(db, 'SELECT id FROM users WHERE id = ?', [id])) {
      return res.status(400).json({ error: `El usuario ${id} no existe.` });
    }
  }
  const r = await run(db, 'INSERT INTO conversations (participants, task_id) VALUES (?,?)',
    [JSON.stringify(ids), task_id || null]);
  const c = await queryOne(db, 'SELECT * FROM conversations WHERE id = ?', [r.id]);
  return res.status(201).json({
    conversation: { id: c.id, participants: participantsOf(c), task_id: c.task_id, created_at: c.created_at },
  });
});

// GET /api/conversations/:id/messages — solo participantes
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  const conv = await queryOne(req.db, 'SELECT * FROM conversations WHERE id = ?', [req.params.id]);
  if (!conv) return res.status(404).json({ error: 'No encontramos esa conversación.' });
  if (!isParticipant(conv, req.user.id)) {
    return res.status(403).json({ error: 'No sos parte de esta conversación.' });
  }
  const rows = await queryAll(req.db,
    `SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = ? ORDER BY m.created_at ASC`, [conv.id]);
  return res.json({ messages: rows.map((m) => messageDto(m, m.sender_name)) });
});

// POST /api/conversations/:id/messages {text, photos?, quote?}
router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
  const db = req.db;
  const conv = await queryOne(db, 'SELECT * FROM conversations WHERE id = ?', [req.params.id]);
  if (!conv) return res.status(404).json({ error: 'No encontramos esa conversación.' });
  if (!isParticipant(conv, req.user.id)) {
    return res.status(403).json({ error: 'No sos parte de esta conversación.' });
  }
  const { text, photos, quote } = req.body || {};
  if (!text && !quote && !(photos && photos.length)) {
    return res.status(400).json({ error: 'El mensaje está vacío.' });
  }

  // SEPARACIÓN DE ROLES: solo el handyman crea quotes.
  let quoteJson = null;
  if (quote) {
    if (req.user.role !== 'handyman') {
      return res.status(403).json({ error: 'Solo un handyman puede enviar una cotización por el chat.' });
    }
    const { amount_gs, detail } = quote;
    if (!Number.isInteger(amount_gs) || amount_gs <= 0) {
      return res.status(400).json({ error: 'La cotización necesita un monto en guaraníes mayor a 0.' });
    }
    quoteJson = JSON.stringify({ amount_gs, detail: detail || '', status: 'pending' });
  }
  const photosJson = JSON.stringify((photos || []).map((p) => ({
    filename: p.filename || '', url: p.url || '',
  })));

  const r = await run(db,
    'INSERT INTO messages (conversation_id, sender_id, text, photos, quote) VALUES (?,?,?,?,?)',
    [conv.id, req.user.id, text || '', photosJson, quoteJson]);
  const m = await queryOne(db,
    'SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?',
    [r.id]);
  // Si trajo cotización, avisar a los demás participantes.
  if (quoteJson) {
    const q = JSON.parse(quoteJson);
    for (const pid of participantsOf(conv)) {
      if (pid === req.user.id) continue;
      await notify(db, {
        userId: pid, type: 'quote',
        title: `📝 Nueva cotización de ${m.sender_name}`,
        body: `Te cotizó Gs. ${q.amount_gs.toLocaleString('es-PY')}${q.detail ? ` — ${q.detail}` : ''}. Respondela desde el chat.`,
      });
    }
  }
  return res.status(201).json({ message: messageDto(m, m.sender_name) });
});

// PATCH /api/messages/:id/quote {status: accepted|rejected} — solo el cliente acepta/rechaza
router.patch('/messages/:id/quote', requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Estado no válido (usá accepted o rejected).' });
  }
  const db = req.db;
  const m = await queryOne(db, 'SELECT * FROM messages WHERE id = ?', [req.params.id]);
  if (!m || !m.quote) return res.status(404).json({ error: 'Ese mensaje no tiene cotización.' });
  const conv = await queryOne(db, 'SELECT * FROM conversations WHERE id = ?', [m.conversation_id]);
  if (!conv || !isParticipant(conv, req.user.id)) {
    return res.status(403).json({ error: 'No sos parte de esta conversación.' });
  }
  // SEPARACIÓN DE ROLES: solo el CLIENTE DEL TRABAJO (o de la tarea, si todavía
  // no hay trabajo) acepta/rechaza. No se usa el rol global: un handyman también
  // puede ser cliente en otro trabajo, y viceversa. En conversaciones directas
  // sin tarea se mantiene el criterio anterior (rol 'client').
  if (conv.task_id) {
    let clientId = null;
    const job = await queryOne(db,
      'SELECT client_id FROM jobs WHERE task_id = ? ORDER BY id DESC LIMIT 1', [conv.task_id]);
    if (job) clientId = job.client_id;
    else {
      const task = await queryOne(db, 'SELECT client_id FROM tasks WHERE id = ?', [conv.task_id]);
      if (task) clientId = task.client_id;
    }
    if (!clientId || clientId !== req.user.id) {
      return res.status(403).json({ error: 'Solo el cliente puede aceptar o rechazar una cotización.' });
    }
  } else if (req.user.role !== 'client') {
    return res.status(403).json({ error: 'Solo el cliente puede aceptar o rechazar una cotización.' });
  }
  const q = safeJsonParse(m.quote, null);
  if (!q || q.status !== 'pending') {
    return res.status(400).json({ error: 'Esa cotización ya fue respondida.' });
  }
  q.status = status;
  await run(db, 'UPDATE messages SET quote = ? WHERE id = ?', [JSON.stringify(q), m.id]);
  // Avisar al handyman que la envió.
  const senderName = (await queryOne(db, 'SELECT name FROM users WHERE id = ?', [req.user.id])).name;
  await notify(db, {
    userId: m.sender_id, type: 'quote',
    title: status === 'accepted'
      ? `✅ ${senderName} aceptó tu cotización`
      : `❌ ${senderName} rechazó tu cotización`,
    body: `Cotización de Gs. ${q.amount_gs.toLocaleString('es-PY')}${q.detail ? ` — ${q.detail}` : ''}.`,
  });
  return res.json({ quote: q });
});

module.exports = router;
