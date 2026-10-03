'use strict';

/**
 * Tests de las mejoras 1–3:
 *  1. POST /api/bookings/:id/reschedule
 *  2. cancel-preview / cancel con reembolso automático (+ PATCH viejo)
 *  3. POST /api/bookings/:id/no-show
 * Más el cálculo puro de la política (borde de 24 h) y el PATCH de
 * businesses con cancel_free_hours / min_advance_hours.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryOne, queryAll, run } = require('../src/db');
const { calcCancelPolicy } = require('../src/lib/cancellation');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

const pad = (n) => String(n).padStart(2, '0');
/** Fecha/hora de turno a `hoursAhead` horas de ahora (puede ser negativo). */
function slotAt(hoursAhead) {
  const d = new Date(Date.now() + hoursAhead * 3600000);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Reserva confirmada con turno a `hoursAhead` horas, cobro del 100% (mock).
 * Devuelve { proToken, client, service, professional, slot, booking }.
 */
async function confirmedBooking(hoursAhead) {
  const { api, register, makePro, db } = ctx;
  const { token: proToken, service, professional } = await makePro();
  const client = await register();
  const s = slotAt(hoursAhead);
  const sl = await api('POST', '/api/slots', {
    token: proToken, body: { professional_id: professional.id, ...s },
  });
  assert.equal(sl.status, 201, `crear slot falló: ${JSON.stringify(sl.json)}`);
  const b = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id, slot_id: sl.json.slot.id },
  });
  assert.equal(b.status, 201);
  const c = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
    token: proToken, body: { status: 'confirmed' },
  });
  assert.equal(c.status, 200);
  assert.equal(c.json.booking.paid, true);
  assert.equal(c.json.booking.paid_gs, 100000); // 100% del total
  return { proToken, client, service, professional, slot: sl.json.slot, booking: c.json.booking, db };
}

async function paymentFor(bookingId) {
  return queryOne(ctx.db, 'SELECT * FROM payments WHERE reference_type = ? AND reference_id = ? ORDER BY id DESC LIMIT 1',
    ['booking', bookingId]);
}

