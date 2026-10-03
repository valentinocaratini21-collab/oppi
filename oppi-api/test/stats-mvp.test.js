'use strict';

/**
 * Estadísticas MVP por rol (2026-10).
 * - Tracking de visitas: POST /api/professionals/:id/view y
 *   POST /api/businesses/:id/view — 1 por día por visitante.
 * - GET /api/pro/stats y GET /api/businesses/:id/stats agregan:
 *   conversion_pct, response_time_median, top_staff (solo negocio),
 *   recurrent_pct.
 * - GET /api/me/summary: resumen del cliente.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { run, queryOne, queryAll } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

const pad = (n) => String(n).padStart(2, '0');
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function hoursAgo(h) { return stamp(new Date(Date.now() - h * 3600000)); }
function daysAgo(d) { return hoursAgo(d * 24); }

async function businessFixture(name = 'Salón Stats') {
  const { api, register } = ctx;
  const owner = await register({ role: 'business' });
  const r = await api('POST', '/api/businesses', {
    token: owner.token,
    body: {
      name, ruc: '80022222-2', categories: ['peluquería'],
      barrio: 'Villa Morra', address: 'Avda. Stats 456',
      services: [{ name: 'Corte', price_gs: 100000 }, { name: 'Color', price_gs: 200000 }],
      schedule: [{ day: 'lun-vie', open: '09:00', close: '18:00' }],
    },
  });
  assert.equal(r.status, 201);
  return { api, register, owner, business: r.json.business, services: r.json.services };
}

async function addBooking(db, { clientId, serviceId, status = 'completed', totalGs = 100000, createdAt = null }) {
  const r = await run(db,
    `INSERT INTO bookings (client_id, service_id, status, paid_gs, paid, total_gs, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [clientId, serviceId, status, totalGs, 1, totalGs, createdAt || stamp(new Date())]);
  return r.id;
}

async function addView(db, { profileType, profileId, visitorKey, when = null }) {
  const at = when || stamp(new Date());
  await run(db,
    `INSERT INTO profile_views (profile_type, profile_id, visitor_key, viewed_at, day)
     VALUES (?,?,?,?,?)`,
    [profileType, profileId, visitorKey, at, at.slice(0, 10)]);
}

async function addConversation(db, participantIds) {
  const r = await run(db, 'INSERT INTO conversations (participants) VALUES (?)',
    [JSON.stringify(participantIds)]);
  return r.id;
}

async function addMessage(db, { conversationId, senderId, text = 'hola', when = null }) {
  const at = when || stamp(new Date());
  await run(db,
    'INSERT INTO messages (conversation_id, sender_id, text, created_at) VALUES (?,?,?,?)',
    [conversationId, senderId, text, at]);
}

// ---------- tracking de visitas ----------

test('vistas: 1 por día por visitante (refresh no infla)', async () => {
  const { api, makePro } = ctx;
  const { professional } = await makePro();
  const v1 = await api('POST', `/api/professionals/${professional.id}/view`);
  assert.equal(v1.status, 200);
  assert.equal(v1.json.counted, true);
  const v2 = await api('POST', `/api/professionals/${professional.id}/view`);
  assert.equal(v2.status, 200);
  assert.equal(v2.json.counted, false); // mismo día, misma IP: no cuenta
  const n = await queryOne(ctx.db,
    'SELECT COUNT(*) AS c FROM profile_views WHERE profile_type = ? AND profile_id = ?',
    ['professional', professional.id]);
  assert.equal(n.c, 1);
});

test('vistas: con sesión usa user_id (distinto de la IP anónima)', async () => {
  const { api, register, makePro } = ctx;
  const { professional } = await makePro();
  const u1 = await register();
  const u2 = await register();
  const a = await api('POST', `/api/professionals/${professional.id}/view`, { token: u1.token });
  assert.equal(a.json.counted, true);
  const b = await api('POST', `/api/professionals/${professional.id}/view`, { token: u2.token });
  assert.equal(b.json.counted, true); // otro usuario: cuenta
  const c = await api('POST', `/api/professionals/${professional.id}/view`, { token: u1.token });
  assert.equal(c.json.counted, false); // el mismo usuario hoy: no cuenta
});

test('vistas: perfil inexistente → 404', async () => {
  const { api } = ctx;
  const r = await api('POST', '/api/professionals/999999/view');
  assert.equal(r.status, 404);
  const b = await api('POST', '/api/businesses/999999/view');
  assert.equal(b.status, 404);
});

test('vistas: endpoint de negocios cuenta igual', async () => {
  const { api } = await businessFixture('Salón Vistas');
  const { business } = await businessFixture('Salón Vistas 2');
  const v1 = await api('POST', `/api/businesses/${business.id}/view`);
  assert.equal(v1.json.counted, true);
  const v2 = await api('POST', `/api/businesses/${business.id}/view`);
  assert.equal(v2.json.counted, false);
});

// ---------- conversion_pct ----------

test('stats: conversion_pct = reservas / visitas del período', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, professional, service } = await makePro();
  const client = await register();
  // 4 visitas hoy (distintos visitantes) + 1 vieja (fuera del período).
  await addView(ctx.db, { profileType: 'professional', profileId: professional.id, visitorKey: 'ip:1.1.1.1' });
  await addView(ctx.db, { profileType: 'professional', profileId: professional.id, visitorKey: 'ip:2.2.2.2' });
  await addView(ctx.db, { profileType: 'professional', profileId: professional.id, visitorKey: 'ip:3.3.3.3' });
  await addView(ctx.db, { profileType: 'professional', profileId: professional.id, visitorKey: 'ip:4.4.4.4' });
  await addView(ctx.db, { profileType: 'professional', profileId: professional.id, visitorKey: 'ip:9.9.9.9', when: daysAgo(40) });
  // 2 reservas en el período.
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: service.id });
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: service.id });

  const r = await api('GET', '/api/pro/stats', { token: proToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.visitas_perfil, 4);
  assert.equal(r.json.reservas_count, 2);
  assert.equal(r.json.conversion_pct, 50); // 2/4
  assert.equal(r.json.conversion, 50);
});

test('stats: conversion_pct null si no hay visitas (no se inventa)', async () => {
  const { api, makePro } = ctx;
  const { token: proToken } = await makePro();
  const r = await api('GET', '/api/pro/stats', { token: proToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.visitas_perfil, 0);
  assert.equal(r.json.conversion_pct, null);
  assert.equal(r.json.conversion, null);
});

// ---------- response_time_median ----------

test('stats: response_time_median — mediana entre 1er mensaje del cliente y 1ra respuesta', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, professional, user: proUser } = await makePro();
  const c1 = await register();
  const c2 = await register();
  const c3 = await register();
  const base = Date.now();
  const at = (mins) => stamp(new Date(base - 120 * 60000 + mins * 60000));

  // Conv 1: cliente pregunta, el pro responde a los 10 min.
  const conv1 = await addConversation(ctx.db, [proUser.id, c1.user.id]);
  await addMessage(ctx.db, { conversationId: conv1, senderId: c1.user.id, when: at(0) });
  await addMessage(ctx.db, { conversationId: conv1, senderId: proUser.id, when: at(10) });
  // Conv 2: 30 min.
  const conv2 = await addConversation(ctx.db, [proUser.id, c2.user.id]);
  await addMessage(ctx.db, { conversationId: conv2, senderId: c2.user.id, when: at(0) });
  await addMessage(ctx.db, { conversationId: conv2, senderId: proUser.id, when: at(30) });
  // Conv 3: el pro escribió primero → se ignora (no es consulta entrante).
  const conv3 = await addConversation(ctx.db, [proUser.id, c3.user.id]);
  await addMessage(ctx.db, { conversationId: conv3, senderId: proUser.id, when: at(0) });
  await addMessage(ctx.db, { conversationId: conv3, senderId: c3.user.id, when: at(5) });
  // Conv 4: cliente preguntó, sin respuesta → se ignora.
  const conv4 = await addConversation(ctx.db, [proUser.id, c3.user.id]);
  await addMessage(ctx.db, { conversationId: conv4, senderId: c3.user.id, when: at(0) });
  void professional;

  const r = await api('GET', '/api/pro/stats', { token: proToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.response_time_median, 20); // mediana de [10, 30]
});

test('stats: response_time_median null sin conversaciones', async () => {
  const { api, makePro } = ctx;
  const { token: proToken } = await makePro();
  const r = await api('GET', '/api/pro/stats', { token: proToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.response_time_median, null);
});

// ---------- top_staff (solo negocio) ----------

test('stats negocio: top_staff = colaborador con más completadas del período', async () => {
  const { api, register, owner, business, services } = await businessFixture('Salón Staff');
  const corte = services.find((s) => s.name === 'Corte');
  const color = services.find((s) => s.name === 'Color');
  // Equipo: Ana hace Cortes, Beto hace Color.
  const ana = await run(ctx.db,
    `INSERT INTO team_members (business_id, user_id, name, role, permiso, services) VALUES (?,?,?,?,?,?)`,
    [business.id, null, 'Ana', 'Estilista', 'lectura', JSON.stringify([corte.id])]);
  const beto = await run(ctx.db,
    `INSERT INTO team_members (business_id, user_id, name, role, permiso, services) VALUES (?,?,?,?,?,?)`,
    [business.id, null, 'Beto', 'Colorista', 'lectura', JSON.stringify([color.id])]);
  const client = await register();
  // Ana: 3 cortes completados; Beto: 1 color.
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: corte.id });
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: corte.id });
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: corte.id });
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: color.id });
  // Fuera del período: no cuenta.
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: color.id, createdAt: daysAgo(40) });

  const r = await api('GET', `/api/businesses/${business.id}/stats`, { token: owner.token });
  assert.equal(r.status, 200);
  assert.ok(r.json.top_staff, 'tiene que haber top_staff');
  assert.equal(r.json.top_staff.id, ana.id);
  assert.equal(r.json.top_staff.name, 'Ana');
  assert.equal(r.json.top_staff.reservas_completadas, 3);
  void beto;
});

test('stats negocio: top_staff null sin equipo o sin completadas', async () => {
  const { api, owner, business } = await businessFixture('Salón Sin Staff');
  const r = await api('GET', `/api/businesses/${business.id}/stats`, { token: owner.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.top_staff, null);
});

test('stats pro: top_staff siempre null (solo negocios)', async () => {
  const { api, makePro } = ctx;
  const { token: proToken } = await makePro();
  const r = await api('GET', '/api/pro/stats', { token: proToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.top_staff, null);
});

// ---------- recurrent_pct ----------

test('stats: recurrent_pct — clientes con más de 1 completada', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, service } = await makePro();
  const c1 = await register(); // 2 completadas → recurrente
  const c2 = await register(); // 1 completada
  const c3 = await register(); // 1 pendiente (no cuenta como cliente con completada)
  await addBooking(ctx.db, { clientId: c1.user.id, serviceId: service.id });
  await addBooking(ctx.db, { clientId: c1.user.id, serviceId: service.id });
  await addBooking(ctx.db, { clientId: c2.user.id, serviceId: service.id });
  await addBooking(ctx.db, { clientId: c3.user.id, serviceId: service.id, status: 'pending' });

  const r = await api('GET', '/api/pro/stats', { token: proToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.recurrent_pct.count, 1);
  assert.equal(r.json.recurrent_pct.pct, 50); // 1 de 2 clientes con completadas
});

// ---------- me/summary ----------

test('me/summary: completadas, gastado, puntos y link a cumplimiento', async () => {
  const { api, register, makePro } = ctx;
  const { service } = await makePro();
  const client = await register();
  // 2 completadas (100000 + 50000) + 1 cancelada (no cuenta).
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: service.id, totalGs: 100000 });
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: service.id, totalGs: 50000 });
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: service.id, totalGs: 99999, status: 'cancelled' });
  // Oppi Points ganados.
  await run(ctx.db,
    'INSERT INTO points_ledger (user_id, amount_gs, reason) VALUES (?,?,?)',
    [client.user.id, 15000, 'no_show_pro']);

  const r = await api('GET', '/api/me/summary', { token: client.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.reservas_completadas, 2);
  assert.equal(r.json.total_gastado_gs, 150000);
  assert.equal(r.json.oppi_points, 15000);
  assert.equal(r.json.cumplimiento_url, '/mi-cumplimiento');
});

test('me/summary: sin token → 401; cliente nuevo → ceros', async () => {
  const { api, register } = ctx;
  const anon = await api('GET', '/api/me/summary');
  assert.equal(anon.status, 401);
  const fresh = await register();
  const r = await api('GET', '/api/me/summary', { token: fresh.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.reservas_completadas, 0);
  assert.equal(r.json.total_gastado_gs, 0);
  assert.equal(r.json.oppi_points, 0);
});

// ---------- negocio: métricas nuevas integradas ----------

test('stats negocio: conversion_pct usa las visitas del negocio', async () => {
  const { api, register, owner, business, services } = await businessFixture('Salón Conversión');
  const corte = services.find((s) => s.name === 'Corte');
  const client = await register();
  await addView(ctx.db, { profileType: 'business', profileId: business.id, visitorKey: 'ip:5.5.5.5' });
  await addView(ctx.db, { profileType: 'business', profileId: business.id, visitorKey: 'ip:6.6.6.6' });
  await addBooking(ctx.db, { clientId: client.user.id, serviceId: corte.id });

  const r = await api('GET', `/api/businesses/${business.id}/stats`, { token: owner.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.visitas_perfil, 2);
  assert.equal(r.json.conversion_pct, 50);
  assert.ok(r.json.recurrent_pct);
  assert.ok('response_time_median' in r.json);
});
