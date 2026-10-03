'use strict';

/**
 * Tests del soporte por WhatsApp:
 *  - verificación del webhook (token ok/ko)
 *  - recepción: guarda conversación + mensaje entrante, el bot saluda
 *  - flujo del bot: menú → opción → respuesta
 *  - 2 "no te entendí" seguidos → handoff automático a humano
 *  - reportar no-show desde el bot crea el reporte (misma lógica que
 *    POST /api/bookings/:id/no-show)
 *  - bandeja de agentes: bootstrap, lista, reply, handoff, bot, resolve
 *  - validateConfig: mensajes exactos cuando falta cada variable
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryOne, queryAll } = require('../src/db');
const { validateConfig, getProvider, getMockInstance } = require('../src/lib/whatsapp');

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

/** Payload estilo Meta Cloud API con un mensaje de texto. */
function waPayload(waId, text, opts = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '59521123456', phone_number_id: '999' },
          contacts: [{ profile: { name: opts.name || 'Contacto' }, wa_id: waId }],
          messages: [opts.message || {
            from: waId, id: opts.waMessageId || `wamid.${Date.now()}`, timestamp: '1700000000',
            type: 'text', text: { body: text },
          }],
        },
      }],
    }],
  };
}

async function webhookText(waId, text, opts) {
  const { api } = ctx;
  const { status, json } = await api('POST', '/api/whatsapp/webhook', { body: waPayload(waId, text, opts) });
  assert.equal(status, 200, `webhook falló: ${JSON.stringify(json)}`);
}

async function convByExternalId(externalId) {
  return queryOne(ctx.db, 'SELECT * FROM support_conversations WHERE external_id = ?', [externalId]);
}

async function lastOutMessage(convId) {
  return queryOne(ctx.db,
    "SELECT * FROM support_messages WHERE conversation_id = ? AND direction = 'out' ORDER BY id DESC LIMIT 1",
    [convId]);
}

async function inbox(status) {
  const { api } = ctx;
  const q = status ? { query: { status } } : {};
  const { status: st, json } = await api('GET', '/api/support/conversations', { token: agent["token"], ...q });
  assert.equal(st, 200, `bandeja falló: ${JSON.stringify(json)}`);
  return json.conversations;
}

before(async () => {
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  ctx = await setup();
  // Bootstrap: el primer agente se auto-registra (todavía no hay agentes).
  agent = await ctx.register({ name: 'Agente Uno' });
  const r = await ctx.api('POST', '/api/support/agents', {
    token: agent["token"], body: { email: agent.user.email, role: 'admin' },
  });
  assert.equal(r.status, 201, `bootstrap de agente falló: ${JSON.stringify(r.json)}`);
});
after(() => ctx.close());

// ---------- verificación del webhook ----------

test('webhook GET: token correcto → 200 con el challenge', async () => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_VERIFY_TOKEN = 'secreto-xyz';
  const res = await fetch(`${ctx.base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=secreto-xyz&hub.challenge=ABC123`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ABC123');
});

test('webhook GET: token incorrecto → 403', async () => {
  const res = await fetch(`${ctx.base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=ABC123`);
  assert.equal(res.status, 403);
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
});

// ---------- validateConfig ----------

test('validateConfig: mensajes exactos por cada variable faltante', () => {
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  const missing = validateConfig();
  assert.equal(missing.length, 3);
  assert.ok(missing[0].startsWith('Falta WHATSAPP_PHONE_NUMBER_ID:'), missing[0]);
  assert.ok(missing[1].startsWith('Falta WHATSAPP_ACCESS_TOKEN:'), missing[1]);
  assert.ok(missing[2].startsWith('Falta WHATSAPP_VERIFY_TOKEN:'), missing[2]);
  assert.equal(getProvider().name, 'mock');
});

test('validateConfig: config completa → provider cloud', () => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_VERIFY_TOKEN = 'secreto';
  assert.deepEqual(validateConfig(), []);
  assert.equal(getProvider().name, 'cloud');
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  assert.equal(getProvider().name, 'mock');
});

// ---------- agentes ----------

test('solo un agente puede sumar a otro: un usuario común recibe 403', async () => {
  const other = await ctx.register({ name: 'Común' });
  const r = await ctx.api('POST', '/api/support/agents', {
    token: other["token"], body: { email: other.user.email },
  });
  assert.equal(r.status, 403);
});

test('agregar agente con email inexistente → 404', async () => {
  const r = await ctx.api('POST', '/api/support/agents', {
    token: agent["token"], body: { email: 'nadie@oppi.test' },
  });
  assert.equal(r.status, 404);
});

test('agregar agente duplicado → 409', async () => {
  const r = await ctx.api('POST', '/api/support/agents', {
    token: agent["token"], body: { email: agent.user.email },
  });
  assert.equal(r.status, 409);
});

