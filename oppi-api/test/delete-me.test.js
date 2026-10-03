'use strict';

// DELETE /api/me: pieza "lista para lanzar" 3.
// - Con la contraseña correcta: anonimiza (nombre "Usuario eliminado",
//   email/teléfono NULL) e invalida la sesión.
// - Con la contraseña incorrecta: 401 y no borra nada.
// - Sin contraseña: 400.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryOne } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('eliminar cuenta: sin contraseña → 400', async () => {
  const { api, register } = ctx;
  const { token } = await register();
  const r = await api('DELETE', '/api/me', { token, body: {} });
  assert.equal(r.status, 400);
});

test('eliminar cuenta: contraseña incorrecta → 401 y no borra nada', async () => {
  const { api, register } = ctx;
  const email = `noborrar@oppi.test`;
  const { token, user } = await register({ email, password: 'secreto123' });
  const r = await api('DELETE', '/api/me', { token, body: { password: 'otraclave' } });
  assert.equal(r.status, 401);
  // La cuenta sigue intacta: el login funciona y los datos no se tocaron.
  const login = await api('POST', '/api/auth/login', { body: { email, password: 'secreto123' } });
  assert.equal(login.status, 200);
  const row = await queryOne(ctx.db, 'SELECT * FROM users WHERE id = ?', [user.id]);
  assert.equal(row.name, 'Test User');
  assert.equal(row.email, email);
  assert.equal(row.deleted_at, null);
});

test('eliminar cuenta: contraseña correcta → anonimiza e invalida la sesión', async () => {
  const { api, register } = ctx;
  const email = `borrarme@oppi.test`;
  const { token, user } = await register({ email, phone: '0981 111 222', password: 'secreto123' });
  const r = await api('DELETE', '/api/me', { token, body: { password: 'secreto123' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const row = await queryOne(ctx.db, 'SELECT * FROM users WHERE id = ?', [user.id]);
  assert.equal(row.name, 'Usuario eliminado');
  assert.equal(row.email, null);
  assert.equal(row.phone, null);
  assert.ok(row.deleted_at, 'deleted_at debería estar marcado');
  // La sesión queda invalidada: el mismo token ya no sirve.
  const me = await api('GET', '/api/me', { token });
  assert.equal(me.status, 401);
  // Y el login con el email viejo tampoco: ya no existe.
  const login = await api('POST', '/api/auth/login', { body: { email, password: 'secreto123' } });
  assert.equal(login.status, 401);
});