async function lastNotif(userId) {
  const rows = await queryAll(ctx.db, 'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
  return rows[0];
}

// ---------- cálculo puro: borde de 24 h ----------

test('política de cancelación: borde exacto de 24 h (cálculo puro)', () => {
  const now = new Date(2026, 9, 1, 12, 0, 0); // 1 oct 2026, 12:00 local
  const fmt = (d) => ({
    slotDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    slotTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  });
  const base = { paidGs: 100000, paid: true, cancelFreeHours: 24, now };

  // Exactamente 24 h → sin cargo (horas_before >= cancel_free_hours).
  const d1 = new Date(now.getTime() + 24 * 3600000);
  const p1 = calcCancelPolicy({ ...base, ...fmt(d1) });
  assert.equal(p1.free_cancel, true);
  assert.equal(p1.refund_gs, 100000);
  assert.equal(p1.forfeit_gs, 0);
  assert.equal(p1.hours_before, 24);

  // Un minuto menos → con cargo.
  const d2 = new Date(now.getTime() + 24 * 3600000 - 60000);
  const p2 = calcCancelPolicy({ ...base, ...fmt(d2) });
  assert.equal(p2.free_cancel, false);
  assert.equal(p2.refund_gs, 0);
  assert.equal(p2.forfeit_gs, 100000);

  // Con cancel_free_hours personalizado (48): 30 h antes → con cargo.
  const d3 = new Date(now.getTime() + 30 * 3600000);
  const p3 = calcCancelPolicy({ ...base, ...fmt(d3), cancelFreeHours: 48 });
  assert.equal(p3.free_cancel, false);
  assert.equal(p3.forfeit_gs, 100000);

  // Sin turno asignado → se devuelve todo.
  const p4 = calcCancelPolicy({ ...base, slotDate: null, slotTime: null });
  assert.equal(p4.free_cancel, true);
  assert.equal(p4.refund_gs, 100000);
  assert.equal(p4.hours_before, null);

  // Sin cobro acreditado → no hay nada que mover.
  const p5 = calcCancelPolicy({ ...base, ...fmt(d2), paid: false });
  assert.equal(p5.refund_gs, 0);
  assert.equal(p5.forfeit_gs, 0);
});

// ---------- 1. reprogramar ----------

test('reprogramar: ok — mueve el turno, el cobro no se toca, avisa a ambos', async () => {
  const { api, register } = ctx;
  const f = await confirmedBooking(30);
  const oldSlotId = f.slot.id;

  const s2 = slotAt(50);
  const sl2 = await api('POST', '/api/slots', {
    token: f.proToken, body: { professional_id: f.professional.id, ...s2 },
  });
  assert.equal(sl2.status, 201);
  const newSlotId = sl2.json.slot.id;

  const r = await api('POST', `/api/bookings/${f.booking.id}/reschedule`, {
    token: f.client.token, body: { slot_id: newSlotId },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.booking.slot_id, newSlotId);

  // El cobro no se tocó: mismo monto, sigue acreditado, el pago sigue 'captured'.
  assert.equal(r.json.booking.paid_gs, 100000);
  assert.equal(r.json.booking.paid, true);
  const pay = await paymentFor(f.booking.id);
  assert.equal(pay.status, 'captured');

  // Turno viejo libre, turno nuevo ocupado.
  const oldSlot = await queryOne(ctx.db, 'SELECT * FROM slots WHERE id = ?', [oldSlotId]);
  const newSlot = await queryOne(ctx.db, 'SELECT * FROM slots WHERE id = ?', [newSlotId]);
  assert.equal(oldSlot.status, 'free');
  assert.equal(newSlot.status, 'booked');

  // Avisos a ambas partes.
  const nClient = await lastNotif(f.client.user.id);
  assert.match(nClient.title, /se movió/i);
  const proUser = await queryOne(ctx.db, 'SELECT user_id FROM professionals WHERE id = ?', [f.professional.id]);
  const nPro = await lastNotif(proUser.user_id);
  assert.match(nPro.title, /reprogramada/i);
});

test('reprogramar: también puede pedirlo el dueño del servicio', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  const s2 = slotAt(55);
  const sl2 = await api('POST', '/api/slots', {
    token: f.proToken, body: { professional_id: f.professional.id, ...s2 },
  });
  const r = await api('POST', `/api/bookings/${f.booking.id}/reschedule`, {
    token: f.proToken, body: { slot_id: sl2.json.slot.id },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.booking.slot_id, sl2.json.slot.id);
});

test('reprogramar: turno ocupado → 400', async () => {
  const { api, register } = ctx;
  const f = await confirmedBooking(30);
  // Otro cliente ocupa un turno.
  const other = await register();
  const s2 = slotAt(51);
  const sl2 = await api('POST', '/api/slots', {
    token: f.proToken, body: { professional_id: f.professional.id, ...s2 },
  });
  const taken = await api('POST', '/api/bookings', {
    token: other.token, body: { service_id: f.service.id, slot_id: sl2.json.slot.id },
  });
  assert.equal(taken.status, 201);

  const r = await api('POST', `/api/bookings/${f.booking.id}/reschedule`, {
    token: f.client.token, body: { slot_id: sl2.json.slot.id },
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /ocupado/i);
});

test('reprogramar: reserva no confirmada → 400; tercero → 403', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, service } = await makePro();
  const client = await register();
  const outsider = await register();
  const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  const id = b.json.booking.id;

  const pending = await api('POST', `/api/bookings/${id}/reschedule`, {
    token: client.token, body: { slot_id: 999999 },
  });
  assert.equal(pending.status, 400);
  assert.match(pending.json.error, /confirmada/i);

  const no = await api('POST', `/api/bookings/${id}/reschedule`, {
    token: outsider.token, body: { slot_id: 999999 },
  });
  assert.equal(no.status, 403);

  // Turno inexistente → 404 (sobre una reserva confirmada).
  const f = await confirmedBooking(30);
  const missing = await api('POST', `/api/bookings/${f.booking.id}/reschedule`, {
    token: f.client.token, body: { slot_id: 999999 },
  });
  assert.equal(missing.status, 404);
});

test('reprogramar: turno pasado → 400', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  const past = slotAt(-5);
  const sl = await api('POST', '/api/slots', {
    token: f.proToken, body: { professional_id: f.professional.id, ...past },
  });
  assert.equal(sl.status, 201);
  const r = await api('POST', `/api/bookings/${f.booking.id}/reschedule`, {
    token: f.client.token, body: { slot_id: sl.json.slot.id },
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /pasó|futuro/i);
});

test('reprogramar: respeta la anticipación mínima del negocio', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, service, professional } = await makePro();
  // Negocio dueño del servicio (servicio con profesional + negocio).
  const owner = await register({ role: 'business' });
  const biz = await api('POST', '/api/businesses', {
    token: owner.token,
    body: { name: 'Salón Anticipado', services: [{ name: 'X', price_gs: 50000, deposit_type: 'none' }] },
  });
  assert.equal(biz.status, 201);
  const businessId = biz.json.business.id;
  await run(ctx.db, 'UPDATE services SET business_id = ? WHERE id = ?', [businessId, service.id]);
  const patch = await api('PATCH', `/api/businesses/${businessId}`, {
    token: owner.token, body: { min_advance_hours: 48 },
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.business.min_advance_hours, 48);

  const f = await (async () => {
    const client = await register();
    const s = slotAt(60);
    const sl = await api('POST', '/api/slots', {
      token: proToken, body: { professional_id: professional.id, ...s },
    });
    const b = await api('POST', '/api/bookings', {
      token: client.token, body: { service_id: service.id, slot_id: sl.json.slot.id },
    });
    const c = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
      token: proToken, body: { status: 'confirmed' },
    });
    assert.equal(c.status, 200);
    return { client, booking: c.json.booking, professional };
  })();

  // Turno a 30 h (< 48 h de anticipación) → 400.
  const near = slotAt(30);
  const slNear = await api('POST', '/api/slots', {
    token: proToken, body: { professional_id: professional.id, ...near },
  });
  const bad = await api('POST', `/api/bookings/${f.booking.id}/reschedule`, {
    token: f.client.token, body: { slot_id: slNear.json.slot.id },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /anticipación/i);

  // Turno a 50 h (>= 48 h) → ok.
  const far = slotAt(50);
  const slFar = await api('POST', '/api/slots', {
    token: proToken, body: { professional_id: professional.id, ...far },
  });
  const ok = await api('POST', `/api/bookings/${f.booking.id}/reschedule`, {
    token: f.client.token, body: { slot_id: slFar.json.slot.id },
  });
  assert.equal(ok.status, 200);
});