test('bandeja sin ser agente → 403', async () => {
  const other = await ctx.register({ name: 'Otro Común' });
  const r = await ctx.api('GET', '/api/support/conversations', { token: other["token"] });
  assert.equal(r.status, 403);
});

// ---------- recepción + bot: cliente ----------

test('webhook entrante crea conversación y el bot saluda con el menú', async () => {
  await webhookText('595981000001', 'Hola');
  const conv = await convByExternalId('595981000001');
  assert.ok(conv, 'la conversación no se creó');
  assert.equal(conv.kind, 'client');
  assert.equal(conv.status, 'bot');
  const msgs = await queryAll(ctx.db,
    'SELECT * FROM support_messages WHERE conversation_id = ? ORDER BY id ASC', [conv.id]);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].direction, 'in');
  assert.equal(msgs[0].sender, 'user');
  assert.equal(msgs[0].body, 'Hola');
  assert.equal(msgs[1].direction, 'out');
  assert.equal(msgs[1].sender, 'bot');
  assert.match(msgs[1].body, /¿Cómo te podemos ayudar\?/);
});

test('bot: "cancelar" → explica la política en 3 líneas', async () => {
  await webhookText('595981000001', 'cancelar');
  const conv = await convByExternalId('595981000001');
  const last = await lastOutMessage(conv.id);
  assert.match(last.body, /política de cancelación/i);
  assert.match(last.body, /24 h/);
  assert.match(last.body, /piloto/);
});

test('bot: "buscar" → pasos de búsqueda', async () => {
  await webhookText('595981000001', 'Quiero buscar otro profesional');
  const conv = await convByExternalId('595981000001');
  const last = await lastOutMessage(conv.id);
  assert.match(last.body, /buscar/i);
});

