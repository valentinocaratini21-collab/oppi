'use strict';

/**
 * Push end-to-end (driver mock): registrar token → encolar notificación →
 * drenar pendientes con POST /api/notifications/send-due.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('push e2e: registrar token → encolar → drenar marca push_sent', async () => {
  const { api, register, db } = ctx;
  const { queryOne } = require('../src/db');
  const { NotificationService, getPushDriver } = require('../src/lib/notifications');

  const u = await register();
  const reg = await api('POST', '/api/push-tokens', {
    token: u.token, body: { token: 'e2e-token-1', platform: 'android' },
  });
  assert.equal(reg.status, 201);
  // Re-registrar el mismo token: idempotente
  const reg2 = await api('POST', '/api/push-tokens', {
    token: u.token, body: { token: 'e2e-token-1', platform: 'android' },
  });
  assert.equal(reg2.status, 201);
  const tokens = await require('../src/db').queryAll(db,
    'SELECT * FROM push_tokens WHERE user_id = ?', [u.user.id]);
  assert.equal(tokens.length, 1);

  const svc = new NotificationService(db);
  const n = await svc.enqueue({
    userId: u.user.id, type: 'reminder', title: '⏰ Tu turno es mañana',
    body: 'Te esperamos a las 10:00', scheduledFor: '2020-01-01T10:00:00',
  });

  const driver = getPushDriver();
  const sentBefore = driver.sent.length;
  const send = await api('POST', '/api/notifications/send-due', { token: u.token });
  assert.equal(send.status, 200);
  assert.equal(send.json.sent, 1);
  assert.equal(send.json.failed, 0);
  assert.equal(driver.sent.length, sentBefore + 1);
  const last = driver.sent[driver.sent.length - 1];
  assert.equal(last.token, 'e2e-token-1');
  assert.equal(last.title, '⏰ Tu turno es mañana');

  const row = await queryOne(db, 'SELECT push_sent FROM notifications WHERE id = ?', [n.id]);
  assert.equal(row.push_sent, 1);

  // Segunda pasada: no reenvía lo ya enviado
  const send2 = await api('POST', '/api/notifications/send-due', { token: u.token });
  assert.equal(send2.json.sent, 0);
  assert.equal(driver.sent.length, sentBefore + 1);
});

test('push e2e: varios tokens del mismo usuario → 1 push por notificación', async () => {
  const { api, register, db } = ctx;
  const { NotificationService, getPushDriver } = require('../src/lib/notifications');

  const u = await register();
  await api('POST', '/api/push-tokens', { token: u.token, body: { token: 'multi-a', platform: 'android' } });
  await api('POST', '/api/push-tokens', { token: u.token, body: { token: 'multi-b', platform: 'ios' } });

  const svc = new NotificationService(db);
  await svc.enqueue({
    userId: u.user.id, type: 'booking', title: 'Reserva confirmada',
    body: 'Nos vemos pronto', scheduledFor: '2020-01-01T10:00:00',
  });

  const driver = getPushDriver();
  const sentBefore = driver.sent.length;
  const send = await api('POST', '/api/notifications/send-due', { token: u.token });
  assert.equal(send.json.sent, 1, 'una notificación = un push aunque haya 2 tokens');
  assert.equal(driver.sent.length, sentBefore + 1);
});

test('push e2e: sin token registrado → se marca enviada sin push', async () => {
  const { api, register, db } = ctx;
  const { queryOne } = require('../src/db');
  const { NotificationService, getPushDriver } = require('../src/lib/notifications');

  const u = await register(); // sin push-tokens
  const svc = new NotificationService(db);
  const n = await svc.enqueue({
    userId: u.user.id, type: 'offer', title: 'Nueva oferta',
    body: 'Alguien ofertó en tu tarea', scheduledFor: '2020-01-01T10:00:00',
  });

  const driver = getPushDriver();
  const sentBefore = driver.sent.length;
  const send = await api('POST', '/api/notifications/send-due', { token: u.token });
  assert.equal(send.json.sent, 0, 'sin token no hay push que enviar');
  assert.equal(driver.sent.length, sentBefore, 'el driver no recibió nada');
  const row = await queryOne(db, 'SELECT push_sent FROM notifications WHERE id = ?', [n.id]);
  assert.equal(row.push_sent, 1, 'igual se marca para no reintentarla eternamente');
});

test('push e2e: dar de baja un token', async () => {
  const { api, register, db } = ctx;
  const { queryAll } = require('../src/db');
  const u = await register();
  await api('POST', '/api/push-tokens', { token: u.token, body: { token: 'bye-token', platform: 'web' } });
  const del = await api('DELETE', '/api/push-tokens', { token: u.token, body: { token: 'bye-token' } });
  assert.equal(del.status, 200);
  const rows = await queryAll(db, 'SELECT * FROM push_tokens WHERE user_id = ?', [u.user.id]);
  assert.equal(rows.length, 0);
});
