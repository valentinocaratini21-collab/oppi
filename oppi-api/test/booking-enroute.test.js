'use strict';

/**
 * "Voy en camino": POST /api/bookings/:id/en-route.
 * Solo el dueño del servicio (profesional/negocio), solo si la reserva está
 * 'confirmed' y el turno es HOY. Setea en_route_at y notifica al cliente.
 * Idempotente: el segundo aviso devuelve ok sin duplicar la notificación.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryAll } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

/** Fecha local AAAA-MM-DD (los slots se guardan en fecha local). */
function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Pro + servicio + turno en la fecha dada + reserva confirmada por el pro. */
async function confirmedFixture(dateStr) {
  const { api, register, makePro } = ctx;
  const { token: proToken, user: proUser, professional, service } = await makePro();
  const slot = await api('POST', '/api/slots', {
    token: proToken, body: { professional_id: professional.id, date: dateStr, time: '10:00' },
  });
  assert.equal(slot.status, 201);
  const client = await register();
  const b = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, slot_id: slot.json.slot.id },
  });
  assert.equal(b.status, 201);
  const c = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
    token: proToken, body: { status: 'confirmed' },
  });
  assert.equal(c.status, 200);
  return { api, register, proToken, proUser, client, bookingId: b.json.booking.id };
}

async function enRouteNotifs(userId) {
  return queryAll(ctx.db,
    "SELECT * FROM notifications WHERE user_id = ? AND body LIKE '%va en camino%'", [userId]);
}

test('en-route: el día del turno avisa y notifica al cliente', async () => {
  const { api, proToken, proUser, client, bookingId } = await confirmedFixture(localDate(0));
  const r = await api('POST', `/api/bookings/${bookingId}/en-route`, { token: proToken });
  assert.equal(r.status, 200);
  assert.ok(r.json.booking.en_route_at, 'en_route_at tiene que quedar seteado');

  const notifs = await enRouteNotifs(client.user.id);
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].body, `🛵 ${proUser.name} va en camino a tu servicio.`);
});

test('en-route: turno futuro → 400; reserva pendiente → 400; sin reserva → 404', async () => {
  const { api, proToken, bookingId } = await confirmedFixture(localDate(1)); // mañana
  const future = await api('POST', `/api/bookings/${bookingId}/en-route`, { token: proToken });
  assert.equal(future.status, 400);
  assert.match(future.json.error, /día del turno/);

  const { register, makePro } = ctx;
  const fresh = await makePro();
  const slot = await api('POST', '/api/slots', {
    token: fresh.token, body: { professional_id: fresh.professional.id, date: localDate(0), time: '11:00' },
  });
  const client = await register();
  const b = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: fresh.service.id, slot_id: slot.json.slot.id },
  }); // queda 'pending'
  const pending = await api('POST', `/api/bookings/${b.json.booking.id}/en-route`, { token: fresh.token });
  assert.equal(pending.status, 400);
  assert.match(pending.json.error, /confirmada/);

  const missing = await api('POST', '/api/bookings/999999/en-route', { token: proToken });
  assert.equal(missing.status, 404);
});

test('en-route: lo pide el cliente → 403; un tercero → 403; sin token → 401', async () => {
  const { api, register, client, bookingId } = await confirmedFixture(localDate(0));
  const byClient = await api('POST', `/api/bookings/${bookingId}/en-route`, { token: client.token });
  assert.equal(byClient.status, 403);

  const outsider = await register();
  const byOther = await api('POST', `/api/bookings/${bookingId}/en-route`, { token: outsider.token });
  assert.equal(byOther.status, 403);

  const anon = await api('POST', `/api/bookings/${bookingId}/en-route`);
  assert.equal(anon.status, 401);
});

test('en-route: idempotente — el doble aviso no duplica la notificación', async () => {
  const { api, proToken, client, bookingId } = await confirmedFixture(localDate(0));
  const first = await api('POST', `/api/bookings/${bookingId}/en-route`, { token: proToken });
  assert.equal(first.status, 200);
  const second = await api('POST', `/api/bookings/${bookingId}/en-route`, { token: proToken });
  assert.equal(second.status, 200);
  assert.equal(second.json.already_notified, true);
  assert.equal(second.json.booking.en_route_at, first.json.booking.en_route_at);

  const notifs = await enRouteNotifs(client.user.id);
  assert.equal(notifs.length, 1, 'la notificación no se tiene que duplicar');
});

test('en-route: bookingDto expone en_route_at (aditivo)', async () => {
  const { api, proToken, bookingId } = await confirmedFixture(localDate(0));
  const before = await api('GET', `/api/bookings/${bookingId}`, { token: proToken });
  assert.equal(before.json.booking.en_route_at, null);
  await api('POST', `/api/bookings/${bookingId}/en-route`, { token: proToken });
  const afterGet = await api('GET', `/api/bookings/${bookingId}`, { token: proToken });
  assert.ok(afterGet.json.booking.en_route_at);
});