test('bot: reprogramar pide el número y deriva a humano con contexto', async () => {
  await webhookText('595981000002', 'Hola');
  await webhookText('595981000002', 'reprogramar');
  let conv = await convByExternalId('595981000002');
  let last = await lastOutMessage(conv.id);
  assert.match(last.body, /número de tu reserva/);

  await webhookText('595981000002', 'La #1387 porfa');
  conv = await convByExternalId('595981000002');
  assert.equal(conv.status, 'human');
  last = await lastOutMessage(conv.id);
  assert.match(last.body, /#1387/);
  assert.match(last.body, /asesor/);
  // El agente recibió la notificación in-app con el contexto.
  const notifs = await queryAll(ctx.db,
    "SELECT * FROM notifications WHERE user_id = ? AND type = 'support' ORDER BY id DESC LIMIT 1",
    [agent.user.id]);
  assert.ok(notifs.length > 0, 'el agente no recibió notificación');
  assert.match(notifs[0].body, /#1387/);
});

test('bot: 2 "no te entendí" seguidos → handoff automático', async () => {
  await webhookText('595981000003', 'Hola');
  await webhookText('595981000003', 'blablabla sin sentido');
  let conv = await convByExternalId('595981000003');
  assert.equal(conv.status, 'bot');
  let last = await lastOutMessage(conv.id);
  assert.match(last.body, /no te entendí/);

  await webhookText('595981000003', 'zzz más ruido');
  conv = await convByExternalId('595981000003');
  assert.equal(conv.status, 'human');
  last = await lastOutMessage(conv.id);
  assert.match(last.body, /Te paso con un asesor/);
});

test('conversación en human: el mensaje entrante queda para agentes, el bot no responde', async () => {
  const before = await queryAll(ctx.db,
    `SELECT * FROM support_messages WHERE conversation_id = (SELECT id FROM support_conversations WHERE external_id = '595981000003')`);
  await webhookText('595981000003', 'sigo acá');
  const afterMsgs = await queryAll(ctx.db,
    `SELECT * FROM support_messages WHERE conversation_id = (SELECT id FROM support_conversations WHERE external_id = '595981000003') ORDER BY id ASC`);
  assert.equal(afterMsgs.length, before.length + 1);
  assert.equal(afterMsgs[afterMsgs.length - 1].direction, 'in');
});

// ---------- bandeja ----------

test('bandeja: lista con último mensaje y contadores, filtro por status', async () => {
  const all = await inbox();
  assert.ok(all.length >= 3);
  const c = all.find((x) => x.external_id === '595981000001');
  assert.ok(c.last_message, 'falta el último mensaje');
  assert.ok(c.total_messages >= 2);
  assert.ok(c.incoming_messages >= 1);
  const humans = await inbox('human');
  assert.ok(humans.every((x) => x.status === 'human'));
  assert.ok(humans.length >= 2);
});

test('bandeja: historial de mensajes ordenado', async () => {
  const convs = await inbox();
  const c = convs.find((x) => x.external_id === '595981000001');
  const { status, json } = await ctx.api('GET', `/api/support/conversations/${c.id}/messages`, { token: agent["token"] });
  assert.equal(status, 200);
  assert.ok(json.messages.length >= 2);
  assert.ok(json.messages[0].id < json.messages[json.messages.length - 1].id);
});

test('bandeja: reply del agente envía como humano y pasa a human', async () => {
  const convs = await inbox('bot');
  const c = convs.find((x) => x.external_id === '595981000001');
  const { status, json } = await ctx.api('POST', `/api/support/conversations/${c.id}/reply`, {
    token: agent["token"], body: { body: 'Hola, soy del equipo de Oppi 👋' },
  });
  assert.equal(status, 201);
  assert.equal(json.message.sender, 'human');
  assert.equal(json.message.direction, 'out');
  const conv = await convByExternalId('595981000001');
  assert.equal(conv.status, 'human');
});

test('bandeja: resolve → resolved; mensaje nuevo reabre en bot', async () => {
  const convs = await inbox();
  const c = convs.find((x) => x.external_id === '595981000001');
  const r = await ctx.api('POST', `/api/support/conversations/${c.id}/resolve`, { token: agent["token"] });
  assert.equal(r.status, 200);
  assert.equal(r.json.conversation.status, 'resolved');

  await webhookText('595981000001', 'volví, tengo otra duda');
  const conv = await convByExternalId('595981000001');
  assert.equal(conv.status, 'bot');
});

test('bandeja: devolver al bot reenvía el menú', async () => {
  const convs = await inbox();
  const c = convs.find((x) => x.external_id === '595981000002');
  const r = await ctx.api('POST', `/api/support/conversations/${c.id}/bot`, { token: agent["token"] });
  assert.equal(r.status, 200);
  assert.equal(r.json.conversation.status, 'bot');
  const conv = await convByExternalId('595981000002');
  const last = await lastOutMessage(conv.id);
  assert.match(last.body, /¿Cómo te podemos ayudar\?/);
});

test('bandeja: handoff manual pausa el bot y notifica agentes', async () => {
  const convs = await inbox();
  const c = convs.find((x) => x.external_id === '595981000002');
  const r = await ctx.api('POST', `/api/support/conversations/${c.id}/handoff`, { token: agent["token"] });
  assert.equal(r.status, 200);
  assert.equal(r.json.conversation.status, 'human');
});

// ---------- no-show desde el bot (Oppi Empresas) ----------

test('bot empresas: "Reportar un no-show" pide número y crea el reporte', async () => {
  const { api, register, makePro, db } = ctx;
  const { token: proToken, user: proUser, service } = await makePro();
  const client = await register();
  // Turno ayer, reserva confirmada con seña retenida (mock).
  const s = slotAt(-26);
  const sl = await api('POST', '/api/slots', {
    token: proToken, body: { professional_id: service.professional_id, ...s },
  });
  assert.equal(sl.status, 201);
  const b = await api('POST', '/api/bookings', {
    token: client["token"], body: { service_id: service.id, slot_id: sl.json.slot.id },
  });
  assert.equal(b.status, 201);
  const c = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
    token: proToken, body: { status: 'confirmed' },
  });
  assert.equal(c.status, 200);
  const bookingId = b.json.booking.id;

  // Conversación de WhatsApp vinculada al profesional, kind business.
  const waId = '595981222333';
  const { run: runDb } = require('../src/db');
  await runDb(db,
    `INSERT INTO support_conversations (external_id, user_id, kind, status, channel)
     VALUES (?, ?, 'business', 'bot', 'whatsapp')`, [waId, proUser.id]);

  await webhookText(waId, 'Hola');
  let conv = await convByExternalId(waId);
  let last = await lastOutMessage(conv.id);
  assert.match(last.body, /Oppi Empresas/);

  await webhookText(waId, 'Reportar un no-show');
  conv = await convByExternalId(waId);
  last = await lastOutMessage(conv.id);
  assert.match(last.body, /número de la reserva/);

  await webhookText(waId, `La reserva #${bookingId}, no vino el cliente`);
  conv = await convByExternalId(waId);
  last = await lastOutMessage(conv.id);
  assert.match(last.body, /Marqué el no-show/);
  assert.match(last.body, new RegExp(`#${bookingId}`));

  const booking = await queryOne(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(booking.status, 'no_show_client');
});

test('bot empresas: no-show con número inválido no rompe nada', async () => {
  const waId = '595981222333';
  // La conversación quedó en 'human' por el handoff del test anterior: la devolvemos al bot.
  const convs = await inbox();
  const c = convs.find((x) => x.external_id === waId);
  const back = await ctx.api('POST', `/api/support/conversations/${c.id}/bot`, { token: agent["token"] });
  assert.equal(back.status, 200);
  await webhookText(waId, 'Reportar un no-show');
  await webhookText(waId, 'La reserva #999999');
  const conv = await convByExternalId(waId);
  const last = await lastOutMessage(conv.id);
  assert.match(last.body, /No pude marcar el no-show/);
});