// ---------- 2. cancelación con reembolso ----------

test('cancel-preview: calcula sin ejecutar (sin cargo, 30 h antes)', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  const r = await api('POST', `/api/bookings/${f.booking.id}/cancel-preview`, { token: f.client.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.charged_gs, 100000);
  assert.equal(r.json.refund_gs, 100000);
  assert.equal(r.json.forfeit_gs, 0);
  assert.equal(r.json.free_cancel, true);
  assert.ok(r.json.hours_before > 24);
  assert.ok(typeof r.json.policy_text === 'string' && r.json.policy_text.length > 0);
  // No ejecutó nada: la reserva sigue confirmada y el pago sigue 'captured'.
  const b = await queryOne(ctx.db, 'SELECT * FROM bookings WHERE id = ?', [f.booking.id]);
  assert.equal(b.status, 'confirmed');
  const pay = await paymentFor(f.booking.id);
  assert.equal(pay.status, 'captured');
});

test('cancel-preview: tercero → 403; reserva cerrada → 400', async () => {
  const { api, register } = ctx;
  const f = await confirmedBooking(30);
  const outsider = await register();
  const no = await api('POST', `/api/bookings/${f.booking.id}/cancel-preview`, { token: outsider.token });
  assert.equal(no.status, 403);

  const done = await api('PATCH', `/api/bookings/${f.booking.id}`, {
    token: f.proToken, body: { status: 'completed' },
  });
  assert.equal(done.status, 200);
  const closed = await api('POST', `/api/bookings/${f.booking.id}/cancel-preview`, { token: f.client.token });
  assert.equal(closed.status, 400);
});

