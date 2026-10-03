'use strict';

/**
 * Tests del panel admin (pieza "lista para lanzar" 1) + ajustes de
 * compatibilidad web/móvil:
 *  - auth: sin token → 401, no-admin → 403.
 *  - overview: las 6 métricas.
 *  - verifications: lista negocios y profesionales pendientes.
 *  - approve/reject con alias 'approved'/'rejected' (móvil) y
 *    'approve'/'reject' (web); al aprobar se limpia "En verificación".
 *  - suspend/unsuspend: bloquea login y se puede revertir.
 *  - GET /api/admin/users?q=: búsqueda de usuarios.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryOne } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { delete process.env.ADMIN_EMAIL; await ctx.close(); });

/** Crea un admin vía ADMIN_EMAIL (se lee en el registro, sin hardcodear).
 * Idempotente: la DB se comparte entre los tests del archivo. */
let cachedAdmin = null;
async function adminFixture() {
  if (cachedAdmin) return cachedAdmin;
  const { register } = ctx;
  process.env.ADMIN_EMAIL = 'admin@oppi.test';
  try {
    const admin = await register({ name: 'Admin Oppi', email: 'admin@oppi.test' });
    assert.equal(admin.user.is_admin, true);
    cachedAdmin = admin;
    return admin;
  } finally {
    delete process.env.ADMIN_EMAIL;
  }
}

async function businessFixture() {
  const { api, register } = ctx;
  const owner = await register({ role: 'business' });
  const r = await api('POST', '/api/businesses', {
    token: owner.token,
    body: { name: 'Salón Admin', categories: ['peluquería'], barrio: 'Villa Morra' },
  });
  assert.equal(r.status, 201);
  return { owner, business: r.json.business };
}

test('admin: sin token → 401; no-admin → 403', async () => {
  const { api, register } = ctx;
  const anon = await api('GET', '/api/admin/overview');
  assert.equal(anon.status, 401);
  const { token } = await register();
  const denied = await api('GET', '/api/admin/overview', { token });
  assert.equal(denied.status, 403);
  assert.match(denied.json.error, /administradores/i);
});

test('admin: overview devuelve las 6 métricas', async () => {
  const { api } = ctx;
  const { token } = await adminFixture();
  const r = await api('GET', '/api/admin/overview', { token });
  assert.equal(r.status, 200);
  for (const k of ['users', 'bookings_today', 'bookings_week', 'gross_income_gs', 'no_shows', 'suspended']) {
    assert.ok(Number.isInteger(r.json[k]), `falta ${k}`);
  }
  assert.ok(r.json.users >= 1);
});

test('admin: verifications lista negocios y profesionales pendientes', async () => {
  const { api, makePro } = ctx;
  const { token } = await adminFixture();
  const { owner, business } = await businessFixture();
  const doc = await api('POST', `/api/businesses/${business.id}/documents`, {
    token: owner.token, body: { type: 'ruc' },
  });
  assert.equal(doc.status, 201);
  const { professional } = await makePro();

  const r = await api('GET', '/api/admin/verifications', { token });
  assert.equal(r.status, 200);
  const biz = r.json.verifications.find((v) => v.id === `business:${business.id}`);
  assert.ok(biz, 'el negocio pendiente tiene que estar en la cola');
  assert.equal(biz.type, 'business');
  assert.equal(biz.name, 'Salón Admin');
  assert.deepEqual(biz.documents, [{ label: 'RUC', url: null }]);
  assert.ok(biz.submitted_at);
  const pro = r.json.verifications.find((v) => v.id === `professional:${professional.id}`);
  assert.ok(pro, 'el profesional no verificado tiene que estar en la cola');
  assert.equal(pro.type, 'professional');
  assert.deepEqual(pro.documents, []);
});

