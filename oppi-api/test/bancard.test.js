'use strict';

/**
 * BancardProvider: protocolo vPOS 0.3 (venta directa) con red simulada.
 * - Fórmulas de firma MD5 por operación (verificadas contra la documentación
 *   oficial "eCommerce – Compra Simple" v1.23.1).
 * - Construcción del request single_buy de venta directa (SIN preautorización).
 * - Reembolso vía single_buy/rollback (mismo día; después es manual).
 * - Validación del webhook single_buy_confirm.
 * - Errores de config que nombran la variable faltante.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const PRIV = 'test-private-key-123';
const PUB = 'test-public-key-456';

before(() => {
  process.env.PAYMENT_BANCARD_PUBLIC_KEY = PUB;
  process.env.PAYMENT_BANCARD_PRIVATE_KEY = PRIV;
  process.env.PAYMENT_BANCARD_ENV = 'staging';
});

function load() {
  return require('../src/lib/payments');
}

/** fetch simulado: handler(url, body) → respuesta JSON de Bancard. */
function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body, headers: opts.headers });
    const reply = await handler(url, body);
    return {
      ok: reply.httpStatus == null || reply.httpStatus < 400,
      status: reply.httpStatus || 200,
      json: async () => reply.json,
    };
  };
  return { fetchImpl, calls };
}

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

test('bancard: fórmulas de firma MD5 por operación', () => {
  const { BancardProvider } = load();
  const p = new BancardProvider({ fetchImpl: async () => { throw new Error('no red'); } });
  const spid = 123456789012345;
  assert.equal(p._singleBuyToken(spid, 150000), md5(PRIV + spid + '150000.00' + 'PYG'));
  assert.equal(p._getConfirmationToken(spid), md5(PRIV + spid + 'get_confirmation'));
  assert.equal(p._rollbackToken(spid), md5(PRIV + spid + 'rollback' + '0.00'));
  assert.equal(p._webhookToken(spid, '150000.00'), md5(PRIV + spid + 'confirm' + '150000.00' + 'PYG'));
  assert.match(String(p._shopProcessId()), /^\d{15}$/);
  assert.equal(p.baseUrl, 'https://vpos.infonet.com.py:8888');
});

