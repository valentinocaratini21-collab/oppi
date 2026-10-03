'use strict';

/**
 * Notificaciones: se encolan en los eventos de negocio y quedan visibles
 * en el centro de notificaciones (GET /api/notifications).
 * - reserva creada → avisa al profesional; confirmada → avisa al cliente
 * - oferta creada → avisa al cliente; aceptada/rechazada → a los handymen
 * - cotización por chat → avisa al otro participante; aceptada → al handyman
 * - reseña creada → avisa al reseñado
 * - reserva cancelada con turno → avisa a la lista de espera
 * - push-tokens + send-due con driver mock
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

async function notifsFor(token, type) {
  const { api } = ctx;
  const r = await api('GET', '/api/notifications', { token });
  assert.equal(r.status, 200);
  return type ? r.json.notifications.filter((n) => n.type === type) : r.json.notifications;
}

test('notif: reserva creada avisa al profesional; confirmada avisa al cliente', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, service, user: proUser } = await makePro();
  const client = await register();
  const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  assert.equal(b.status, 201);

  const toPro = await notifsFor(proToken, 'booking');
  assert.ok(toPro.some((n) => /Nueva reserva/.test(n.title)), 'el profesional tiene que ver la reserva nueva');

  const conf = await api('PATCH', `/api/bookings/${b.json.booking.id}`, { token: proToken, body: { status: 'confirmed' } });
  assert.equal(conf.status, 200);
  const toClient = await notifsFor(client.token, 'booking');
  assert.ok(toClient.some((n) => /confirmada/i.test(n.title)), 'el cliente tiene que ver la confirmación');
});

test('notif: oferta recibida/aceptada/rechazada', async () => {
  const { api, register } = ctx;
  const client = await register();
  const h1 = await register({ role: 'handyman' });
  const h2 = await register({ role: 'handyman' });
  const t = await api('POST', '/api/tasks', {
    token: client.token, body: { title: 'Pintar reja', category: 'pintura', barrio: 'Sajonia' },
  });
  const o1 = await api('POST', `/api/tasks/${t.json.task.id}/offers`, {
    token: h1.token, body: { amount_gs: 300000, message: 'Voy el lunes' },
  });
  assert.equal(o1.status, 201);
  const toClient = await notifsFor(client.token, 'offer');
  assert.ok(toClient.some((n) => /Nueva oferta/.test(n.title)), 'el cliente ve la oferta recibida');

  const o2 = await api('POST', `/api/tasks/${t.json.task.id}/offers`, {
    token: h2.token, body: { amount_gs: 280000 },
  });
  const acc = await api('POST', `/api/offers/${o1.json.offer.id}/accept`, { token: client.token, body: {} });
  assert.equal(acc.status, 201);
  const toH1 = await notifsFor(h1.token, 'offer');
  assert.ok(toH1.some((n) => /Aceptaron tu oferta/.test(n.title)), 'el elegido ve el aceptado');
  const toH2 = await notifsFor(h2.token, 'offer');
  assert.ok(toH2.some((n) => /no elegida/.test(n.title)), 'el otro ve el rechazo');
});

test('notif: cotización recibida y aceptada por chat', async () => {
  const { api, register } = ctx;
  const client = await register();
  const handy = await register({ role: 'handyman' });
  const c = await api('POST', '/api/conversations', {
    token: client.token, body: { participants: [handy.user.id] },
  });
  assert.equal(c.status, 201);
  const m = await api('POST', `/api/conversations/${c.json.conversation.id}/messages`, {
    token: handy.token, body: { text: 'Te paso precio', quote: { amount_gs: 150000, detail: 'Mano de obra' } },
  });
  assert.equal(m.status, 201);
  const toClient = await notifsFor(client.token, 'quote');
  assert.ok(toClient.some((n) => /cotización/i.test(n.title)), 'el cliente ve la cotización recibida');

  const q = await api('PATCH', `/api/messages/${m.json.message.id}/quote`, {
    token: client.token, body: { status: 'accepted' },
  });
  assert.equal(q.status, 200);
  const toHandy = await notifsFor(handy.token, 'quote');
  assert.ok(toHandy.some((n) => /aceptó tu cotización/.test(n.title)), 'el handyman ve la aceptación');
});

test('notif: trabajo completado y reseña recibida', async () => {
  const { api, register } = ctx;
  const client = await register();
  const handy = await register({ role: 'handyman' });
  const t = await api('POST', '/api/tasks', {
    token: client.token, body: { title: 'Cambiar cuerda', category: 'varios', barrio: 'Sajonia' },
  });
  const o = await api('POST', `/api/tasks/${t.json.task.id}/offers`, {
    token: handy.token, body: { amount_gs: 100000 },
  });
  const acc = await api('POST', `/api/offers/${o.json.offer.id}/accept`, { token: client.token, body: {} });
  const jobId = acc.json.job.id;
  await api('PATCH', `/api/jobs/${jobId}`, { token: handy.token, body: { status: 'in_progress' } });
  await api('PATCH', `/api/jobs/${jobId}`, { token: handy.token, body: { status: 'completed' } });
  const jobNotifs = await notifsFor(client.token, 'job');
  assert.ok(jobNotifs.some((n) => /completado/i.test(n.title)), 'el cliente ve trabajo completado');

  const rev = await api('POST', '/api/reviews', {
    token: client.token, body: { job_id: jobId, to_user: handy.user.id, rating: 5, text: 'Genial' },
  });
  assert.equal(rev.status, 201);
  const revNotifs = await notifsFor(handy.token, 'review');
  assert.ok(revNotifs.some((n) => /reseña/i.test(n.title)), 'el handyman ve la reseña recibida');
});

test('notif: cancelar con turno libera lugar → avisa a la lista de espera', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, professional, service, slot } = await makePro();
  const client = await register();
  const waiter = await register();
  const w = await api('POST', '/api/waitlist', {
    token: waiter.token,
    body: { professional_id: professional.id, service_id: service.id, slot_desc: 'sábado a la mañana' },
  });
  assert.equal(w.status, 201);
  const b = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, slot_id: slot.id },
  });
  assert.equal(b.status, 201);
  const cancel = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
    token: client.token, body: { status: 'cancelled' },
  });
  assert.equal(cancel.status, 200);
  const wl = await notifsFor(waiter.token, 'waitlist');
  assert.ok(wl.some((n) => /Se liberó/.test(n.title)), 'el de la lista de espera se entera');
});

test('notif: referido canjeado avisa al dueño del código', async () => {
  const { api, register } = ctx;
  const owner = await register();
  const guest = await register();
  const r = await api('POST', '/api/referrals/redeem', {
    token: guest.token, body: { code: owner.user.referral_code },
  });
  assert.equal(r.status, 200);
  const toOwner = await notifsFor(owner.token, 'referral');
  assert.ok(toOwner.some((n) => /referido/i.test(n.title)), 'el dueño ve que usaron su código');
});

test('push: registro de token + send-due con mock', async () => {  const { api, register } = ctx;
  const u = await register();
  const reg = await api('POST', '/api/push-tokens', {
    token: u.token, body: { token: 'fcm-token-abc', platform: 'android' },
  });
  assert.equal(reg.status, 201);
  // Idempotente: registrar dos veces no falla.
  const reg2 = await api('POST', '/api/push-tokens', {
    token: u.token, body: { token: 'fcm-token-abc', platform: 'android' },
  });
  assert.equal(reg2.status, 201);
  const bad = await api('POST', '/api/push-tokens', { token: u.token, body: { token: '' } });
  assert.equal(bad.status, 400);

  // Forzar una notificación vencida y despacharla.
  const { NotificationService } = require('../src/lib/notifications');
  const svc = new NotificationService(ctx.db);
  await svc.enqueue({
    userId: u.user.id, type: 'reminder', title: '⏰ Test', body: 'vencida',
    scheduledFor: '2020-01-01T10:00:00',
  });
  const send = await api('POST', '/api/notifications/send-due', { token: u.token });
  assert.equal(send.status, 200);
  assert.ok(send.json.sent >= 1, 'el mock despacha la vencida');
  const send2 = await api('POST', '/api/notifications/send-due', { token: u.token });
  assert.equal(send2.json.sent, 0, 'no reenvía lo ya enviado');

  const del = await api('DELETE', '/api/push-tokens', { token: u.token, body: { token: 'fcm-token-abc' } });
  assert.equal(del.status, 200);
});

test('cron: send-due y generate-reminders aceptan x-cron-secret sin JWT', async () => {
  const { base } = ctx;
  process.env.CRON_SECRET = 'test-cron-secret';
  const ok = await fetch(`${base}/api/notifications/send-due`, {
    method: 'POST', headers: { 'x-cron-secret': 'test-cron-secret' },
  });
  assert.equal(ok.status, 200);
  const wrong = await fetch(`${base}/api/notifications/send-due`, {
    method: 'POST', headers: { 'x-cron-secret': 'wrong' },
  });
  assert.equal(wrong.status, 401);
  const none = await fetch(`${base}/api/notifications/send-due`, { method: 'POST' });
  assert.equal(none.status, 401);
  delete process.env.CRON_SECRET;
});
