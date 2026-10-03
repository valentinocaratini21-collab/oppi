'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('waitlist: anotarse y duplicado → 409', async () => {
  const { api, register, makePro } = ctx;
  const { professional, service } = await makePro();
  const client = await register();
  const add = await api('POST', '/api/waitlist', {
    token: client.token,
    body: { professional_id: professional.id, service_id: service.id, slot_desc: 'sábado a la mañana' },
  });
  assert.equal(add.status, 201);
  const dup = await api('POST', '/api/waitlist', {
    token: client.token,
    body: { professional_id: professional.id, service_id: service.id, slot_desc: 'sábado a la mañana' },
  });
  assert.equal(dup.status, 409);
  assert.match(dup.json.error, /lista de espera/);
  // Otro slot_desc sí se puede
  const other = await api('POST', '/api/waitlist', {
    token: client.token, body: { professional_id: professional.id, slot_desc: 'viernes a la tarde' },
  });
  assert.equal(other.status, 201);
  const list = await api('GET', '/api/waitlist', { token: client.token });
  assert.equal(list.json.waitlist.length, 2);
});

test('referidos: código inexistente → 400', async () => {
  const { api, register } = ctx;
  const u = await register();
  const r = await api('POST', '/api/referrals/redeem', { token: u.token, body: { code: 'OPPI-NOEXISTE' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /no existe/);
});

test('referidos: auto-canje → 400', async () => {
  const { api, register } = ctx;
  const u = await register();
  const r = await api('POST', '/api/referrals/redeem', { token: u.token, body: { code: u.user.referral_code } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /propio código/);
});

test('referidos: canje feliz suma Gs. 20.000; doble canje → 400', async () => {
  const { api, register } = ctx;
  const owner = await register();
  const guest = await register();
  const ok = await api('POST', '/api/referrals/redeem', {
    token: guest.token, body: { code: owner.user.referral_code },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.bonus_gs, 20000);
  assert.equal(ok.json.credit_gs, 20000);

  const me = await api('GET', '/api/me', { token: guest.token });
  assert.equal(me.json.user.credit_gs, 20000);

  const twice = await api('POST', '/api/referrals/redeem', {
    token: guest.token, body: { code: owner.user.referral_code },
  });
  assert.equal(twice.status, 400);
  assert.match(twice.json.error, /Ya usaste/);
});

test('notificaciones: generate-reminders crea recordatorio (sin duplicar)', async () => {
  const { api, register, makePro, db } = ctx;
  const { run, queryOne } = require('../src/db');
  const { token: proToken, professional, service } = await makePro();
  const client = await register();
  // Turno mañana a las 10:00 (dentro de 48h)
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  await run(db, 'INSERT INTO slots (professional_id, date, time) VALUES (?,?,?)', [professional.id, tomorrow, '10:00']);
  const slot = await queryOne(db, 'SELECT * FROM slots WHERE professional_id = ? AND date = ?', [professional.id, tomorrow]);
  const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id, slot_id: slot.id } });
  await api('PATCH', `/api/bookings/${b.json.booking.id}`, { token: proToken, body: { status: 'confirmed' } });

  const gen1 = await api('POST', '/api/notifications/generate-reminders', { token: client.token });
  assert.equal(gen1.status, 200);
  assert.equal(gen1.json.created, 1);

  const gen2 = await api('POST', '/api/notifications/generate-reminders', { token: client.token });
  assert.equal(gen2.json.created, 0); // no duplica

  const notifs = await api('GET', '/api/notifications', { token: client.token });
  assert.ok(notifs.json.notifications.some((n) => n.type === 'reminder'));

  const unread = await api('GET', '/api/notifications', { token: client.token, query: { unread: 1 } });
  assert.ok(unread.json.notifications.length >= 1);
  const mark = await api('PATCH', `/api/notifications/${unread.json.notifications[0].id}`, {
    token: client.token, body: { read: true },
  });
  assert.equal(mark.json.notification.read, true);
});

test('config: expone comisión del 15% y textos de "Cómo ganamos"', async () => {
  const { api } = ctx;
  const r = await api('GET', '/api/config'); // público
  assert.equal(r.status, 200);
  assert.equal(r.json.commission_percent, 15);
  assert.ok(r.json.texts.how_we_earn.length >= 1);
  assert.match(r.json.texts.how_we_earn.join(' '), /15%/);
});

test('health: /api/health responde ok', async () => {
  const { api } = ctx;
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});
