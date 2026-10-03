'use strict';

/**
 * Bandeja de soporte por WhatsApp (in-app, para agentes humanos).
 *
 *  - POST /api/support/agents {email, role?} — agrega un agente. Si todavía
 *    no hay ningún agente, cualquier usuario logueado puede auto-registrarse
 *    (bootstrap); después solo un agente existente puede sumar a otro.
 *  - GET  /api/support/conversations?status= — lista con último mensaje y contadores.
 *  - GET  /api/support/conversations/:id/messages — historial.
 *  - POST /api/support/conversations/:id/reply {body} — responde como humano.
 *  - POST /api/support/conversations/:id/handoff — pausa el bot, pasa a 'human'.
 *  - POST /api/support/conversations/:id/bot — devuelve la conversación al bot.
 *  - POST /api/support/conversations/:id/resolve — marca 'resolved'.
 *
 * Todo salvo el bootstrap de agentes requiere `requireAgent` (el user tiene
 * que estar en `support_agents`).
 */
const express = require('express');
const { queryAll, queryOne, run, isUniqueViolation } = require('../db');
const { requireAuth } = require('../lib/auth');
const { getProvider } = require('../lib/whatsapp');
const { handoffToHuman, sendMenu, runBot, quickRepliesFor, InAppProvider } = require('../lib/supportBot');

const router = express.Router();

function nowTs() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function requireAgent(req, res, next) {
  const agent = await queryOne(req.db, 'SELECT * FROM support_agents WHERE user_id = ?', [req.user.id]);
  if (!agent) {
    return res.status(403).json({ error: 'No tenés acceso a la bandeja de soporte.' });
  }
  req.agent = agent;
  return next();
}

async function getConversation(db, res, id) {
  const conv = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [id]);
  if (!conv) { res.status(404).json({ error: 'No encontramos esa conversación.' }); return null; }
  return conv;
}

// POST /api/support/agents — agrega un agente por email.
router.post('/support/agents', requireAuth, async (req, res) => {
  const db = req.db;
  const { email, role } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Pasame el email del usuario.' });
  const user = await queryOne(db, 'SELECT * FROM users WHERE email = ?',
    [String(email).trim().toLowerCase()]);
  if (!user) return res.status(404).json({ error: 'No hay ningún usuario registrado con ese email.' });

  const anyAgent = await queryOne(db, 'SELECT id FROM support_agents LIMIT 1');
  if (anyAgent) {
    const me = await queryOne(db, 'SELECT id FROM support_agents WHERE user_id = ?', [req.user.id]);
    if (!me) return res.status(403).json({ error: 'Solo un agente puede sumar a otro agente.' });
  }
  const finalRole = role === 'admin' ? 'admin' : 'agent';
  try {
    const r = await run(db, 'INSERT INTO support_agents (user_id, role) VALUES (?, ?)',
      [user.id, finalRole]);
    const agent = await queryOne(db, 'SELECT * FROM support_agents WHERE id = ?', [r.id]);
    return res.status(201).json({ agent: { id: agent.id, user_id: agent.user_id, role: agent.role, name: user.name, email: user.email } });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Ese usuario ya es agente de soporte.' });
    }
    throw err;
  }
});

