'use strict';

/**
 * Notificaciones — servicio + drivers de envío.
 *
 * Flujo:
 *  1. Las rutas llaman a `notify(db, { userId, type, title, body })` en cada
 *     evento de negocio (reserva creada/confirmada, oferta recibida, etc.).
 *     Eso ENCOLA la notificación en la tabla `notifications` (visible en el
 *     centro de notificaciones de la app por polling) — nunca rompe el flujo
 *     principal si falla.
 *  2. El envío push real lo hace `NotificationService.sendDue()`: toma las
 *     notificaciones con `scheduled_for` vencido y `push_sent = 0`, las manda
 *     vía el PushDriver configurado y las marca como enviadas. Lo corre un
 *     worker/cron (ver POST /api/notifications/send-due).
 *
 * Driver elegido por env `PUSH_PROVIDER` (default: `mock`):
 *  - mock → MockDriver: no manda nada afuera, solo guarda en DB.
 *  - fcm  → FcmDriver (Android/web): necesita PUSH_FCM_PROJECT_ID y
 *           PUSH_FCM_SERVICE_ACCOUNT_JSON. Implementación completa con la
 *           API FCM HTTP v1 (OAuth2 con la service account, sin dependencias
 *           externas: usa node:crypto + fetch).
 *  - apns → ApnsDriver (iOS): necesita PUSH_APNS_KEY_ID, PUSH_APNS_TEAM_ID,
 *           PUSH_APNS_KEY_FILE y PUSH_APNS_BUNDLE_ID. Implementación completa
 *           con el provider API de APNs por HTTP/2 (JWT ES256 firmado con la
 *           .p8, sin dependencias externas: usa node:crypto + node:http2).
 *
 * TODO(CREDENCIAL): solo faltan las credenciales del dueño (ver
 * NOTIFICACIONES.md). El protocolo está implementado de punta a punta.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { queryAll, queryOne, run } = require('../db');

const NOTIFICATION_TYPES = ['reminder', 'review_request', 'waitlist', 'booking', 'referral', 'offer', 'quote', 'job', 'review', 'support'];

/**
 * Mapeo tipo de notificación → preferencia del usuario (pieza "lista para
 * lanzar" 5). Claves de /api/me/notification-prefs:
 *   reminders → reminder, review_request, waitlist
 *   offers    → offer, quote
 *   messages  → booking, job, review, support
 *   promos    → referral
 */
const NOTIF_PREF_BY_TYPE = {
  reminder: 'reminders', review_request: 'reminders', waitlist: 'reminders',
  offer: 'offers', quote: 'offers',
  booking: 'messages', job: 'messages', review: 'messages', support: 'messages',
  referral: 'promos',
};
const NOTIF_PREF_KEYS = ['reminders', 'offers', 'messages', 'promos'];

/** Preferencias efectivas de un usuario (sin fila → todo activado). */
async function getNotificationPrefs(db, userId) {
  const row = await queryOne(db, 'SELECT * FROM notification_prefs WHERE user_id = ?', [userId]);
  const prefs = {};
  for (const k of NOTIF_PREF_KEYS) prefs[k] = row ? Boolean(row[k]) : true;
  return prefs;
}

/** base64url de un string/Buffer (para JWTs). */
function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** Interfaz de envío push. */
class PushDriver {
  constructor() {
    if (new.target === PushDriver) throw new Error('PushDriver es una interfaz: usá un driver concreto.');
    this.name = 'base';
  }
  /** Envía a un device token. Lanza si falla. */
  async send(/* { token, platform, title, body, data } */) { throw new Error('no implementado'); }
}

/** MockDriver: no envía nada afuera; la notificación queda en la DB. */
class MockDriver extends PushDriver {
  constructor() { super(); this.name = 'mock'; this.sent = []; }
  async send({ token, platform, title, body, data }) {
    this.sent.push({ token, platform, title, body, data, at: new Date().toISOString() });
    return { ok: true, driver: 'mock' };
  }
}

/**
 * FcmDriver — Firebase Cloud Messaging (Android / web), API HTTP v1.
 *
 * Credenciales:
 *   PUSH_FCM_PROJECT_ID           → id del proyecto Firebase
 *   PUSH_FCM_SERVICE_ACCOUNT_JSON → contenido del JSON de la service account
 *                                    (o ruta al archivo .json; nunca commitearlo)
 *
 * Autenticación: JWT RS256 firmado con la private_key de la service account
 * → POST https://oauth2.googleapis.com/token (grant_type jwt-bearer) →
 * access_token, cacheado hasta su expiración.
 * Envío: POST https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send
 *
 * La app registra su token con POST /api/push-tokens {token, platform:'android'|'web'}.
 * TODO(CREDENCIAL): solo faltan el proyecto y la service account del dueño.
 */
