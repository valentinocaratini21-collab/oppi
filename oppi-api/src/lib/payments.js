'use strict';

/**
 * Pagos — interfaz de pasarela + drivers.
 *
 * Driver elegido por env `PAYMENT_PROVIDER` (default: `mock`).
 *
 * Interfaz (PaymentProvider) — todos los métodos son async y trabajan en
 * guaraníes (montos enteros):
 *  - charge({ amountGs, description, metadata }) → { paymentId, status, amountGs, ... }
 *      Cobra el TOTAL en el acto (venta directa, sin seña ni preautorización).
 *      Bancard devuelve status 'pending': la operación queda creada y el cliente
 *      todavía tiene que pagar en el iframe; el cobro real llega por webhook.
 *      Mock devuelve status 'captured' en el acto (simulado, sin plata real).
 *  - refund(paymentId, amountGs?) → { paymentId, status:'refunded' }
 *      Reembolsa total o parcial un pago ya cobrado.
 *
 * Cada operación que las rutas ejecutan se registra en la tabla `payments`
 * (ver recordPayment): la pasarela es la fuente de verdad del dinero, la DB
 * es el libro contable.
 */
const crypto = require('node:crypto');
const { run, queryOne } = require('../db');

class PaymentProvider {
  constructor() {
    if (new.target === PaymentProvider) throw new Error('PaymentProvider es una interfaz: usá un driver concreto.');
    this.name = 'base';
  }
  async charge(/* { amountGs, description, metadata } */) { throw new Error('no implementado'); }
  async refund(/* paymentId, amountGs */) { throw new Error('no implementado'); }
}

/**
 * MockProvider: comportamiento simulado (lo que la API hacía antes: no se
 * mueve plata de verdad). El cobro queda 'captured' en el acto; el registro
 * contable vive en la tabla `payments`.
 */
class MockProvider extends PaymentProvider {
  constructor() {
    super();
    this.name = 'mock';
    this.charges = new Map();
  }

  _get(paymentId) {
    const c = this.charges.get(paymentId);
    if (!c) {
      const err = new Error(`Pago ${paymentId} no encontrado en el mock.`);
      err.code = 'PAYMENT_NOT_FOUND';
      throw err;
    }
    return c;
  }

  async charge({ amountGs, description, metadata } = {}) {
    if (!Number.isInteger(amountGs) || amountGs <= 0) {
      throw new Error('El monto a cobrar tiene que ser un entero en guaraníes > 0.');
    }
    const paymentId = `mock_${crypto.randomBytes(12).toString('hex')}`;
    const charge = {
      paymentId, amountGs, status: 'captured',
      description: description || '', metadata: metadata || null,
      createdAt: new Date().toISOString(),
    };
    this.charges.set(paymentId, charge);
    return { paymentId, status: 'captured', amountGs };
  }

  async refund(paymentId, amountGs) {
    const c = this._get(paymentId);
    if (c.status !== 'captured') {
      const err = new Error(`Solo se puede reembolsar un pago cobrado (estado: "${c.status}").`);
      err.code = 'PAYMENT_BAD_STATE';
      throw err;
    }
    const amount = amountGs == null ? c.amountGs : amountGs;
    if (!Number.isInteger(amount) || amount <= 0 || amount > c.amountGs) {
      throw new Error('El monto a reembolsar no es válido.');
    }
    c.status = 'refunded';
    c.refundedGs = amount;
    return { paymentId, status: 'refunded', amountGs: amount };
  }
}

