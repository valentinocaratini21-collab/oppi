'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('profesionales: GET público con filtros por categoría y barrio', async () => {
  const { api, makePro } = ctx;
  await makePro();
  const all = await api('GET', '/api/professionals');
  assert.equal(all.status, 200);
  assert.ok(all.json.professionals.length >= 1);
  const byCat = await api('GET', '/api/professionals', { query: { category: 'peluquería' } });
  assert.ok(byCat.json.professionals.length >= 1);
  const byBarrio = await api('GET', '/api/professionals', { query: { barrio: 'Villa Morra' } });
  assert.ok(byBarrio.json.professionals.length >= 1);
  const none = await api('GET', '/api/professionals', { query: { barrio: 'Barrio Inexistente' } });
  assert.equal(none.json.professionals.length, 0);
});

test('profesionales: crear sin token → 401; con rol client → 403', async () => {
  const { api, register } = ctx;
  const anon = await api('POST', '/api/professionals', { body: { bio: 'x' } });
  assert.equal(anon.status, 401);
  const client = await register();
  const denied = await api('POST', '/api/professionals', { token: client.token, body: { bio: 'x' } });
  assert.equal(denied.status, 403);
});

test('servicios: seña percent inválida (150) → 400 con mensaje claro', async () => {
  const { api, makePro } = ctx;
  const { token, professional } = await makePro();
  const r = await api('POST', '/api/services', {
    token,
    body: { professional_id: professional.id, name: 'Color', price_gs: 200000, deposit_type: 'percent', deposit_value: 150 },
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /entre 1 y 100/);
});

test('servicios: seña fija mayor que el precio → 400', async () => {
  const { api, makePro } = ctx;
  const { token, professional } = await makePro();
  const r = await api('POST', '/api/services', {
    token,
    body: { professional_id: professional.id, name: 'X', price_gs: 100000, deposit_type: 'fixed', deposit_value: 150000 },
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /no puede ser mayor que el precio/);
});

test('servicios: seña válida (percent y fixed) → 201; edición revalida', async () => {
  const { api, makePro } = ctx;
  const { token, professional } = await makePro();
  const ok = await api('POST', '/api/services', {
    token,
    body: { professional_id: professional.id, name: 'Peinado', price_gs: 180000, deposit_type: 'fixed', deposit_value: 60000 },
  });
  assert.equal(ok.status, 201);
  const bad = await api('PATCH', `/api/services/${ok.json.service.id}`, {
    token, body: { deposit_type: 'percent', deposit_value: 0 },
  });
  assert.equal(bad.status, 400);
});

test('servicios: otro usuario no puede crear servicios ajenos → 403', async () => {
  const { api, makePro, register } = ctx;
  const { professional } = await makePro();
  const intruso = await register();
  const r = await api('POST', '/api/services', {
    token: intruso.token,
    body: { professional_id: professional.id, name: 'Trucho', price_gs: 50000 },
  });
  assert.equal(r.status, 403);
});

test('favoritos: agregar, duplicado → 409, eliminar', async () => {
  const { api, register, makePro } = ctx;
  const { professional } = await makePro();
  const client = await register();
  const add = await api('POST', '/api/favorites', { token: client.token, body: { professional_id: professional.id } });
  assert.equal(add.status, 201);
  const dup = await api('POST', '/api/favorites', { token: client.token, body: { professional_id: professional.id } });
  assert.equal(dup.status, 409);
  const list = await api('GET', '/api/favorites', { token: client.token });
  assert.equal(list.json.favorites.length, 1);
  const del = await api('DELETE', `/api/favorites/${professional.id}`, { token: client.token });
  assert.equal(del.status, 200);
});
