'use strict';

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
  const { api, register } = ctx;
  const owner = await register({ role: 'business' });
  const created = await api('POST', '/api/businesses', {
    token: owner.token,
    body: {
      name: 'Salón Ganancias', categories: ['peluquería'], barrio: 'Villa Morra',
      services: [
        { name: 'Corte', price_gs: 100000, deposit_type: 'none' },
        { name: 'Color', price_gs: 200000, deposit_type: 'none' },
      ],
    },
  });
  assert.equal(created.status, 201);
  const corte = created.json.services.find((s) => s.name === 'Corte');
  const color = created.json.services.find((s) => s.name === 'Color');
  const client = await register();

  async function booking(serviceId, totalGs, days, status = 'completed') {
    await run(ctx.db,
      `INSERT INTO bookings (client_id, service_id, status, paid_gs, paid, total_gs, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [client.user.id, serviceId, status, 0, 0, totalGs, daysAgo(days)]);
  }
  await booking(corte.id, 100000, 2);            // dentro de semana y mes
  await booking(color.id, 200000, 10);           // dentro de mes, fuera de semana
  await booking(corte.id, 100000, 40);           // fuera de mes
  await booking(corte.id, 100000, 1, 'confirmed'); // no completada: no cuenta
  return { owner, client };
}

test('ganancias: periodo=semana solo cuenta los últimos 7 días', async () => {
  const { api } = ctx;
  const { owner } = await earningsFixture();
  const r = await api('GET', '/api/business/earnings', { token: owner.token, query: { periodo: 'semana' } });
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

test('ganancias: periodo=mes cuenta los últimos 30 días, por servicio ordenado', async () => {
  const { api } = ctx;
  const { owner } = await earningsFixture();
  const r = await api('GET', '/api/business/earnings', { token: owner.token, query: { periodo: 'mes' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.periodo, 'mes');
  assert.equal(r.json.ingresos_brutos, 300000);
  assert.equal(r.json.comision, 45000);
  assert.equal(r.json.neto, 255000);
  assert.equal(r.json.reservas_count, 2);
  assert.equal(r.json.ticket_promedio, 150000);
  assert.equal(r.json.por_servicio.length, 2);
  assert.equal(r.json.por_servicio[0].nombre, 'Color'); // ordenado por ingresos desc
  assert.equal(r.json.por_servicio[0].ingresos, 200000);
  assert.equal(r.json.por_servicio[1].nombre, 'Corte');
});

test('ganancias: sin reservas responde ceros (ticket 0)', async () => {
  const { api, register } = ctx;
  const owner = await register({ role: 'business' });
  await api('POST', '/api/businesses', {
    token: owner.token,
    body: { name: 'Negocio Vacío', services: [{ name: 'X', price_gs: 50000 }] },
  });
  const r = await api('GET', '/api/business/earnings', { token: owner.token, query: { periodo: 'mes' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ingresos_brutos, 0);
  assert.equal(r.json.comision, 0);
  assert.equal(r.json.neto, 0);
  assert.equal(r.json.reservas_count, 0);
  assert.equal(r.json.ticket_promedio, 0);
  assert.deepEqual(r.json.por_servicio, []);
});

test('ganancias: periodo inválido → 400', async () => {
  const { api } = ctx;
  const { owner } = await earningsFixture();
  const r = await api('GET', '/api/business/earnings', { token: owner.token, query: { periodo: 'año' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /semana.*mes|mes.*semana/);
});

test('ganancias: rol no-business → 403; sin token → 401', async () => {
  const { api } = ctx;
  const { client } = await earningsFixture();
  const denied = await api('GET', '/api/business/earnings', { token: client.token, query: { periodo: 'mes' } });
  assert.equal(denied.status, 403);
  const anon = await api('GET', '/api/business/earnings', { query: { periodo: 'mes' } });
  assert.equal(anon.status, 401);
});
