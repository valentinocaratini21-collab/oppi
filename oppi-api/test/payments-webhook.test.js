'use strict';

/**
 * POST /api/payments/bancard-webhook — confirmación servidor-a-servidor de Bancard.
 * - Con provider mock → 200 ok:false (nada que confirmar).
 * - Firma inválida o body roto → 400.
 * - Firma válida + Bancard aprueba → pago 'pending'→'captured' y el cobro de la reserva marcado.
 * - Firma válida + Bancard rechaza → pago →'failed', el cobro sigue impago.
 * getConfirmation se parchea (sin red): el protocolo real se testea en bancard.test.js.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup } = require('./helper');
const { run, queryOne } = require('../src/db');
const paymentsLib = require('../src/lib/payments');

const PRIV = 'webhook-test-private';
const PUB = 'webhook-test-public';
const SPID = '123456789012345';
const AMOUNT_STR = '150000.00';

const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
const goodToken = () => md5(PRIV + SPID + 'confirm' + AMOUNT_STR + 'PYG');
const webhookBody = (token) => ({
  operation: {
    token, shop_process_id: SPID, response: 'S', response_code: '00',
    amount: AMOUNT_STR, currency: 'PYG', authorization_number: '123456',
  },
});

let ctx;
before(async () => {
  process.env.PAYMENT_PROVIDER = 'bancard';
  process.env.PAYMENT_BANCARD_PUBLIC_KEY = PUB;
  process.env.PAYMENT_BANCARD_PRIVATE_KEY = PRIV;
  process.env.PAYMENT_BANCARD_ENV = 'staging';
  ctx = await setup();
  // Sin red en este test: getConfirmation responde lo que cada test necesite.
  paymentsLib.BancardProvider.prototype.getConfirmation = async () => ({ approved: true });
});
after(() => ctx.close());

/** Crea reserva confirmada (con mock) y la deja como si Bancard la hubiera dejado 'pending'. */
async function seedPendingBookingPayment() {
  const { api, register, makePro, db } = ctx;
  process.env.PAYMENT_PROVIDER = 'mock'; // la reserva se crea/confirma con el mock
  let bookingId;
  try {
    const { service, token: proToken } = await makePro();
    const client = await register();
    const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
    assert.equal(b.status, 201);
    bookingId = b.json.booking.id;
    // La confirmación (y el cobro) la hace el profesional.
    const c = await api('PATCH', `/api/bookings/${bookingId}`, { token: proToken, body: { status: 'confirmed' } });
    assert.equal(c.status, 200);
  } finally {
    process.env.PAYMENT_PROVIDER = 'bancard';
  }
  const pay = await queryOne(db,
    `SELECT * FROM payments WHERE reference_type = 'booking' AND reference_id = ? ORDER BY id DESC LIMIT 1`, [bookingId]);
  assert.ok(pay, 'la confirmación tiene que haber registrado el pago');
  // Lo reescribo como lo dejaría Bancard: cobro pendiente de confirmación.
  await run(db, `UPDATE payments SET provider = 'bancard', provider_payment_id = ?, status = 'pending' WHERE id = ?`,
    [SPID, pay.id]);
  await run(db, 'UPDATE bookings SET paid = 0 WHERE id = ?', [bookingId]);
  return { bookingId, paymentId: pay.id };
}

test('webhook con provider mock → 200 ok:false (nada que confirmar)', async () => {
  const { api } = ctx;
  process.env.PAYMENT_PROVIDER = 'mock';
  const r = await api('POST', '/api/payments/bancard-webhook', { body: { operation: {} } });
  process.env.PAYMENT_PROVIDER = 'bancard';
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /no es Bancard/);
});

test('webhook con body roto → 400', async () => {
  const { api } = ctx;
  const r = await api('POST', '/api/payments/bancard-webhook', { body: { hola: 1 } });
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
});

test('webhook con firma adulterada → 400', async () => {
  const { api } = ctx;
  const r = await api('POST', '/api/payments/bancard-webhook', { body: webhookBody('firma-trucha') });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /firma inválida/);
});

test('webhook aprobado → pago captured y el cobro de la reserva marcado como pagado', async () => {
  const { api, db } = ctx;
  const { bookingId, paymentId } = await seedPendingBookingPayment();
  const r = await api('POST', '/api/payments/bancard-webhook', { body: webhookBody(goodToken()) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, status: 'captured' });
  const pay = await queryOne(db, 'SELECT * FROM payments WHERE id = ?', [paymentId]);
  assert.equal(pay.status, 'captured');
  const booking = await queryOne(db, 'SELECT paid FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(booking.paid, 1);
});

test('webhook rechazado por Bancard → pago failed, el cobro sigue impago', async () => {
  const { api, db } = ctx;
  paymentsLib.BancardProvider.prototype.getConfirmation = async () => ({ approved: false });
  const { bookingId, paymentId } = await seedPendingBookingPayment();
  const r = await api('POST', '/api/payments/bancard-webhook', { body: webhookBody(goodToken()) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, status: 'failed' });
  const pay = await queryOne(db, 'SELECT * FROM payments WHERE id = ?', [paymentId]);
  assert.equal(pay.status, 'failed');
  const booking = await queryOne(db, 'SELECT paid FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(booking.paid, 0);
  paymentsLib.BancardProvider.prototype.getConfirmation = async () => ({ approved: true });
});

test('webhook duplicado (pago ya captured) → ok:true already:true, idempotente', async () => {
  const { api, db } = ctx;
  const { paymentId } = await seedPendingBookingPayment();
  await run(db, `UPDATE payments SET status = 'captured' WHERE id = ?`, [paymentId]);
  const r = await api('POST', '/api/payments/bancard-webhook', { body: webhookBody(goodToken()) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, already: true });
});
