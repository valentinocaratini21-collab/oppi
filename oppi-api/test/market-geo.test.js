'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

const VM = { lat: -25.2907, lng: -57.5725 }; // Villa Morra
const SA = { lat: -25.3036, lng: -57.6060 }; // Sajonia (~3.7 km de Villa Morra)

async function publicar(token, body) {
  return ctx.api('POST', '/api/tasks', { token, body });
}

test('tareas geo: publicar con coords las guarda', async () => {
  const { token } = await ctx.register();
  const r = await publicar(token, {
    title: 'Geo con coords', category: 'plomería', barrio: 'Villa Morra',
    lat: VM.lat, lng: VM.lng,
  });
  assert.equal(r.status, 201, `publicar con coords: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.task.lat, VM.lat);
  assert.equal(r.json.task.lng, VM.lng);

  const get = await ctx.api('GET', `/api/tasks/${r.json.task.id}`);
  assert.equal(get.status, 200);
  assert.equal(get.json.task.lat, VM.lat);
  assert.equal(get.json.task.lng, VM.lng);
});

test('tareas geo: publicar sin coords sigue andando', async () => {
  const { token } = await ctx.register();
  const r = await publicar(token, { title: 'Geo sin coords', category: 'pintura', barrio: 'Sajonia' });
  assert.equal(r.status, 201, `publicar sin coords: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.task.lat, null);
  assert.equal(r.json.task.lng, null);
});

test('tareas geo: coords fuera de rango o incompletas → 400', async () => {
  const { token } = await ctx.register();
  const base = { title: 'Geo mala', category: 'pintura' };
  const latFuera = await publicar(token, { ...base, lat: 200, lng: VM.lng });
  assert.equal(latFuera.status, 400);
  const lngFuera = await publicar(token, { ...base, lat: VM.lat, lng: -200 });
  assert.equal(lngFuera.status, 400);
  const noNumero = await publicar(token, { ...base, lat: 'abc', lng: VM.lng });
  assert.equal(noNumero.status, 400);
  const incompleta = await publicar(token, { ...base, lat: VM.lat });
  assert.equal(incompleta.status, 400);
  assert.ok(incompleta.json.error);
});

test('tareas geo: GET con lat/lng devuelve distance_km y ordena por distancia', async () => {
  const { token } = await ctx.register();
  await publicar(token, { title: 'Geo lejos SA', category: 'jardinería', barrio: 'Sajonia', lat: SA.lat, lng: SA.lng });
  await publicar(token, { title: 'Geo cerca VM', category: 'jardinería', barrio: 'Villa Morra', lat: VM.lat, lng: VM.lng });
  const r = await ctx.api('GET', '/api/tasks', { query: { lat: VM.lat, lng: VM.lng, category: 'jardinería' } });
  assert.equal(r.status, 200);
  const names = r.json.tasks.map((t) => t.title);
  assert.deepEqual(names, ['Geo cerca VM', 'Geo lejos SA']);
  assert.deepEqual(r.json.tasks.map((t) => t.distance_km), [0, 3.7]);
  for (const t of r.json.tasks) {
    assert.ok(Number.isInteger(t.distance_km * 10), 'distance_km con 1 decimal');
  }
});

test('tareas geo: a igual distancia, las urgentes van primero', async () => {
  const { token } = await ctx.register();
  await publicar(token, { title: 'Geo normal VM', category: 'fletes', barrio: 'Villa Morra', lat: VM.lat, lng: VM.lng });
  await publicar(token, { title: 'Geo urgente VM', category: 'fletes', barrio: 'Villa Morra', lat: VM.lat, lng: VM.lng, urgent: true });
  const r = await ctx.api('GET', '/api/tasks', { query: { lat: VM.lat, lng: VM.lng, category: 'fletes' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.tasks.map((t) => t.title), ['Geo urgente VM', 'Geo normal VM']);
  assert.ok(r.json.tasks.every((t) => t.distance_km === 0));
});

test('tareas geo: radio_km filtra fuera del radio', async () => {
  const { token } = await ctx.register();
  await publicar(token, { title: 'Geo radio VM', category: 'electricidad', barrio: 'Villa Morra', lat: VM.lat, lng: VM.lng });
  await publicar(token, { title: 'Geo radio SA', category: 'electricidad', barrio: 'Sajonia', lat: SA.lat, lng: SA.lng });
  const chico = await ctx.api('GET', '/api/tasks', {
    query: { lat: VM.lat, lng: VM.lng, category: 'electricidad', radio_km: 1 },
  });
  assert.equal(chico.status, 200);
  assert.deepEqual(chico.json.tasks.map((t) => t.title), ['Geo radio VM']);
  assert.ok(chico.json.tasks.every((t) => t.distance_km <= 1));

  const grande = await ctx.api('GET', '/api/tasks', {
    query: { lat: VM.lat, lng: VM.lng, category: 'electricidad', radio_km: 10 },
  });
  assert.equal(grande.status, 200);
  assert.deepEqual(grande.json.tasks.map((t) => t.title), ['Geo radio VM', 'Geo radio SA']);
});

test('tareas geo: tareas sin coords quedan afuera con lat/lng, y sin lat/lng no hay distance_km', async () => {
  const { token } = await ctx.register();
  await publicar(token, { title: 'Geo con coords dos', category: 'carpintería', lat: VM.lat, lng: VM.lng });
  await publicar(token, { title: 'Geo sin coords dos', category: 'carpintería' });

  const geo = await ctx.api('GET', '/api/tasks', { query: { lat: VM.lat, lng: VM.lng, category: 'carpintería' } });
  assert.ok(geo.json.tasks.some((t) => t.title === 'Geo con coords dos'));
  assert.ok(!geo.json.tasks.some((t) => t.title === 'Geo sin coords dos'));

  const plano = await ctx.api('GET', '/api/tasks', { query: { category: 'carpintería' } });
  assert.equal(plano.status, 200);
  assert.ok(plano.json.tasks.some((t) => t.title === 'Geo sin coords dos'));
  assert.ok(plano.json.tasks.every((t) => !('distance_km' in t)));
});

test('tareas geo: lat/lng inválidos en el GET → 400', async () => {
  const mala = await ctx.api('GET', '/api/tasks', { query: { lat: 'abc', lng: VM.lng } });
  assert.equal(mala.status, 400);
  const incompleta = await ctx.api('GET', '/api/tasks', { query: { lat: VM.lat } });
  assert.equal(incompleta.status, 400);
  const radioMalo = await ctx.api('GET', '/api/tasks', { query: { lat: VM.lat, lng: VM.lng, radio_km: -5 } });
  assert.equal(radioMalo.status, 400);
});
