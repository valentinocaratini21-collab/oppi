'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('reservas: crear no calcula seña; el cobro del 100% es al confirmar', async () => {
  const { api, register, makePro } = ctx;
  const { service } = await makePro();
  const client = await register();
  const r = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  assert.equal(r.status, 201);
  assert.equal(r.json.booking.status, 'pending');
  assert.equal(r.json.booking.total_gs, 100000);
  assert.equal(r.json.booking.paid_gs, 0);
  assert.equal(r.json.booking.paid, false);
});

test('reservas: aplica crédito del usuario (no más que el total)', async () => {
  const { api, register, makePro, db } = ctx;
  const { service } = await makePro();
  const client = await register();
  const { run } = require('../src/db');
  await run(db, 'UPDATE users SET credit_gs = 50000 WHERE id = ?', [client.user.id]);

  const ok = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, apply_credit_gs: 20000 },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.booking.credit_applied_gs, 20000);
  const tooMuch = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, apply_credit_gs: 200000 },
  });
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.json.error, /más crédito que el total/);
});

test('reservas: con turno libre lo marca booked; segundo intento → 409', async () => {
  const { api, register, makePro } = ctx;
  const { service, slot } = await makePro();
  const c1 = await register();
  const c2 = await register();
  const b1 = await api('POST', '/api/bookings', { token: c1.token, body: { service_id: service.id, slot_id: slot.id } });
  assert.equal(b1.status, 201);
  const b2 = await api('POST', '/api/bookings', { token: c2.token, body: { service_id: service.id, slot_id: slot.id } });
  assert.equal(b2.status, 409);
});

test('reservas: la config vieja de seña del servicio se ignora (no bloquea la reserva)', async () => {
  const { api, register, makePro, db } = ctx;
  const { professional } = await makePro();
  const { run } = require('../src/db');
  // Inserto directo un servicio con seña fija mayor al precio (config vieja inválida)
  const bad = await run(db,
    'INSERT INTO services (professional_id, name, price_gs, deposit_type, deposit_value) VALUES (?,?,?,?,?)',
    [professional.id, 'Servicio roto', 100000, 'fixed', 999999]);
  const client = await register();
  const r = await api('POST', '/api/bookings', { token: client.token, body: { service_id: bad.id } });
  assert.equal(r.status, 201);
  assert.equal(r.json.booking.paid, false);
});

test('reservas: solo el profesional confirma; el cliente no puede → 403', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, service } = await makePro();
  const client = await register();
  const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  const id = b.json.booking.id;

  const clientTries = await api('PATCH', `/api/bookings/${id}`, { token: client.token, body: { status: 'confirmed' } });
  assert.equal(clientTries.status, 403);

  const ok = await api('PATCH', `/api/bookings/${id}`, { token: proToken, body: { status: 'confirmed' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.booking.status, 'confirmed');
  assert.equal(ok.json.booking.paid, true);
  assert.equal(ok.json.booking.paid_gs, 100000);
});

test('reservas: cancelar la puede el cliente o el profesional; un tercero no → 403', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, service } = await makePro();
  const client = await register();
  const outsider = await register();

  const b1 = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  const no = await api('PATCH', `/api/bookings/${b1.json.booking.id}`, { token: outsider.token, body: { status: 'cancelled' } });
  assert.equal(no.status, 403);
  const yes = await api('PATCH', `/api/bookings/${b1.json.booking.id}`, { token: client.token, body: { status: 'cancelled' } });
  assert.equal(yes.status, 200);
  assert.equal(yes.json.booking.status, 'cancelled');

  const b2 = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  const proCancels = await api('PATCH', `/api/bookings/${b2.json.booking.id}`, { token: proToken, body: { status: 'cancelled' } });
  assert.equal(proCancels.status, 200);
});

test('reservas: completar solo el profesional y desde confirmed', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, service } = await makePro();
  const client = await register();
  const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  const id = b.json.booking.id;
  const early = await api('PATCH', `/api/bookings/${id}`, { token: proToken, body: { status: 'completed' } });
  assert.equal(early.status, 400);
  await api('PATCH', `/api/bookings/${id}`, { token: proToken, body: { status: 'confirmed' } });
  const done = await api('PATCH', `/api/bookings/${id}`, { token: proToken, body: { status: 'completed' } });
  assert.equal(done.status, 200);
  assert.equal(done.json.booking.status, 'completed');
});
