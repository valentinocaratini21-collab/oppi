'use strict';

/**
 * Drivers push FCM y APNs: protocolo completo con red simulada.
 * - Errores de config que nombran la variable faltante.
 * - FCM: flujo OAuth2 (JWT RS256 firmado con la service account) + armado
 *   del mensaje HTTP v1.
 * - APNs: JWT ES256 firmado con la .p8 (verificado con la clave pública) +
 *   request HTTP/2 al path correcto con los headers de Apple.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function load() {
  return require('../src/lib/notifications');
}

// ---- fixtures de claves ----
const rsa = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const ec = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const SA_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'oppi-test',
  client_email: 'test@oppi-test.iam.gserviceaccount.com',
  private_key: rsa.privateKey,
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oppi-apns-'));
const P8_PATH = path.join(tmpDir, 'AuthKey_TEST123456.p8');
fs.writeFileSync(P8_PATH, ec.privateKey);

before(() => {
  process.env.PUSH_FCM_PROJECT_ID = 'oppi-test';
  process.env.PUSH_FCM_SERVICE_ACCOUNT_JSON = SA_JSON;
  process.env.PUSH_APNS_KEY_ID = 'TEST123456';
  process.env.PUSH_APNS_TEAM_ID = 'TEAM654321';
  process.env.PUSH_APNS_KEY_FILE = P8_PATH;
  process.env.PUSH_APNS_BUNDLE_ID = 'com.oppi.app';
  process.env.PUSH_APNS_ENV = 'sandbox';
});

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const reply = await handler(url, opts);
    return {
      ok: reply.httpStatus == null || reply.httpStatus < 400,
      status: reply.httpStatus || 200,
      json: async () => reply.json,
    };
  };
  return { fetchImpl, calls };
}

/** http2 simulado: responde con {status, body} y guarda lo que se mandó. */
function fakeHttp2Connect({ status, body }) {
  const seen = {};
  const connect = (authority) => {
    seen.authority = authority;
    const session = {
      request(headers) {
        seen.headers = headers;
        const handlers = {};
        const stream = {
          on(ev, fn) { handlers[ev] = fn; return stream; },
          setTimeout() { return stream; },
          write(chunk) { seen.payload = String(chunk); return true; },
          end() {
            setImmediate(() => {
              if (handlers.response) handlers.response({ ':status': status });
              if (body && handlers.data) handlers.data(Buffer.from(body));
              if (handlers.end) handlers.end();
            });
            return stream;
          },
        };
        return stream;
      },
      close() { seen.closed = true; },
    };
    return session;
  };
  return { connect, seen };
}

// ==================== FCM ====================

test('fcm: sin credenciales → error que nombra la variable faltante', () => {
  const { FcmDriver } = load();
  const s1 = process.env.PUSH_FCM_PROJECT_ID;
  const s2 = process.env.PUSH_FCM_SERVICE_ACCOUNT_JSON;
  delete process.env.PUSH_FCM_PROJECT_ID;
  delete process.env.PUSH_FCM_SERVICE_ACCOUNT_JSON;
  assert.throws(() => new FcmDriver(), /PUSH_FCM_PROJECT_ID.*PUSH_FCM_SERVICE_ACCOUNT_JSON/);
  process.env.PUSH_FCM_PROJECT_ID = s1;
  assert.throws(() => new FcmDriver(), /PUSH_FCM_SERVICE_ACCOUNT_JSON/);
  process.env.PUSH_FCM_SERVICE_ACCOUNT_JSON = s2;
  process.env.PUSH_FCM_SERVICE_ACCOUNT_JSON = 'no-es-json-ni-ruta';
  assert.throws(() => new FcmDriver(), /inválido/);
  process.env.PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'x' });
  assert.throws(() => new FcmDriver(), /client_email.*private_key/);
  process.env.PUSH_FCM_SERVICE_ACCOUNT_JSON = s2;
});

test('fcm: OAuth2 con JWT RS256 + envío HTTP v1 (access token cacheado)', async () => {
  const { FcmDriver } = load();
  const { fetchImpl, calls } = stubFetch(async (url) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return { json: { access_token: 'ya29.test', expires_in: 3600, token_type: 'Bearer' } };
    }
    return { json: { name: 'projects/oppi-test/messages/mid-1' } };
  });
  const d = new FcmDriver({ fetchImpl });
  const r1 = await d.send({ token: 'dev-token-1', platform: 'android', title: 'Hola', body: 'Mundo', data: { a: 1 } });
  assert.equal(r1.ok, true);
  assert.equal(r1.messageId, 'projects/oppi-test/messages/mid-1');

  // Llamada 1: OAuth2 — el assertion es un JWT RS256 bien formado
  const oauthCall = calls[0];
  assert.equal(oauthCall.url, 'https://oauth2.googleapis.com/token');
  const params = new URLSearchParams(oauthCall.opts.body);
  assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, pl, sig] = params.get('assertion').split('.');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).alg, 'RS256');
  const payload = JSON.parse(Buffer.from(pl, 'base64url').toString());
  assert.equal(payload.iss, 'test@oppi-test.iam.gserviceaccount.com');
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.ok(
    crypto.verify('RSA-SHA256', Buffer.from(`${h}.${pl}`), rsa.publicKey, Buffer.from(sig, 'base64url')),
    'la firma RS256 tiene que verificar con la clave pública'
  );

  // Llamada 2: FCM HTTP v1
  const sendCall = calls[1];
  assert.equal(sendCall.url, 'https://fcm.googleapis.com/v1/projects/oppi-test/messages:send');
  assert.equal(sendCall.opts.headers.Authorization, 'Bearer ya29.test');
  const msg = JSON.parse(sendCall.opts.body).message;
  assert.equal(msg.token, 'dev-token-1');
  assert.deepEqual(msg.notification, { title: 'Hola', body: 'Mundo' });
  assert.deepEqual(msg.data, { a: '1' });
  assert.equal(msg.android.priority, 'high');

  // Segundo envío: el access token se reutiliza (OAuth2 no se repite)
  await d.send({ token: 'dev-token-2', platform: 'web', title: 'T2', body: 'B2' });
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1);
});

