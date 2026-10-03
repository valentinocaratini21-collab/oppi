'use strict';

/**
 * Filtros de búsqueda (mejora 3):
 * - min_price / max_price filtran por precio del servicio.
 * - disponibilidad = hoy | manana | semana filtra por turnos libres.
 * - orden = relevancia | precio_asc | precio_desc | rating | distancia.
 * - Compatibilidad con los params existentes (q, rubro, lat, lng, radio_km).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { run } = require('../src/db');

let ctx, api;
before(async () => {
  ctx = await setup();
  api = ctx.api;
  // Barato (50k), rating 5, turno libre HOY
  await makeProFull({ name: 'Ana Barata', price: 50000, rating: 5, slotDate: todayStr() });
  // Caro (200k), rating 4, turno libre MAÑANA
  await makeProFull({ name: 'Beto Caro', price: 200000, rating: 4, slotDate: tomorrowStr() });
  // Medio (100k), rating 3, sin turnos
  await makeProFull({ name: 'Ceci Media', price: 100000, rating: 3, slotDate: null });
});
after(() => ctx.close());

const pad = (n) => String(n).padStart(2, '0');
const fmtDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => fmtDay(new Date());
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return fmtDay(d); };

async function makeProFull({ name, price, rating, slotDate }) {
  const { token } = await ctx.register({ role: 'pro', name });
  const p = await api('POST', '/api/professionals', {
    token, body: { bio: `Bio de ${name}`, categories: ['peluquería'], barrio: 'Villa Morra' },
  });
  assert.equal(p.status, 201);
  const proId = p.json.professional.id;
  const s = await api('POST', '/api/services', {
    token, body: { professional_id: proId, name: `Servicio de ${name}`, price_gs: price },
  });
  assert.equal(s.status, 201);
  await run(ctx.db, 'UPDATE professionals SET rating = ? WHERE id = ?', [rating, proId]);
  if (slotDate) {
    const sl = await api('POST', '/api/slots', {
      token, body: { professional_id: proId, date: slotDate, time: '10:00' },
    });
    assert.equal(sl.status, 201);
  }
  return { proId, token };
}

const names = (r) => r.json.results.map((x) => x.name);

test('search: min_price y max_price filtran por precio del servicio', async () => {
  const r = await api('GET', '/api/search', { query: { min_price: 60000, max_price: 150000 } });
  assert.equal(r.status, 200);
  assert.deepEqual(names(r), ['Ceci Media']);
});

test('search: solo min_price', async () => {
  const r = await api('GET', '/api/search', { query: { min_price: 150000 } });
  assert.equal(r.status, 200);
  assert.deepEqual(names(r), ['Beto Caro']);
});

test('search: solo max_price', async () => {
  const r = await api('GET', '/api/search', { query: { max_price: 80000 } });
  assert.equal(r.status, 200);
  assert.deepEqual(names(r), ['Ana Barata']);
});

test('search: precio inválido → 400', async () => {
  for (const q of [{ min_price: -1 }, { max_price: 'abc' }, { min_price: 200000, max_price: 100000 }]) {
    const r = await api('GET', '/api/search', { query: q });
    assert.equal(r.status, 400, `esperaba 400 para ${JSON.stringify(q)}`);
  }
});

test('search: disponibilidad=hoy filtra por turnos libres de hoy', async () => {
  const r = await api('GET', '/api/search', { query: { disponibilidad: 'hoy' } });
  assert.equal(r.status, 200);
  assert.deepEqual(names(r), ['Ana Barata']);
});

test('search: disponibilidad=manana', async () => {
  const r = await api('GET', '/api/search', { query: { disponibilidad: 'manana' } });
  assert.equal(r.status, 200);
  assert.deepEqual(names(r), ['Beto Caro']);
});

test('search: disponibilidad=semana incluye hoy y mañana', async () => {
  const r = await api('GET', '/api/search', { query: { disponibilidad: 'semana' } });
  assert.equal(r.status, 200);
  assert.deepEqual(new Set(names(r)), new Set(['Ana Barata', 'Beto Caro']));
});

test('search: disponibilidad inválida → 400', async () => {
  const r = await api('GET', '/api/search', { query: { disponibilidad: 'ayer' } });
  assert.equal(r.status, 400);
});

test('search: orden=precio_asc y precio_desc', async () => {
  const asc = await api('GET', '/api/search', { query: { orden: 'precio_asc' } });
  assert.equal(asc.status, 200);
  assert.deepEqual(names(asc), ['Ana Barata', 'Ceci Media', 'Beto Caro']);
  const desc = await api('GET', '/api/search', { query: { orden: 'precio_desc' } });
  assert.equal(desc.status, 200);
  assert.deepEqual(names(desc), ['Beto Caro', 'Ceci Media', 'Ana Barata']);
});

test('search: orden=rating y relevancia', async () => {
  const r = await api('GET', '/api/search', { query: { orden: 'rating' } });
  assert.equal(r.status, 200);
  assert.deepEqual(names(r), ['Ana Barata', 'Beto Caro', 'Ceci Media']);
  const rel = await api('GET', '/api/search', { query: { orden: 'relevancia' } });
  assert.equal(rel.status, 200);
  assert.deepEqual(names(rel), ['Ana Barata', 'Beto Caro', 'Ceci Media']);
});

test('search: orden inválido → 400', async () => {
  const r = await api('GET', '/api/search', { query: { orden: 'magia' } });
  assert.equal(r.status, 400);
});

test('search: orden=distancia sin geo → 400; con geo → 200 ordenado', async () => {
  const sinGeo = await api('GET', '/api/search', { query: { orden: 'distancia' } });
  assert.equal(sinGeo.status, 400);
  // Poner coordenadas distintas para verificar el orden por distancia
  const rows = await (async () => {
    const { queryAll } = require('../src/db');
    return queryAll(ctx.db, 'SELECT id FROM professionals ORDER BY id');
  })();
  const coords = [
    { lat: -25.2907, lng: -57.5725 }, // Ana: Villa Morra (punto de búsqueda)
    { lat: -25.2635, lng: -57.5759 }, // Beto: Centro (~3 km)
    { lat: -25.3036, lng: -57.6060 }, // Ceci: Sajonia (~4.6 km)
  ];
  for (let i = 0; i < rows.length; i++) {
    await run(ctx.db, 'UPDATE professionals SET lat = ?, lng = ? WHERE id = ?',
      [coords[i].lat, coords[i].lng, rows[i].id]);
  }
  const conGeo = await api('GET', '/api/search', {
    query: { orden: 'distancia', lat: -25.2907, lng: -57.5725 },
  });
  assert.equal(conGeo.status, 200);
  assert.deepEqual(names(conGeo), ['Ana Barata', 'Beto Caro', 'Ceci Media']);
  for (const p of conGeo.json.results) {
    assert.equal(typeof p.distance_km, 'number');
  }
});

test('search: resultados traen precio_desde', async () => {
  const r = await api('GET', '/api/search', { query: { q: 'Ana Barata' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.results[0].precio_desde, 50000);
});

test('search: compatibilidad con q + filtros combinados', async () => {
  const r = await api('GET', '/api/search', {
    query: { q: 'Barata', min_price: 10000, disponibilidad: 'hoy', orden: 'precio_asc' },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(names(r), ['Ana Barata']);
  // rubro sigue funcionando
  const r2 = await api('GET', '/api/search', { query: { rubro: 'peluquería' } });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.results.length, 3);
});