class FcmDriver extends PushDriver {
  constructor({ fetchImpl } = {}) {
    super();
    this.name = 'fcm';
    const missing = [];
    if (!process.env.PUSH_FCM_PROJECT_ID) missing.push('PUSH_FCM_PROJECT_ID');
    if (!process.env.PUSH_FCM_SERVICE_ACCOUNT_JSON) missing.push('PUSH_FCM_SERVICE_ACCOUNT_JSON');
    if (missing.length) {
      throw new Error(
        `FCM sin configurar: faltan ${missing.join(' y ')}. ` +
        'Creá el proyecto en https://console.firebase.google.com y generá una clave de ' +
        'cuenta de servicio (ver NOTIFICACIONES.md).'
      );
    }
    this.projectId = process.env.PUSH_FCM_PROJECT_ID;
    const raw = String(process.env.PUSH_FCM_SERVICE_ACCOUNT_JSON).trim();
    let sa;
    try {
      sa = JSON.parse(raw);
    } catch {
      // Puede ser una ruta al archivo.
      try {
        sa = JSON.parse(fs.readFileSync(raw, 'utf8'));
      } catch (err) {
        throw new Error(
          `PUSH_FCM_SERVICE_ACCOUNT_JSON inválido: no es JSON ni una ruta legible (${err.message}). ` +
          'Pegá el contenido del JSON de la service account o la ruta al archivo.'
        );
      }
    }
    if (!sa.client_email || !sa.private_key) {
      throw new Error(
        'PUSH_FCM_SERVICE_ACCOUNT_JSON inválido: el JSON tiene que tener "client_email" y "private_key".'
      );
    }
    this.serviceAccount = sa;
    this._fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this._accessToken = null;
    this._accessTokenExp = 0;
  }

  /** Access token OAuth2 (cacheado). Construye y firma el JWT RS256. */
  async _getAccessToken() {
    if (this._accessToken && Date.now() < this._accessTokenExp - 60000) return this._accessToken;
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
      iss: this.serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }));
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), this.serviceAccount.private_key)
      .toString('base64url');
    const assertion = `${header}.${payload}.${signature}`;
    let res;
    try {
      res = await this._fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
      });
    } catch (err) {
      throw new Error(`FCM: no se pudo pedir el access token (${err.message}).`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.access_token) {
      throw new Error(
        `FCM: Google rechazó el access token (HTTP ${res.status}): ${JSON.stringify(data)}. ` +
        'Revisá que la service account sea del proyecto PUSH_FCM_PROJECT_ID.'
      );
    }
    this._accessToken = data.access_token;
    this._accessTokenExp = Date.now() + Number(data.expires_in || 3600) * 1000;
    return this._accessToken;
  }

  /** Construye el cuerpo del mensaje FCM (testeable sin red). */
  _buildMessage({ token, platform, title, body, data }) {
    const message = {
      token,
      notification: { title: String(title), body: String(body || '') },
      data: Object.fromEntries(
        Object.entries(data || {}).map(([k, v]) => [k, String(v)])
      ),
    };
    if (platform === 'android') message.android = { priority: 'high' };
    return { message };
  }

  async send({ token, platform, title, body, data } = {}) {
    if (!token) throw new Error('FCM: falta el device token.');
    const accessToken = await this._getAccessToken();
    const url = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;
    let res;
    try {
      res = await this._fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(this._buildMessage({ token, platform, title, body, data })),
      });
    } catch (err) {
      throw new Error(`FCM: falló el envío (${err.message}).`);
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(
        `FCM: Google rechazó el push (HTTP ${res.status}): ${JSON.stringify(payload)}.`
      );
      err.code = res.status === 404 ? 'FCM_BAD_TOKEN' : 'FCM_REJECTED';
      err.httpStatus = res.status;
      throw err;
    }
    return { ok: true, driver: 'fcm', messageId: payload && payload.name };
  }
}

/**
 * ApnsDriver — Apple Push Notification service (iOS), provider API por HTTP/2.
 *
 * Credenciales:
 *   PUSH_APNS_KEY_ID    → Key ID de 10 caracteres (developer.apple.com → Keys)
 *   PUSH_APNS_TEAM_ID   → Team ID (10 caracteres)
 *   PUSH_APNS_KEY_FILE  → ruta al archivo .p8 descargado (nunca commitearlo)
 *   PUSH_APNS_BUNDLE_ID → bundle id de la app Oppi (ej. com.oppi.app)
 *   PUSH_APNS_ENV       → "sandbox" o "prod" (default: sandbox)
 *
 * Autenticación: JWT ES256 firmado con la clave .p8
 * (header {alg:'ES256', kid}, payload {iss: teamId, iat}), renovado cada 50 min.
 * Envío: POST https://api.push.apple.com/3/device/{deviceToken} (prod) o
 * https://api.sandbox.push.apple.com (sandbox), por HTTP/2 con node:http2
 * (cargado de forma perezosa: solo cuando se usa el driver).
 *
 * La app registra su token con POST /api/push-tokens {token, platform:'ios'}.
 * TODO(CREDENCIAL): solo faltan la APNs Key y los datos de la cuenta Apple del dueño.
 */
