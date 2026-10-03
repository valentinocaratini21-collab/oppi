'use strict';

/**
 * Ganancias del profesional independiente: GET /api/pro/earnings.
 * Misma forma que GET /api/business/earnings (helper compartido en
 * src/lib/earnings.js): brutos, comisión 15%, neto, nº reservas,
 * ticket promedio y desglose por servicio; solo reservas completed de los
 * servicios del profesional logueado (rol pro).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { run } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

/** created_at 'AAAA-MM-DD HH:MM:SS' (UTC) de hace n días. */
function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

async function earningsFixture() {
  const { api, register, makePro } = ctx;
  const { token: proToken, professional, service: corte } = await makePro();
  const s2 = await api('POST', '/api/services', {
    token: proToken,
    body: { professional_id: professional.id, name: 'Barba', price_gs: 50000, deposit_type: 'none' },
  });
  assert.equal(s2.status, 201);
  const barba = s2.json.service;
  const client = await register();

  async function booking(serviceId, totalGs, days, status = 'completed') {
    await run(ctx.db,
      `INSERT INTO bookings (client_id, service_id, status, paid_gs, paid, total_gs, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [client.user.id, serviceId, status, 0, 0, totalGs, daysAgo(days)]);
  }
  await booking(corte.id, 100000, 2);             // dentro de semana y mes
  await booking(barba.id, 50000, 10);             // dentro de mes, fuera de semana
  await booking(corte.id, 100000, 40);            // fuera de mes
  await booking(corte.id, 100000, 1, 'confirmed'); // no completada: no cuenta

  // Otro profesional: sus reservas no cuentan para este.
  const other = await makePro();
  await run(ctx.db,
    `INSERT INTO bookings (client_id, service_id, status, paid_gs, paid, total_gs, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [client.user.id, other.service.id, 'completed', 0, 0, 999999, daysAgo(1)]);
  return { proToken, client };
}

test('pro/earnings: periodo=semana solo cuenta los últimos 7 días', async () => {
  const { api } = ctx;
  const { proToken } = await earningsFixture();
  const r = await api('GET', '/api/pro/earnings', { token: proToken, query: { periodo: 'semana' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, {
    periodo: 'semana',
    ingresos_brutos: 100000,
    comision: 15000,          // 15% redondeado
    neto: 85000,
    reservas_count: 1,
    ticket_promedio: 100000,
    por_servicio: [{ servicio_id: r.json.por_servicio[0].servicio_id, nombre: 'Corte', reservas: 1, ingresos: 100000 }],
  });
});

test('pro/earnings: periodo=mes cuenta los últimos 30 días, por servicio ordenado', async () => {
  const { api } = ctx;
  const { proToken } = await earningsFixture();
  const r = await api('GET', '/api/pro/earnings', { token: proToken, query: { periodo: 'mes' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.periodo, 'mes');
  assert.equal(r.json.ingresos_brutos, 150000);
  assert.equal(r.json.comision, 22500);
  assert.equal(r.json.neto, 127500);
  assert.equal(r.json.reservas_count, 2);
  assert.equal(r.json.ticket_promedio, 75000);
  assert.equal(r.json.por_servicio.length, 2);
  assert.equal(r.json.por_servicio[0].nombre, 'Corte'); // ordenado por ingresos desc
  assert.equal(r.json.por_servicio[0].ingresos, 100000);
  assert.equal(r.json.por_servicio[1].nombre, 'Barba');
  assert.equal(r.json.por_servicio[1].ingresos, 50000);
});

test('pro/earnings: sin reservas responde ceros', async () => {
  const { api, makePro } = ctx;
  const { token } = await makePro();
  const r = await api('GET', '/api/pro/earnings', { token, query: { periodo: 'mes' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ingresos_brutos, 0);
  assert.equal(r.json.comision, 0);
  assert.equal(r.json.neto, 0);
  assert.equal(r.json.reservas_count, 0);
  assert.equal(r.json.ticket_promedio, 0);
  assert.deepEqual(r.json.por_servicio, []);
});

test('pro/earnings: periodo inválido → 400', async () => {
  const { api } = ctx;
  const { proToken } = await earningsFixture();
  const r = await api('GET', '/api/pro/earnings', { token: proToken, query: { periodo: 'año' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /semana.*mes|mes.*semana/);
});

test('pro/earnings: rol pro sin perfil → 404', async () => {
  const { api, register } = ctx;
  const pro = await register({ role: 'pro' }); // sin crear el perfil de profesional
  const r = await api('GET', '/api/pro/earnings', { token: pro.token, query: { periodo: 'mes' } });
  assert.equal(r.status, 404);
  assert.match(r.json.error, /perfil/);
});

test('pro/earnings: rol no-pro → 403; sin token → 401', async () => {
  const { api } = ctx;
  const { client } = await earningsFixture();
  const denied = await api('GET', '/api/pro/earnings', { token: client.token, query: { periodo: 'mes' } });
  assert.equal(denied.status, 403);
  const anon = await api('GET', '/api/pro/earnings', { query: { periodo: 'mes' } });
  assert.equal(anon.status, 401);
});
