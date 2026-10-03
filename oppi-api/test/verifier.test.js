'use strict';

/**
 * Tests del Verificador (equipo IA de Oppi):
 *  - unitarios de src/lib/verifier.js (puros, sin DB): RUC, score, flags.
 *  - integración HTTP: POST /api/businesses/:id/documents acepta
 *    file_url/file_size opcionales (con validación), y
 *    GET /api/admin/verifications incluye `precheck` en cada item.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { precheckBusiness, precheckProfessional } = require('../src/lib/verifier');

const NEGOCIO_OK = { name: 'Salón Che', ruc: '1234567-8', barrio: 'Villa Morra', address: 'Av. España 123' };
const DOCS_OK = [
  { type: 'ruc', file_url: 'https://cdn.oppi.test/ruc.pdf', file_size: 120000 },
  { type: 'habilitacion', file_url: 'https://cdn.oppi.test/hab.pdf', file_size: 80000 },
  { type: 'identidad', file_url: 'https://cdn.oppi.test/id.pdf', file_size: 95000 },
];

test('verifier: negocio con todo completo → score 100 sin flags', () => {
  const r = precheckBusiness(NEGOCIO_OK, DOCS_OK);
  assert.deepEqual(r.flags, []);
  assert.equal(r.score, 100);
});

test('verifier: RUC válido aceptado / inválidos rechazados con flag alta', () => {
  for (const ruc of ['123456-7', '123456789-0', '1234567-8']) {
    const r = precheckBusiness({ ...NEGOCIO_OK, ruc }, DOCS_OK);
    assert.ok(!r.flags.some((f) => f.code === 'ruc-formato-invalido'), `RUC válido marcado: ${ruc}`);
  }
  for (const ruc of ['12345-6', '1234567890-1', '1234567', 'abc-1', '', '1234567-88']) {
    const r = precheckBusiness({ ...NEGOCIO_OK, ruc }, DOCS_OK);
    const f = r.flags.find((f2) => f2.code === 'ruc-formato-invalido');
    assert.ok(f, `RUC inválido no marcado: "${ruc}"`);
    assert.equal(f.severity, 'alta');
    assert.match(f.message, /RUC con formato inválido/);
  }
});

test('verifier: documento sin file_url → flag alta "todavía no subió el archivo"', () => {
  const docs = [{ type: 'ruc', file_url: null, file_size: null }];
  const r = precheckBusiness(NEGOCIO_OK, docs);
  const f = r.flags.find((f2) => f2.code.startsWith('doc-sin-archivo'));
  assert.ok(f, 'falta el flag de archivo no subido');
  assert.equal(f.severity, 'alta');
  assert.match(f.message, /todavía no subió el archivo/i);
});

test('verifier: file_size 0 o null con url → alta "vacío o corrupto"', () => {
  for (const size of [0, null]) {
    const r = precheckBusiness(NEGOCIO_OK, [{ type: 'ruc', file_url: 'https://x.test/a.pdf', file_size: size }]);
    const f = r.flags.find((f2) => f2.code.startsWith('doc-vacio'));
    assert.ok(f, `size=${size} no marcado como vacío`);
    assert.equal(f.severity, 'alta');
    assert.match(f.message, /vacío o corrupto/i);
  }
});

test('verifier: archivo < 5KB → media; > 10MB → baja', () => {
  const chico = precheckBusiness(NEGOCIO_OK, [{ type: 'ruc', file_url: 'https://x.test/a.pdf', file_size: 2000 }]);
  const fChico = chico.flags.find((f) => f.code.startsWith('doc-muy-chico'));
  assert.ok(fChico);
  assert.equal(fChico.severity, 'media');
  assert.match(fChico.message, /muy chico, puede estar corrupto/i);

  const pesado = precheckBusiness(NEGOCIO_OK, [{ type: 'ruc', file_url: 'https://x.test/a.pdf', file_size: 11 * 1024 * 1024 }]);
  const fPesado = pesado.flags.find((f) => f.code.startsWith('doc-muy-pesado'));
  assert.ok(fPesado);
  assert.equal(fPesado.severity, 'baja');
  assert.match(fPesado.message, /muy pesado/i);
});

test('verifier: tipos esperados faltantes → flag media por cada uno', () => {
  const r = precheckBusiness(NEGOCIO_OK, []);
  const faltantes = r.flags.filter((f) => f.code.startsWith('doc-faltante'));
  assert.equal(faltantes.length, 3);
  assert.ok(faltantes.every((f) => f.severity === 'media'));
});

test('verifier: registro incompleto → flag baja por campo vacío', () => {
  const r = precheckBusiness({ name: 'Salón Che', ruc: '1234567-8', barrio: '', address: '  ' }, DOCS_OK);
  const bajos = r.flags.filter((f) => f.severity === 'baja');
  assert.equal(bajos.length, 2, 'barrio y address vacíos deberían dar 2 flags baja');
  assert.equal(r.score, 100 - 5 - 5);
});

test('verifier: el score resta 25/10/5 y tiene piso en 0', () => {
  // 2 altas (25*2) + 3 medias (10*3) + 1 baja (5) = 85 → 25
  const r = precheckBusiness(
    { name: '', ruc: 'mal', barrio: 'Villa Morra', address: 'Av. España 123' },
    [{ type: 'ruc', file_url: null, file_size: null }],
  );
  assert.equal(r.score, 25);
  // Muchas altas no bajan de 0
  const docs = Array.from({ length: 10 }, (_, i) => ({ type: `doc${i}`, file_url: null, file_size: null }));
  const r2 = precheckBusiness({ name: '', ruc: 'x', barrio: '', address: '' }, docs);
  assert.equal(r2.score, 0);
});

test('verifier: profesional completo → score 100', () => {
  const r = precheckProfessional(
    { name: 'Ana Pérez', foto_url: 'https://cdn.oppi.test/ana.jpg' },
    { bio: 'Peluquera con 10 años de experiencia en color y corte.', categories: JSON.stringify(['peluquería']), profession_id: null },
    [{ price_gs: 100000 }],
  );
  assert.deepEqual(r.flags, []);
  assert.equal(r.score, 100);
});

test('verifier: profesional sin foto ni servicios, bio corta y sin categoría', () => {
  const r = precheckProfessional(
    { name: 'Ana Pérez', foto_url: '' },
    { bio: 'Hola', categories: '[]', profession_id: null },
    [],
  );
  const porCodigo = Object.fromEntries(r.flags.map((f) => [f.code, f]));
  assert.equal(porCodigo['foto-faltante'].severity, 'alta');
  assert.equal(porCodigo['bio-corta'].severity, 'media');
  assert.equal(porCodigo['categoria-faltante'].severity, 'media');
  assert.equal(porCodigo['servicios-sin-precio'].severity, 'alta');
  // 25 + 10 + 10 + 25 = 70 → 30
  assert.equal(r.score, 30);
});

test('verifier: profesional sin nombre → flag alta', () => {
  const r = precheckProfessional(
    { name: '  ', foto_url: 'https://cdn.oppi.test/ana.jpg' },
    { bio: 'Peluquera con 10 años de experiencia en color y corte.', categories: '[]', profession_id: 3 },
    [{ price_gs: 50000 }],
  );
  assert.ok(r.flags.some((f) => f.code === 'nombre-faltante' && f.severity === 'alta'));
});

test('verifier: profesión por profession_id también vale como categoría', () => {
  const r = precheckProfessional(
    { name: 'Ana Pérez', foto_url: 'https://cdn.oppi.test/ana.jpg' },
    { bio: 'Peluquera con 10 años de experiencia en color y corte.', categories: '[]', profession_id: 7 },
    [{ price_gs: 50000 }],
  );
  assert.deepEqual(r.flags, []);
});

// ---------- Integración HTTP ----------

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { delete process.env.ADMIN_EMAIL; await ctx.close(); });

let cachedAdmin = null;
async function adminFixture() {
  if (cachedAdmin) return cachedAdmin;
  const { register } = ctx;
  process.env.ADMIN_EMAIL = 'admin-verifier@oppi.test';
  try {
    const admin = await register({ name: 'Admin Verifier', email: 'admin-verifier@oppi.test' });
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
    body: { name: 'Salón Verifier', ruc: '7654321-9', categories: ['peluquería'], barrio: 'Villa Morra', address: 'Av. España 123' },
  });
  assert.equal(r.status, 201);
  return { owner, business: r.json.business };
}

test('documents: POST acepta file_url y file_size opcionales', async () => {
  const { api } = ctx;
  const { owner, business } = await businessFixture();
  const r = await api('POST', `/api/businesses/${business.id}/documents`, {
    token: owner.token,
    body: { type: 'ruc', file_url: 'https://cdn.oppi.test/ruc.pdf', file_size: 120000 },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.document.file_url, 'https://cdn.oppi.test/ruc.pdf');
  assert.equal(r.json.document.file_size, 120000);

  // Sin file_url/file_size sigue funcionando como antes.
  const r2 = await api('POST', `/api/businesses/${business.id}/documents`, {
    token: owner.token,
    body: { type: 'identidad' },
  });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.document.file_url, null);
  assert.equal(r2.json.document.file_size, null);
});

test('documents: POST valida file_url y file_size', async () => {
  const { api } = ctx;
  const { owner, business } = await businessFixture();
  const mala = await api('POST', `/api/businesses/${business.id}/documents`, {
    token: owner.token,
    body: { type: 'ruc', file_url: 'ftp://mal.test/a.pdf' },
  });
  assert.equal(mala.status, 400);
  assert.match(mala.json.error, /http\/https/i);

  const negativa = await api('POST', `/api/businesses/${business.id}/documents`, {
    token: owner.token,
    body: { type: 'habilitacion', file_url: 'https://x.test/a.pdf', file_size: -5 },
  });
  assert.equal(negativa.status, 400);
  assert.match(negativa.json.error, /entero/i);
});

test('verifications: cada item trae precheck con score y flags', async () => {
  const { api, makePro } = ctx;
  const { token } = await adminFixture();
  const { owner: bizOwner, business } = await businessFixture();
  await api('POST', `/api/businesses/${business.id}/documents`, {
  token: bizOwner.token,
  });
  const { professional } = await makePro();

  const r = await api('GET', '/api/admin/verifications', { token });
  assert.equal(r.status, 200);
  const biz = r.json.verifications.find((v) => v.id === `business:${business.id}`);
  assert.ok(biz);
  assert.ok(biz.precheck, 'el item business tiene que traer precheck');
  assert.ok(Number.isInteger(biz.precheck.score) && biz.precheck.score >= 0 && biz.precheck.score <= 100);
  assert.ok(Array.isArray(biz.precheck.flags));
  assert.ok(biz.precheck.flags.length > 0, 'el negocio sin archivo tiene que tener flags');

  const pro = r.json.verifications.find((v) => v.id === `professional:${professional.id}`);
  assert.ok(pro);
  assert.ok(pro.precheck, 'el item professional tiene que traer precheck');
  assert.ok(Number.isInteger(pro.precheck.score));
  // makePro crea servicio con precio y categoría, pero el user no tiene foto → flag alta
  assert.ok(pro.precheck.flags.some((f) => f.code === 'foto-faltante'), 'esperaba flag de foto faltante');
});
