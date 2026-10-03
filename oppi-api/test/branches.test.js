'use strict';

/**
 * Sucursales (mejora 1):
 * - CRUD de branches con validación de dueño.
 * - GET público, POST/PATCH/DELETE solo el dueño.
 * - Reservas aceptan branch_id opcional, validado contra el negocio.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

async function businessFixture(name = 'Salón Test') {
  const { api, register } = ctx;
  const owner = await register({ role: 'business', name: 'Dueño' });
  const r = await api('POST', '/api/businesses', {
    token: owner.token,
    body: {
      name, categories: ['peluquería'], barrio: 'Villa Morra',
      services: [{ name: 'Corte', price_gs: 120000 }],
    },
  });
  assert.equal(r.status, 201);
  return { api, owner, business: r.json.business, service: r.json.services[0] };
}

test('sucursales: CRUD completo del dueño', async () => {
  const { api, owner, business } = await businessFixture('Salón CRUD');
  // Crear
  const created = await api('POST', `/api/businesses/${business.id}/branches`, {
    token: owner.token,
    body: { nombre: 'Sucursal Villa Morra', direccion: 'Avda. Test 123', telefono: '0981 111 111', horario: 'lun-vie 9-18' },
  });
  assert.equal(created.status, 201);
  const branch = created.json.branch;
  assert.equal(branch.nombre, 'Sucursal Villa Morra');
  assert.equal(branch.business_id, business.id);
  assert.equal(branch.direccion, 'Avda. Test 123');
  // GET público (sin token)
  const list = await api('GET', `/api/businesses/${business.id}/branches`);
  assert.equal(list.status, 200);
  assert.ok(list.json.branches.some((b) => b.id === branch.id));
  // Editar
  const patched = await api('PATCH', `/api/branches/${branch.id}`, {
    token: owner.token, body: { telefono: '0981 222 222', lat: -25.28, lng: -57.57 },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.branch.telefono, '0981 222 222');
  assert.equal(patched.json.branch.lat, -25.28);
  // Borrar
  const del = await api('DELETE', `/api/branches/${branch.id}`, { token: owner.token });
  assert.equal(del.status, 200);
  const list2 = await api('GET', `/api/businesses/${business.id}/branches`);
  assert.ok(!list2.json.branches.some((b) => b.id === branch.id));
});

test('sucursales: crear sin nombre → 400', async () => {
  const { api, owner, business } = await businessFixture('Salón Sin Nombre');
  const r = await api('POST', `/api/businesses/${business.id}/branches`, {
    token: owner.token, body: { direccion: 'Calle X' },
  });
  assert.equal(r.status, 400);
});

test('sucursales: otro usuario no puede crear/editar/borrar (403)', async () => {
  const { api, owner, business } = await businessFixture('Salón Ajeno');
  const intruso = await ctx.register({ name: 'Intruso' });
  const created = await api('POST', `/api/businesses/${business.id}/branches`, {
    token: owner.token, body: { nombre: 'Sucursal 1' },
  });
  const branchId = created.json.branch.id;

  const c = await api('POST', `/api/businesses/${business.id}/branches`, {
    token: intruso.token, body: { nombre: 'Sucursal trucha' },
  });
  assert.equal(c.status, 403);
  const p = await api('PATCH', `/api/branches/${branchId}`, {
    token: intruso.token, body: { nombre: 'Hack' },
  });
  assert.equal(p.status, 403);
  const d = await api('DELETE', `/api/branches/${branchId}`, { token: intruso.token });
  assert.equal(d.status, 403);
  // La sucursal sigue intacta
  const list = await api('GET', `/api/businesses/${business.id}/branches`);
  assert.equal(list.json.branches[0].nombre, 'Sucursal 1');
});

test('sucursales: negocio inexistente → 404', async () => {
  const { api, register } = ctx;
  const u = await register();
  const r = await api('GET', '/api/businesses/99999/branches');
  assert.equal(r.status, 404);
  const r2 = await api('POST', '/api/businesses/99999/branches', {
    token: u.token, body: { nombre: 'X' },
  });
  assert.equal(r2.status, 404);
  const r3 = await api('PATCH', '/api/branches/99999', { token: u.token, body: { nombre: 'X' } });
  assert.equal(r3.status, 404);
});

test('reservas: aceptan branch_id válido y lo exponen', async () => {
  const { api, owner, business, service } = await businessFixture('Salón Reserva');
  const branch = (await api('POST', `/api/businesses/${business.id}/branches`, {
    token: owner.token, body: { nombre: 'Sucursal Centro' },
  })).json.branch;
  const client = await ctx.register({ name: 'Cliente' });
  const r = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, branch_id: branch.id },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.booking.branch_id, branch.id);
  assert.equal(r.json.booking.branch_name, 'Sucursal Centro');
  // El GET la trae también
  const g = await api('GET', `/api/bookings/${r.json.booking.id}`, { token: client.token });
  assert.equal(g.json.booking.branch_id, branch.id);
  assert.equal(g.json.booking.branch_name, 'Sucursal Centro');
});

test('reservas: branch_id de otro negocio → 400', async () => {
  const { api, service } = await businessFixture('Salón Uno');
  const otro = await businessFixture('Salón Dos');
  const branchOtro = (await api('POST', `/api/businesses/${otro.business.id}/branches`, {
    token: otro.owner.token, body: { nombre: 'Sucursal Otro' },
  })).json.branch;
  const client = await ctx.register({ name: 'Cliente 2' });
  const r = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, branch_id: branchOtro.id },
  });
  assert.equal(r.status, 400);
  assert.ok(!r.json.booking, 'la reserva no se tiene que crear');
});

test('reservas: branch_id inexistente → 404; en servicio de profesional → 400', async () => {
  const { api, owner, business, service } = await businessFixture('Salón Tres');
  const client = await ctx.register({ name: 'Cliente 3' });
  const r = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, branch_id: 99999 },
  });
  assert.equal(r.status, 404);

  // Una sucursal real, pero usada en un servicio de profesional → 400.
  const realBranch = (await api('POST', `/api/businesses/${business.id}/branches`, {
    token: owner.token, body: { nombre: 'Sucursal Real' },
  })).json.branch;
  const pro = await ctx.makePro();
  const r3 = await api('POST', '/api/bookings', {
    token: client.token,
    body: { service_id: pro.service.id, branch_id: realBranch.id },
  });
  assert.equal(r3.status, 400);
  assert.match(r3.json.error, /profesional/);
});

test('sucursales: reserva sin branch_id sigue funcionando (opcional)', async () => {
  const { api, service } = await businessFixture('Salón Opcional');
  const client = await ctx.register({ name: 'Cliente 4' });
  const r = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.booking.branch_id, null);
});