test('fcm: token muerto (404) → error FCM_BAD_TOKEN', async () => {
  const { FcmDriver } = load();
  const { fetchImpl } = stubFetch(async (url) => {
    if (url.includes('oauth2')) return { json: { access_token: 'ya29.test', expires_in: 3600 } };
    return { httpStatus: 404, json: { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } } };
  });
  const d = new FcmDriver({ fetchImpl });
  const err = await d.send({ token: 'muerto', title: 'T', body: 'B' }).catch((e) => e);
  assert.equal(err.code, 'FCM_BAD_TOKEN');
});

// ==================== APNs ====================

test('apns: sin credenciales → error que nombra las variables faltantes', () => {
  const { ApnsDriver } = load();
  const saved = {};
  for (const k of ['PUSH_APNS_KEY_ID', 'PUSH_APNS_TEAM_ID', 'PUSH_APNS_KEY_FILE', 'PUSH_APNS_BUNDLE_ID']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  assert.throws(
    () => new ApnsDriver(),
    /PUSH_APNS_KEY_ID.*PUSH_APNS_TEAM_ID.*PUSH_APNS_KEY_FILE.*PUSH_APNS_BUNDLE_ID/
  );
  for (const k of Object.keys(saved)) process.env[k] = saved[k];
  process.env.PUSH_APNS_KEY_FILE = '/no/existe/AuthKey.p8';
  assert.throws(() => new ApnsDriver(), /PUSH_APNS_KEY_FILE/);
  process.env.PUSH_APNS_KEY_FILE = saved.PUSH_APNS_KEY_FILE;
});

test('apns: JWT ES256 firmado con la .p8 (verifica con la clave pública)', () => {
  const { ApnsDriver } = load();
  const { connect } = fakeHttp2Connect({ status: 200, body: '' });
  const d = new ApnsDriver({ http2Connect: connect });
  const [h, pl, sig] = d._providerJwt().split('.');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).alg, 'ES256');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).kid, 'TEST123456');
  assert.equal(JSON.parse(Buffer.from(pl, 'base64url').toString()).iss, 'TEAM654321');
  assert.ok(
    crypto.verify(
      'sha256',
      Buffer.from(`${h}.${pl}`),
      { key: ec.publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(sig, 'base64url')
    ),
    'la firma ES256 tiene que verificar con la clave pública P-256'
  );
  // El JWT se cachea
  assert.equal(d._providerJwt(), d._providerJwt());
});

test('apns: send por HTTP/2 al path y headers correctos', async () => {
  const { ApnsDriver } = load();
  const { connect, seen } = fakeHttp2Connect({ status: 200, body: '' });
  const d = new ApnsDriver({ http2Connect: connect });
  const r = await d.send({ token: 'ios-token-abc', title: 'Turno', body: 'Mañana 10:00', data: { type: 'reminder' } });
  assert.equal(r.ok, true);
  assert.equal(seen.authority, 'https://api.sandbox.push.apple.com');
  assert.equal(seen.headers[':method'], 'POST');
  assert.equal(seen.headers[':path'], '/3/device/ios-token-abc');
  assert.match(seen.headers.authorization, /^bearer /);
  assert.equal(seen.headers['apns-topic'], 'com.oppi.app');
  assert.equal(seen.headers['apns-push-type'], 'alert');
  const payload = JSON.parse(seen.payload);
  assert.deepEqual(payload.aps.alert, { title: 'Turno', body: 'Mañana 10:00' });
  assert.equal(payload.type, 'reminder');
  assert.equal(seen.closed, true);
});

test('apns: BadDeviceToken → error APNS_BAD_TOKEN', async () => {
  const { ApnsDriver } = load();
  const { connect } = fakeHttp2Connect({ status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) });
  const d = new ApnsDriver({ http2Connect: connect });
  const err = await d.send({ token: 'muerto', title: 'T', body: 'B' }).catch((e) => e);
  assert.equal(err.code, 'APNS_BAD_TOKEN');
  assert.match(err.message, /BadDeviceToken/);
});
