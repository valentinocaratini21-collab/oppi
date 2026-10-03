'use strict';

/**
 * Clientes — CRM derivado de reservas (mejora 4):
 * - GET /api/pro/clients (profesional autenticado)
 * - GET /api/businesses/:id/clients (dueño del negocio)
 * Cada item: { id, nombre, barrio, reservas_count, ultima_visita, gasto_total,
 * rating_promedio_dado }.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx, api;
before(async () => { ctx = await setup(); api = ctx.api; });
after(() => ctx.close());

/** Crea una reserva y la lleva a completed (vía confirm → complete del pro). */
async function completedBooking({ clientToken, proToken, serviceId }) {
  const b = await api('POST', '/api/bookings', {
    token: clientToken, body: { service_id: serviceId },
  });
  assert.equal(b.status, 201);
  const c = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
    token: proToken, body: { status: 'confirmed' },
  });
  assert.equal(c.status, 200);
  const done = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
    token: proToken, body: { status: 'completed' },
  });
  assert.equal(done.status, 200);
  return done.json.booking;
}

test('pro/clients: lista clientes con métricas derivadas de reservas', async () => {
  const { token: proToken, user: proUser, service } = await ctx.makePro();
  const cli1 = await ctx.register({ name: 'Juana Pérez' });
  await api('PATCH', '/api/me', { token: cli1.token, body: { barrio: 'Villa Morra' } });
  const cli2 = await ctx.register({ name: 'Pedro Gómez' });
  await api('PATCH', '/api/me', { token: cli2.token, body: { barrio: 'Centro' } });

  await completedBooking({ clientToken: cli1.token, proToken, serviceId: service.id });
  await completedBooking({ clientToken: cli1.token, proToken, serviceId: service.id });
  await completedBooking({ clientToken: cli2.token, proToken, serviceId: service.id });

  // Juana le deja una reseña de 5 al profesional
  const bookings = await api('GET', '/api/bookings', { token: cli1.token });
  const firstBooking = bookings.json.bookings[0];
  const rev = await api('POST', '/api/reviews', {
    token: cli1.token,
    body: { booking_id: firstBooking.id, to_user: proUser.id, rating: 5, text: 'Excelente' },
  });
  assert.equal(rev.status, 201);

  const r = await api('GET', '/api/pro/clients', { token: proToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.clients.length, 2);
  const juana = r.json.clients.find((c) => c.nombre === 'Juana Pérez');
  assert.ok(juana);
  assert.equal(juana.barrio, 'Villa Morra');
  assert.equal(juana.reservas_count, 2);
  assert.equal(juana.gasto_total, 200000); // 2 × 100000 (completed)
  assert.ok(juana.ultima_visita, 'tiene que traer ultima_visita');
  assert.equal(juana.rating_promedio_dado, 5);
  const pedro = r.json.clients.find((c) => c.nombre === 'Pedro Gómez');
  assert.equal(pedro.reservas_count, 1);
  assert.equal(pedro.gasto_total, 100000);
  assert.equal(pedro.rating_promedio_dado, null);
});

test('pro/clients: requiere rol pro', async () => {
  const client = await ctx.register({ name: 'Cliente Común' });
  const r = await api('GET', '/api/pro/clients', { token: client.token });
  assert.equal(r.status, 403);
  const r2 = await api('GET', '/api/pro/clients');
  assert.equal(r2.status, 401);
});

test('businesses/:id/clients: dueño ve los clientes del negocio', async () => {
  const owner = await ctx.register({ role: 'business', name: 'Dueña' });
  const b = await api('POST', '/api/businesses', {
    token: owner.token,
    body: { name: 'Salón CRM', services: [{ name: 'Corte', price_gs: 120000 }] },
  });
  assert.equal(b.status, 201);
  const business = b.json.business;
  const service = b.json.services[0];
  const cli = await ctx.register({ name: 'Marta López' });
  await api('PATCH', '/api/me', { token: cli.token, body: { barrio: 'Sajonia' } });
  await completedBooking({ clientToken: cli.token, proToken: owner.token, serviceId: service.id });

  const r = await api('GET', `/api/businesses/${business.id}/clients`, { token: owner.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.clients.length, 1);
  const marta = r.json.clients[0];
  assert.equal(marta.nombre, 'Marta López');
  assert.equal(marta.reservas_count, 1);
  assert.equal(marta.gasto_total, 120000);

  // Otro usuario no puede verlos
  const intruso = await ctx.register({ name: 'Intruso' });
  const r2 = await api('GET', `/api/businesses/${business.id}/clients`, { token: intruso.token });
  assert.equal(r2.status, 403);
  // Negocio inexistente
  const r3 = await api('GET', '/api/businesses/99999/clients', { token: owner.token });
  assert.equal(r3.status, 404);
});

test('clients: las reservas canceladas no suman al gasto pero sí al conteo', async () => {
  const { token: proToken, service } = await ctx.makePro();
  const cli = await ctx.register({ name: 'Carlos Cancelado' });
  const b = await api('POST', '/api/bookings', {
    token: cli.token, body: { service_id: service.id },
  });
  assert.equal(b.status, 201);
  const cancel = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
    token: cli.token, body: { status: 'cancelled' },
  });
  assert.equal(cancel.status, 200);

  const r = await api('GET', '/api/pro/clients', { token: proToken });
  const carlos = r.json.clients.find((c) => c.nombre === 'Carlos Cancelado');
  assert.ok(carlos);
  assert.equal(carlos.reservas_count, 1);
  assert.equal(carlos.gasto_total, 0);
});