test('admin: approve con alias "approved" limpia el badge "En verificación"', async () => {
  const { api } = ctx;
  const { token } = await adminFixture();
  const { owner, business } = await businessFixture();
  await api('POST', `/api/businesses/${business.id}/documents`, {
    token: owner.token, body: { type: 'ruc' },
  });
  const r = await api('POST', `/api/admin/verifications/business:${business.id}`, {
    token, body: { decision: 'approved' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.verification_status, 'verified');
  const pub = await api('GET', `/api/businesses/${business.id}`);
  assert.equal(pub.json.business.verification_status, 'verified');
  // Ya no aparece en la cola de pendientes.
  const q = await api('GET', '/api/admin/verifications', { token });
  assert.ok(!q.json.verifications.some((v) => v.id === `business:${business.id}`));
});

test('admin: reject con alias "rejected" guarda el motivo y no verifica', async () => {
  const { api, makePro } = ctx;
  const { token } = await adminFixture();
  const { professional } = await makePro();
  const r = await api('POST', `/api/admin/verifications/professional:${professional.id}`, {
    token, body: { decision: 'rejected', reason: 'La foto del documento está borrosa.' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.verified, false);
  const row = await queryOne(ctx.db, 'SELECT verified, verification_note FROM professionals WHERE id = ?', [professional.id]);
  assert.equal(Number(row.verified), 0);
  assert.match(row.verification_note, /borrosa/);
  // Sigue en la cola de pendientes.
  const q = await api('GET', '/api/admin/verifications', { token });
  assert.ok(q.json.verifications.some((v) => v.id === `professional:${professional.id}`));
});

test('admin: decisión inválida → 400; id inválido → 400; inexistente → 404', async () => {
  const { api } = ctx;
  const { token } = await adminFixture();
  const { business } = await businessFixture();
  const bad = await api('POST', `/api/admin/verifications/business:${business.id}`, {
    token, body: { decision: 'maybe' },
  });
  assert.equal(bad.status, 400);
  const badId = await api('POST', '/api/admin/verifications/123', {
    token, body: { decision: 'approve' },
  });
  assert.equal(badId.status, 400);
  const missing = await api('POST', '/api/admin/verifications/business:999999', {
    token, body: { decision: 'approve' },
  });
  assert.equal(missing.status, 404);
});

test('admin: suspend bloquea el login; unsuspend lo restaura', async () => {
  const { api, register } = ctx;
  const { token } = await adminFixture();
  const { user } = await register({ name: 'Suspendible', email: 'susp@oppi.test' });

  const s = await api('POST', `/api/admin/users/${user.id}/suspend`, { token });
  assert.equal(s.status, 200);
  assert.equal(s.json.user.suspended, true);

  const login = await api('POST', '/api/auth/login', {
    body: { email: 'susp@oppi.test', password: 'secreto123' },
  });
  assert.equal(login.status, 403);
  assert.match(login.json.error, /suspendida/i);

  const u = await api('POST', `/api/admin/users/${user.id}/unsuspend`, { token });
  assert.equal(u.status, 200);
  assert.equal(u.json.user.suspended, false);
  const loginOk = await api('POST', '/api/auth/login', {
    body: { email: 'susp@oppi.test', password: 'secreto123' },
  });
  assert.equal(loginOk.status, 200);
});

test('admin: no se puede suspender a sí mismo; inexistente → 404', async () => {
  const { api } = ctx;
  const { token, user } = await adminFixture();
  const self = await api('POST', `/api/admin/users/${user.id}/suspend`, { token });
  assert.equal(self.status, 400);
  const missing = await api('POST', '/api/admin/users/999999/suspend', { token });
  assert.equal(missing.status, 404);
});

test('admin: GET /api/admin/users?q= busca por nombre, email e id', async () => {
  const { api, register } = ctx;
  const { token } = await adminFixture();
  const { user } = await register({ name: 'María González', email: 'maria.g@oppi.test' });

  const byName = await api('GET', '/api/admin/users', { token, query: { q: 'maría' } });
  assert.equal(byName.status, 200);
  assert.ok(byName.json.users.some((u) => u.id === user.id));

  const byEmail = await api('GET', '/api/admin/users', { token, query: { q: 'maria.g@oppi' } });
  assert.ok(byEmail.json.users.some((u) => u.id === user.id));

  const byId = await api('GET', '/api/admin/users', { token, query: { q: String(user.id) } });
  assert.ok(byId.json.users.some((u) => u.id === user.id));

  const none = await api('GET', '/api/admin/users', { token, query: { q: 'zzz-sin-coincidencias' } });
  assert.deepEqual(none.json.users, []);

  const all = await api('GET', '/api/admin/users', { token });
  assert.equal(all.status, 200);
  assert.ok(all.json.users.length >= 1);
  const found = all.json.users.find((u) => u.id === user.id);
  assert.deepEqual(Object.keys(found).sort(), ['email', 'id', 'is_admin', 'name', 'suspended']);
  assert.equal(found.is_admin, false);
  assert.equal(found.suspended, false);

  // no-admin → 403
  const { token: clientToken } = await register();
  const denied = await api('GET', '/api/admin/users', { token: clientToken, query: { q: 'maría' } });
  assert.equal(denied.status, 403);
});
