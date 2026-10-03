'use strict';

// Matriz de permisos de roles de equipo: pieza "lista para lanzar" 6.
// - admin puede todo.
// - editor puede agenda/reservas/servicios, pero NO equipo ni finanzas (403).
// - lectura solo lectura: POST/PATCH/DELETE → 403.
// - Sin vínculo con el negocio → 403.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { run } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

async function businessWithTeam() {
  const { api, register } = ctx;
  const owner = await register({ role: 'business' });
  const b = await api('POST', '/api/businesses', {
    token: owner.token,
    body: {
      name: 'Salón Roles', ruc: '80011111-2', categories: ['peluquería'],
      barrio: 'Villa Morra', address: 'Avda. Roles 456',
      services: [{ name: 'Corte', price_gs: 120000, deposit_type: 'percent', deposit_value: 30 }],
      schedule: [{ day: 'lun-vie', open: '09:00', close: '18:00' }],
    },
  });
  assert.equal(b.status, 201);
  const business = b.json.business;
  const service = b.json.services[0];

  async function addMember(permiso) {
    const u = await register({ role: 'pro' });
    const m = await api('POST', '/api/team', {
      token: owner.token,
      body: { business_id: business.id, name: `Miembro ${permiso}`, permiso, user_id: u.user.id },
    });
    assert.equal(m.status, 201, `no se pudo crear el miembro ${permiso}: ${JSON.stringify(m.json)}`);
    return { ...u, permiso };
  }
  const adminT = await addMember('admin');
  const editorT = await addMember('editor');
  const lectorT = await addMember('lectura');
  const outsider = await register();
  const client = await register();
  return { api, owner, business, service, adminT, editorT, lectorT, outsider, client };
}

async function makeBooking(clientId, serviceId) {
  const r = await run(ctx.db,
    `INSERT INTO bookings (client_id, service_id, status, paid_gs, total_gs)
     VALUES (?,?,?,?,?)`,
    [clientId, serviceId, 'pending', 0, 120000]);
  return r.id;
}

test('equipo: solo admin puede gestionar el equipo (POST /api/team)', async () => {
  const { api, owner, business, adminT, editorT, lectorT, outsider } = await businessWithTeam();
  const body = { business_id: business.id, name: 'Ficha nueva' };
  assert.equal((await api('POST', '/api/team', { token: owner.token, body })).status, 201);
  assert.equal((await api('POST', '/api/team', { token: adminT.token, body })).status, 201);
  assert.equal((await api('POST', '/api/team', { token: editorT.token, body })).status, 403);
  assert.equal((await api('POST', '/api/team', { token: lectorT.token, body })).status, 403);
  assert.equal((await api('POST', '/api/team', { token: outsider.token, body })).status, 403);
});

test('equipo: solo admin puede leer el equipo (GET /api/team)', async () => {
  const { api, owner, business, adminT, editorT, lectorT } = await businessWithTeam();
  const q = { business_id: business.id };
  assert.equal((await api('GET', '/api/team', { token: owner.token, query: q })).status, 200);
  assert.equal((await api('GET', '/api/team', { token: adminT.token, query: q })).status, 200);
  assert.equal((await api('GET', '/api/team', { token: editorT.token, query: q })).status, 403);
  assert.equal((await api('GET', '/api/team', { token: lectorT.token, query: q })).status, 403);
});

test('finanzas: solo admin ve el reporte del negocio (GET /api/businesses/:id/stats)', async () => {
  const { api, owner, business, adminT, editorT, lectorT } = await businessWithTeam();
  const path = `/api/businesses/${business.id}/stats`;
  assert.equal((await api('GET', path, { token: owner.token })).status, 200);
  assert.equal((await api('GET', path, { token: adminT.token })).status, 200);
  assert.equal((await api('GET', path, { token: editorT.token })).status, 403);
  assert.equal((await api('GET', path, { token: lectorT.token })).status, 403);
});

test('servicios: admin y editor pueden crear/editar/eliminar; lectura solo GET (403 en writes)', async () => {
  const { api, business, adminT, editorT, lectorT } = await businessWithTeam();
  const mk = (n) => ({ business_id: business.id, name: n, price_gs: 80000 });

  const sA = await api('POST', '/api/services', { token: adminT.token, body: mk('Barba admin') });
  assert.equal(sA.status, 201);
  const sE = await api('POST', '/api/services', { token: editorT.token, body: mk('Barba editor') });
  assert.equal(sE.status, 201);
  const sL = await api('POST', '/api/services', { token: lectorT.token, body: mk('Barba lectura') });
  assert.equal(sL.status, 403);

  // Lectura sí puede leer (endpoint público de catálogo).
  assert.equal((await api('GET', '/api/services', { token: lectorT.token })).status, 200);

  assert.equal((await api('PATCH', `/api/services/${sA.json.service.id}`,
    { token: adminT.token, body: { price_gs: 90000 } })).status, 200);
  assert.equal((await api('PATCH', `/api/services/${sE.json.service.id}`,
    { token: editorT.token, body: { price_gs: 90000 } })).status, 200);
  assert.equal((await api('PATCH', `/api/services/${sA.json.service.id}`,
    { token: lectorT.token, body: { price_gs: 90000 } })).status, 403);

  assert.equal((await api('DELETE', `/api/services/${sA.json.service.id}`, { token: adminT.token })).status, 200);
  assert.equal((await api('DELETE', `/api/services/${sE.json.service.id}`, { token: editorT.token })).status, 200);
  const sL2 = await api('POST', '/api/services', { token: adminT.token, body: mk('Para borrar lectura') });
  assert.equal((await api('DELETE', `/api/services/${sL2.json.service.id}`, { token: lectorT.token })).status, 403);
});

test('reservas: admin y editor pueden cancelar como negocio; lectura → 403', async () => {
  const { api, service, client, adminT, editorT, lectorT } = await businessWithTeam();
  const cancelL = await makeBooking(client.user.id, service.id);
  const rL = await api('POST', `/api/bookings/${cancelL}/cancel`, { token: lectorT.token, body: {} });
  assert.equal(rL.status, 403);

  const cancelE = await makeBooking(client.user.id, service.id);
  const rE = await api('POST', `/api/bookings/${cancelE}/cancel`, { token: editorT.token, body: {} });
  assert.equal(rE.status, 200);
  assert.equal(rE.json.booking.status, 'cancelled');

  const cancelA = await makeBooking(client.user.id, service.id);
  const rA = await api('POST', `/api/bookings/${cancelA}/cancel`, { token: adminT.token, body: {} });
  assert.equal(rA.status, 200);
  assert.equal(rA.json.booking.status, 'cancelled');
});

test('sin vínculo: alguien fuera del equipo no puede leer ni tocar el negocio', async () => {
  const { api, business, outsider } = await businessWithTeam();
  const q = { business_id: business.id };
  assert.equal((await api('GET', '/api/team', { token: outsider.token, query: q })).status, 403);
  assert.equal((await api('GET', `/api/businesses/${business.id}/stats`, { token: outsider.token })).status, 403);
  assert.equal((await api('POST', '/api/services',
    { token: outsider.token, body: { business_id: business.id, name: 'X', price_gs: 1000 } })).status, 403);
});
