'use strict';

/**
 * Pagos: interfaz PaymentProvider + MockProvider + registro contable.
 * - Unit: charge cobra el 100% (captured en el acto); refund sobre cobrado.
 * - Driver: PAYMENT_PROVIDER default mock; bancard sin credenciales → error claro.
 * - Rutas: confirmar reserva cobra el total (payments: captured); cancelar sin
 *   cargo lo reembolsa (payments: refunded). Aceptar oferta cobra el 100% del
 *   precio acordado.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

test('mock: charge cobra el 100% en el acto', async () => {
  const { MockProvider } = require('../src/lib/payments');
  const p = new MockProvider();
  const ch = await p.charge({ amountGs: 100000, description: 'Total test', metadata: { x: 1 } });
  assert.equal(ch.status, 'captured');
  assert.equal(ch.amountGs, 100000);
  assert.match(ch.paymentId, /^mock_/);
});

test('mock: charge rechaza montos inválidos', async () => {
  const { MockProvider } = require('../src/lib/payments');
  const p = new MockProvider();
  await assert.rejects(() => p.charge({ amountGs: 0 }), /entero en guaraníes > 0/);
  await assert.rejects(() => p.charge({ amountGs: -5 }), /entero en guaraníes > 0/);
  await assert.rejects(() => p.charge({}), /entero en guaraníes > 0/);
});

test('mock: refund solo sobre cobrado; doble refund → error', async () => {
  const { MockProvider } = require('../src/lib/payments');
  const p = new MockProvider();
  const ch = await p.charge({ amountGs: 100000 });
  const ref = await p.refund(ch.paymentId);
  assert.equal(ref.status, 'refunded');
  assert.equal(ref.amountGs, 100000);
  await assert.rejects(() => p.refund(ch.paymentId), /Solo se puede reembolsar/);
});

test('mock: refund parcial válido; monto mayor → error', async () => {
  const { MockProvider } = require('../src/lib/payments');
  const p = new MockProvider();
  const ch = await p.charge({ amountGs: 100000 });
  const ref = await p.refund(ch.paymentId, 40000);
  assert.equal(ref.status, 'refunded');
  assert.equal(ref.amountGs, 40000);
  const ch2 = await p.charge({ amountGs: 100000 });
  await assert.rejects(() => p.refund(ch2.paymentId, 150000), /no es válido/);
});

test('mock: pago inexistente → error con código', async () => {
  const { MockProvider } = require('../src/lib/payments');
  const p = new MockProvider();
  const err = await p.refund('mock_inexistente').catch((e) => e);
  assert.equal(err.code, 'PAYMENT_NOT_FOUND');
});

test('driver: default es mock; bancard sin credenciales → error claro', async () => {
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.PAYMENT_BANCARD_PUBLIC_KEY;
  delete process.env.PAYMENT_BANCARD_PRIVATE_KEY;
  const { getPaymentProvider } = require('../src/lib/payments');
  assert.equal(getPaymentProvider().name, 'mock');
  process.env.PAYMENT_PROVIDER = 'bancard';
  assert.throws(() => getPaymentProvider(), /PAYMENT_BANCARD_PUBLIC_KEY/);
  process.env.PAYMENT_PROVIDER = 'mock';
  assert.equal(getPaymentProvider().name, 'mock');
});

test('driver: PAYMENT_PROVIDER desconocido → error', async () => {
  const { getPaymentProvider } = require('../src/lib/payments');
  process.env.PAYMENT_PROVIDER = 'mercadopago';
  assert.throws(() => getPaymentProvider(), /desconocido/);
  process.env.PAYMENT_PROVIDER = 'mock';
});

test('ruta: confirmar reserva cobra el 100% del total (payments captured); cancelar sin cargo lo reembolsa', async () => {
  const { api, register, makePro, db } = ctx;
  const { queryOne } = require('../src/db');
  const { token: proToken, service } = await makePro(); // precio 100000
  const client = await register();
  const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  assert.equal(b.status, 201);
  const id = b.json.booking.id;

  const conf = await api('PATCH', `/api/bookings/${id}`, { token: proToken, body: { status: 'confirmed' } });
  assert.equal(conf.status, 200);
  assert.equal(conf.json.booking.paid, true);
  assert.equal(conf.json.booking.paid_gs, 100000); // 100% del total, no seña
  const pay = await queryOne(db,
    "SELECT * FROM payments WHERE reference_type = 'booking' AND reference_id = ?", [id]);
  assert.ok(pay, 'tiene que existir el registro contable');
  assert.equal(pay.kind, 'charge');
  assert.equal(pay.status, 'captured');
  assert.equal(pay.amount_gs, 100000);
  assert.match(pay.provider_payment_id, /^mock_/);

  // Sin turno → cancelación sin cargo: reembolso del total.
  const cancel = await api('PATCH', `/api/bookings/${id}`, { token: client.token, body: { status: 'cancelled' } });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.booking.paid, false);
  const pay2 = await queryOne(db, 'SELECT * FROM payments WHERE id = ?', [pay.id]);
  assert.equal(pay2.status, 'refunded');
});

test('ruta: aceptar oferta cobra el 100% del precio acordado del job', async () => {
  const { api, register, db } = ctx;
  const { queryOne } = require('../src/db');
  const client = await register();
  const handy = await register({ role: 'handyman' });
  const t = await api('POST', '/api/tasks', {
    token: client.token, body: { title: 'Arreglar puerta', category: 'carpintería', barrio: 'Sajonia' },
  });
  assert.equal(t.status, 201);
  const o = await api('POST', `/api/tasks/${t.json.task.id}/offers`, {
    token: handy.token, body: { amount_gs: 200000, message: 'Voy mañana' },
  });
  assert.equal(o.status, 201);
  const acc = await api('POST', `/api/offers/${o.json.offer.id}/accept`, { token: client.token, body: {} });
  assert.equal(acc.status, 201);
  const jobId = acc.json.job.id;
  assert.equal(acc.json.job.paid_gs, 200000); // 100% del precio acordado

  const pay = await queryOne(db, "SELECT * FROM payments WHERE reference_type = 'job' AND reference_id = ?", [jobId]);
  assert.ok(pay);
  assert.equal(pay.kind, 'charge');
  assert.equal(pay.status, 'captured');
  assert.equal(pay.amount_gs, 200000);

  // Completar el job no mueve más plata (ya se cobró al aceptar).
  await api('PATCH', `/api/jobs/${jobId}`, { token: handy.token, body: { status: 'in_progress' } });
  const done = await api('PATCH', `/api/jobs/${jobId}`, { token: handy.token, body: { status: 'completed' } });
  assert.equal(done.status, 200);
  const pay2 = await queryOne(db, 'SELECT * FROM payments WHERE id = ?', [pay.id]);
  assert.equal(pay2.status, 'captured');
});
