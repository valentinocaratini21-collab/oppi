'use strict';

/**
 * Provider de WhatsApp para el soporte de Oppi.
 *
 * Interfaz:
 *  - `sendText(to, body)` — envía un mensaje de texto.
 *  - `sendButtons(to, body, buttons[])` — envía el texto + respuestas rápidas.
 *    `buttons` es un array de `{ id, title }` (o strings: id = título).
 *    La Cloud API solo permite hasta 3 botones interactivos: si hay más,
 *    se manda como lista numerada en texto.
 *  - `verifyWebhook(mode, token, challenge)` — verificación del webhook.
 *
 * `getProvider()` elige `CloudApiProvider` si están las 3 env vars, o
 * `MockProvider` si falta alguna (default: loguea a consola y guarda lo
 * "enviado" en memoria — todo simulado, ideal para desarrollo y tests).
 */

const GRAPH_VERSION = 'v21.0';

/** Lee la config en cada llamada (así los tests pueden setear/desetear env). */
function readConfig() {
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  };
}

/**
 * Devuelve exactamente qué variable falta, con mensajes claros.
 * Array vacío = config completa.
 */
function validateConfig() {
  const cfg = readConfig();
  const missing = [];
  if (!cfg.phoneNumberId) {
    missing.push('Falta WHATSAPP_PHONE_NUMBER_ID: es el ID del número de teléfono de WhatsApp (lo ves en developers.facebook.com → tu app → WhatsApp → Configuración de la API).');
  }
  if (!cfg.accessToken) {
    missing.push('Falta WHATSAPP_ACCESS_TOKEN: es el token permanente de acceso a la API (developers.facebook.com → tu app → WhatsApp → Configuración de la API → token). Sin esto no se puede enviar ni recibir nada.');
  }
  if (!cfg.verifyToken) {
    missing.push('Falta WHATSAPP_VERIFY_TOKEN: es la palabra secreta que inventás vos y que pegás igual en Meta (al configurar el webhook) y acá. Meta la usa para verificar que el webhook es tuyo.');
  }
  return missing;
}

/** Normaliza botones: string → { id, title }; trunca títulos a 20 caracteres (límite de la API). */
function normalizeButtons(buttons) {
  return (buttons || []).map((b, i) => {
    const base = typeof b === 'string' ? { id: `btn_${i}`, title: b } : { id: b.id || `btn_${i}`, title: b.title || '' };
    return { id: String(base.id).slice(0, 256), title: String(base.title).slice(0, 20) };
  });
}

/** Interfaz base: lanza si no se implementa. */
class WhatsappProvider {
  get name() { return 'base'; }
  async sendText(/* to, body */) { throw new Error('no implementado'); }
  async sendButtons(to, body, buttons) { return this.sendText(to, body); }
  verifyWebhook(/* mode, token, challenge */) { throw new Error('no implementado'); }
}

/** WhatsApp Cloud API (Meta) vía fetch nativo. */
class CloudApiProvider extends WhatsappProvider {
  constructor(config) {
    super();
    this.config = config || readConfig();
  }
  get name() { return 'cloud'; }

  async callApi(payload) {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${this.config.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json && json.error && json.error.message) || `HTTP ${res.status}`;
      throw new Error(`WhatsApp Cloud API: ${msg}`);
    }
    return json;
  }

  async sendText(to, body) {
    return this.callApi({ to, type: 'text', text: { preview_url: false, body: String(body) } });
  }

  async sendButtons(to, body, buttons) {
    const btns = normalizeButtons(buttons);
    if (btns.length > 0 && btns.length <= 3) {
      // Botones interactivos (reply buttons, máx. 3).
      return this.callApi({
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: String(body) },
          action: {
            buttons: btns.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
          },
        },
      });
    }
    // Más de 3 botones (o ninguno): la API no lo permite → lista numerada como texto.
    let text = String(body);
    if (btns.length > 0) {
      text += '\n' + btns.map((b, i) => `${i + 1}️⃣ ${b.title}`).join('\n');
    }
    return this.sendText(to, text);
  }

  verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token && token === this.config.verifyToken) {
      return { ok: true, challenge };
    }
    return { ok: false };
  }
}

/**
 * MockProvider: no toca la red. Loguea a consola y guarda cada envío en
 * `sent` (útil en tests y desarrollo). Es el default si faltan credenciales.
 */
class MockProvider extends WhatsappProvider {
  constructor() {
    super();
    this.sent = [];
  }
  get name() { return 'mock'; }

  verifyWebhook(mode, token, challenge) {
    // En modo mock no hay verificación real contra Meta; acepta cualquier
    // token para poder probar el flujo del webhook en local.
    if (mode === 'subscribe') return { ok: true, challenge };
    return { ok: false };
  }

  _record(kind, to, body, extra) {
    const entry = { kind, to, body: String(body), at: new Date().toISOString(), ...(extra || {}) };
    this.sent.push(entry);
    console.log(`[whatsapp-mock] → ${to} [${kind}]: ${String(body).slice(0, 120)}${String(body).length > 120 ? '…' : ''}`);
    return { ok: true, driver: 'mock', id: `mock-${this.sent.length}` };
  }

  async sendText(to, body) {
    return this._record('text', to, body);
  }

  async sendButtons(to, body, buttons) {
    const btns = normalizeButtons(buttons);
    const labels = btns.map((b) => b.title).join(' | ');
    return this._record('buttons', to, body, { buttons: labels });
  }

  /** Limpia el registro de enviados (tests). */
  clear() { this.sent = []; }
}

// Instancia compartida del mock (así los tests pueden inspeccionar `sent`).
let mockInstance = null;
function getMockInstance() {
  if (!mockInstance) mockInstance = new MockProvider();
  return mockInstance;
}

/** Elige el provider según config: Cloud API si está completa, mock si no. */
function getProvider() {
  if (validateConfig().length === 0) return new CloudApiProvider();
  return getMockInstance();
}

module.exports = {
  WhatsappProvider, CloudApiProvider, MockProvider,
  getProvider, getMockInstance, validateConfig, normalizeButtons,
};
