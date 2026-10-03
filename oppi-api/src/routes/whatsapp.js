'use strict';

/**
 * Webhook de WhatsApp (Meta Cloud API) para el soporte de Oppi.
 *
 *  - GET  /api/whatsapp/webhook → verificación (hub.mode / hub.verify_token / hub.challenge)
 *  - POST /api/whatsapp/webhook → recepción de mensajes y eventos de estado
 *
 * Al llegar un mensaje: se busca o crea la `support_conversations` por
 * `external_id` (el wa_id del contacto), se guarda el mensaje entrante y,
 * si la conversación está en 'bot', corre el bot. Si está en 'human', queda
 * para los agentes. Si estaba 'resolved', se reabre en 'bot'.
 */
const express = require('express');
const { queryAll, queryOne, run } = require('../db');
const { getProvider } = require('../lib/whatsapp');
const { runBot } = require('../lib/supportBot');

const router = express.Router();

// GET /api/whatsapp/webhook — verificación de Meta.
router.get('/webhook', async (req, res) => {
  const provider = getProvider();
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const r = provider.verifyWebhook(mode, token, challenge);
  if (r.ok) return res.status(200).send(r.challenge || '');
  return res.sendStatus(403);
});

/** Extrae los mensajes entrantes del payload de Meta. */
function extractIncoming(body) {
  const out = [];
  const entries = (body && body.entry) || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const names = {};
      for (const c of value.contacts || []) {
        if (c.wa_id) names[c.wa_id] = (c.profile && c.profile.name) || '';
      }
      for (const m of value.messages || []) {
        let text = '';
        if (m.type === 'text' && m.text) {
          text = m.text.body || '';
        } else if (m.type === 'interactive' && m.interactive) {
          // button_reply / list_reply: el id es el que mandó el bot.
          const br = m.interactive.button_reply || m.interactive.list_reply || {};
          text = br.id || br.title || '';
        } else if (m.type === 'button' && m.button) {
          text = m.button.payload || m.button.text || '';
        }
        out.push({
          from: m.from,
          name: names[m.from] || '',
          text,
          type: m.type,
          waMessageId: m.id || null,
        });
      }
    }
  }
  return out;
}

/**
 * Detecta el tipo de conversación por el wa_id:
 *  - si el número coincide con el teléfono de un usuario que tiene negocio → 'business'
 *  - si coincide con un usuario → 'client' vinculado (user_id)
 *  - si no → 'client' anónimo.
 */
async function detectKind(db, waId) {
  const digits = String(waId || '').replace(/\D/g, '');
  if (!digits) return { kind: 'client' };
  const users = await queryAll(db, "SELECT id, phone FROM users WHERE phone IS NOT NULL AND phone != ''");
  const user = users.find((u) => {
    const d = String(u.phone).replace(/\D/g, '');
    return d && (digits.endsWith(d) || d.endsWith(digits));
  });
  if (!user) return { kind: 'client' };
  const biz = await queryOne(db, 'SELECT id FROM businesses WHERE user_id = ?', [user.id]);
  if (biz) return { kind: 'business', user_id: user.id, business_id: biz.id };
  return { kind: 'client', user_id: user.id };
}

function nowTs() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// POST /api/whatsapp/webhook — recepción.
router.post('/webhook', async (req, res) => {
  const db = req.db;
  const incoming = extractIncoming(req.body);
  const provider = getProvider();

  for (const msg of incoming) {
    if (!msg.from) continue;
    let conv = await queryOne(db,
      'SELECT * FROM support_conversations WHERE external_id = ?', [msg.from]);
    if (!conv) {
      const detected = await detectKind(db, msg.from);
      const r = await run(db,
        `INSERT INTO support_conversations (external_id, user_id, business_id, kind, status, channel)
         VALUES (?,?,?,?, 'bot', 'whatsapp')`,
        [msg.from, detected.user_id || null, detected.business_id || null, detected.kind]);
      conv = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [r.id]);
    }
    await run(db,
      `INSERT INTO support_messages (conversation_id, direction, sender, body, wa_message_id)
       VALUES (?, 'in', 'user', ?, ?)`,
      [conv.id, msg.text || '', msg.waMessageId]);
    await run(db, 'UPDATE support_conversations SET updated_at = ? WHERE id = ?', [nowTs(), conv.id]);

    const fresh = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
    if (fresh.status === 'resolved') {
      // La conversación se había cerrado: un mensaje nuevo la reabre en el bot.
      await run(db, "UPDATE support_conversations SET status = 'bot', bot_state = NULL, bot_misses = 0 WHERE id = ?", [conv.id]);
      const reopened = await queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conv.id]);
      await runBot({ db, provider, conversation: reopened, text: msg.text });
    } else if (fresh.status === 'bot') {
      await runBot({ db, provider, conversation: fresh, text: msg.text });
    }
    // status 'human': el mensaje queda en la bandeja para los agentes.
  }

  return res.sendStatus(200);
});

module.exports = router;
