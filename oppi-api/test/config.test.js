'use strict';

/**
 * Validación de config al arrancar (src/lib/config.js): función pura
 * checkConfig(env) → { errors, warnings }.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkConfig } = require('../src/lib/config');

const BASE = { JWT_SECRET: 'secreto-largo-de-test' };

test('config: sin JWT_SECRET → error que nombra la variable', () => {
  const { errors } = checkConfig({});
  assert.ok(errors.some((e) => /JWT_SECRET/.test(e)), 'el error tiene que decir JWT_SECRET');
});

test('config: sin CRON_SECRET → warning (no error)', () => {
  const { errors, warnings } = checkConfig(BASE);
  assert.equal(errors.length, 0);
  assert.ok(warnings.some((w) => /CRON_SECRET/.test(w)), 'el warning tiene que decir CRON_SECRET');
});

test('config: defaults mock no piden nada', () => {
  const { errors, warnings } = checkConfig({ ...BASE, CRON_SECRET: 'x' });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('config: bancard sin keys → error que nombra ambas variables', () => {
  const { errors } = checkConfig({ ...BASE, PAYMENT_PROVIDER: 'bancard' });
  assert.ok(errors.some((e) => /PAYMENT_BANCARD_PUBLIC_KEY/.test(e)));
  assert.ok(errors.some((e) => /PAYMENT_BANCARD_PRIVATE_KEY/.test(e)));
});

test('config: bancard con keys → sin errores', () => {
  const { errors } = checkConfig({
    ...BASE, PAYMENT_PROVIDER: 'bancard',
    PAYMENT_BANCARD_PUBLIC_KEY: 'pub', PAYMENT_BANCARD_PRIVATE_KEY: 'priv',
  });
  assert.deepEqual(errors, []);
});

test('config: PAYMENT_PROVIDER desconocido → error con las opciones', () => {
  const { errors } = checkConfig({ ...BASE, PAYMENT_PROVIDER: 'mercadopago' });
  assert.ok(errors.some((e) => /PAYMENT_PROVIDER desconocido/.test(e) && /mock \| bancard/.test(e)));
});

test('config: fcm sin credenciales → error que nombra las variables', () => {
  const { errors } = checkConfig({ ...BASE, PUSH_PROVIDER: 'fcm' });
  assert.ok(errors.some((e) => /PUSH_FCM_PROJECT_ID/.test(e) && /PUSH_FCM_SERVICE_ACCOUNT_JSON/.test(e)));
});

test('config: apns sin credenciales → error que nombra las 4 variables', () => {
  const { errors } = checkConfig({ ...BASE, PUSH_PROVIDER: 'apns' });
  const e = errors.find((x) => /PUSH_APNS_KEY_ID/.test(x));
  assert.ok(e, 'tiene que nombrar PUSH_APNS_KEY_ID');
  for (const k of ['PUSH_APNS_TEAM_ID', 'PUSH_APNS_KEY_FILE', 'PUSH_APNS_BUNDLE_ID']) {
    assert.ok(e.includes(k), `tiene que nombrar ${k}`);
  }
});

test('config: s3 sin credenciales → error', () => {
  const { errors } = checkConfig({ ...BASE, STORAGE_DRIVER: 's3' });
  assert.ok(errors.some((e) => /STORAGE_S3_ENDPOINT/.test(e)));
});

test('config: JWT de ejemplo en producción → warning', () => {
  const { warnings } = checkConfig({ JWT_SECRET: 'oppi-dev-secret', NODE_ENV: 'production' });
  assert.ok(warnings.some((w) => /JWT_SECRET/.test(w) && /producción/.test(w)));
});
