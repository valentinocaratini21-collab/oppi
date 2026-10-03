'use strict';

/**
 * Helper de tests: levanta la app en un puerto efímero y expone un cliente
 * HTTP mínimo (fetch nativo, sin dependencias extra).
 *
 * - Sin DATABASE_URL → SQLite en memoria (default, `npm test`).
 * - Con DATABASE_URL → Postgres: crea una DB fresca por archivo de test
 *   (aislamiento total, como el ':memory:' de SQLite) y la borra al cerrar.
 *   Uso: DATABASE_URL=postgres://... node --test test/*.test.js
 */
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../src/app');
const { closeDb } = require('../src/db');

let counter = 0;

function pgSsl() {
  return process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
}

async function setup() {
  let testDbName = null;
  let adminPool = null;
  let originalDbUrl = null;

  // Sin CANCELLATION_PILOT_MODE explícito, los tests corren con el piloto
  // APAGADO: ejercitan el motor viejo de reembolsos. Los tests de la nueva
  // política setean CANCELLATION_PILOT_MODE=true antes de requerir este helper.
  if (!('CANCELLATION_PILOT_MODE' in process.env)) {
    process.env.CANCELLATION_PILOT_MODE = 'false';
  }

  if (process.env.DATABASE_URL) {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    originalDbUrl = process.env.DATABASE_URL;
    const adminUrl = new URL(originalDbUrl);
    adminUrl.pathname = '/postgres';
    adminPool = new Pool({ connectionString: adminUrl.toString(), ssl: pgSsl() });
    counter += 1;
    testDbName = `oppi_test_${process.pid}_${counter}_${Date.now() % 100000}`;
    await adminPool.query(`CREATE DATABASE "${testDbName}"`);
    const testUrl = new URL(originalDbUrl);
    testUrl.pathname = `/${testDbName}`;
    process.env.DATABASE_URL = testUrl.toString();
  }

  const { app, db } = await createApp({ dbPath: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, path, { token, body, query } = {}) {
    const url = new URL(path, base);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* sin cuerpo */ }
    return { status: res.status, json };
  }

  async function register(overrides = {}) {
    counter += 1;
    const body = {
      name: 'Test User', email: `test${counter}@oppi.test`, phone: '0981 000 000',
      password: 'secreto123', role: 'client', terms_accepted: true, ...overrides,
    };
    const { status, json } = await api('POST', '/api/auth/register', { body });
    assert.equal(status, 201, `register falló: ${JSON.stringify(json)}`);
    return json; // { user, token }
  }

  /** Crea un profesional completo: usuario pro + perfil + servicio + turno. */
  async function makePro(overrides = {}) {
    const { user, token } = await register({ role: 'pro', ...overrides });
    const p = await api('POST', '/api/professionals', {
      token, body: { bio: 'Bio de prueba', categories: ['peluquería'], barrio: 'Villa Morra' },
    });
    assert.equal(p.status, 201);
    const s = await api('POST', '/api/services', {
      token,
      body: { professional_id: p.json.professional.id, name: 'Corte', price_gs: 100000, deposit_type: 'percent', deposit_value: 30 },
    });
    assert.equal(s.status, 201);
    const slot = await api('POST', '/api/slots', {
      token, body: { professional_id: p.json.professional.id, date: '2026-10-10', time: '10:00' },
    });
    assert.equal(slot.status, 201);
    return { user, token, professional: p.json.professional, service: s.json.service, slot: slot.json.slot };
  }

  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeDb(db);
    if (testDbName) {
      try {
        await adminPool.query(`DROP DATABASE "${testDbName}" WITH (FORCE)`);
      } finally {
        await adminPool.end();
      }
      process.env.DATABASE_URL = originalDbUrl;
    }
  };
  return { api, register, makePro, db, close, base };
}

module.exports = { setup };
