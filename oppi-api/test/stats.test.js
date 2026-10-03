'use strict';

/**
 * Reportes (mejora 6):
 * - GET /api/pro/stats?periodo=semana|mes
 * - GET /api/businesses/:id/stats?periodo=semana|mes
 * { ingresos, reservas_count, top_servicios, clientes_nuevos,
 *   clientes_recurrentes, conversion }.
 * conversion es null: no hay tracking de visitas al perfil.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { run } = require('../src/db');

let ctx, api;
before(async () => { ctx = await setup(); api = ctx.api; });
after(() => ctx.close());

async function bookingFlow({ clientToken, ownerToken, serviceId, toCompleted }) {
  const b = await api('POST', '/api/bookings', {
    token: clientToken, body: { service_id: serviceId },
  });
  assert.equal(b.status, 201);
  const id = b.json.booking.id;
  if (!toCompleted) return id;
  const c = await api('PATCH', `/api/bookings/${id}`, { token: ownerToken, body: { status: 'confirmed' } });
  assert.equal(c.status, 200);
  const d = await api('PATCH', `/api/bookings/${id}`, { token: ownerToken, body: { status: 'completed' } });
  assert.equal(d.status, 200);
  return id;
}

/** Mueve la fecha de creación de una reserva N días atrás. */
async function backdateBooking(id, daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n) => String(n).padStart(2, '0');
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  await run(ctx.db, 'UPDATE bookings SET created_at = ? WHERE id = ?', [s, id]);
}

test('pro/stats: métricas del período con top de servicios', async () => {
  const { token: proToken, professional, service } = await ctx.makePro();
  // Segundo servicio del mismo pro
  const s2 = await api('POST', '/api/services', {
    token: proToken, body: { professional_id: professional.id, name: 'Barba', price_gs: 50000 },
  });
  assert.equal(s2.status, 201);

  const cliNuevo = await ctx.register({ name: 'Cliente Nuevo' });
  const cliViejo = await ctx.register({ name: 'Cliente Viejo' });

  // Cliente viejo: una reserva completada hace 20 días (fuera de la semana, dentro del mes)
  const oldId = await bookingFlow({ clientToken: cliViejo.token, ownerToken: proToken, serviceId: service.id, toCompleted: true });
  await backdateBooking(oldId, 20);
  // Cliente viejo: otra reserva completada hoy (recurrente en semana y mes)
  await bookingFlow({ clientToken: cliViejo.token, ownerToken: proToken, serviceId: service.id, toCompleted: true });
  // Cliente nuevo: una reserva completada hoy, más una pendiente hoy
  await bookingFlow({ clientToken: cliNuevo.token, ownerToken: proToken, serviceId: service.id, toCompleted: true });
  await bookingFlow({ clientToken: cliNuevo.token, ownerToken: proToken, serviceId: service.id, toCompleted: false });

  const semana = await api('GET', '/api/pro/stats', { token: proToken, query: { periodo: 'semana' } });
  assert.equal(semana.status, 200);
  const sw = semana.json;
  assert.equal(sw.periodo, 'semana');
  assert.equal(sw.ingresos, 200000); // 2 completadas en la semana × 100000
  assert.equal(sw.reservas_count, 3); // 3 creadas en la semana (2 completadas + 1 pendiente; la vieja quedó fuera)
  assert.equal(sw.top_servicios.length, 1);
  assert.equal(sw.top_servicios[0].nombre, 'Corte');
  assert.equal(sw.top_servicios[0].count, 2);
  assert.equal(sw.top_servicios[0].ingresos, 200000);
  assert.equal(sw.clientes_nuevos, 1); // Cliente Nuevo
  assert.equal(sw.clientes_recurrentes, 1); // Cliente Viejo
  assert.equal(sw.conversion, null);

  const mes = await api('GET', '/api/pro/stats', { token: proToken, query: { periodo: 'mes' } });
  assert.equal(mes.status, 200);
  assert.equal(mes.json.ingresos, 300000); // 3 completadas en el mes
  assert.equal(mes.json.reservas_count, 4); // las 4 creadas en el mes
  assert.equal(mes.json.clientes_nuevos, 2); // ambos empezaron hace menos de 30 días
  assert.equal(mes.json.clientes_recurrentes, 0);
});

test('pro/stats: período inválido → 400; requiere rol pro', async () => {
  const { token: proToken } = await ctx.makePro();
  const r = await api('GET', '/api/pro/stats', { token: proToken, query: { periodo: 'año' } });
  assert.equal(r.status, 400);
  const client = await ctx.register({ name: 'Común' });
  const r2 = await api('GET', '/api/pro/stats', { token: client.token });
  assert.equal(r2.status, 403);
});

test('businesses/:id/stats: reporte del negocio (dueño)', async () => {
  const owner = await ctx.register({ role: 'business', name: 'Dueña Stats' });
  const b = await api('POST', '/api/businesses', {
    token: owner.token,
    body: { name: 'Salón Stats', services: [{ name: 'Corte', price_gs: 120000 }] },
  });
  assert.equal(b.status, 201);
  const business = b.json.business;
  const service = b.json.services[0];
  const cli = await ctx.register({ name: 'Cliente Stats' });
  await bookingFlow({ clientToken: cli.token, ownerToken: owner.token, serviceId: service.id, toCompleted: true });

  const r = await api('GET', `/api/businesses/${business.id}/stats`, {
    token: owner.token, query: { periodo: 'mes' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ingresos, 120000);
  assert.equal(r.json.reservas_count, 1);
  assert.equal(r.json.top_servicios[0].nombre, 'Corte');
  assert.equal(r.json.clientes_nuevos, 1);
  assert.equal(r.json.clientes_recurrentes, 0);
  assert.equal(r.json.conversion, null);

  // Otro usuario → 403
  const intruso = await ctx.register({ name: 'Intruso' });
  const r2 = await api('GET', `/api/businesses/${business.id}/stats`, { token: intruso.token });
  assert.equal(r2.status, 403);
  // Período inválido → 400
  const r3 = await api('GET', `/api/businesses/${business.id}/stats`, {
    token: owner.token, query: { periodo: 'año' },
  });
  assert.equal(r3.status, 400);
});

test('stats: sin reservas devuelve ceros y conversion null', async () => {
  const { token: proToken } = await ctx.makePro();
  const r = await api('GET', '/api/pro/stats', { token: proToken, query: { periodo: 'semana' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ingresos, 0);
  assert.equal(r.json.reservas_count, 0);
  assert.deepEqual(r.json.top_servicios, []);
  assert.equal(r.json.clientes_nuevos, 0);
  assert.equal(r.json.clientes_recurrentes, 0);
  assert.equal(r.json.conversion, null);
});
