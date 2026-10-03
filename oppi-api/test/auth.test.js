'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('auth: registro feliz devuelve usuario + token', async () => {
  const { api } = ctx;
  const { status, json } = await api('POST', '/api/auth/register', {
    body: { name: 'Valen', email: 'valen@oppi.test', password: 'secreto123', role: 'client', terms_accepted: true },
  });
  assert.equal(status, 201);
  assert.ok(json.token);
  assert.equal(json.user.email, 'valen@oppi.test');
  assert.ok(json.user.referral_code.startsWith('OPPI-'));
});

test('auth: registro con email duplicado → 409', async () => {
  const { api } = ctx;
  const { status, json } = await api('POST', '/api/auth/register', {
    body: { name: 'Otro', email: 'valen@oppi.test', password: 'secreto123', terms_accepted: true },
  });
  assert.equal(status, 409);
  assert.match(json.error, /ya está registrado/i);
});

test('auth: registro con datos inválidos → 400', async () => {
  const { api } = ctx;
  const bad1 = await api('POST', '/api/auth/register', { body: { name: 'X', email: 'no-es-email', password: 'secreto123' } });
  assert.equal(bad1.status, 400);
  const bad2 = await api('POST', '/api/auth/register', { body: { name: 'X', email: 'x2@oppi.test', password: '123' } });
  assert.equal(bad2.status, 400);
});

test('auth: login feliz y login con clave mala → 401', async () => {
  const { api } = ctx;
  const ok = await api('POST', '/api/auth/login', { body: { email: 'valen@oppi.test', password: 'secreto123' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token);
  const bad = await api('POST', '/api/auth/login', { body: { email: 'valen@oppi.test', password: 'otra' } });
  assert.equal(bad.status, 401);
});

test('auth: /api/me con token válido y sin token → 401', async () => {
  const { api, register } = ctx;
  const { token, user } = await register();
  const me = await api('GET', '/api/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.id, user.id);
  const anon = await api('GET', '/api/me');
  assert.equal(anon.status, 401);
});

test('auth: token inválido → 401', async () => {
  const { api } = ctx;
  const r = await api('GET', '/api/me', { token: 'invalido' });
  assert.equal(r.status, 401);
});