test('cancel: sin cargo devuelve el cobro completo (refund)', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  const r = await api('POST', `/api/bookings/${f.booking.id}/cancel`, { token: f.client.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.free_cancel, true);
  assert.equal(r.json.refund_gs, 100000);
  assert.equal(r.json.forfeit_gs, 0);
  assert.equal(r.json.booking.status, 'cancelled');
  assert.equal(r.json.booking.paid, false);
  const pay = await paymentFor(f.booking.id);
  assert.equal(pay.status, 'refunded');
  const slot = await queryOne(ctx.db, 'SELECT * FROM slots WHERE id = ?', [f.slot.id]);
  assert.equal(slot.status, 'free');
});

test('cancel: con menos de 24 h el cobro queda para el prestador', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(10);
  const prev = await api('POST', `/api/bookings/${f.booking.id}/cancel-preview`, { token: f.client.token });
  assert.equal(prev.json.free_cancel, false);
  assert.equal(prev.json.forfeit_gs, 100000);

  const r = await api('POST', `/api/bookings/${f.booking.id}/cancel`, { token: f.client.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.free_cancel, false);
  assert.equal(r.json.refund_gs, 0);
  assert.equal(r.json.forfeit_gs, 100000);
  assert.equal(r.json.booking.status, 'cancelled');
  const pay = await paymentFor(f.booking.id);
  assert.equal(pay.status, 'captured');
});

test('cancel: respeta cancel_free_hours del negocio', async () => {
  const { api, register, makePro } = ctx;
  const { token: proToken, service, professional } = await makePro();
  const owner = await register({ role: 'business' });
  const biz = await api('POST', '/api/businesses', {
    token: owner.token,
    body: { name: 'Salón Estricto', services: [{ name: 'X', price_gs: 50000, deposit_type: 'none' }] },
  });
  const businessId = biz.json.business.id;
  await run(ctx.db, 'UPDATE services SET business_id = ? WHERE id = ?', [businessId, service.id]);
  const patch = await api('PATCH', `/api/businesses/${businessId}`, {
    token: owner.token, body: { cancel_free_hours: 48 },
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.business.cancel_free_hours, 48);

  // 30 h antes con límite de 48 h → con cargo.
  const f = await (async () => {
    const client = await register();
    const s = slotAt(30);
    const sl = await api('POST', '/api/slots', {
      token: proToken, body: { professional_id: professional.id, ...s },
    });
    const b = await api('POST', '/api/bookings', {
      token: client.token, body: { service_id: service.id, slot_id: sl.json.slot.id },
    });
    const c = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
      token: proToken, body: { status: 'confirmed' },
    });
    return { client, booking: c.json.booking };
  })();
  const prev = await api('POST', `/api/bookings/${f.booking.id}/cancel-preview`, { token: f.client.token });
  assert.equal(prev.json.free_cancel, false);

  // PATCH inválido → 400; no dueño → 403.
  const badVal = await api('PATCH', `/api/businesses/${businessId}`, {
    token: owner.token, body: { cancel_free_hours: -3 },
  });
  assert.equal(badVal.status, 400);
  const stranger = await register();
  const no = await api('PATCH', `/api/businesses/${businessId}`, {
    token: stranger.token, body: { cancel_free_hours: 12 },
  });
  assert.equal(no.status, 403);
});