// =====================================================================
// BancardProvider — vPOS 0.3 (Bancard, Paraguay), venta directa.
// =====================================================================
//
// Verificado contra la documentación oficial de Bancard
// ("eCommerce – Compra Simple" v1.23.1). La API de vPOS es autenticación
// por operación con tokens MD5: la clave privada NUNCA viaja en claro,
// solo dentro del hash.
//
// Ambientes:
//   staging → https://vpos.infonet.com.py:8888
//   prod    → https://vpos.infonet.com.py
// Ambos exigen TLS 1.2+ del lado del comercio. OJO: Cloudflare delante de
// vpos.infonet.com.py bloquea pedidos HTTP/1.1 con huella TLS de OpenSSL 3.0;
// si staging devuelve 403 en HTML ("Sorry, you have been blocked"), hay que
// salir por HTTP/2 (ver PAGOS.md).
//
// Flujo (venta directa — el cliente paga el 100% del total):
//   1. charge → POST /vpos/api/0.3/single_buy SIN preautorización.
//      Devuelve { paymentId: shop_process_id, status:'pending', processId,
//      checkoutJsUrl }. El frontend abre el iframe de Bancard
//      (Bancard.Checkout.createForm) con el process_id y el cliente mete su
//      tarjeta ahí — la tarjeta NUNCA pasa por nuestros servidores.
//   2. Bancard hace POST servidor-a-servidor (single_buy_confirm) a la URL de
//      confirmación configurada en el portal de comercios, y redirige el
//      browser a return_url.
//      → La ruta del webhook verifica, re-consulta y marca el pago como
//        'captured' (ver PAGOS.md).
//   3. refund → POST /vpos/api/0.3/single_buy/rollback (solo el mismo día;
//      después es reversa manual por el portal de Bancard). vPOS no tiene
//      reembolso parcial por API.
//
// Credenciales (todas en el portal de comercios de Bancard — ver PAGOS.md):
//   PAYMENT_BANCARD_PUBLIC_KEY   → llave pública del comercio
//   PAYMENT_BANCARD_PRIVATE_KEY  → llave privada del comercio (solo para los hashes MD5)
//   PAYMENT_BANCARD_ENV          → "staging" o "prod" (default: staging)
//   PAYMENT_BANCARD_RETURN_URL   → (opcional) a dónde vuelve el browser tras pagar
//   PAYMENT_BANCARD_CANCEL_URL   → (opcional) a dónde vuelve si cancela
//
// TODO(CREDENCIAL): todo lo marcado arriba depende de las keys del dueño.
// Sin credenciales reales no se puede probar contra staging: este driver está
// completo a nivel de protocolo, pendiente solo de llaves + URLs del portal.
// TODO(CREDENCIAL): confirmar con el ejecutivo de Bancard que el comercio
// tiene habilitado el producto "vPOS compra simple" SIN preautorización
// (antes se usaba preautorización para la seña; ahora es venta directa).
const BANCARD_BASE_URLS = {
  staging: 'https://vpos.infonet.com.py:8888',
  prod: 'https://vpos.infonet.com.py',
};
const BANCARD_CHECKOUT_JS_VERSION = '4.0.0';
const BANCARD_CURRENCY = 'PYG';

