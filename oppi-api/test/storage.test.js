'use strict';

/**
 * Storage: LocalDriver + endpoint POST /api/uploads.
 * - Unit: save → el archivo existe en disco; delete lo borra.
 * - Driver: default local; s3 sin credenciales → error claro.
 * - HTTP: sin token → 401; binario → 201 + GET de la url devuelve los bytes;
 *   data_url JSON → 201; formato inválido → 400.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

// PNG mínimo de 1x1 (bytes reales).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

test('local driver: save guarda en disco y delete lo borra', async () => {
  const { LocalDriver } = require('../src/lib/storage');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oppi-up-'));
  const d = new LocalDriver(dir);
  const { url, key } = await d.save(PNG_1PX, { filename: 'foto.png', contentType: 'image/png' });
  assert.match(url, /^\/uploads\//);
  assert.ok(fs.existsSync(path.join(dir, key)), 'el archivo tiene que existir en disco');
  assert.deepEqual(fs.readFileSync(path.join(dir, key)), PNG_1PX);
  await d.delete(key);
  assert.ok(!fs.existsSync(path.join(dir, key)), 'delete lo tiene que borrar');
  fs.rmdirSync(dir);
});

test('local driver: el nombre en disco es aleatorio (no usa el filename del usuario)', async () => {
  const { LocalDriver } = require('../src/lib/storage');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oppi-up-'));
  const d = new LocalDriver(dir);
  const a = await d.save(PNG_1PX, { filename: '../../etc/passwd', contentType: 'image/png' });
  const b = await d.save(PNG_1PX, { filename: '../../etc/passwd', contentType: 'image/png' });
  assert.notEqual(a.key, b.key);
  assert.ok(!a.key.includes('..') && !a.key.includes('/'));
  await d.delete(a.key); await d.delete(b.key);
  fs.rmdirSync(dir);
});

test('driver: default local; s3 sin credenciales → error claro', async () => {
  delete process.env.STORAGE_DRIVER;
  const { getStorageProvider } = require('../src/lib/storage');
  assert.equal(getStorageProvider().name, 'local');
  process.env.STORAGE_DRIVER = 's3';
  assert.throws(() => getStorageProvider(), /STORAGE_S3_ENDPOINT/);
  process.env.STORAGE_DRIVER = 'local';
  assert.equal(getStorageProvider().name, 'local');
});

test('uploads: sin token → 401', async () => {
  const { api, base } = ctx;
  const r = await fetch(`${base}/api/uploads?filename=f.png`, {
    method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG_1PX,
  });
  assert.equal(r.status, 401);
  // Por el helper JSON (sin token) también 401:
  const noAuth = await api('POST', '/api/uploads', { body: { filename: 'f.png', data_url: 'data:image/png;base64,xx' } });
  assert.equal(noAuth.status, 401);
});

test('uploads: binario → 201 y la url descarga los mismos bytes', async () => {
  const { api, register, base } = ctx;
  const u = await register();
  const up = await fetch(`${base}/api/uploads?filename=foto.png`, {
    method: 'POST',
    headers: { authorization: `Bearer ${u.token}`, 'content-type': 'image/png' },
    body: PNG_1PX,
  });
  assert.equal(up.status, 201);
  const { file } = await up.json();
  assert.match(file.url, /^\/uploads\//);
  assert.equal(file.content_type, 'image/png');
  assert.equal(file.size_bytes, PNG_1PX.length);
  // Descargar la url pública: tiene que devolver los bytes originales.
  const down = await fetch(`${base}${file.url}`);
  assert.equal(down.status, 200);
  assert.ok(Buffer.from(await down.arrayBuffer()).equals(PNG_1PX));
});

test('uploads: JSON con data_url → 201; formato inválido → 400', async () => {
  const { api, register } = ctx;
  const u = await register();
  const dataUrl = `data:image/png;base64,${PNG_1PX.toString('base64')}`;
  const ok = await api('POST', '/api/uploads', { token: u.token, body: { filename: 'a.png', data_url: dataUrl } });
  assert.equal(ok.status, 201);
  assert.match(ok.json.file.url, /^\/uploads\//);
  const bad = await api('POST', '/api/uploads', { token: u.token, body: { filename: 'a.txt', data_url: 'data:text/plain;base64,SG9sYQ==' } });
  assert.equal(bad.status, 400);
  const empty = await api('POST', '/api/uploads', { token: u.token, body: {} });
  assert.equal(empty.status, 400);
});
