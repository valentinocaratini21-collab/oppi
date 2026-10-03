'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('perfil: PATCH /api/me actualiza todos los campos y responde el usuario', async () => {
  const { api, register } = ctx;
  const { token, user } = await register();
  const r = await api('PATCH', '/api/me', {
    token,
    body: {
      nombre: 'Valen Caratini', telefono: '+595 981 123 456',
      barrio: 'Villa Morra', foto_url: 'https://ejemplo.com/foto.jpg',
    },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.user, {
    id: user.id, nombre: 'Valen Caratini', email: user.email,
    telefono: '+595 981 123 456', barrio: 'Villa Morra',
    foto_url: 'https://ejemplo.com/foto.jpg', rol: 'client',
  });
});

test('perfil: PATCH /api/me parcial (solo nombre) deja el resto igual', async () => {
  const { api, register } = ctx;
  const { token } = await register({ phone: '0981 999 999' });
  const r = await api('PATCH', '/api/me', { token, body: { nombre: 'Nuevo Nombre' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.nombre, 'Nuevo Nombre');
  assert.equal(r.json.user.telefono, '0981 999 999');
  assert.equal(r.json.user.barrio, null);
});

test('perfil: PATCH /api/me sin token → 401', async () => {
  const { api } = ctx;
  const r = await api('PATCH', '/api/me', { body: { nombre: 'X' } });
  assert.equal(r.status, 401);
});

test('perfil: nombre inválido → 400', async () => {
  const { api, register } = ctx;
  const { token } = await register();
  const corto = await api('PATCH', '/api/me', { token, body: { nombre: 'A' } });
  assert.equal(corto.status, 400);
  assert.match(corto.json.error, /2 y 60/);
  const largo = await api('PATCH', '/api/me', { token, body: { nombre: 'x'.repeat(61) } });
  assert.equal(largo.status, 400);
  const vacio = await api('PATCH', '/api/me', { token, body: { nombre: '   ' } });
  assert.equal(vacio.status, 400);
});

test('perfil: teléfono inválido → 400', async () => {
  const { api, register } = ctx;
  const { token } = await register();
  const letras = await api('PATCH', '/api/me', { token, body: { telefono: 'abc123' } });
  assert.equal(letras.status, 400);
  assert.match(letras.json.error, /teléfono/i);
  const corto = await api('PATCH', '/api/me', { token, body: { telefono: '12345' } });
  assert.equal(corto.status, 400);
  const largo = await api('PATCH', '/api/me', { token, body: { telefono: '1'.repeat(21) } });
  assert.equal(largo.status, 400);
});

test('perfil: barrio de más de 60 caracteres → 400', async () => {
  const { api, register } = ctx;
  const { token } = await register();
  const r = await api('PATCH', '/api/me', { token, body: { barrio: 'x'.repeat(61) } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /60/);
});

test('perfil: foto_url inválida → 400', async () => {
  const { api, register } = ctx;
  const { token } = await register();
  const mala = await api('PATCH', '/api/me', { token, body: { foto_url: 'no-es-url' } });
  assert.equal(mala.status, 400);
  assert.match(mala.json.error, /http/);
  const ftp = await api('PATCH', '/api/me', { token, body: { foto_url: 'ftp://ejemplo.com/f.jpg' } });
  assert.equal(ftp.status, 400);
  const larga = await api('PATCH', '/api/me', { token, body: { foto_url: `https://ejemplo.com/${'x'.repeat(500)}` } });
  assert.equal(larga.status, 400);
});

test('perfil: mandar "" vacía un campo opcional', async () => {
  const { api, register } = ctx;
  const { token } = await register();
  await api('PATCH', '/api/me', { token, body: { telefono: '0981 111 111', barrio: 'Centro' } });
  const r = await api('PATCH', '/api/me', { token, body: { telefono: '', barrio: null } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.telefono, null);
  assert.equal(r.json.user.barrio, null);
});
