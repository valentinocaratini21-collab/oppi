'use strict';

/**
 * Detalle de servicio (mejora 2):
 * - POST /api/services y PATCH /api/services/:id aceptan photo_url,
 *   description e includes[] (dueño).
 * - Los GET de servicios los exponen con `includes` parseado.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx, api;
before(async () => { ctx = await setup(); api = ctx.api; });
after(() => ctx.close());

test('servicios: crear con detalle (photo_url, description, includes)', async () => {
  const { token, professional } = await ctx.makePro();
  const r = await api('POST', '/api/services', {
    token,
    body: {
      professional_id: professional.id, name: 'Color completo', price_gs: 250000,
      photo_url: 'https://ejemplo.com/foto.jpg',
      description: 'Coloración completa con productos premium.',
      includes: ['Lavado', 'Color', 'Peinado final'],
    },
  });
  assert.equal(r.status, 201);
  const s = r.json.service;
  assert.equal(s.photo_url, 'https://ejemplo.com/foto.jpg');
  assert.equal(s.description, 'Coloración completa con productos premium.');
  assert.deepEqual(s.includes, ['Lavado', 'Color', 'Peinado final']);
});

test('servicios: el GET expone el detalle con includes parseado', async () => {
  const r = await api('GET', '/api/services');
  assert.equal(r.status, 200);
  const s = r.json.services.find((x) => x.name === 'Color completo');
  assert.ok(s, 'tiene que existir el servicio creado');
  assert.equal(s.photo_url, 'https://ejemplo.com/foto.jpg');
  assert.deepEqual(s.includes, ['Lavado', 'Color', 'Peinado final']);
});

test('servicios: el detalle del negocio expone los servicios con detalle', async () => {
  const owner = await ctx.register({ role: 'business', name: 'Dueño Salón' });
  const b = await api('POST', '/api/businesses', {
    token: owner.token,
    body: {
      name: 'Salón Detalle', services: [{ name: 'Corte', price_gs: 100000 }],
    },
  });
  assert.equal(b.status, 201);
  const svcId = b.json.services[0].id;
  const p = await api('PATCH', `/api/services/${svcId}`, {
    token: owner.token,
    body: { description: 'Corte con estilo', includes: ['Lavado', 'Corte'] },
  });
  assert.equal(p.status, 200);
  const g = await api('GET', `/api/businesses/${b.json.business.id}`);
  const s = g.json.services.find((x) => x.id === svcId);
  assert.equal(s.description, 'Corte con estilo');
  assert.deepEqual(s.includes, ['Lavado', 'Corte']);
});

test('servicios: PATCH edita el detalle y lo conserva si no se toca', async () => {
  const { token, professional } = await ctx.makePro();
  const svc = await api('POST', '/api/services', {
    token,
    body: {
      professional_id: professional.id, name: 'Corte clásico', price_gs: 80000,
      description: 'Vieja descripción', includes: ['Corte'],
    },
  });
  assert.equal(svc.status, 201);
  const p = await api('PATCH', `/api/services/${svc.json.service.id}`, {
    token,
    body: { description: 'Nueva descripción', includes: ['Corte', 'Barba'], photo_url: 'https://ejemplo.com/nueva.jpg' },
  });
  assert.equal(p.status, 200);
  assert.equal(p.json.service.description, 'Nueva descripción');
  assert.deepEqual(p.json.service.includes, ['Corte', 'Barba']);
  assert.equal(p.json.service.photo_url, 'https://ejemplo.com/nueva.jpg');
  // Sin tocar el detalle, se conserva
  const p2 = await api('PATCH', `/api/services/${svc.json.service.id}`, {
    token, body: { price_gs: 90000 },
  });
  assert.equal(p2.status, 200);
  assert.deepEqual(p2.json.service.includes, ['Corte', 'Barba']);
  assert.equal(p2.json.service.description, 'Nueva descripción');
});

test('servicios: includes inválido → 400', async () => {
  const { token, professional } = await ctx.makePro();
  const r = await api('POST', '/api/services', {
    token, body: { professional_id: professional.id, name: 'Roto', price_gs: 50000, includes: 'no-es-lista' },
  });
  assert.equal(r.status, 400);
  const ok = await api('POST', '/api/services', {
    token, body: { professional_id: professional.id, name: 'Bien', price_gs: 50000 },
  });
  const p = await api('PATCH', `/api/services/${ok.json.service.id}`, {
    token, body: { includes: 42 },
  });
  assert.equal(p.status, 400);
});

test('servicios: valores por defecto cuando no se pasa detalle', async () => {
  const { token, professional } = await ctx.makePro();
  const r = await api('POST', '/api/services', {
    token, body: { professional_id: professional.id, name: 'Simple', price_gs: 50000 },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.service.photo_url, null);
  assert.equal(r.json.service.description, '');
  assert.deepEqual(r.json.service.includes, []);
});