class BancardProvider extends PaymentProvider {
  constructor({ fetchImpl } = {}) {
    super();
    this.name = 'bancard';
    this.publicKey = process.env.PAYMENT_BANCARD_PUBLIC_KEY;
    this.privateKey = process.env.PAYMENT_BANCARD_PRIVATE_KEY;
    this.env = (process.env.PAYMENT_BANCARD_ENV || 'staging').toLowerCase();
    const missing = [];
    if (!this.publicKey) missing.push('PAYMENT_BANCARD_PUBLIC_KEY');
    if (!this.privateKey) missing.push('PAYMENT_BANCARD_PRIVATE_KEY');
    if (missing.length) {
      throw new Error(
        `Bancard sin configurar: faltan ${missing.join(' y ')}. ` +
        'Conseguilas en el portal de comercios de Bancard (ver PAGOS.md).'
      );
    }
    if (!BANCARD_BASE_URLS[this.env]) {
      throw new Error(`PAYMENT_BANCARD_ENV inválido: "${this.env}" (usá staging o prod).`);
    }
    this.baseUrl = BANCARD_BASE_URLS[this.env];
    this.returnUrl = process.env.PAYMENT_BANCARD_RETURN_URL || null;
    this.cancelUrl = process.env.PAYMENT_BANCARD_CANCEL_URL || null;
    // fetchImpl inyectable para tests (default: fetch global de Node).
    this._fetch = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  // ---- firma MD5 por operación (contrato de vPOS) ----
  _md5(s) {
    return crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
  }
  /** Monto como string con 2 decimales y punto (contrato de vPOS). */
  _money(amountGs) {
    return `${amountGs}.00`;
  }
  /** shop_process_id: entero de 15 dígitos, único por operación. */
  _shopProcessId() {
    // randomInt no acepta rangos > 2^48: se genera en dos partes (7+8 dígitos).
    const a = crypto.randomInt(10 ** 6, 10 ** 7);
    const b = crypto.randomInt(0, 10 ** 8);
    return Number(`${a}${String(b).padStart(8, '0')}`);
  }
  _checkoutJsUrl() {
    return `${this.baseUrl}/checkout/javascript/dist/bancard-checkout-${BANCARD_CHECKOUT_JS_VERSION}.js`;
  }

  /** Token para single_buy: md5(private_key + shop_process_id + amount + currency). */
  _singleBuyToken(shopProcessId, amountGs) {
    return this._md5(this.privateKey + shopProcessId + this._money(amountGs) + BANCARD_CURRENCY);
  }
  /** Token para get_confirmation: md5(private_key + shop_process_id + "get_confirmation"). */
  _getConfirmationToken(shopProcessId) {
    return this._md5(this.privateKey + shopProcessId + 'get_confirmation');
  }
  /** Token para rollback: md5(private_key + shop_process_id + "rollback" + "0.00"). */
  _rollbackToken(shopProcessId) {
    return this._md5(this.privateKey + shopProcessId + 'rollback' + '0.00');
  }
  /** Token que Bancard manda en el webhook: md5(private_key + shop_process_id + "confirm" + amount + currency). */
  _webhookToken(shopProcessId, amountStr) {
    return this._md5(this.privateKey + shopProcessId + 'confirm' + amountStr + BANCARD_CURRENCY);
  }

  /** POST JSON a vPOS; lanza Error con el `key` de Bancard si status=error. */
  async _post(path, operation) {
    let res;
    try {
      res = await this._fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_key: this.publicKey, operation }),
      });
    } catch (err) {
      const e = new Error(`Bancard no respondió (${path}): ${err.message}`);
      e.code = 'BANCARD_NETWORK';
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch { /* cuerpo no-JSON */ }
    if (!res.ok) {
      const e = new Error(`Bancard HTTP ${res.status} en ${path}.`);
      e.code = 'BANCARD_HTTP';
      e.httpStatus = res.status;
      e.body = data;
      throw e;
    }
    if (!data || data.status !== 'success') {
      const msg = Array.isArray(data?.messages) && data.messages.length
        ? data.messages.map((m) => `${m.key || '?'}: ${m.dsc || m.message || ''}`).join(' | ')
        : 'respuesta desconocida de Bancard';
      const key = data?.messages?.[0]?.key;
      const e = new Error(`Bancard rechazó la operación (${path}): ${msg}`);
      e.code = 'BANCARD_REJECTED';
      e.bancardKey = key;
      e.body = data;
      throw e;
    }
    return data;
  }

  /**
   * Crea la venta directa en Bancard (el cliente paga el 100% del total).
   * Devuelve status 'pending': el cliente todavía tiene que pagar en el
   * iframe de Bancard. El frontend usa `processId` + `checkoutJsUrl` para
   * abrirlo con `Bancard.Checkout.createForm(container, processId)`.
   * Cuando el cliente paga, llega el webhook (single_buy_confirm) y la ruta
   * lo marca como 'captured' (ver PAGOS.md).
   *
   * NOTA: no se manda `preauthorization` (antes era "S" para la seña):
   * es venta directa, el monto se acredita al comercio cuando el cliente paga.
   */
  async charge({ amountGs, description, metadata } = {}) {
    if (!Number.isInteger(amountGs) || amountGs <= 0) {
      throw new Error('El monto a cobrar tiene que ser un entero en guaraníes > 0.');
    }
    const shopProcessId = this._shopProcessId();
    const operation = {
      token: this._singleBuyToken(shopProcessId, amountGs),
      shop_process_id: shopProcessId,
      amount: this._money(amountGs),
      currency: BANCARD_CURRENCY,
      additional_data: '',
      description: String(description || 'Cobro Oppi').slice(0, 200),
    };
    if (this.returnUrl) operation.return_url = this.returnUrl;
    if (this.cancelUrl) operation.cancel_url = this.cancelUrl;
    const data = await this._post('/vpos/api/0.3/single_buy', operation);
    return {
      paymentId: String(shopProcessId),
      status: 'pending',
      amountGs,
      processId: data.process_id,
      checkoutJsUrl: this._checkoutJsUrl(),
      metadata: metadata || null,
    };
  }

  /**
   * Reembolsa un cobro: reversa total vía single_buy/rollback (solo el mismo
   * día; después es trámite manual en el portal de comercios de Bancard).
   * vPOS no tiene reembolso parcial por API.
   * Si el cliente nunca pagó (PaymentNotFoundError) se toma como reembolsado:
   * no hay nada que reversar.
   */
  async refund(paymentId, amountGs) {
    if (amountGs != null) {
      throw new Error(
        'Bancard vPOS no soporta reembolso parcial por API: es reversa total el mismo día ' +
        'o trámite manual en el portal de comercios. Hacelo desde el portal y registralo en la tabla payments.'
      );
    }
    const shopProcessId = Number(paymentId);
    if (!Number.isSafeInteger(shopProcessId)) {
      throw new Error(`paymentId de Bancard inválido: "${paymentId}" (se esperaba el shop_process_id).`);
    }
    const operation = {
      token: this._rollbackToken(shopProcessId),
      shop_process_id: shopProcessId,
    };
    try {
      await this._post('/vpos/api/0.3/single_buy/rollback', operation);
    } catch (err) {
      if (err.code === 'BANCARD_REJECTED' && err.bancardKey === 'PaymentNotFoundError') {
        // El cliente nunca llegó a pagar: nada que reversar, se considera reembolsado.
        return { paymentId: String(shopProcessId), status: 'refunded', amountGs: 0 };
      }
      if (err.code === 'BANCARD_REJECTED' && err.bancardKey === 'TransactionAlreadyConfirmed') {
        throw new Error(
          'Bancard: la operación ya se confirmó (pasó el día) y no se puede reversar por API. ' +
          'Hacé la reversa manual en el portal de comercios de Bancard.'
        );
      }
      throw err;
    }
    return { paymentId: String(shopProcessId), status: 'refunded', amountGs: 0 };
  }

  /**
   * Re-consulta el estado de una operación (get_confirmation). Es la fuente
   * de verdad: usar SIEMPRE después del webhook antes de marcar un pago.
   */
  async getConfirmation(shopProcessId) {
    const spid = Number(shopProcessId);
    if (!Number.isSafeInteger(spid)) {
      throw new Error(`shop_process_id inválido: "${shopProcessId}".`);
    }
    const operation = {
      token: this._getConfirmationToken(spid),
      shop_process_id: spid,
    };
    let data;
    try {
      data = await this._post('/vpos/api/0.3/single_buy/confirmations', operation);
    } catch (err) {
      if (err.code === 'BANCARD_REJECTED' && err.bancardKey === 'PaymentNotFoundError') return null;
      throw err;
    }
    const op = data.operation || {};
    const amountGs = op.amount != null ? Math.round(Number(op.amount)) : null;
    return {
      shopProcessId: String(spid),
      approved: op.response === 'S' || op.response_code === '00',
      response: op.response || null,
      responseCode: op.response_code || null,
      responseDescription: op.response_details || op.extended_response_description || null,
      amountGs,
      currency: op.currency || BANCARD_CURRENCY,
      authorizationNumber: op.authorization_number || null,
      ticketNumber: op.ticket_number || null,
      cardLastNumbers: op.card_last_numbers || null,
      raw: op,
    };
  }

  /**
   * Valida el webhook `single_buy_confirm` de Bancard.
   * El cuerpo que manda Bancard es { operation: { token, shop_process_id,
   * response, response_details, amount, currency, ... } } donde
   * token = md5(private_key + shop_process_id + "confirm" + amount + currency).
   *
   * Verifica la firma con comparación en tiempo constante y devuelve el
   * resultado normalizado. Aun con firma válida, la documentación recomienda
   * re-consultar con getConfirmation() antes de acreditar (zero-trust).
   */
  verifyConfirmationCallback(body) {
    const op = body && body.operation;
    if (!op || op.shop_process_id == null || op.amount == null) {
      const err = new Error('Webhook de Bancard inválido: falta operation.shop_process_id o operation.amount.');
      err.code = 'BANCARD_BAD_WEBHOOK';
      throw err;
    }
    const expected = this._webhookToken(op.shop_process_id, op.amount);
    const got = Buffer.from(String(op.token || ''), 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
      const err = new Error('Webhook de Bancard con firma inválida (token no coincide).');
      err.code = 'BANCARD_BAD_SIGNATURE';
      throw err;
    }
    return {
      shopProcessId: String(op.shop_process_id),
      approved: op.response === 'S' || op.response_code === '00',
      response: op.response || null,
      responseCode: op.response_code || null,
      responseDescription: op.response_details || op.extended_response_description || null,
      amountGs: Math.round(Number(op.amount)),
      authorizationNumber: op.authorization_number || null,
      ticketNumber: op.ticket_number || null,
      cardLastNumbers: op.card_last_numbers || null,
    };
  }
}