// GET /api/support/conversations — bandeja.
router.get('/support/conversations', requireAuth, requireAgent, async (req, res) => {
  const db = req.db;
  const { status } = req.query;
  const where = status ? 'WHERE c.status = ?' : '';
  const params = status ? [String(status)] : [];
  const convs = await queryAll(db,
    `SELECT c.* FROM support_conversations c ${where} ORDER BY c.updated_at DESC`, params);
  const out = [];
  for (const c of convs) {
    const last = await queryOne(db,
      'SELECT * FROM support_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', [c.id]);
    const counts = await queryOne(db,
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) AS incoming,
              SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS outgoing
       FROM support_messages WHERE conversation_id = ?`, [c.id]);
    out.push({
      ...c,
      last_message: last || null,
      total_messages: Number(counts.total || 0),
      incoming_messages: Number(counts.incoming || 0),
      outgoing_messages: Number(counts.outgoing || 0),
    });
  }
  return res.json({ conversations: out });
});

// GET /api/support/conversations/:id/messages — historial.
router.get('/support/conversations/:id/messages', requireAuth, requireAgent, async (req, res) => {
  const conv = await getConversation(req.db, res, req.params.id);
  if (!conv) return;
  const messages = await queryAll(req.db,
    'SELECT * FROM support_messages WHERE conversation_id = ? ORDER BY id ASC', [conv.id]);
  return res.json({ conversation: conv, messages });
});

// POST /api/support/conversations/:id/reply — el agente responde como humano.
router.post('/support/conversations/:id/reply', requireAuth, requireAgent, async (req, res) => {
  const db = req.db;
  const conv = await getConversation(db, res, req.params.id);
  if (!conv) return;
  const { body } = req.body || {};
  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: 'Escribí el mensaje antes de enviarlo.' });
  }
  const provider = getProvider();
  await provider.sendText(conv.external_id, String(body));
  const r = await run(db,
    `INSERT INTO support_messages (conversation_id, direction, sender, body)
     VALUES (?, 'out', 'human', ?)`,
    [conv.id, String(body)]);
  await run(db, "UPDATE support_conversations SET status = 'human', bot_state = NULL, updated_at = ? WHERE id = ?",
    [nowTs(), conv.id]);
  const message = await queryOne(db, 'SELECT * FROM support_messages WHERE id = ?', [r.id]);
  return res.status(201).json({ message });
});

// POST /api/support/conversations/:id/handoff — pausa el bot, pasa a 'human'.
router.post('/support/conversations/:id/handoff', requireAuth, requireAgent, async (req, res) => {
  const db = req.db;
  const conv = await getConversation(db, res, req.params.id);
  if (!conv) return;
  const fresh = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
  await handoffToHuman(db, getProvider(), fresh);
  const updated = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
  return res.json({ conversation: updated });
});

// POST /api/support/conversations/:id/bot — devuelve la conversación al bot.
router.post('/support/conversations/:id/bot', requireAuth, requireAgent, async (req, res) => {
  const db = req.db;
  const conv = await getConversation(db, res, req.params.id);
  if (!conv) return;
  await run(db, "UPDATE support_conversations SET status = 'bot', bot_state = NULL, bot_misses = 0, updated_at = ? WHERE id = ?",
    [nowTs(), conv.id]);
  const fresh = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
  await sendMenu(db, getProvider(), fresh);
  const updated = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
  return res.json({ conversation: updated });
});

// POST /api/support/conversations/:id/resolve — cierra la conversación.
router.post('/support/conversations/:id/resolve', requireAuth, requireAgent, async (req, res) => {
  const db = req.db;
  const conv = await getConversation(db, res, req.params.id);
  if (!conv) return;
  await run(db, "UPDATE support_conversations SET status = 'resolved', bot_state = NULL, updated_at = ? WHERE id = ?",
    [nowTs(), conv.id]);
  const updated = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
  return res.json({ conversation: updated });
});

// ---------- Chat integrado in-app (canal oficial de soporte) ----------

/**
 * `external_id` de la conversación in-app de un usuario (UNIQUE en la
 * tabla, así nunca colisiona con un wa_id). `channel = 'inapp'`.
 */
function inappExternalId(userId) {
  return `inapp:${userId}`;
}

async function getOrCreateInappConversation(db, user) {
  const externalId = inappExternalId(user.id);
  let conv = await queryOne(db, 'SELECT * FROM support_conversations WHERE external_id = ?', [externalId]);
  if (!conv) {
    const biz = await queryOne(db, 'SELECT id FROM businesses WHERE user_id = ?', [user.id]);
    const kind = biz ? 'business' : 'client';
    try {
      const r = await run(db,
        `INSERT INTO support_conversations (external_id, user_id, business_id, kind, status, channel)
         VALUES (?, ?, ?, ?, 'bot', 'inapp')`,
        [externalId, user.id, biz ? biz.id : null, kind]);
      conv = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [r.id]);
    } catch (err) {
      // Carrera entre dos primeros mensajes: la otra corrida ya la creó.
      if (!isUniqueViolation(err)) throw err;
      conv = await queryOne(db, 'SELECT * FROM support_conversations WHERE external_id = ?', [externalId]);
    }
  }
  return conv;
}

// POST /api/support/chat — el usuario habla con el bot de soporte in-app.
// Requiere auth. Responde { reply, quick_replies[], status }.
router.post('/support/chat', requireAuth, async (req, res) => {
  const db = req.db;
  const text = String((req.body || {}).body || '').trim();
  if (!text) return res.status(400).json({ error: 'Escribí el mensaje antes de enviarlo.' });

  let conv = await getOrCreateInappConversation(db, req.user);
  if (conv.status === 'resolved') {
    // La conversación se había cerrado: un mensaje nuevo la reabre en el bot.
    await run(db,
      "UPDATE support_conversations SET status = 'bot', bot_state = NULL, bot_misses = 0, updated_at = ? WHERE id = ?",
      [nowTs(), conv.id]);
    conv = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
  }

  // Marca para saber qué mensajes salientes mandó el bot en ESTE turno.
  const prevMax = await queryOne(db,
    'SELECT MAX(id) AS max_id FROM support_messages WHERE conversation_id = ?', [conv.id]);
  const prevMaxId = (prevMax && prevMax.max_id) || 0;

  await run(db,
    `INSERT INTO support_messages (conversation_id, direction, sender, body)
     VALUES (?, 'in', 'user', ?)`,
    [conv.id, text]);
  await run(db, 'UPDATE support_conversations SET updated_at = ? WHERE id = ?', [nowTs(), conv.id]);

  const fresh = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
  if (fresh.status === 'bot') {
    // Corre el mismo motor del bot que usa WhatsApp, con un provider que
    // solo registra envíos (sin salir a la red). El handoff a humano dentro
    // del bot ya notifica a los agentes (notifyAgents en supportBot.js).
    await runBot({ db, provider: new InAppProvider(), conversation: fresh, text });
  }
  // status 'human': el bot no responde; el mensaje queda en la bandeja.

  const updated = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
  const replyRow = await queryOne(db,
    `SELECT * FROM support_messages
     WHERE conversation_id = ? AND direction = 'out' AND id > ?
     ORDER BY id DESC LIMIT 1`,
    [conv.id, prevMaxId]);

  return res.json({
    reply: replyRow ? replyRow.body : null,
    quick_replies: updated.status === 'bot' ? quickRepliesFor(updated.kind) : [],
    status: updated.status,
    conversation_id: updated.id,
  });
});

// GET /api/support/chat/history — historial del chat in-app del usuario,
// ordenado cronológicamente, con sender ('bot' | 'user' | 'agent') y
// timestamps. Requiere auth.
router.get('/support/chat/history', requireAuth, async (req, res) => {
  const db = req.db;
  const conv = await queryOne(db,
    'SELECT * FROM support_conversations WHERE external_id = ?', [inappExternalId(req.user.id)]);
  if (!conv) return res.json({ conversation: null, messages: [] });
  const rows = await queryAll(db,
    'SELECT * FROM support_messages WHERE conversation_id = ? ORDER BY id ASC', [conv.id]);
  return res.json({
    conversation: { id: conv.id, kind: conv.kind, status: conv.status },
    messages: rows.map((m) => ({
      id: m.id,
      sender: m.sender === 'human' ? 'agent' : m.sender,
      direction: m.direction,
      body: m.body,
      created_at: m.created_at,
    })),
  });
});

module.exports = router;
