'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

/** Negocio con un servicio de Gs. 120.000 y seña del 30%. */
async function businessFixture() {
  const { api, register } = ctx;
  const owner = await register({ role: 'business' });
  const r = await api('POST', '/api/businesses', {
    token: owner.token,
    body: {
      name: 'Salón Cupones', ruc: '80011111-1', categories: ['peluquería'],
      barrio: 'Villa Morra', address: 'Avda. Cupón 123',
      services: [{ name: 'Corte', price_gs: 120000, deposit_type: 'percent', deposit_value: 30 }],
      schedule: [{ day: 'lun-vie', open: '09:00', close: '18:00' }],
    },
  });
  assert.equal(r.status, 201);
  return { api, owner, business: r.json.business, service: r.json.services[0] };
}

test('cupones: crear guarda el código en mayúsculas y lo lista (solo dueño)', async () => {
  const { api, owner, business } = await businessFixture();
  const created = await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token,
    body: { code: 'bienvenida10', type: 'percent', value: 10, max_uses: 100 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.coupon.code, 'BIENVENIDA10');
  assert.equal(created.json.coupon.type, 'percent');
  assert.equal(created.json.coupon.value, 10);
  assert.equal(created.json.coupon.used_count, 0);
  assert.equal(created.json.coupon.active, true);

  const list = await api('GET', `/api/businesses/${business.id}/coupons`, { token: owner.token });
  assert.equal(list.status, 200);
  assert.ok(list.json.coupons.some((c) => c.code === 'BIENVENIDA10'));

  // Un tercero no puede ver ni crear cupones.
  const { register } = ctx;
  const outsider = await register();
  const noList = await api('GET', `/api/businesses/${business.id}/coupons`, { token: outsider.token });
  assert.equal(noList.status, 403);
  const noCreate = await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: outsider.token, body: { code: 'HACK99', type: 'percent', value: 10 },
  });
  assert.equal(noCreate.status, 403);
});

test('cupones: validaciones de creación', async () => {
  const { api, owner, business } = await businessFixture();
  const base = { type: 'percent', value: 10 };
  const bad = [
    [{ ...base, code: 'ABC' }, /entre 4 y 20/],                       // muy corto
    [{ ...base, code: 'ABC 123' }, /entre 4 y 20/],                   // con espacio
    [{ ...base, code: 'A'.repeat(21) }, /entre 4 y 20/],              // muy largo
    [{ code: 'TIPO', type: 'zzz', value: 10 }, /percent o fixed/],    // tipo inválido
    [{ code: 'PERCIEN', type: 'percent', value: 0 }, /mayor a 0/],    // percent 0
    [{ code: 'PERCNOV', type: 'percent', value: 91 }, /90%/],         // percent > 90
    [{ code: 'FIJOCERO', type: 'fixed', value: 0 }, /mayor a 0/],     // fixed 0
    [{ code: 'FIJONEG', type: 'fixed', value: -5 }, /mayor a 0/],     // fixed negativo
    [{ ...base, code: 'FECHAS', valid_from: '2026-12-31', valid_until: '2026-01-01' }, /no puede ser posterior/],
    [{ ...base, code: 'MAXUSO', max_uses: 0 }, /mayor a 0/],
  ];
  for (const [body, re] of bad) {
    const r = await api('POST', `/api/businesses/${business.id}/coupons`, { token: owner.token, body });
    assert.equal(r.status, 400, `esperaba 400 para ${JSON.stringify(body)}: ${JSON.stringify(r.json)}`);
    assert.match(r.json.error, re);
  }
  // Código duplicado en el mismo negocio → 409.
  const dup1 = await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'UNICO5', type: 'percent', value: 5 },
  });
  assert.equal(dup1.status, 201);
  const dup2 = await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'unico5', type: 'percent', value: 5 },
  });
  assert.equal(dup2.status, 409);
  assert.match(dup2.json.error, /ese código/);
});

test('cupones: pausar y activar (solo dueño)', async () => {
  const { api, owner, business } = await businessFixture();
  const c = await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'PAUSA20', type: 'percent', value: 20 },
  });
  const id = c.json.coupon.id;

  const bad = await api('PATCH', `/api/coupons/${id}`, { token: owner.token, body: { active: 2 } });
  assert.equal(bad.status, 400);

  const paused = await api('PATCH', `/api/coupons/${id}`, { token: owner.token, body: { active: 0 } });
  assert.equal(paused.status, 200);
  assert.equal(paused.json.coupon.active, false);

  const active = await api('PATCH', `/api/coupons/${id}`, { token: owner.token, body: { active: 1 } });
  assert.equal(active.status, 200);
  assert.equal(active.json.coupon.active, true);

  const { register } = ctx;
  const outsider = await register();
  const no = await api('PATCH', `/api/coupons/${id}`, { token: outsider.token, body: { active: 0 } });
  assert.equal(no.status, 403);
  const missing = await api('PATCH', '/api/coupons/999999', { token: owner.token, body: { active: 0 } });
  assert.equal(missing.status, 404);
});