class ApnsDriver extends PushDriver {
  constructor({ http2Connect } = {}) {
    super();
    this.name = 'apns';
    const missing = ['PUSH_APNS_KEY_ID', 'PUSH_APNS_TEAM_ID', 'PUSH_APNS_KEY_FILE', 'PUSH_APNS_BUNDLE_ID']
      .filter((k) => !process.env[k]);
    if (missing.length) {
      throw new Error(
        `APNs sin configurar: faltan ${missing.join(', ')}. ` +
        'Creá una APNs Key (.p8) en https://developer.apple.com/account (ver NOTIFICACIONES.md).'
      );
    }
    this.keyId = process.env.PUSH_APNS_KEY_ID;
    this.teamId = process.env.PUSH_APNS_TEAM_ID;
    this.bundleId = process.env.PUSH_APNS_BUNDLE_ID;
    this.env = (process.env.PUSH_APNS_ENV || 'sandbox').toLowerCase();
    if (!['sandbox', 'prod'].includes(this.env)) {
      throw new Error(`PUSH_APNS_ENV inválido: "${process.env.PUSH_APNS_ENV}" (usá sandbox o prod).`);
    }
    try {
      this.keyPem = fs.readFileSync(process.env.PUSH_APNS_KEY_FILE, 'utf8');
    } catch (err) {
      throw new Error(
        `PUSH_APNS_KEY_FILE no se pudo leer (${process.env.PUSH_APNS_KEY_FILE}): ${err.message}. ` +
        'Apuntá la variable a la ruta del archivo .p8 descargado de Apple.'
      );
    }
    if (!/BEGIN PRIVATE KEY/.test(this.keyPem)) {
      throw new Error(
        'PUSH_APNS_KEY_FILE no parece una clave .p8 válida (falta el bloque BEGIN PRIVATE KEY).'
      );
    }
    // Carga perezosa: node:http2 solo se requiere cuando se instancia el driver.
    this._http2Connect = http2Connect || ((authority) => require('node:http2').connect(authority));
    this._jwt = null;
    this._jwtExp = 0;
  }

  _authority() {
    return this.env === 'prod' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  }

