'use strict';

/**
 * Taxonomía (mejora 7):
 * - GET /api/taxonomy público con las 8 categorías, profesiones y subcategorías.
 * - Profesionales aceptan profession_id; negocios aceptan category_id.
 * - Migración: el texto libre existente se mapea a la profesión/categoría más
 *   cercana, o queda null.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { run, queryOne, queryAll } = require('../src/db');
const { seedTaxonomy, mapLegacyTaxonomy, bestMatch, TAXONOMY } = require('../src/db/taxonomy');

let ctx, api;
before(async () => { ctx = await setup(); api = ctx.api; });
after(() => ctx.close());

test('taxonomy: GET /api/taxonomy devuelve las 8 categorías con su contenido', async () => {
  const r = await api('GET', '/api/taxonomy');
  assert.equal(r.status, 200);
  const cats = r.json.categories;
  assert.equal(cats.length, 8);
  assert.deepEqual(cats.map((c) => c.nombre),
    ['Belleza', 'Hogar', 'Salud', 'Deportes', 'Educación', 'Eventos', 'Mascotas', 'Más']);
  for (const c of cats) {
    assert.ok(c.icono, `${c.nombre} tiene que tener icono`);
    assert.ok(c.professions.length >= 4 && c.professions.length <= 8,
      `${c.nombre}: ${c.professions.length} profesiones (esperaba 4-8)`);
    assert.ok(c.subcategories.length >= 3 && c.subcategories.length <= 6,
      `${c.nombre}: ${c.subcategories.length} subcategorías (esperaba 3-6)`);
    for (const p of c.professions) assert.ok(p.id && p.nombre);
    for (const s of c.subcategories) assert.ok(s.id && s.nombre);
  }
});

test('taxonomy: el seed es idempotente', async () => {
  const again = await seedTaxonomy(ctx.db);
  assert.equal(again.seeded, false);
  const n = await queryOne(ctx.db, 'SELECT COUNT(*) AS n FROM categories');
  assert.equal(Number(n.n), 8);
});

test('taxonomy: profesional elige su profesión', async () => {
  const { token, professional } = await ctx.makePro();
  const tax = await api('GET', '/api/taxonomy');
  const belleza = tax.json.categories.find((c) => c.nombre === 'Belleza');
  const peluquero = belleza.professions.find((p) => p.nombre === 'Peluquero/a');
  assert.ok(peluquero);

  const p = await api('PATCH', `/api/professionals/${professional.id}`, {
    token, body: { profession_id: peluquero.id },
  });
  assert.equal(p.status, 200);
  assert.equal(p.json.professional.profession_id, peluquero.id);
  assert.equal(p.json.professional.profession_name, 'Peluquero/a');

  // El GET público también la expone
  const g = await api('GET', `/api/professionals/${professional.id}`);
  assert.equal(g.json.professional.profession_id, peluquero.id);
  assert.equal(g.json.professional.profession_name, 'Peluquero/a');

  // Se puede limpiar con null
  const clear = await api('PATCH', `/api/professionals/${professional.id}`, {
    token, body: { profession_id: null },
  });
  assert.equal(clear.status, 200);
  assert.equal(clear.json.professional.profession_id, null);

  // Profesión inexistente → 400
  const bad = await api('PATCH', `/api/professionals/${professional.id}`, {
    token, body: { profession_id: 99999 },
  });
  assert.equal(bad.status, 400);
});

test('taxonomy: profesional se crea con profession_id', async () => {
  const { token } = await ctx.register({ role: 'pro', name: 'Pro Tax' });
  const tax = await api('GET', '/api/taxonomy');
  const h = tax.json.categories.find((c) => c.nombre === 'Hogar');
  const plomero = h.professions.find((p) => p.nombre === 'Plomero/a');
  const r = await api('POST', '/api/professionals', {
    token, body: { bio: 'Plomero', categories: [], profession_id: plomero.id },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.professional.profession_name, 'Plomero/a');
});

test('taxonomy: negocio elige su categoría', async () => {
  const owner = await ctx.register({ role: 'business', name: 'Dueña Tax' });
  const tax = await api('GET', '/api/taxonomy');
  const belleza = tax.json.categories.find((c) => c.nombre === 'Belleza');
  const b = await api('POST', '/api/businesses', {
    token: owner.token,
    body: { name: 'Salón Tax', category_id: belleza.id, services: [{ name: 'Corte', price_gs: 100000 }] },
  });
  assert.equal(b.status, 201);
  assert.equal(b.json.business.category_id, belleza.id);
  assert.equal(b.json.business.category_name, 'Belleza');

  // Cambiarla por PATCH
  const hogar = tax.json.categories.find((c) => c.nombre === 'Hogar');
  const p = await api('PATCH', `/api/businesses/${b.json.business.id}`, {
    token: owner.token, body: { category_id: hogar.id },
  });
  assert.equal(p.status, 200);
  assert.equal(p.json.business.category_name, 'Hogar');

  // Categoría inexistente → 400
  const bad = await api('PATCH', `/api/businesses/${b.json.business.id}`, {
    token: owner.token, body: { category_id: 99999 },
  });
  assert.equal(bad.status, 400);
});

test('taxonomy: mapeo de texto libre existente a profesión/categoría', async () => {
  // Profesionales con texto libre viejo y sin profession_id
  const { token: t1 } = await ctx.register({ role: 'pro', name: 'Plomero Viejo' });
  const p1 = await api('POST', '/api/professionals', {
    token: t1, body: { bio: 'Plomería', categories: ['plomería'] },
  });
  const { token: t2 } = await ctx.register({ role: 'pro', name: 'Raro' });
  const p2 = await api('POST', '/api/professionals', {
    token: t2, body: { bio: 'X', categories: ['zzzzzz-no-existe'] },
  });
  // Negocio con texto libre viejo
  const owner = await ctx.register({ role: 'business', name: 'Dueña Vieja' });
  const b = await api('POST', '/api/businesses', {
    token: owner.token, body: { name: 'Salón Viejo', categories: ['peluquería'] },
  });

  const mapped = await mapLegacyTaxonomy(ctx.db);
  assert.ok(mapped.professionals >= 1, 'tiene que mapear al menos al plomero');

  const pro1 = await queryOne(ctx.db, 'SELECT profession_id FROM professionals WHERE id = ?', [p1.json.professional.id]);
  assert.ok(pro1.profession_id, 'plomería → profession_id seteado');
  const prof = await queryOne(ctx.db,
    'SELECT pr.nombre, c.nombre AS cat FROM professions pr JOIN categories c ON c.id = pr.category_id WHERE pr.id = ?',
    [pro1.profession_id]);
  assert.equal(prof.nombre, 'Plomero/a');
  assert.equal(prof.cat, 'Hogar');

  // Sin coincidencia razonable → null
  const pro2 = await queryOne(ctx.db, 'SELECT profession_id FROM professionals WHERE id = ?', [p2.json.professional.id]);
  assert.equal(pro2.profession_id, null);

  const biz = await queryOne(ctx.db, 'SELECT category_id FROM businesses WHERE id = ?', [b.json.business.id]);
  assert.ok(biz.category_id, 'peluquería → category_id seteado');
  const cat = await queryOne(ctx.db, 'SELECT nombre FROM categories WHERE id = ?', [biz.category_id]);
  assert.equal(cat.nombre, 'Belleza');

  // Idempotente: segunda corrida no remapea
  const mapped2 = await mapLegacyTaxonomy(ctx.db);
  assert.equal(mapped2.professionals, 0);
  assert.equal(mapped2.businesses, 0);
});

test('taxonomy: bestMatch coincide por prefijo común (rioplatense)', () => {
  const cands = [{ id: 1, nombre: 'Peluquero/a' }, { id: 2, nombre: 'Plomero/a' }];
  assert.equal(bestMatch('peluquería', cands).id, 1);
  assert.equal(bestMatch('electricidad', [{ id: 3, nombre: 'Electricista' }]).id, 3);
  assert.equal(bestMatch('masajes', [{ id: 4, nombre: 'Masajista' }]).id, 4);
  assert.equal(bestMatch('xyz-nada', cands), null);
  assert.equal(TAXONOMY.length, 8);
});

test('taxonomy: search con rubro sigue funcionando tras la taxonomía', async () => {
  const r = await api('GET', '/api/search', { query: { rubro: 'peluquería' } });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.results));
});