test('cupones: validate calcula el descuento percent y fixed', async () => {
  const { api, owner, business, service } = await businessFixture();
  await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'TEST10', type: 'percent', value: 10 },
  });
  await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'FIJO15', type: 'fixed', value: 15000 },
  });

  const p = await api('POST', '/api/coupons/validate', {
    body: { code: 'test10', business_id: business.id, service_id: service.id },
  });
  assert.equal(p.status, 200);
  assert.equal(p.json.valid, true);
  assert.equal(p.json.discount_gs, 12000); // 10% de 120000
  assert.deepEqual(p.json.coupon, { code: 'TEST10', type: 'percent', value: 10 });

  const f = await api('POST', '/api/coupons/validate', {
    body: { code: 'FIJO15', business_id: business.id, service_id: service.id },
  });
  assert.equal(f.json.valid, true);
  assert.equal(f.json.discount_gs, 15000);

  // Código inexistente → inválido.
  const none = await api('POST', '/api/coupons/validate', {
    body: { code: 'NOEXISTE', business_id: business.id, service_id: service.id },
  });
  assert.equal(none.json.valid, false);
  assert.match(none.json.error, /no existe/);

  // validate no cuenta como uso.
  const list = await api('GET', `/api/businesses/${business.id}/coupons`, { token: owner.token });
  assert.equal(list.json.coupons.find((c) => c.code === 'TEST10').used_count, 0);
});

test('cupones: validate rechaza vencido, futuro, pausado y servicio de otro negocio', async () => {
  const { api, owner, business, service } = await businessFixture();
  await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'VENCIDO', type: 'percent', value: 10, valid_until: '2020-01-01' },
  });
  await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'FUTURO', type: 'percent', value: 10, valid_from: '2030-01-01' },
  });
  const paused = await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'PAUSADO', type: 'percent', value: 10 },
  });
  await api('PATCH', `/api/coupons/${paused.json.coupon.id}`, { token: owner.token, body: { active: 0 } });

  const cases = [
    ['VENCIDO', /venció/],
    ['FUTURO', /todavía no está vigente/],
    ['PAUSADO', /pausado/],
  ];
  for (const [code, re] of cases) {
    const r = await api('POST', '/api/coupons/validate', {
      body: { code, business_id: business.id, service_id: service.id },
    });
    assert.equal(r.json.valid, false, `esperaba inválido para ${code}`);
    assert.match(r.json.error, re);
  }

  // Servicio de otro negocio.
  const other = await businessFixture();
  const wrong = await api('POST', '/api/coupons/validate', {
    body: { code: 'VENCIDO', business_id: other.business.id, service_id: other.service.id },
  });
  assert.equal(wrong.json.valid, false);
});

test('cupones: agotado (max_uses) deja de validar', async () => {
  const { api, owner, business, service } = await businessFixture();
  const { register } = ctx;
  const client = await register();
  await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'UNSOLO', type: 'percent', value: 10, max_uses: 1 },
  });
  const v1 = await api('POST', '/api/coupons/validate', {
    body: { code: 'UNSOLO', business_id: business.id, service_id: service.id },
  });
  assert.equal(v1.json.valid, true);
  const b = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, coupon_code: 'UNSOLO' },
  });
  assert.equal(b.status, 201);
  const v2 = await api('POST', '/api/coupons/validate', {
    body: { code: 'UNSOLO', business_id: business.id, service_id: service.id },
  });
  assert.equal(v2.json.valid, false);
  assert.match(v2.json.error, /todas las veces/);
});

test('reservas: con cupón percent aplica descuento sobre el total (sin seña)', async () => {
  const { api, owner, business, service } = await businessFixture();
  const { register } = ctx;
  const client = await register();
  await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'DESC10', type: 'percent', value: 10 },
  });

  const r = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, coupon_code: 'desc10' },
  });
  assert.equal(r.status, 201);
  const b = r.json.booking;
  assert.equal(b.discount_gs, 12000);          // 10% de 120000
  assert.equal(b.total_gs, 108000);            // total con descuento
  assert.equal(b.paid, false);                // el cobro es al confirmar, no al crear
  assert.equal(b.coupon_code, 'DESC10');

  // used_count se incrementó una sola vez.
  const list = await api('GET', `/api/businesses/${business.id}/coupons`, { token: owner.token });
  assert.equal(list.json.coupons.find((c) => c.code === 'DESC10').used_count, 1);
});

test('reservas: con cupón fixed aplica descuento sobre el total (sin seña)', async () => {
  const { api, owner, business, service } = await businessFixture();
  const { register } = ctx;
  const client = await register();
  await api('POST', `/api/businesses/${business.id}/coupons`, {
    token: owner.token, body: { code: 'FIJO15K', type: 'fixed', value: 15000 },
  });

  const r = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, coupon_code: 'FIJO15K' },
  });
  assert.equal(r.status, 201);
  const b = r.json.booking;
  assert.equal(b.discount_gs, 15000);
  assert.equal(b.total_gs, 105000);
  assert.equal(b.paid, false); // el cobro es al confirmar, no al crear
  assert.equal(b.coupon_code, 'FIJO15K');
});

test('reservas: cupón inválido → 400 y no se crea la reserva', async () => {
  const { api, owner, business, service } = await businessFixture();
  const { register } = ctx;
  const client = await register();

  const r = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, coupon_code: 'TRUCHO' },
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /no existe/);

  // No se creó ninguna reserva del cliente.
  const mine = await api('GET', '/api/bookings', { token: client.token });
  assert.equal(mine.json.bookings.length, 0);
});