  /** JWT de proveedor ES256 (renovado cada 50 min; Apple los acepta hasta 60). */
  _providerJwt() {
    if (this._jwt && Date.now() < this._jwtExp) return this._jwt;
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: this.keyId }));
    const payload = b64url(JSON.stringify({ iss: this.teamId, iat: now }));
    const sigInput = `${header}.${payload}`;
    const signature = crypto.sign('sha256', Buffer.from(sigInput), {
      key: this.keyPem,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    this._jwt = `${sigInput}.${signature}`;
    this._jwtExp = Date.now() + 50 * 60 * 1000;
    return this._jwt;
  }

  /** Cuerpo del push (testeable sin red). */
  _buildPayload({ title, body, data }) {
    return {
      aps: {
        alert: { title: String(title), body: String(body || '') },
        sound: 'default',
      },
      ...(data || {}),
    };
  }

  async send({ token, platform, title, body, data } = {}) {
    if (!token) throw new Error('APNs: falta el device token.');
    const session = this._http2Connect(this._authority());
    const payload = JSON.stringify(this._buildPayload({ title, body, data }));
    const req = session.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${this._providerJwt()}`,
      'apns-topic': this.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    const chunks = [];
    const result = await new Promise((resolve, reject) => {
      let status = 0;
      req.on('response', (headers) => { status = headers[':status'] || 0; });
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      req.on('error', reject);
      req.setTimeout(10000, () => reject(new Error('APNs: timeout esperando respuesta.')));
      req.write(payload);
      req.end();
    }).finally(() => { try { session.close(); } catch { /* noop */ } });
    if (result.status === 200) return { ok: true, driver: 'apns' };
    let reason = result.body;
    try { reason = JSON.parse(result.body).reason || result.body; } catch { /* texto plano */ }
    const err = new Error(`APNs rechazó el push (HTTP ${result.status}): ${reason}.`);
    err.code = result.status === 400 && /BadDeviceToken/.test(String(reason)) ? 'APNS_BAD_TOKEN' : 'APNS_REJECTED';
    err.httpStatus = result.status;
    throw err;
  }
}

const PUSH_DRIVERS = { mock: MockDriver, fcm: FcmDriver, apns: ApnsDriver };
let cachedDriver = null;
let cachedDriverName = null;

/** Devuelve el PushDriver según PUSH_PROVIDER (default: mock). */
function getPushDriver() {
  const name = (process.env.PUSH_PROVIDER || 'mock').toLowerCase();
  const Driver = PUSH_DRIVERS[name];
  if (!Driver) throw new Error(`PUSH_PROVIDER desconocido: "${name}" (usá ${Object.keys(PUSH_DRIVERS).join(' | ')}).`);
  if (!cachedDriver || cachedDriverName !== name) {
    cachedDriver = new Driver();
    cachedDriverName = name;
  }
  return cachedDriver;
}

function notifRow(n) {
  if (!n) return null;
  return {
    id: n.id, user_id: n.user_id, type: n.type, title: n.title, body: n.body,
    read: Boolean(n.read), scheduled_for: n.scheduled_for, created_at: n.created_at,
  };
}

class NotificationService {
  constructor(db, { pushDriver } = {}) {
    this.db = db;
    this.pushDriver = pushDriver || getPushDriver();
  }

  /** Encola una notificación (queda visible en el centro de notificaciones).
   * Respeta las preferencias del usuario (/api/me/notification-prefs): si
   * tiene apagada la categoría de este tipo, no se encola nada (devuelve
   * null, sin error). */
  async enqueue({ userId, type, title, body = '', scheduledFor = null, data = null } = {}) {
    if (!userId) throw new Error('notify: falta userId.');
    if (!NOTIFICATION_TYPES.includes(type)) throw new Error(`notify: tipo desconocido "${type}".`);
    if (!title) throw new Error('notify: falta title.');
    const prefKey = NOTIF_PREF_BY_TYPE[type];
    if (prefKey) {
      const prefs = await getNotificationPrefs(this.db, userId);
      if (!prefs[prefKey]) return null;
    }
    const r = await run(this.db,
      `INSERT INTO notifications (user_id, type, title, body, scheduled_for) VALUES (?,?,?,?,?)`,
      [userId, type, title, body, scheduledFor]);
    return notifRow(await queryOne(this.db, 'SELECT * FROM notifications WHERE id = ?', [r.id]));
  }

  /**
   * Envía las notificaciones vencidas (scheduled_for <= ahora y push_sent = 0)
   * vía el PushDriver. Devuelve { sent, failed }.
   */
  async sendDue({ limit = 100 } = {}) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const due = await queryAll(this.db,
      `SELECT n.*, t.token AS push_token, t.platform AS push_platform
       FROM notifications n
       LEFT JOIN push_tokens t ON t.user_id = n.user_id
       WHERE n.push_sent = 0 AND n.scheduled_for IS NOT NULL AND n.scheduled_for <= ?
       ORDER BY n.scheduled_for ASC LIMIT ?`,
      [now, limit]);
    let sent = 0; let failed = 0;
    const seen = new Set();
    for (const n of due) {
      if (seen.has(n.id)) continue; // un usuario puede tener varios tokens: 1 push por notificación
      seen.add(n.id);
      try {
        if (!n.push_token) {
          // Sin token registrado: se marca como enviada para no reintentarla
          // eternamente (sigue visible en el centro de notificaciones).
          await run(this.db, 'UPDATE notifications SET push_sent = 1 WHERE id = ?', [n.id]);
          continue;
        }
        await this.pushDriver.send({
          token: n.push_token, platform: n.push_platform,
          title: n.title, body: n.body, data: { notification_id: n.id, type: n.type },
        });
        await run(this.db, "UPDATE notifications SET push_sent = 1, push_sent_at = ? WHERE id = ?",
          [new Date().toISOString().slice(0, 19).replace('T', ' '), n.id]);
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(`[notificaciones] falló el push #${n.id}:`, err.message);
      }
    }
    return { sent, failed };
  }
}

/**
 * Encola una notificación sin romper el flujo principal si algo falla.
 * Uso en rutas: `await notify(db, {...})` de src/lib/notifications.js: eso guarda en la DB y
 * queda visible acá. El push real sale por send-due.
 */
async function notify(db, payload) {
  try {
    return await new NotificationService(db).enqueue(payload);
  } catch (err) {
    console.error('[notificaciones] no se pudo encolar:', err.message);
    return null;
  }
}

module.exports = {
  NOTIFICATION_TYPES, NOTIF_PREF_BY_TYPE, NOTIF_PREF_KEYS, getNotificationPrefs,
  PushDriver, MockDriver, FcmDriver, ApnsDriver,
  getPushDriver, NotificationService, notify,
};
