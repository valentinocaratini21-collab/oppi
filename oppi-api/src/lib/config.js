'use strict';

/**
 * Validación de configuración al arrancar (fail-fast).
 *
 * Uso: `require('./lib/config').validateOrExit();` como primera línea del
 * entry point (src/server.js). Si falta una variable requerida, imprime en
 * consola EXACTAMENTE qué falta (nombre de la variable + qué poner) y sale
 * con código 1 en vez de levantar un servidor roto.
 *
 * Reglas:
 *  - JWT_SECRET: siempre requerida. Sin ella los JWT no se pueden firmar.
 *  - CRON_SECRET: solo warning si falta. Sin ella los endpoints de cron
 *    (/api/notifications/generate-reminders, /api/notifications/send-due)
 *    exigen JWT de usuario; el scheduler externo no puede llamarlos con el
 *    header x-cron-secret.
 *  - Pagos / push: se exigen credenciales solo según el provider elegido
 *    (PAYMENT_PROVIDER, PUSH_PROVIDER). Con los defaults (mock) no se pide nada.
 *  - STORAGE_DRIVER=s3 exige sus credenciales; con local no se pide nada.
 *
 * `checkConfig(env)` es pura y testeable: devuelve { errors, warnings }.
 * `validateOrExit()` la evalúa contra process.env y corta el proceso si hay errores.
 */

const PAYMENT_PROVIDERS = ['mock', 'bancard'];
const PUSH_PROVIDERS = ['mock', 'fcm', 'apns'];
const STORAGE_DRIVERS = ['local', 's3'];

const DEV_JWT_PLACEHOLDER = 'oppi-dev-secret';

