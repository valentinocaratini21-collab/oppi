'use strict';

/**
 * GET /api/search — búsqueda unificada de profesionales.
 * - Sin geo: { results } ordenados por rating, sin distance_km.
 * - Con lat+lng: ordenados por distancia ascendente, con distance_km y filtro por radio.
 * - Filtros q (nombre/bio) y rubro (categorías).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { run } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

const VM = { lat: -25.2907, lng: -57.5725 }; // Villa Morra
const CE = { lat: -25.2635, lng: -57.5759 }; // Centro (~3.0 km de VM)
const SA = { lat: -25.3036, lng: -57.6060 }; // Sajonia (~4.6 km de VM)

async function makeProAt(name, barrio, coords, categories = ['peluquería']) {
  const { api, register } = ctx;
  const { token } = await register({ role: 'pro', name });
  const p = await api('POST', '/api/professionals', {
    token, body: { bio: `Bio de ${name}`, categories, barrio },
  });
  assert.equal(p.status, 201);
  if (coords) {
    await run(ctx.db, 'UPDATE professionals SET lat = ?, lng = ? WHERE id = ?',
      [coords.lat, coords.lng, p.json.professional.id]);
  }
  return p.json.professional;
}

test('search sin geo: devuelve { results } ordenados por rating, sin distance_km', async () => {
  const { api } = ctx;
  await makeProAt('Ana Pelu', 'Villa Morra', VM);
  await makeProAt('Beto Corte', 'Centro', CE);
  const r = await api('GET', '/api/search');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.results), 'tiene que devolver { results: [] }');
  assert.ok(r.json.results.length >= 2);
  assert.equal(r.json.results[0].distance_km, undefined);
});

test('search con lat+lng: ordena por distancia y trae distance_km', async () => {
  const { api } = ctx;
  const r = await api('GET', '/api/search', { query: { lat: VM.lat, lng: VM.lng } });
  assert.equal(r.status, 200);
  const list = r.json.results;
  assert.ok(list.length >= 2);
  // El de Villa Morra (distancia ~0) va antes que el de Centro (~3 km).
  const names = list.map((p) => p.name);
  assert.ok(names.indexOf('Ana Pelu') < names.indexOf('Beto Corte'),
    'Ana (Villa Morra) tiene que estar antes que Beto (Centro) buscando desde Villa Morra');
  for (const p of list) {
    assert.equal(typeof p.distance_km, 'number', 'cada resultado trae distance_km');
  }
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].distance_km >= list[i - 1].distance_km, 'orden ascendente por distancia');
  }
  const ana = list.find((p) => p.name === 'Ana Pelu');
  assert.ok(ana.distance_km < 0.5, 'Ana está a < 0.5 km de Villa Morra');
});

test('search respeta radio_km', async () => {
  const { api } = ctx;
  const r = await api('GET', '/api/search', { query: { lat: VM.lat, lng: VM.lng, radio_km: 1 } });
  assert.equal(r.status, 200);
  for (const p of r.json.results) {
    assert.ok(p.distance_km <= 1, `fuera de radio: ${p.name} a ${p.distance_km} km`);
  }
  assert.ok(r.json.results.some((p) => p.name === 'Ana Pelu'));
  assert.ok(!r.json.results.some((p) => p.name === 'Beto Corte'), 'Beto (Centro, ~3 km) queda afuera');
});

test('search filtra por q y por rubro', async () => {
  const { api } = ctx;
  await makeProAt('Carlos Plomero', 'Sajonia', SA, ['plomería']);
  const byQ = await api('GET', '/api/search', { query: { q: 'Plomero' } });
  assert.equal(byQ.status, 200);
  assert.ok(byQ.json.results.some((p) => p.name === 'Carlos Plomero'));
  assert.ok(byQ.json.results.every((p) => p.name.includes('Plomero') || (p.bio || '').includes('Plomero')));
  const byRubro = await api('GET', '/api/search', { query: { rubro: 'plomería' } });
  assert.equal(byRubro.status, 200);
  assert.ok(byRubro.json.results.length >= 1);
  assert.ok(byRubro.json.results.every((p) => (p.categories || []).join(' ').toLowerCase().includes('plomer')));
});

test('search con lat inválida → 400', async () => {
  const { api } = ctx;
  const r = await api('GET', '/api/search', { query: { lat: 'no-numero', lng: VM.lng } });
  assert.equal(r.status, 400);
  assert.ok(r.json.error);
});
