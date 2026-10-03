'use strict';

// notification-prefs: pieza "lista para lanzar" 5.
// - GET sin fila → todo true (defaults).
// - PATCH guarda las preferencias (parcial, valida booleanos).
// - El encolado (NotificationService.enqueue) respeta lo apagado:
//   con promos off, una promo (tipo referral) no se encola.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryAll } = require('../src/db');
const { NotificationService } = require('../src/lib/notifications');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('prefs: GET sin fila guardada → todo true', async () => {
  const { api, register } = ctx;
  const { token } = await register();
  const r = await api('GET', '/api/me/notification-prefs', { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { reminders: true, offers: true, messages: true, promos: true });
});

test('prefs: PATCH guarda parcial y responde el estado completo', async () => {
  const { api, register } = ctx;
  const { token } = await register();
  const r = await api('PATCH', '/api/me/notification-prefs', { token, body: { promos: false } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { reminders: true, offers: true, messages: true, promos: false });
  const g = await api('GET', '/api/me/notification-prefs', { token });
  assert.deepEqual(g.json, { reminders: true, offers: true, messages: true, promos: false });
  // Segundo PATCH solo toca lo enviado; lo demás queda.
  const r2 = await api('PATCH', '/api/me/notification-prefs', { token, body: { reminders: false, offers: false } });
  assert.deepEqual(r2.json, { reminders: false, offers: false, messages: true, promos: false });
});

test('prefs: PATCH con valor no booleano o vacío → 400', async () => {
  const { api, register } = ctx;
  const { token } = await register();
  const r = await api('PATCH', '/api/me/notification-prefs', { token, body: { promos: 'no' } });
  assert.equal(r.status, 400);
  const vacio = await api('PATCH', '/api/me/notification-prefs', { token, body: {} });
  assert.equal(vacio.status, 400);
});

test('prefs: con promos off NO se encola una promo (referral); con on sí', async () => {
  const { api, register } = ctx;
  const { token, user } = await register();
  const off = await api('PATCH', '/api/me/notification-prefs', { token, body: { promos: false } });
  assert.equal(off.json.promos, false);

  const svc = new NotificationService(ctx.db);
  const nada = await svc.enqueue({ userId: user.id, type: 'referral', title: 'Ganaste crédito' });
  assert.equal(nada, null, 'con promos off, referral no se debería encolar');
  let rows = await queryAll(ctx.db, 'SELECT id FROM notifications WHERE user_id = ? AND type = ?', [user.id, 'referral']);
  assert.equal(rows.length, 0);

  // Otros tipos sí se encolan aunque promos esté off (no son promos).
  const reminder = await svc.enqueue({ userId: user.id, type: 'reminder', title: 'Tu turno es mañana' });
  assert.ok(reminder && reminder.id, 'reminder sí se debería encolar');

  // Al prender promos de nuevo, la promo sí se encola.
  await api('PATCH', '/api/me/notification-prefs', { token, body: { promos: true } });
  const promo = await svc.enqueue({ userId: user.id, type: 'referral', title: 'Ganaste crédito' });
  assert.ok(promo && promo.id, 'con promos on, referral sí se debería encolar');
  rows = await queryAll(ctx.db, 'SELECT id FROM notifications WHERE user_id = ? AND type = ?', [user.id, 'referral']);
  assert.equal(rows.length, 1);
});
