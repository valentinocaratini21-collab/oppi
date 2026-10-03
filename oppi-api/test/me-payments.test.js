'use strict';

/**
 * Historial de pagos del cliente: GET /api/me/payments.
 * Junta la tabla `payments` (cobros del 100%: captured/refunded de mis
 * reservas) con los créditos por referido canjeados (sintetizados desde
 * referral_redemptions). Ordenado por fecha desc. Estados en español.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryAll, run } = require('../src/db');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

/** Crea pro + cliente; el cliente canjea un código y confirma una reserva (cobro del 100%). */
async function paymentsFixture() {
  const { api, register, makePro } = ctx;
  const { token: proToken, service } = await makePro(); // Corte, Gs. 100.000
  const owner = await register();                       // dueño del código de referido
  const client = await register();

  // Crédito por referido (el canje acredita users.credit_gs).
  const redeem = await api('POST', '/api/referrals/redeem', {
    token: client.token, body: { code: owner.user.referral_code },
  });
  assert.equal(redeem.status, 200);

  // Reserva + confirmación → cobro del 100% (mock) registrado en `payments`.
  const b = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id },
  });
  assert.equal(b.status, 201);
  const bookingId = b.json.booking.id;
  const c = await api('PATCH', `/api/bookings/${bookingId}`, {
    token: proToken, body: { status: 'confirmed' },
  });
  assert.equal(c.status, 200);
  return { api, client, proToken, bookingId, service };
}

test('me/payments: historial vacío → []', async () => {
  const { api, register } = ctx;
  const fresh = await register();
  const r = await api('GET', '/api/me/payments', { token: fresh.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.payments, []);
});

test('me/payments: cobro del total + crédito por referido, ordenados por fecha desc', async () => {
  const { api, client } = await paymentsFixture();
  // Atrasa el cobro un día para que el orden por fecha sea determinístico.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await run(ctx.db, "UPDATE payments SET created_at = ? WHERE reference_type = 'booking'", [yesterday]);

  const r = await api('GET', '/api/me/payments', { token: client.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.payments.length, 2);

  const [credito, cobro] = r.json.payments; // fecha desc: el canje (hoy) antes que el cobro (ayer)
  assert.equal(credito.estado, 'Crédito');
  assert.equal(credito.tipo, 'credito');
  assert.equal(credito.monto_gs, 20000);
  assert.match(credito.concepto, /Crédito por referido/);
  assert.ok(!('booking_id' in credito));

  assert.equal(cobro.estado, 'Cobrado');
  assert.equal(cobro.tipo, 'pago');
  assert.equal(cobro.monto_gs, 100000); // 100% del total
  assert.match(cobro.concepto, /Cobro/);
  assert.ok(cobro.booking_id);
  assert.ok(cobro.fecha);
});

test('me/payments: al cancelar, el cobro aparece como "Reembolsado"', async () => {
  const { api, client, bookingId } = await paymentsFixture();
  const cancel = await api('PATCH', `/api/bookings/${bookingId}`, {
    token: client.token, body: { status: 'cancelled' },
  });
  assert.equal(cancel.status, 200);

  const r = await api('GET', '/api/me/payments', { token: client.token });
  assert.equal(r.status, 200);
  const pago = r.json.payments.find((p) => p.tipo === 'pago');
  assert.ok(pago);
  assert.equal(pago.estado, 'Reembolsado');
  assert.equal(pago.booking_id, bookingId);
});

test('me/payments: los pagos de otro cliente no se ven; sin token → 401', async () => {
  const { api, register } = ctx;
  const { proToken } = await paymentsFixture();
  // El profesional no es el cliente de la reserva: no ve esos pagos.
  const pro = await api('GET', '/api/me/payments', { token: proToken });
  assert.equal(pro.status, 200);
  assert.ok(!pro.json.payments.some((p) => p.tipo === 'pago'));

  const outsider = await register();
  const other = await api('GET', '/api/me/payments', { token: outsider.token });
  assert.equal(other.status, 200);
  assert.deepEqual(other.json.payments, []);

  const anon = await api('GET', '/api/me/payments');
  assert.equal(anon.status, 401);
});

test('me/payments: la notificación de crédito existe pero el historial usa referral_redemptions', async () => {
  // Sanity: el canje quedó registrado para sintetizar el ítem "Crédito".
  const { client } = await paymentsFixture();
  const reds = await queryAll(ctx.db, 'SELECT * FROM referral_redemptions WHERE user_id = ?', [client.user.id]);
  assert.equal(reds.length, 1);
  assert.ok(reds[0].created_at);
});
