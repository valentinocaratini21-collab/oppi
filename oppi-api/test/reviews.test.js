'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

async function reviewFixture() {
  const { api, register, makePro } = ctx;
  const { token: proToken, service, user: proUser } = await makePro();
  const client = await register();
  const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  return { api, client, proToken, proUser, bookingId: b.json.booking.id };
}

test('reseñas: crear con rating 1-5; rating 6 → 400', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const ok = await api('POST', '/api/reviews', {
    token: client.token, body: { booking_id: bookingId, to_user: proUser.id, rating: 5, text: 'Un genio' },
  });
  assert.equal(ok.status, 201);
  const bad = await api('POST', '/api/reviews', {
    token: client.token, body: { booking_id: bookingId, to_user: proUser.id, rating: 6, text: 'x' },
  });
  assert.equal(bad.status, 400);
});

test('reseñas: solo el cliente de la reserva puede reseñar → 403 para otro', async () => {
  const { api, proUser, bookingId } = await reviewFixture();
  const { register } = ctx;
  const outsider = await register();
  const r = await api('POST', '/api/reviews', {
    token: outsider.token, body: { booking_id: bookingId, to_user: proUser.id, rating: 4, text: 'x' },
  });
  assert.equal(r.status, 403);
});

test('reseñas: el profesional responde UNA vez; segunda → 400; otro → 403', async () => {
  const { api, client, proToken, proUser, bookingId } = await reviewFixture();
  const { register } = ctx;
  const rev = await api('POST', '/api/reviews', {
    token: client.token, body: { booking_id: bookingId, to_user: proUser.id, rating: 4, text: 'Bien' },
  });
  const reviewId = rev.json.review.id;

  const outsider = await register();
  const no = await api('POST', `/api/reviews/${reviewId}/reply`, {
    token: outsider.token, body: { reply_text: 'Gracias!' },
  });
  assert.equal(no.status, 403);

  const yes = await api('POST', `/api/reviews/${reviewId}/reply`, {
    token: proToken, body: { reply_text: 'Gracias por tu visita 🙌' },
  });
  assert.equal(yes.status, 200);
  assert.ok(yes.json.review.reply_text);

  const twice = await api('POST', `/api/reviews/${reviewId}/reply`, {
    token: proToken, body: { reply_text: 'Otra vez' },
  });
  assert.equal(twice.status, 400);
  assert.match(twice.json.error, /una vez/);
});

test('reseñas: la respuesta se expone en el perfil público del profesional', async () => {
  const { api, client, proToken, proUser, bookingId } = await reviewFixture();
  const { queryOne } = require('../src/db');
  const pro = await queryOne(ctx.db, 'SELECT id FROM professionals WHERE user_id = ?', [proUser.id]);
  await api('POST', '/api/reviews', {
    token: client.token, body: { booking_id: bookingId, to_user: proUser.id, rating: 5, text: 'Excelente' },
  });
  const list = await api('GET', '/api/reviews', { query: { to_user: proUser.id } });
  const reviewId = list.json.reviews[0].id;
  await api('POST', `/api/reviews/${reviewId}/reply`, { token: proToken, body: { reply_text: 'Gracias!' } });

  const profile = await api('GET', `/api/professionals/${pro.id}`); // sin token: público
  assert.equal(profile.status, 200);
  assert.ok(profile.json.reviews.some((r) => r.reply_text === 'Gracias!'));
});

test('reseñas: con fotos (máx 3) se guardan y se exponen en el listado y el perfil', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const { queryOne } = require('../src/db');
  const urls = ['https://img.oppi.test/foto1.jpg', 'https://img.oppi.test/foto2.jpg'];
  const r = await api('POST', '/api/reviews', {
    token: client.token,
    body: { booking_id: bookingId, to_user: proUser.id, rating: 5, text: 'Un genio, atención de primera', photos: urls },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.review.photos, urls);

  const list = await api('GET', '/api/reviews', { query: { to_user: proUser.id } });
  const found = list.json.reviews.find((x) => x.id === r.json.review.id);
  assert.ok(found);
  assert.deepEqual(found.photos, urls);

  // El perfil público del profesional también expone las fotos.
  const pro = await queryOne(ctx.db, 'SELECT id FROM professionals WHERE user_id = ?', [proUser.id]);
  const profile = await api('GET', `/api/professionals/${pro.id}`); // sin token: público
  assert.equal(profile.status, 200);
  const inProfile = profile.json.reviews.find((x) => x.id === r.json.review.id);
  assert.ok(inProfile);
  assert.deepEqual(inProfile.photos, urls);
});

test('reseñas: sin fotos → photos: []', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const r = await api('POST', '/api/reviews', {
    token: client.token, body: { booking_id: bookingId, to_user: proUser.id, rating: 4, text: 'Bien' },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.review.photos, []);
});

test('reseñas: más de 3 fotos → 400; foto no-URL → 400; photos no-array → 400', async () => {
  const { api, client, proUser, bookingId } = await reviewFixture();
  const base = { booking_id: bookingId, to_user: proUser.id, rating: 5, text: 'x' };

  const many = await api('POST', '/api/reviews', {
    token: client.token,
    body: { ...base, photos: ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg', 'https://a/4.jpg'] },
  });
  assert.equal(many.status, 400);
  assert.match(many.json.error, /3 fotos/);

  const badUrl = await api('POST', '/api/reviews', {
    token: client.token, body: { ...base, photos: ['not-a-url'] },
  });
  assert.equal(badUrl.status, 400);
  assert.match(badUrl.json.error, /URL/);

  const notArray = await api('POST', '/api/reviews', {
    token: client.token, body: { ...base, photos: 'https://a/1.jpg' },
  });
  assert.equal(notArray.status, 400);
});
