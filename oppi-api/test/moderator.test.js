'use strict';

/**
 * Tests del Moderador (equipo IA de Oppi):
 * - cada regla (insulto, URL, mayúsculas, duplicado, incoherencia, vacía)
 *   en POST /api/reviews
 * - "boludo" NO es insulto; un solo teléfono NO es spam
 * - el GET público no muestra retenidas
 * - flujo admin approve/reject de la cola de moderación
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryOne, queryAll } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { delete process.env.ADMIN_EMAIL; await ctx.close(); });

let adminCache = null;
async function adminFixture() {
  if (adminCache) return adminCache;
  const { register } = ctx;
  process.env.ADMIN_EMAIL = 'modadmin@oppi.test';
  try {
    const admin = await register({ name: 'Admin Mod', email: 'modadmin@oppi.test' });
    assert.equal(admin.user.is_admin, true);
    adminCache = admin;
    return admin;
  } finally {
    delete process.env.ADMIN_EMAIL;
  }
}

/** Contexto fresco: un pro, su cliente y una reserva lista para reseñar. */
async function reviewFixture() {
  const { api, register, makePro } = ctx;
  const { service, user: proUser } = await makePro();
  const client = await register();
  const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  assert.equal(b.status, 201);
  return { api, client, proUser, bookingId: b.json.booking.id };
}

// El fixture usa POST /api/bookings → el pro es el dueño del servicio.
async function postReviewTo(api, client, bookingId, proUser, rating, text) {
  return api('POST', '/api/reviews', {
    token: client.token,
    body: { booking_id: bookingId, to_user: proUser.id, rating, text },
  });
}

test('moderador: insulto → retenida, sin notificar al profesional', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 1, 'sos un pelotudo, no vuelvo más');
  assert.equal(r.status, 201);
  assert.equal(r.json.moderation.held, true);
  assert.match(r.json.moderation.message, /en revisión por el equipo de Oppi/);
  const notifs = await queryAll(ctx.db,
    "SELECT * FROM notifications WHERE user_id = ? AND type = 'review'", [proUser.id]);
  assert.equal(notifs.length, 0);
});

test('moderador: "boludo" NO es insulto → aprobada', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 5, 'genial boludo, excelente trabajo');
  assert.equal(r.status, 201);
  assert.equal(r.json.review.moderation_status, 'approved');
  assert.ok(!r.json.moderation);
});

test('moderador: URL → retenida', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 5, 'trabajo impecable, mirá https://promo.com');
  assert.equal(r.status, 201);
  assert.equal(r.json.moderation.held, true);
});

test('moderador: un solo teléfono paraguayo NO es spam → aprobada', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 5, 'muy buen trabajo, coordinamos todo por el 0981 234 567');
  assert.equal(r.status, 201);
  assert.equal(r.json.review.moderation_status, 'approved');
});

test('moderador: dos teléfonos → retenida', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 5, 'llamame al 0981 234 567 o al 0971 345 678');
  assert.equal(r.status, 201);
  assert.equal(r.json.moderation.held, true);
});

test('moderador: TODO EN MAYÚSCULAS → retenida', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 2, 'EL PEOR SERVICIO DE MI VIDA, NO RECOMIENDO');
  assert.equal(r.status, 201);
  assert.equal(r.json.moderation.held, true);
});

test('moderador: texto duplicado → retenida', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const first = await postReviewTo(api, client, bookingId, proUser, 5, 'Servicio muy bueno, recomendable');
  assert.equal(first.status, 201);
  assert.equal(first.json.review.moderation_status, 'approved');
  const dup = await postReviewTo(api, client, bookingId, proUser, 5, 'Servicio muy bueno, recomendable');
  assert.equal(dup.status, 201);
  assert.equal(dup.json.moderation.held, true);
});

test('moderador: rating bajo con texto muy positivo → retenida', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 1, 'Excelente trabajo, lo recomiendo');
  assert.equal(r.status, 201);
  assert.equal(r.json.moderation.held, true);
});

test('moderador: rating alto con texto muy negativo → retenida', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 5, 'Horrible, un desastre total');
  assert.equal(r.status, 201);
  assert.equal(r.json.moderation.held, true);
});

test('moderador: vacía con rating bajo → retenida ("contanos qué pasó")', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 2, '');
  assert.equal(r.status, 201);
  assert.equal(r.json.moderation.held, true);
  const row = await queryOne(ctx.db, 'SELECT moderation_reason FROM reviews WHERE id = ?', [r.json.review.id]);
  assert.match(row.moderation_reason, /contanos qu[ée] pas[óo]/i);
});

test('moderador: GET público no muestra retenidas', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 1, 'sos un idiota');
  assert.equal(r.json.moderation.held, true);
  const list = await api('GET', '/api/reviews', { query: { to_user: proUser.id } });
  assert.ok(!list.json.reviews.some((x) => x.id === r.json.review.id));
});

test('moderador admin: cola lista retenidas; approve publica y notifica', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const { token: adminToken } = await adminFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 1, 'qué mierda de servicio');
  const reviewId = r.json.review.id;
  assert.equal(r.json.moderation.held, true);

  const queue = await api('GET', '/api/admin/moderation', { token: adminToken });
  assert.equal(queue.status, 200);
  const item = queue.json.queue.find((x) => x.id === reviewId);
  assert.ok(item);
  assert.equal(item.from_name, client.user.name);
  assert.equal(item.to_name, proUser.name);

  const approved = await api('POST', `/api/admin/moderation/${reviewId}`, {
    token: adminToken, body: { decision: 'approve' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.json.review.moderation_status, 'approved');

  // Ahora sí se publica y el profesional recibe la notificación.
  const list = await api('GET', '/api/reviews', { query: { to_user: proUser.id } });
  assert.ok(list.json.reviews.some((x) => x.id === reviewId));
  const notif = await queryOne(ctx.db,
    "SELECT * FROM notifications WHERE user_id = ? AND type = 'review'", [proUser.id]);
  assert.ok(notif);
  assert.match(notif.title, /Nueva reseña/);
});

test('moderador admin: reject no publica', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const { token: adminToken } = await adminFixture();
  const r = await postReviewTo(api, client, bookingId, proUser, 2, 'www.spam.com baratisimo');
  const reviewId = r.json.review.id;
  assert.equal(r.json.moderation.held, true);

  const rejected = await api('POST', `/api/admin/moderation/${reviewId}`, {
    token: adminToken, body: { decision: 'reject' },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.review.moderation_status, 'rejected');

  const list = await api('GET', '/api/reviews', { query: { to_user: proUser.id } });
  assert.ok(!list.json.reviews.some((x) => x.id === reviewId));
  const queue = await api('GET', '/api/admin/moderation', { token: adminToken });
  assert.ok(!queue.json.queue.some((x) => x.id === reviewId));
});

test('moderador admin: sin token → 401; no-admin → 403', async () => {
  const { api, register } = ctx;
  assert.equal((await api('GET', '/api/admin/moderation')).status, 401);
  const { token } = await register();
  assert.equal((await api('GET', '/api/admin/moderation', { token })).status, 403);
  assert.equal((await api('POST', '/api/admin/moderation/1', { token, body: { decision: 'approve' } })).status, 403);
});
