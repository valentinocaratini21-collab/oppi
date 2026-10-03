'use strict';

// terms_accepted: pieza "lista para lanzar" 1.
// - Registro sin terms_accepted: true → 400.
// - Registro con el flag → 201 y terms_accepted_at guardado en la DB.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryOne } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('términos: registro sin terms_accepted → 400 y no crea el usuario', async () => {
  const { api } = ctx;
  const email = 'sinterminos1@oppi.test';
  const r = await api('POST', '/api/auth/register', {
    body: { name: 'Sin Términos', email, password: 'secreto123', role: 'client' },
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /términos/i);
  const row = await queryOne(ctx.db, 'SELECT id FROM users WHERE email = ?', [email]);
  assert.equal(row, undefined);
});

test('términos: terms_accepted en false o string → 400 (solo vale true)', async () => {
  const { api } = ctx;
  const rFalse = await api('POST', '/api/auth/register', {
    body: { name: 'Falso', email: 'falso@oppi.test', password: 'secreto123', terms_accepted: false },
  });
  assert.equal(rFalse.status, 400);
  const rStr = await api('POST', '/api/auth/register', {
    body: { name: 'String', email: 'string@oppi.test', password: 'secreto123', terms_accepted: 'true' },
  });
  assert.equal(rStr.status, 400);
});

test('términos: registro con terms_accepted: true → 201 y guarda terms_accepted_at', async () => {
  const { api } = ctx;
  const email = 'conterminos1@oppi.test';
  const before = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const r = await api('POST', '/api/auth/register', {
    body: { name: 'Con Términos', email, password: 'secreto123', role: 'client', terms_accepted: true },
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.token);
  const row = await queryOne(ctx.db,
    'SELECT terms_accepted_at FROM users WHERE id = ?', [r.json.user.id]);
  assert.ok(row.terms_accepted_at, 'terms_accepted_at debería estar guardado');
  assert.match(row.terms_accepted_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(row.terms_accepted_at >= before, 'terms_accepted_at debería ser de este momento');
});