function checkConfig(env = {}) {
  const errors = [];
  const warnings = [];
  const missing = (k) => !env[k] || !String(env[k]).trim();

  // ---- JWT: siempre requerido ----
  if (missing('JWT_SECRET')) {
    errors.push(
      'Falta la variable requerida JWT_SECRET.\n' +
      '  → Seteala con un secreto largo y aleatorio. Generá uno así:\n' +
      '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  } else if (env.NODE_ENV === 'production' && String(env.JWT_SECRET).trim() === DEV_JWT_PLACEHOLDER) {
    warnings.push(
      `JWT_SECRET tiene el valor de ejemplo de desarrollo ("${DEV_JWT_PLACEHOLDER}").\n` +
      '  → En producción generá uno propio (ver arriba) o cualquiera puede firmar tokens.'
    );
  }

  // ---- CRON_SECRET: warning (no fatal) ----
  if (missing('CRON_SECRET')) {
    warnings.push(
      'Falta CRON_SECRET.\n' +
      '  → Los endpoints de cron (POST /api/notifications/generate-reminders y\n' +
      '    POST /api/notifications/send-due) van a exigir JWT de usuario; el scheduler\n' +
      '    externo no va a poder llamarlos con el header x-cron-secret.\n' +
      '  → Seteala con un secreto aleatorio (mismo comando que JWT_SECRET) y pasala\n' +
      '    al scheduler como header `x-cron-secret: <valor>`.'
    );
  }

  // ---- Pagos: solo según PAYMENT_PROVIDER ----
  const paymentProvider = String(env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  if (!PAYMENT_PROVIDERS.includes(paymentProvider)) {
    errors.push(
      `PAYMENT_PROVIDER desconocido: "${env.PAYMENT_PROVIDER}".\n` +
      `  → Usá uno de: ${PAYMENT_PROVIDERS.join(' | ')}.`
    );
  } else if (paymentProvider === 'bancard') {
    const need = [];
    if (missing('PAYMENT_BANCARD_PUBLIC_KEY')) need.push('PAYMENT_BANCARD_PUBLIC_KEY');
    if (missing('PAYMENT_BANCARD_PRIVATE_KEY')) need.push('PAYMENT_BANCARD_PRIVATE_KEY');
    if (need.length) {
      errors.push(
        `PAYMENT_PROVIDER=bancard pero faltan: ${need.join(' y ')}.\n` +
        '  → Conseguilas en el portal de comercios de Bancard (ver PAGOS.md, checklist de credenciales).'
      );
    }
    const bancardEnv = String(env.PAYMENT_BANCARD_ENV || 'staging').toLowerCase();
    if (!['staging', 'prod'].includes(bancardEnv)) {
      errors.push(
        `PAYMENT_BANCARD_ENV inválido: "${env.PAYMENT_BANCARD_ENV}".\n` +
        '  → Usá "staging" (default) o "prod".'
      );
    }
  }

  // ---- Push: solo según PUSH_PROVIDER ----
  const pushProvider = String(env.PUSH_PROVIDER || 'mock').toLowerCase();
  if (!PUSH_PROVIDERS.includes(pushProvider)) {
    errors.push(
      `PUSH_PROVIDER desconocido: "${env.PUSH_PROVIDER}".\n` +
      `  → Usá uno de: ${PUSH_PROVIDERS.join(' | ')}.`
    );
  } else if (pushProvider === 'fcm') {
    const need = [];
    if (missing('PUSH_FCM_PROJECT_ID')) need.push('PUSH_FCM_PROJECT_ID');
    if (missing('PUSH_FCM_SERVICE_ACCOUNT_JSON')) need.push('PUSH_FCM_SERVICE_ACCOUNT_JSON');
    if (need.length) {
      errors.push(
        `PUSH_PROVIDER=fcm pero faltan: ${need.join(' y ')}.\n` +
        '  → Creá el proyecto en https://console.firebase.google.com y generá una\n' +
        '    clave de cuenta de servicio (ver NOTIFICACIONES.md).'
      );
    }
  } else if (pushProvider === 'apns') {
    const need = ['PUSH_APNS_KEY_ID', 'PUSH_APNS_TEAM_ID', 'PUSH_APNS_KEY_FILE', 'PUSH_APNS_BUNDLE_ID']
      .filter((k) => missing(k));
    if (need.length) {
      errors.push(
        `PUSH_PROVIDER=apns pero faltan: ${need.join(', ')}.\n` +
        '  → Creá una APNs Key (.p8) en https://developer.apple.com/account (ver NOTIFICACIONES.md).'
      );
    }
  }

  // ---- Storage: solo si es s3 ----
  const storage = String(env.STORAGE_DRIVER || 'local').toLowerCase();
  if (!STORAGE_DRIVERS.includes(storage)) {
    errors.push(
      `STORAGE_DRIVER desconocido: "${env.STORAGE_DRIVER}".\n` +
      `  → Usá uno de: ${STORAGE_DRIVERS.join(' | ')}.`
    );
  } else if (storage === 's3') {
    const need = ['STORAGE_S3_ENDPOINT', 'STORAGE_S3_BUCKET', 'STORAGE_S3_REGION', 'STORAGE_S3_KEY', 'STORAGE_S3_SECRET']
      .filter((k) => missing(k));
    if (need.length) {
      errors.push(
        `STORAGE_DRIVER=s3 pero faltan: ${need.join(', ')}.\n` +
        '  → Creá el bucket y generá las access keys (AWS S3, Cloudflare R2 o MinIO).'
      );
    }
  }

  return { errors, warnings };
}

/** Valida process.env; ante errores imprime y sale con código 1. */
function validateOrExit() {
  const { errors, warnings } = checkConfig(process.env);
  for (const w of warnings) {
    console.warn('[config] ADVERTENCIA:\n' + w + '\n');
  }
  if (errors.length) {
    console.error('[config] ERROR: la API no puede arrancar por configuración inválida:\n');
    for (const e of errors) console.error(e + '\n');
    console.error('Completá las variables en tu .env o en el dashboard del hosting (ver .env.example) y reintentá.');
    process.exit(1);
  }
}

module.exports = { checkConfig, validateOrExit, PAYMENT_PROVIDERS, PUSH_PROVIDERS };
