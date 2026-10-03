'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

async function businessFixture() {
  const { api, register } = ctx;
  const owner = await register({ role: 'business' });
  const r = await api('POST', '/api/businesses', {
    token: owner.token,
    body: {
      name: 'Salón Test', ruc: '80099999-1', categories: ['peluquería'],
      barrio: 'Villa Morra', address: 'Avda. Test 123',
      services: [{ name: 'Corte', price_gs: 120000, deposit_type: 'percent', deposit_value: 30 }],
      schedule: [{ day: 'lun-vie', open: '09:00', close: '18:00' }],
    },
  });
  return { api, owner, business: r.json.business, services: r.json.services };
}

test('negocios: alta en 3 pasos (datos+servicio+horario) queda pending', async () => {
  const { business, services } = await businessFixture();
  assert.equal(business.verification_status, 'pending');
  assert.equal(business.name, 'Salón Test');
  assert.deepEqual(business.schedule, [{ day: 'lun-vie', open: '09:00', close: '18:00' }]);
  assert.equal(services.length, 1);
  assert.equal(services[0].name, 'Corte');
});

test('negocios: alta con servicio con seña inválida → 400 y no crea nada', async () => {
  const { api, register } = ctx;
  const owner = await register({ role: 'business' });
  const r = await api('POST', '/api/businesses', {
    token: owner.token,
    body: {
      name: 'Salón Roto', categories: [],
      services: [{ name: 'X', price_gs: 50000, deposit_type: 'percent', deposit_value: 200 }],
    },
  });
  assert.equal(r.status, 400);
  const list = await api('GET', '/api/businesses', { query: { barrio: 'zzz' } });
  assert.ok(!list.json.businesses.some((b) => b.name === 'Salón Roto'));
});

test('negocios: cualquier cuenta puede dar de alta → pasa a rol business', async () => {
  const { api, register } = ctx;
  const client = await register();
  const r = await api('POST', '/api/businesses', {
token: client.token,
    body: { name: 'Nuevo Negocio', services: [{ name: 'Corte', price_gs: 50000 }] },
  });
  assert.equal(r.status, 201);
  const me = await api('GET', '/api/me', { token: client.token });
  assert.equal(me.json.user.role, 'business');
});

test('negocios: documentos como checklist (pendiente → aprobado)', async () => {
  const { api, owner, business } = await businessFixture();
  const add = await api('POST', `/api/businesses/${business.id}/documents`, {
    token: owner.token, body: { type: 'ruc' },
  });
  assert.equal(add.status, 201);
  assert.equal(add.json.document.status, 'pending');
  const dup = await api('POST', `/api/businesses/${business.id}/documents`, {
    token: owner.token, body: { type: 'ruc' },
  });
  assert.equal(dup.status, 409);
  const ok = await api('PATCH', `/api/businesses/${business.id}/documents/${add.json.document.id}`, {
    token: owner.token, body: { status: 'approved' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.document.status, 'approved');
  const list = await api('GET', `/api/businesses/${business.id}/documents`, { token: owner.token });
  assert.ok(list.json.documents.some((d) => d.type === 'ruc' && d.status === 'approved'));
});

test('negocios: equipo CRUD solo el dueño', async () => {
  const { api, owner, business } = await businessFixture();
  const { register } = ctx;
  const add = await api('POST', '/api/team', {
    token: owner.token, body: { business_id: business.id, name: 'Laura', role: 'Estilista', services: ['Corte'] },
  });
  assert.equal(add.status, 201);
  const list = await api('GET', '/api/team', { token: owner.token, query: { business_id: business.id } });
  assert.equal(list.json.team.length, 1);

  const intruso = await register({ role: 'business' });
  const denied = await api('POST', '/api/team', {
    token: intruso.token, body: { business_id: business.id, name: 'X' },
  });
  assert.equal(denied.status, 403);

  const del = await api('DELETE', `/api/team/${add.json.member.id}`, { token: owner.token });
  assert.equal(del.status, 200);
});

test('negocios: perfil público incluye servicios, equipo y documentos', async () => {
  const { api, owner, business } = await businessFixture();
  await api('POST', '/api/team', {
    token: owner.token, body: { business_id: business.id, name: 'Nadia', role: 'Manicura' },
  });
  const pub = await api('GET', `/api/businesses/${business.id}`); // sin token
  assert.equal(pub.status, 200);
  assert.equal(pub.json.services.length, 1);
  assert.equal(pub.json.team.length, 1);
});