test('bancard: charge arma el single_buy de venta directa (sin preautorización)', async () => {
  const { BancardProvider } = load();
  const { fetchImpl, calls } = stubFetch(async () => ({
    json: { status: 'success', process_id: 'proc-abc-123' },
  }));
  const p = new BancardProvider({ fetchImpl });
  const charge = await p.charge({ amountGs: 150000, description: 'Reserva #1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://vpos.infonet.com.py:8888/vpos/api/0.3/single_buy');
  assert.equal(calls[0].body.public_key, PUB);
  const op = calls[0].body.operation;
  assert.ok(!('preauthorization' in op), 'la venta directa no manda preauthorization');
  assert.equal(op.amount, '150000.00');
  assert.equal(op.currency, 'PYG');
  assert.equal(op.token, md5(PRIV + op.shop_process_id + '150000.00' + 'PYG'));
  assert.match(String(op.shop_process_id), /^\d{15}$/);
  assert.equal(charge.status, 'pending');
  assert.equal(charge.paymentId, String(op.shop_process_id));
  assert.equal(charge.processId, 'proc-abc-123');
  assert.match(charge.checkoutJsUrl, /bancard-checkout-4\.0\.0\.js$/);
});

test('bancard: charge rechaza montos inválidos', async () => {
  const { BancardProvider } = load();
  const p = new BancardProvider({ fetchImpl: async () => { throw new Error('no red'); } });
  await assert.rejects(() => p.charge({ amountGs: 0 }), /entero en guaraníes > 0/);
  await assert.rejects(() => p.charge({ amountGs: -100 }), /entero en guaraníes > 0/);
  await assert.rejects(() => p.charge({}), /entero en guaraníes > 0/);
});

test('bancard: refund reversa; PaymentNotFoundError → reembolsado idempotente', async () => {
  const { BancardProvider } = load();
  const spid = 123456789012345;
  // Caso feliz
  let stub = stubFetch(async () => ({ json: { status: 'success' } }));
  let p = new BancardProvider({ fetchImpl: stub.fetchImpl });
  const rel = await p.refund(String(spid));
  assert.equal(rel.status, 'refunded');
  assert.equal(stub.calls[0].url, 'https://vpos.infonet.com.py:8888/vpos/api/0.3/single_buy/rollback');
  assert.equal(stub.calls[0].body.operation.token, md5(PRIV + spid + 'rollback' + '0.00'));
  // El cliente nunca pagó → se considera reembolsado, no error
  stub = stubFetch(async () => ({
    json: { status: 'error', messages: [{ key: 'PaymentNotFoundError', dsc: 'no existe' }] },
  }));
  p = new BancardProvider({ fetchImpl: stub.fetchImpl });
  const rel2 = await p.refund(String(spid));
  assert.equal(rel2.status, 'refunded');
  // Pasó el día → error claro que manda al portal
  stub = stubFetch(async () => ({
    json: { status: 'error', messages: [{ key: 'TransactionAlreadyConfirmed', dsc: 'ya confirmada' }] },
  }));
  p = new BancardProvider({ fetchImpl: stub.fetchImpl });
  await assert.rejects(() => p.refund(String(spid)), /portal de comercios/);
});

test('bancard: refund parcial → error (vPOS no lo soporta por API)', async () => {
  const { BancardProvider } = load();
  const p = new BancardProvider({ fetchImpl: async () => { throw new Error('no red'); } });
  await assert.rejects(() => p.refund('123456789012345', 50000), /no soporta reembolso parcial/);
});

test('bancard: getConfirmation normaliza; PaymentNotFoundError → null', async () => {
  const { BancardProvider } = load();
  const spid = 123456789012345;
  let stub = stubFetch(async (url, body) => {
    assert.equal(body.operation.token, md5(PRIV + spid + 'get_confirmation'));
    return {
      json: {
        status: 'success',
        operation: {
          shop_process_id: spid, response: 'S', response_code: '00',
          response_details: 'Aprobada', amount: '150000.00', currency: 'PYG',
          authorization_number: 'AUTH99', ticket_number: 'T1',
        },
      },
    };
  });
  let p = new BancardProvider({ fetchImpl: stub.fetchImpl });
  const conf = await p.getConfirmation(spid);
  assert.equal(conf.approved, true);
  assert.equal(conf.amountGs, 150000);
  assert.equal(conf.authorizationNumber, 'AUTH99');
  stub = stubFetch(async () => ({
    json: { status: 'error', messages: [{ key: 'PaymentNotFoundError', dsc: 'x' }] },
  }));
  p = new BancardProvider({ fetchImpl: stub.fetchImpl });
  assert.equal(await p.getConfirmation(spid), null);
});

test('bancard: verifyConfirmationCallback valida la firma del webhook', () => {
  const { BancardProvider } = load();
  const p = new BancardProvider({ fetchImpl: async () => { throw new Error('no red'); } });
  const spid = 123456789012345;
  const good = {
    operation: {
      token: md5(PRIV + spid + 'confirm' + '150000.00' + 'PYG'),
      shop_process_id: spid, response: 'S', response_code: '00',
      response_details: 'Aprobada', amount: '150000.00', currency: 'PYG',
      authorization_number: 'AUTH99',
    },
  };
  const cb = p.verifyConfirmationCallback(good);
  assert.equal(cb.shopProcessId, String(spid));
  assert.equal(cb.approved, true);
  assert.equal(cb.amountGs, 150000);
  const tampered = JSON.parse(JSON.stringify(good));
  tampered.operation.token = '0'.repeat(32);
  assert.throws(() => p.verifyConfirmationCallback(tampered), /firma inválida/);
  assert.throws(() => p.verifyConfirmationCallback({}), /falta operation/);
});

test('bancard: sin credenciales → error que nombra la variable faltante', () => {
  const { BancardProvider } = load();
  const savedPub = process.env.PAYMENT_BANCARD_PUBLIC_KEY;
  const savedPriv = process.env.PAYMENT_BANCARD_PRIVATE_KEY;
  delete process.env.PAYMENT_BANCARD_PUBLIC_KEY;
  delete process.env.PAYMENT_BANCARD_PRIVATE_KEY;
  assert.throws(() => new BancardProvider(), /PAYMENT_BANCARD_PUBLIC_KEY.*PAYMENT_BANCARD_PRIVATE_KEY/);
  process.env.PAYMENT_BANCARD_PUBLIC_KEY = savedPub;
  delete process.env.PAYMENT_BANCARD_PRIVATE_KEY;
  assert.throws(() => new BancardProvider(), /PAYMENT_BANCARD_PRIVATE_KEY/);
  process.env.PAYMENT_BANCARD_PUBLIC_KEY = savedPub;
  process.env.PAYMENT_BANCARD_PRIVATE_KEY = savedPriv;
});
