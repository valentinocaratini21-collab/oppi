'use strict';

/**
 * Tests del chat de soporte integrado in-app (canal oficial):
 *  - sin auth → 401 en POST /api/support/chat y GET /api/support/chat/history
 *  - primer mensaje: el bot responde el menú + quick_replies de cliente
 *  - usuario con negocio → kind 'business' y quick_replies de empresa
 *  - 2 mensajes sin sentido → handoff a human + notificación in-app a agentes
 *  - chip "Hablar con un asesor" (id 'asesor') → handoff a human
 *  - "Reportar un no-show" ejecuta la lógica real de no-show
 *  - history: mensajes ordenados, sender bot/user/agent y timestamps
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryOne, queryAll } = require('../src/db');

let ctx;
let agent; // { user, token }

const pad = (n) => String(n).padStart(2, '0');
function slotAt(hoursAhead) {
  const d = new Date(Date.now() + hoursAhead * 3600000);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

async function chat(token, body) {
  return ctx.api('POST', '/api/support/chat', { token, body: { body } });
}

async function convFor(userId) {
  return queryOne(ctx.db, 'SELECT * FROM support_conversations WHERE external_id = ?', [`inapp:${userId}`]);
}

before(async () => {
  ctx = await setup();
  // Bootstrap: el primer agente se auto-registra (todavía no hay agentes).
  agent = await ctx.register({ name: 'Agente Chat' });
  const r = await ctx.api('POST', '/api/support/agents', {
    token: agent["token"], body: { email: agent.user.email, role: 'admin' },
  });
  assert.equal(r.status, 201, `bootstrap de agente falló: ${JSON.stringify(r.json)}`);
});
after(() => ctx.close());

// ---------- auth ----------

test('sin auth → 401 en POST /api/support/chat y GET /api/support/chat/history', async () => {
  const c = await ctx.api('POST', '/api/support/chat', { body: { body: 'Hola' } });
  assert.equal(c.status, 401);
  const h = await ctx.api('GET', '/api/support/chat/history');
  assert.equal(h.status, 401);
});

test('body vacío → 400', async () => {
  const u = await ctx.register({ name: 'Vacío' });
  const { status } = await ctx.api('POST', '/api/support/chat', { token: u["token"], body: { body: '   ' } });
  assert.equal(status, 400);
});

// ---------- bot in-app: cliente ----------

test('cliente: primer mensaje → el bot saluda con el menú + quick_replies', async () => {
  const u = await ctx.register({ name: 'Cliente InApp' });
  const { status, json } = await chat(u["token"], 'Hola');
  assert.equal(status, 200, `chat falló: ${JSON.stringify(json)}`);
  assert.equal(json.status, 'bot');
  assert.match(json.reply, /¿Cómo te podemos ayudar\?/);
  assert.deepEqual(json.quick_replies, [
    { id: 'buscar', title: 'Buscar otro profesional' },
    { id: 'reprogramar', title: 'Reprogramar' },
    { id: 'cancelar', title: 'Cancelar una reserva' },
    { id: 'otro', title: 'Otro tema' },
  ]);

  const conv = await convFor(u.user.id);
  assert.ok(conv, 'la conversación in-app no se creó');
  assert.equal(conv.channel, 'inapp');
  assert.equal(conv.external_id, `inapp:${u.user.id}`);
  assert.equal(conv.kind, 'client');
  assert.equal(conv.user_id, u.user.id);
  assert.equal(conv.status, 'bot');
});

test('cliente: el segundo mensaje no repite el menú, responde al intent', async () => {
  const u = await ctx.register({ name: 'Cliente Intent' });
  await chat(u["token"], 'Hola');
  const { status, json } = await chat(u["token"], 'cancelar');
  assert.equal(status, 200);
  assert.match(json.reply, /política de cancelación/i);
  assert.equal(json.status, 'bot');
  // En bot activo, los chips siguen disponibles.
  assert.equal(json.quick_replies.length, 4);
  assert.equal(json.quick_replies[0].title, 'Buscar otro profesional');
});

test('2 mensajes sin sentido → handoff a human + notificación in-app al agente', async () => {
  const u = await ctx.register({ name: 'Cliente Handoff' });
  await chat(u["token"], 'Hola');
  let r = await chat(u["token"], 'blablabla sin sentido');
  assert.equal(r.json.status, 'bot');
  assert.match(r.json.reply, /no te entendí/);

  r = await chat(u["token"], 'zzz más ruido');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'human');
  assert.match(r.json.reply, /Te paso con un asesor/);
  assert.deepEqual(r.json.quick_replies, []);

  const conv = await convFor(u.user.id);
  assert.equal(conv.status, 'human');

  // El agente recibió la notificación in-app (mecanismo existente).
  const notifs = await queryAll(ctx.db,
    "SELECT * FROM notifications WHERE user_id = ? AND type = 'support' ORDER BY id DESC LIMIT 1",
    [agent.user.id]);
  assert.ok(notifs.length > 0, 'el agente no recibió notificación del handoff');
});

test('chip "Hablar con un asesor" (id asesor) → handoff a human', async () => {
  const u = await ctx.register({ name: 'Cliente Asesor' });
  await chat(u["token"], 'Hola');
  const r = await chat(u["token"], 'asesor');
  assert.equal(r.json.status, 'human');
  assert.match(r.json.reply, /Te paso con un asesor/);
});

test('en human, el bot no responde: reply null y el mensaje queda para agentes', async () => {
  const u = await ctx.register({ name: 'Cliente Silencio' });
  await chat(u["token"], 'Hola');
  await chat(u["token"], 'otro'); // handoff
  const r = await chat(u["token"], 'sigo esperando');
  assert.equal(r.json.status, 'human');
  assert.equal(r.json.reply, null);

  const rows = await queryAll(ctx.db,
    'SELECT * FROM support_messages WHERE conversation_id = (SELECT id FROM support_conversations WHERE external_id = ?) ORDER BY id ASC',
    [`inapp:${u.user.id}`]);
  const last = rows[rows.length - 1];
  assert.equal(last.direction, 'in');
  assert.equal(last.sender, 'user');
  assert.equal(last.body, 'sigo esperando');
});

// ---------- history ----------

test('history: mensajes ordenados con sender bot/user/agent y timestamps', async () => {
  const u = await ctx.register({ name: 'Cliente History' });
  await chat(u["token"], 'Hola');     // → saludo del bot
  await chat(u["token"], 'asesor');   // → handoff a human
  const conv = await convFor(u.user.id);
  // El agente responde como humano.
  const reply = await ctx.api('POST', `/api/support/conversations/${conv.id}/reply`, {
    token: agent["token"], body: { body: 'Hola, soy del equipo 👋' },
  });
  assert.equal(reply.status, 201);

  const { status, json } = await ctx.api('GET', '/api/support/chat/history', { token: u["token"] });
  assert.equal(status, 200);
  assert.equal(json.conversation.id, conv.id);
  assert.equal(json.conversation.status, 'human');
  const senders = json.messages.map((m) => m.sender);
  assert.deepEqual(senders, ['user', 'bot', 'user', 'bot', 'agent']);
  // Ordenados cronológicamente.
  const ids = json.messages.map((m) => m.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  // Timestamps presentes.
  for (const m of json.messages) {
    assert.ok(m.created_at, `mensaje ${m.id} sin created_at`);
    assert.ok(m.body !== undefined);
  }
  assert.equal(json.messages[json.messages.length - 1].body, 'Hola, soy del equipo 👋');
});

test('history sin conversación → messages vacío', async () => {
  const u = await ctx.register({ name: 'Sin Conversación' });
  const { status, json } = await ctx.api('GET', '/api/support/chat/history', { token: u["token"] });
  assert.equal(status, 200);
  assert.equal(json.conversation, null);
  assert.deepEqual(json.messages, []);
});

// ---------- bot in-app: empresa ----------

test('usuario con negocio → kind business y quick_replies de empresa', async () => {
  const { api } = ctx;
  const { token, user } = await ctx.register({ name: 'Dueña Negocio', role: 'client' });
  const b = await api('POST', '/api/businesses', { token, body: { name: 'Pelu La Esquina' } });
  assert.equal(b.status, 201, `crear negocio falló: ${JSON.stringify(b.json)}`);

  const { status, json } = await chat(token, 'Hola');
  assert.equal(status, 200);
  assert.equal(json.status, 'bot');
  assert.match(json.reply, /Oppi Empresas/);
  assert.deepEqual(json.quick_replies, [
    { id: 'asignar', title: 'Asignar otro colaborador' },
    { id: 'reprogramar', title: 'Reprogramar reserva' },
    { id: 'noshow', title: 'Reportar un no-show' },
    { id: 'asesor', title: 'Hablar con un asesor' },
  ]);

  const conv = await convFor(user.id);
  assert.equal(conv.kind, 'business');
  assert.ok(conv.business_id, 'falta el business_id vinculado');
});

test('reportar no-show desde el bot ejecuta la lógica real', async () => {
  const { api, register, makePro, db } = ctx;
  const { token: proToken, user: proUser, professional, service } = await makePro();
  const b = await api('POST', '/api/businesses', { token: proToken, body: { name: 'Barbería Test' } });
  assert.equal(b.status, 201);

  const client = await register({ name: 'Cliente NoShow' });
  // Turno ayer, reserva confirmada.
  const s = slotAt(-26);
  const sl = await api('POST', '/api/slots', {
    token: proToken, body: { professional_id: professional.id, ...s },
  });
  assert.equal(sl.status, 201);
  const bk = await api('POST', '/api/bookings', {
    token: client["token"], body: { service_id: service.id, slot_id: sl.json.slot.id },
  });
  assert.equal(bk.status, 201);
  const cf = await api('PATCH', `/api/bookings/${bk.json.booking.id}`, {
    token: proToken, body: { status: 'confirmed' },
  });
  assert.equal(cf.status, 200);
  const bookingId = bk.json.booking.id;

  await chat(proToken, 'Hola');
  let r = await chat(proToken, 'Reportar un no-show');
  assert.equal(r.json.status, 'bot');
  assert.match(r.json.reply, /número de la reserva/);

  r = await chat(proToken, `#${bookingId}, el cliente no vino`);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'bot');
  assert.match(r.json.reply, /Marqué el no-show/);
  assert.match(r.json.reply, new RegExp(`#${bookingId}`));

  const booking = await queryOne(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(booking.status, 'no_show_client');
});

test('no-show in-app con número inválido no rompe nada', async () => {
  const { api } = ctx;
  const { token, user } = await ctx.register({ name: 'Dueña Dos' });
  const b = await api('POST', '/api/businesses', { token, body: { name: 'Salón Dos' } });
  assert.equal(b.status, 201);
  await chat(token, 'Hola');
  await chat(token, 'Reportar un no-show');
  const r = await chat(token, 'La reserva #999999');
  assert.equal(r.json.status, 'bot');
  assert.match(r.json.reply, /No pude marcar el no-show/);
  const conv = await convFor(user.id);
  assert.equal(conv.status, 'bot');
});