test('cancel vía PATCH viejo aplica la misma política (con cargo → el cobro queda)', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(10);
  const r = await api('PATCH', `/api/bookings/${f.booking.id}`, {
    token: f.client.token, body: { status: 'cancelled' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.booking.status, 'cancelled');
  const pay = await paymentFor(f.booking.id);
  assert.equal(pay.status, 'captured');

  // Vía vieja sin cargo → refund, como antes.
  const g = await confirmedBooking(30);
  const r2 = await api('PATCH', `/api/bookings/${g.booking.id}`, {
    token: g.proToken, body: { status: 'cancelled' },
  });
  assert.equal(r2.status, 200);
  const pay2 = await paymentFor(g.booking.id);
  assert.equal(pay2.status, 'refunded');
});

test('cancel: dos veces → 400', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  const first = await api('POST', `/api/bookings/${f.booking.id}/cancel`, { token: f.client.token });
  assert.equal(first.status, 200);
  const second = await api('POST', `/api/bookings/${f.booking.id}/cancel`, { token: f.client.token });
  assert.equal(second.status, 400);
});

// ---------- 3. no-show ----------

test('no-show: el prestador marca que el cliente no vino → el cobro queda para él', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(-3);
  const r = await api('POST', `/api/bookings/${f.booking.id}/no-show`, { token: f.proToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.booking.status, 'no_show_client');
  const pay = await paymentFor(f.booking.id);
  assert.equal(pay.status, 'captured');
  const n = await lastNotif(f.client.user.id);
  assert.match(n.title, /no te presentaste/i);
});

test('no-show: el cliente marca que el prestador faltó → reembolso + falta al profesional', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(-3);
  const r = await api('POST', `/api/bookings/${f.booking.id}/no-show`, { token: f.client.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.booking.status, 'no_show_pro');
  assert.equal(r.json.booking.paid, false);
  const pay = await paymentFor(f.booking.id);
  assert.equal(pay.status, 'refunded');
  const pro = await queryOne(ctx.db, 'SELECT * FROM professionals WHERE id = ?', [f.professional.id]);
  assert.equal(pro.no_show_count, 1);
  const proUser = await queryOne(ctx.db, 'SELECT user_id FROM professionals WHERE id = ?', [f.professional.id]);
  const n = await lastNotif(proUser.user_id);
  assert.match(n.title, /falta/i);
});

test('no-show: turno futuro → 400; reserva cerrada → 400; tercero → 403', async () => {
  const { api, register } = ctx;
  const f = await confirmedBooking(5);
  const future = await api('POST', `/api/bookings/${f.booking.id}/no-show`, { token: f.proToken });
  assert.equal(future.status, 400);
  assert.match(future.json.error, /todavía no pasó/i);

  const outsider = await register();
  const no = await api('POST', `/api/bookings/${f.booking.id}/no-show`, { token: outsider.token });
  assert.equal(no.status, 403);

  const g = await confirmedBooking(-3);
  await api('PATCH', `/api/bookings/${g.booking.id}`, { token: g.proToken, body: { status: 'completed' } });
  const closed = await api('POST', `/api/bookings/${g.booking.id}/no-show`, { token: g.client.token });
  assert.equal(closed.status, 400);
  assert.match(closed.json.error, /confirmada/i);
});

test('no-show: reserva pending → 400', async () => {
  const { api, register, makePro } = ctx;
  const { service } = await makePro();
  const client = await register();
  const b = await api('POST', '/api/bookings', { token: client.token, body: { service_id: service.id } });
  const r = await api('POST', `/api/bookings/${b.json.booking.id}/no-show`, { token: client.token });
  assert.equal(r.status, 400);
});