const DRIVERS = { mock: MockProvider, bancard: BancardProvider };
let cached = null;
let cachedName = null;

/** Devuelve el provider según PAYMENT_PROVIDER (default: mock). Instancia única por driver. */
function getPaymentProvider() {
  const name = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  const Driver = DRIVERS[name];
  if (!Driver) throw new Error(`PAYMENT_PROVIDER desconocido: "${name}" (usá ${Object.keys(DRIVERS).join(' | ')}).`);
  if (!cached || cachedName !== name) {
    cached = new Driver();
    cachedName = name;
  }
  return cached;
}

/** Registra un movimiento en la tabla contable `payments`. */
async function recordPayment(db, { referenceType, referenceId, provider, providerPaymentId, kind = 'charge', amountGs, status = 'captured' }) {
  const r = await run(db,
    `INSERT INTO payments (reference_type, reference_id, provider, provider_payment_id, kind, amount_gs, status)
     VALUES (?,?,?,?,?,?,?)`,
    [referenceType, referenceId, provider, providerPaymentId || null, kind, amountGs, status]);
  return queryOne(db, 'SELECT * FROM payments WHERE id = ?', [r.id]);
}

/** Actualiza el estado contable de un pago. */
async function updatePaymentStatus(db, id, status) {
  await run(db, 'UPDATE payments SET status = ? WHERE id = ?', [status, id]);
}

/** Último pago en estado dado para una referencia (ej. el cobro vigente de una reserva). */
async function findPayment(db, referenceType, referenceId, status) {
  return queryOne(db,
    `SELECT * FROM payments WHERE reference_type = ? AND reference_id = ? AND status = ?
     ORDER BY id DESC LIMIT 1`,
    [referenceType, referenceId, status]);
}

module.exports = {
  PaymentProvider, MockProvider, BancardProvider,
  getPaymentProvider, recordPayment, updatePaymentStatus, findPayment,
  BANCARD_BASE_URLS, BANCARD_CURRENCY,
};
