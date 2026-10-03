'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { run } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

const VM = { lat: -25.2907, lng: -57.5725 }; // Villa Morra
const CE = { lat: -25.2635, lng: -57.5759 }; // Centro (~3.0 km)
const SA = { lat: -25.3036, lng: -57.6060 }; // Sajonia (~3.7 km)

async function makeProAt(name, barrio, coords) {
  const { api, register } = ctx;
  const { token } = await register({ role: 'pro', name });
  const p = await api('POST', '/api/professionals', {
    token, body: { bio: 'bio', categories: ['peluquería'], barrio },
  });
  assert.equal(p.status, 201);
  if (coords) {
    await run(ctx.db, 'UPDATE professionals SET lat = ?, lng = ? WHERE id = ?',
      [coords.lat, coords.lng, p.json.professional.id]);
  }
  return p.json.professional;
}

async function makeBusinessAt(name, barrio, coords) {
  const { api, register } = ctx;
  const { token } = await register({ name: `Dueño ${name}` });
  const b = await api('POST', '/api/businesses', {
    token,
    body: { name, categories: ['peluquería'], barrio, services: [{ name: 'Corte', price_gs: 100000 }] },
  });
  assert.equal(b.status, 201);
  if (coords) {
    await run(ctx.db, 'UPDATE businesses SET lat = ?, lng = ? WHERE id = ?',
      [coords.lat, coords.lng, b.json.business.id]);
  }
  return b.json.business;
}

test('geo: profesionales se ordenan por distancia ascendente con distance_km', async () => {
  const { api } = ctx;
  await makeProAt('Pro Sajonia', 'Sajonia', SA);
  await makeProAt('Pro Villa Morra', 'Villa Morra', VM);
  await makeProAt('Pro Centro', 'Centro', CE);
  const r = await api('GET', '/api/professionals', { query: { lat: VM.lat, lng: VM.lng } });
  assert.equal(r.status, 200);
  const barrios = r.json.professionals.map((p) => p.barrio);
  assert.deepEqual(barrios, ['Villa Morra', 'Centro', 'Sajonia']);
  const dists = r.json.professionals.map((p) => p.distance_km);
  assert.deepEqual(dists, [0, 3, 3.7]);
  for (const p of r.json.professionals) {
    assert.ok(Number.isInteger(p.distance_km * 10), 'distance_km con 1 decimal');
    assert.ok(p.lat !== null && p.lng !== null);
  }
});

test('geo: radio_km filtra por distancia (default 50)', async () => {
  const { api } = ctx;
  await makeProAt('Pro Lejos A', 'Sajonia', SA);
  await makeProAt('Pro Cerca A', 'Villa Morra', VM);
  const chico = await api('GET', '/api/professionals', {
    query: { lat: VM.lat, lng: VM.lng, radio_km: 3.5 },
  });
  assert.equal(chico.status, 200);
  assert.ok(chico.json.professionals.length >= 1);
  assert.ok(chico.json.professionals.every((p) => p.distance_km <= 3.5));
  assert.ok(!chico.json.professionals.some((p) => p.name === 'Pro Lejos A'));
  const minimo = await api('GET', '/api/professionals', {
    query: { lat: VM.lat, lng: VM.lng, radio_km: 0.5 },
  });
  assert.ok(minimo.json.professionals.every((p) => p.distance_km === 0));
});

test('geo: sin coordenadas en la fila queda afuera; sin lat/lng todo igual que antes', async () => {
  const { api } = ctx;
  await makeProAt('Pro Sin Geo', 'Trinidad', null); // sin lat/lng
  await makeProAt('Pro Con Geo', 'Villa Morra', VM);
  const geo = await api('GET', '/api/professionals', { query: { lat: VM.lat, lng: VM.lng } });
  assert.ok(!geo.json.professionals.some((p) => p.name === 'Pro Sin Geo'));
  assert.ok(geo.json.professionals.some((p) => p.name === 'Pro Con Geo'));

  const plano = await api('GET', '/api/professionals');
  assert.equal(plano.status, 200);
  assert.ok(plano.json.professionals.some((p) => p.name === 'Pro Sin Geo'));
  assert.ok(plano.json.professionals.every((p) => !('distance_km' in p)));
});

test('geo: lat/lng inválidos → 400', async () => {
  const { api } = ctx;
  const mala = await api('GET', '/api/professionals', { query: { lat: 'abc', lng: VM.lng } });
  assert.equal(mala.status, 400);
  const fuera = await api('GET', '/api/professionals', { query: { lat: 200, lng: VM.lng } });
  assert.equal(fuera.status, 400);
  const incompleta = await api('GET', '/api/professionals', { query: { lat: VM.lat } });
  assert.equal(incompleta.status, 400);
  const radioMalo = await api('GET', '/api/professionals', {
    query: { lat: VM.lat, lng: VM.lng, radio_km: -5 },
  });
  assert.equal(radioMalo.status, 400);
});

test('geo: negocios también aceptan lat/lng/radio_km', async () => {
  const { api } = ctx;
  await makeBusinessAt('Negocio Sajonia', 'Sajonia', SA);
  await makeBusinessAt('Negocio Villa Morra', 'Villa Morra', VM);
  const r = await api('GET', '/api/businesses', { query: { lat: VM.lat, lng: VM.lng, radio_km: 10 } });
  assert.equal(r.status, 200);
  const names = r.json.businesses.map((b) => b.name);
  assert.deepEqual(names, ['Negocio Villa Morra', 'Negocio Sajonia']);
  assert.deepEqual(r.json.businesses.map((b) => b.distance_km), [0, 3.7]);
  const filtrado = await api('GET', '/api/businesses', { query: { lat: VM.lat, lng: VM.lng, radio_km: 1 } });
  assert.deepEqual(filtrado.json.businesses.map((b) => b.name), ['Negocio Villa Morra']);
});
