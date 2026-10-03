'use strict';

/**
 * Tests de la nueva política de cancelación (piloto: CANCELLATION_PILOT_MODE=true).
 *
 * - Cálculo puro: computeFreeUntil (3 niveles), resolveCancellation,
 *   complianceScore, trimesterOf, maybeEarnWildcard.
 * - Endpoints: preview/cancel con comodines, en-route→no-show, reset
 *   trimestral, +1 comodín cada 10 completadas, 3 no-shows → suspendido,
 *   piloto ON no mueve plata, idempotencia, motivos obligatorios, Oppi Points.
 *
 * Los 175 tests viejos corren con el piloto apagado (ver test/helper.js) y
 * ejercitan el motor de reembolsos intacto.
 */
process.env.CANCELLATION_PILOT_MODE = 'true';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');
const { queryOne, queryAll, run } = require('../src/db');
const {
  computeFreeUntil, resolveCancellation, complianceScore, hasTrustedSeal,
  trimesterOf, trimesterResetLabel, maybeEarnWildcard, isPilotMode,
  validateCancelReason, CANCEL_REASONS,
} = require('../src/lib/cancellation');
const { recordCompletion, pointsBalance } = require('../src/lib/policy-store');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

assert.equal(isPilotMode(), true, 'estos tests corren con el piloto prendido');

const pad = (n) => String(n).padStart(2, '0');
/** Fecha/hora de turno a `hoursAhead` horas de ahora (puede ser negativo). */
function slotAt(hoursAhead) {
  const d = new Date(Date.now() + hoursAhead * 3600000);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** 'AAAA-MM-DD HH:MM:SS' local a `hoursAhead` horas de ahora. */
function dbDateTime(hoursAhead) {
  const d = new Date(Date.now() + hoursAhead * 3600000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Reserva confirmada con turno a `hoursAhead` horas, cobro del 100% (mock).
 * En piloto, al confirmar se calcula free_until (sin mover plata al cancelar).
 */
async function confirmedBooking(hoursAhead) {
  const { api, register, makePro } = ctx;
  const { token: proToken, service, professional, user: proUser } = await makePro();
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
  return { proToken, proUser, client, service, professional, slot: sl.json.slot, booking: c.json.booking };
}

/** Fuerza que el plazo gratis ya haya pasado (simula cancelación tardía). */
async function makeLate(bookingId) {
  await run(ctx.db, 'UPDATE bookings SET free_until = ? WHERE id = ?', [dbDateTime(-1), bookingId]);
}

async function paymentFor(bookingId) {
  return queryOne(ctx.db, 'SELECT * FROM payments WHERE reference_type = ? AND reference_id = ? ORDER BY id DESC LIMIT 1',
    ['booking', bookingId]);
}

// ---------- cálculo puro ----------

test('computeFreeUntil: <3h → confirmación+15min; 3–24h → inicio−3h; ≥24h → inicio−24h', () => {
  const start = new Date(2026, 9, 5, 14, 0, 0); // 5 oct 2026 14:00 local

  // 2 h entre confirmación e inicio → +15 min desde la confirmación.
  const c1 = new Date(start.getTime() - 2 * 3600000);
  assert.equal(computeFreeUntil(c1, start).getTime(), c1.getTime() + 15 * 60000);

  // 10 h → inicio − 3 h.
  const c2 = new Date(start.getTime() - 10 * 3600000);
  assert.equal(computeFreeUntil(c2, start).getTime(), start.getTime() - 3 * 3600000);

  // 48 h → inicio − 24 h.
  const c3 = new Date(start.getTime() - 48 * 3600000);
  assert.equal(computeFreeUntil(c3, start).getTime(), start.getTime() - 24 * 3600000);

  // Bordes: exactamente 3 h → tramo 3–24 h; exactamente 24 h → tramo ≥24 h.
  const c4 = new Date(start.getTime() - 3 * 3600000);
  assert.equal(computeFreeUntil(c4, start).getTime(), start.getTime() - 3 * 3600000);
  const c5 = new Date(start.getTime() - 24 * 3600000);
  assert.equal(computeFreeUntil(c5, start).getTime(), start.getTime() - 24 * 3600000);
});

test('resolveCancellation: gratis / comodin / sin_comodin', () => {
  const now = new Date(2026, 9, 1, 12, 0, 0);
  const future = new Date(now.getTime() + 3600000);
  const past = new Date(now.getTime() - 3600000);

  assert.equal(resolveCancellation({ now, freeUntil: future, wildcardBalance: 0 }), 'gratis');
  assert.equal(resolveCancellation({ now, freeUntil: now, wildcardBalance: 0 }), 'gratis'); // borde: igual = gratis
  assert.equal(resolveCancellation({ now, freeUntil: null, wildcardBalance: 0 }), 'gratis'); // sin plazo
  assert.equal(resolveCancellation({ now, freeUntil: past, wildcardBalance: 2 }), 'comodin');
  assert.equal(resolveCancellation({ now, freeUntil: past, wildcardBalance: 0 }), 'sin_comodin');
});

test('complianceScore: % redondeado; sello confiable si ≥95', () => {
  assert.equal(complianceScore({ cumplidas: 10, tardiasSinComodin: 0, noShows: 0 }), 100);
  assert.equal(complianceScore({ cumplidas: 0, tardiasSinComodin: 0, noShows: 0 }), 100); // sin historial
  assert.equal(complianceScore({ cumplidas: 9, tardiasSinComodin: 1, noShows: 0 }), 90);
  assert.equal(complianceScore({ cumplidas: 2, tardiasSinComodin: 1, noShows: 0 }), 67); // 66.6… → 67
  assert.equal(complianceScore({ cumplidas: 19, tardiasSinComodin: 1, noShows: 0 }), 95);
  assert.ok(hasTrustedSeal(95));
  assert.ok(hasTrustedSeal(100));
  assert.ok(!hasTrustedSeal(94));
});

test('trimesterOf + reset label + maybeEarnWildcard', () => {
  assert.equal(trimesterOf(new Date(2026, 0, 15)), '2026-Q1');
  assert.equal(trimesterOf(new Date(2026, 3, 1)), '2026-Q2');
  assert.equal(trimesterOf(new Date(2026, 6, 20)), '2026-Q3');
  assert.equal(trimesterOf(new Date(2026, 9, 1)), '2026-Q4');
  assert.equal(trimesterOf(new Date(2026, 11, 31)), '2026-Q4');
  assert.equal(trimesterResetLabel('2026-Q1'), '1 de abril');
  assert.equal(trimesterResetLabel('2026-Q2'), '1 de julio');
  assert.equal(trimesterResetLabel('2026-Q3'), '1 de octubre');
  assert.equal(trimesterResetLabel('2026-Q4'), '1 de enero');
  assert.equal(maybeEarnWildcard(10), true);
  assert.equal(maybeEarnWildcard(20), true);
  assert.equal(maybeEarnWildcard(9), false);
  assert.equal(maybeEarnWildcard(0), false);
});

test('validateCancelReason: cliente opcional, pro/empresa obligatorio con códigos', () => {
  assert.equal(validateCancelReason('client', undefined), null);
  assert.equal(validateCancelReason('client', 'salud'), null);
  assert.ok(validateCancelReason('client', 'invento'));
  assert.ok(validateCancelReason('pro', undefined));
  assert.ok(validateCancelReason('pro', ''));
  assert.equal(validateCancelReason('pro', 'salud'), null);
  assert.ok(validateCancelReason('pro', 'cambio_planes')); // código de cliente, no de pro
  assert.equal(validateCancelReason('business', 'cierre_sucursal'), null);
  assert.ok(validateCancelReason('business', undefined));
  assert.deepEqual(Object.keys(CANCEL_REASONS).sort(), ['business', 'client', 'pro']);
});

// ---------- preview ----------

test('GET cancel-preview: tardía con comodín → comodin (no ejecuta nada)', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  await makeLate(f.booking.id);

  const r = await api('GET', `/api/bookings/${f.booking.id}/cancel-preview`, { token: f.client.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.dentro_plazo_gratis, false);
  assert.equal(r.json.resolucion, 'comodin');
  assert.equal(r.json.comodines.balance, 3); // arranque del trimestre
  assert.equal(r.json.comodines.proximo_en, 10);
  assert.ok(typeof r.json.comodines.reset_fecha === 'string' && r.json.comodines.reset_fecha.length > 0);
  assert.ok(r.json.free_until);
  assert.ok(r.json.policy_text.length > 0);
  assert.equal(r.json.pilot_mode, true);
  assert.equal(r.json.seria_no_show, false);

  // No ejecutó nada: sigue confirmada.
  const b = await queryOne(ctx.db, 'SELECT * FROM bookings WHERE id = ?', [f.booking.id]);
  assert.equal(b.status, 'confirmed');
});

test('GET cancel-preview: dentro del plazo → gratis', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30); // free_until = inicio − 24 h (futuro)
  const r = await api('GET', `/api/bookings/${f.booking.id}/cancel-preview`, { token: f.client.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.resolucion, 'gratis');
  assert.equal(r.json.dentro_plazo_gratis, true);
});

test('confirmar calcula y guarda free_until', async () => {
  const f = await confirmedBooking(30);
  const b = await queryOne(ctx.db, 'SELECT free_until, confirmed_at FROM bookings WHERE id = ?', [f.booking.id]);
  assert.ok(b.free_until, 'free_until se calcula al confirmar');
  assert.ok(b.confirmed_at, 'confirmed_at se guarda al confirmar');
  // 30 h de anticipación → inicio − 24 h.
  const start = new Date(f.slot.date + 'T' + f.slot.time + ':00');
  const expected = start.getTime() - 24 * 3600000;
  const got = new Date(b.free_until.replace(' ', 'T') + '').getTime();
  assert.ok(Math.abs(got - expected) < 5 * 60000, `free_until ≈ inicio−24h (diff ${got - expected}ms)`);
});

// ---------- cancelación con comodines ----------

test('cancel tardía con comodín: consume 1, no mueve plata', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  await makeLate(f.booking.id);

  const r = await api('POST', `/api/bookings/${f.booking.id}/cancel`, {
    token: f.client.token, body: {},
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.resolucion, 'comodin');
  assert.equal(r.json.booking.status, 'cancelled');
  assert.equal(r.json.booking.wildcard_used, true);
  assert.equal(r.json.booking.free_cancel, false);
  assert.equal(r.json.comodines.balance, 2);

  // Piloto ON: el cobro no se toca.
  assert.equal(r.json.booking.paid, true);
  const pay = await paymentFor(f.booking.id);
  assert.equal(pay.status, 'captured');
});

test('cancel dentro del plazo: gratis y tampoco mueve plata', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  const r = await api('POST', `/api/bookings/${f.booking.id}/cancel`, {
    token: f.client.token, body: {},
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.resolucion, 'gratis');
  assert.equal(r.json.booking.free_cancel, true);
  assert.equal(r.json.booking.wildcard_used, false);
  assert.equal(r.json.booking.paid, true);
  const pay = await paymentFor(f.booking.id);
  assert.equal(pay.status, 'captured');
});

test('cancel tardía sin comodín: baja el cumplimiento', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  await makeLate(f.booking.id);
  // El preview crea la fila de comodines (balance 3); la dejo en 0.
  await api('GET', `/api/bookings/${f.booking.id}/cancel-preview`, { token: f.client.token });
  await run(ctx.db, 'UPDATE wildcards SET balance = 0 WHERE owner_type = ? AND owner_id = ?',
    ['user', f.client.user.id]);

  const r = await api('POST', `/api/bookings/${f.booking.id}/cancel`, {
    token: f.client.token, body: {},
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.resolucion, 'sin_comodin');
  assert.equal(r.json.booking.wildcard_used, false);

  const c = await api('GET', '/api/me/compliance', { token: f.client.token });
  assert.equal(c.status, 200);
  assert.equal(c.json.cumplidas, 0);
  assert.equal(c.json.tardias_sin_comodin, 1);
  assert.equal(c.json.no_shows, 0);
  assert.equal(c.json.score_pct, 0);
  assert.equal(c.json.sello_confiable, false);
  assert.equal(c.json.estrellas_separadas, true);
});

test('cancel idempotente: dos veces → 200 sin duplicar el consumo', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  await makeLate(f.booking.id);

  const first = await api('POST', `/api/bookings/${f.booking.id}/cancel`, {
    token: f.client.token, body: {},
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.comodines.balance, 2);

  const second = await api('POST', `/api/bookings/${f.booking.id}/cancel`, {
    token: f.client.token, body: {},
  });
  assert.equal(second.status, 200);
  assert.equal(second.json.already_cancelled, true);
  assert.equal(second.json.booking.status, 'cancelled');

  const w = await api('GET', '/api/me/wildcards', { token: f.client.token });
  assert.equal(w.json.balance, 2, 'el segundo cancel no consumió otro comodín');
});

test('motivo obligatorio para pro/empresa; opcional para cliente', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);

  // El pro sin motivo → 400.
  const noReason = await api('POST', `/api/bookings/${f.booking.id}/cancel`, {
    token: f.proToken, body: {},
  });
  assert.equal(noReason.status, 400);
  assert.match(noReason.json.error, /motivo/i);

  // Código inválido → 400.
  const badCode = await api('POST', `/api/bookings/${f.booking.id}/cancel`, {
    token: f.proToken, body: { reason: 'cambio_planes' },
  });
  assert.equal(badCode.status, 400);

  // Código válido → 200, guarda motivo y quién canceló, avisa al cliente con alternativas.
  const ok = await api('POST', `/api/bookings/${f.booking.id}/cancel`, {
    token: f.proToken, body: { reason: 'salud' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.booking.cancel_reason, 'salud');
  assert.equal(ok.json.booking.cancelled_by, 'pro');
  const notifs = await queryAll(ctx.db,
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', [f.client.user.id]);
  assert.match(notifs[0].body, /reprogramar/i);

  // El cliente puede cancelar sin motivo.
  const g = await confirmedBooking(30);
  const clientOk = await api('POST', `/api/bookings/${g.booking.id}/cancel`, {
    token: g.client.token, body: {},
  });
  assert.equal(clientOk.status, 200);
  assert.equal(clientOk.json.booking.cancelled_by, 'client');
});

// ---------- en-route → no-show ----------

test('cliente cancela después de en_route_at → no-show del cliente (no cancelación)', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(30);
  await run(ctx.db, 'UPDATE bookings SET en_route_at = ? WHERE id = ?', [dbDateTime(-1), f.booking.id]);

  const prev = await api('GET', `/api/bookings/${f.booking.id}/cancel-preview`, { token: f.client.token });
  assert.equal(prev.json.seria_no_show, true);

  const r = await api('POST', `/api/bookings/${f.booking.id}/cancel`, {
    token: f.client.token, body: {},
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.no_show, true);
  assert.equal(r.json.booking.status, 'no_show_client');
  assert.equal(r.json.booking.no_show_kind, 'client');
  const u = await queryOne(ctx.db, 'SELECT no_show_count FROM users WHERE id = ?', [f.client.user.id]);
  assert.equal(u.no_show_count, 1);
});

// ---------- comodines: completar, tope, reset ----------

test('completar suma +1: cada 10 → 1 comodín (tope 3)', async () => {
  const { db } = ctx;
  const { user } = await ctx.register();
  // Arranco con balance 1 para ver el +1 del premio.
  await run(db, `INSERT INTO wildcards (owner_type, owner_id, balance, trimester, completed_since_last, updated_at)
    VALUES ('user', ?, 1, '2026-Q4', 0, ?)`, [user.id, dbDateTime(0)]);
  let last;
  for (let i = 0; i < 10; i++) last = await recordCompletion(db, 'user', user.id);
  assert.equal(last.completed_since_last, 10);
  assert.equal(last.earned, true);
  assert.equal(last.balance, 2);

  // Tope: con balance 3, el premio no lo pasa.
  await run(db, 'UPDATE wildcards SET balance = 3, completed_since_last = 0 WHERE owner_type = ? AND owner_id = ?',
    ['user', user.id]);
  for (let i = 0; i < 10; i++) last = await recordCompletion(db, 'user', user.id);
  assert.equal(last.earned, true);
  assert.equal(last.balance, 3);
});

test('completar por endpoint suma al cliente y al prestador', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(-3);
  const done = await api('PATCH', `/api/bookings/${f.booking.id}`, {
    token: f.proToken, body: { status: 'completed' },
  });
  assert.equal(done.status, 200);

  const wc = await api('GET', '/api/me/wildcards', { token: f.client.token });
  assert.equal(wc.json.completed_since_last, 1);
  assert.equal(wc.json.balance, 3);
  assert.equal(wc.json.proximo_en, 9);
});

test('reset trimestral lazy: al cambiar el trimestre el balance vuelve a 3', async () => {
  const { api } = ctx;
  const { token, user } = await ctx.register();
  await run(ctx.db, `INSERT INTO wildcards (owner_type, owner_id, balance, trimester, completed_since_last, updated_at)
    VALUES ('user', ?, 0, '2020-Q1', 7, ?)`, [user.id, dbDateTime(0)]);

  const r = await api('GET', '/api/me/wildcards', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.balance, 3);
  assert.equal(r.json.completed_since_last, 0);
  assert.notEqual(r.json.trimester, '2020-Q1');
});

// ---------- no-shows, puntos, suspensión ----------

test('report-no-show del pro: cliente recibe 10% en Oppi Points y se descuentan solos', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(-3); // servicio de Gs. 100.000

  const r = await api('POST', `/api/bookings/${f.booking.id}/report-no-show`, {
    token: f.client.token, body: { kind: 'pro', notes: 'no vino nadie' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, 'pro');
  assert.equal(r.json.booking.status, 'no_show_pro');
  assert.equal(r.json.points_gs, 10000);

  const ledger = await queryAll(ctx.db, 'SELECT * FROM points_ledger WHERE user_id = ?', [f.client.user.id]);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].amount_gs, 10000);
  assert.equal(ledger[0].reason, 'no_show_pro');
  assert.equal(await pointsBalance(ctx.db, f.client.user.id), 10000);

  // En la próxima reserva los puntos se aplican solos como descuento.
  const { service } = await ctx.makePro();
  const b2 = await api('POST', '/api/bookings', {
    token: f.client.token, body: { service_id: service.id },
  });
  assert.equal(b2.status, 201);
  assert.equal(b2.json.booking.points_gs, 10000);
  assert.equal(await pointsBalance(ctx.db, f.client.user.id), 0);
});

test('report-no-show del cliente: el pro recibe puntos y queda destacado 7 días', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(-3);

  const r = await api('POST', `/api/bookings/${f.booking.id}/report-no-show`, {
    token: f.proToken, body: { kind: 'client' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.booking.status, 'no_show_client');
  assert.equal(r.json.booking.no_show_kind, 'client');

  const proUserId = (await queryOne(ctx.db, 'SELECT user_id FROM professionals WHERE id = ?', [f.professional.id])).user_id;
  const ledger = await queryAll(ctx.db,
    "SELECT * FROM points_ledger WHERE user_id = ? AND reason = 'no_show_client'", [proUserId]);
  assert.equal(ledger.length, 1);
  assert.ok(ledger[0].amount_gs > 0);
  const pro = await queryOne(ctx.db, 'SELECT featured_until FROM professionals WHERE id = ?', [f.professional.id]);
  assert.ok(pro.featured_until, 'el pro queda destacado');
});

test('3 no-shows del cliente → cuenta suspendida y 403 al reservar', async () => {
  const { api } = ctx;
  const { token: proToken, service, professional } = await ctx.makePro();
  const client = await ctx.register();

  for (let i = 0; i < 3; i++) {
    const s = slotAt(-3 - i);
    const sl = await api('POST', '/api/slots', {
      token: proToken, body: { professional_id: professional.id, ...s },
    });
    assert.equal(sl.status, 201);
    const b = await api('POST', '/api/bookings', {
      token: client.token, body: { service_id: service.id, slot_id: sl.json.slot.id },
    });
    assert.equal(b.status, 201);
    const c = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
      token: proToken, body: { status: 'confirmed' },
    });
    assert.equal(c.status, 200);
    const r = await api('POST', `/api/bookings/${b.json.booking.id}/report-no-show`, {
      token: proToken, body: { kind: 'client' },
    });
    assert.equal(r.status, 200);
  }

  const u = await queryOne(ctx.db, 'SELECT suspended, no_show_count FROM users WHERE id = ?', [client.user.id]);
  assert.equal(u.no_show_count, 3);
  assert.equal(u.suspended, 1);

  // Aviso de suspensión.
  const notifs = await queryAll(ctx.db,
    "SELECT * FROM notifications WHERE user_id = ? AND title LIKE '%suspendida%'", [client.user.id]);
  assert.ok(notifs.length >= 1);

  // Bloquea crear reservas nuevas.
  const blocked = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id },
  });
  assert.equal(blocked.status, 403);
  assert.match(blocked.json.error, /suspendida/i);
});

test('3 no-shows del pro → profesional suspendido y 403 al reservarle', async () => {
  const { api } = ctx;
  const { token: proToken, service, professional } = await ctx.makePro();

  for (let i = 0; i < 3; i++) {
    const client = await ctx.register();
    const s = slotAt(-3 - i);
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
    const r = await api('POST', `/api/bookings/${b.json.booking.id}/report-no-show`, {
      token: client.token, body: { kind: 'pro' },
    });
    assert.equal(r.status, 200);
  }

  const p = await queryOne(ctx.db, 'SELECT suspended, no_show_count FROM professionals WHERE id = ?', [professional.id]);
  assert.equal(p.no_show_count, 3);
  assert.equal(p.suspended, 1);

  const other = await ctx.register();
  const blocked = await api('POST', '/api/bookings', {
    token: other.token, body: { service_id: service.id },
  });
  assert.equal(blocked.status, 403);
  assert.match(blocked.json.error, /suspendido/i);
});

test('report-no-show: validaciones (kind, rol, turno futuro)', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(-3);

  const badKind = await api('POST', `/api/bookings/${f.booking.id}/report-no-show`, {
    token: f.client.token, body: { kind: 'invento' },
  });
  assert.equal(badKind.status, 400);

  // El cliente no puede marcar no-show del cliente; el pro no puede marcar el suyo.
  const wrong1 = await api('POST', `/api/bookings/${f.booking.id}/report-no-show`, {
    token: f.client.token, body: { kind: 'client' },
  });
  assert.equal(wrong1.status, 403);
  const wrong2 = await api('POST', `/api/bookings/${f.booking.id}/report-no-show`, {
    token: f.proToken, body: { kind: 'pro' },
  });
  assert.equal(wrong2.status, 403);

  // Turno futuro → 400.
  const g = await confirmedBooking(5);
  const future = await api('POST', `/api/bookings/${g.booking.id}/report-no-show`, {
    token: g.proToken, body: { kind: 'client' },
  });
  assert.equal(future.status, 400);
});

// ---------- /api/me/* ----------

test('GET /api/me/compliance: forma completa con historial mixto', async () => {
  const { api } = ctx;
  const f = await confirmedBooking(-3);
  await api('PATCH', `/api/bookings/${f.booking.id}`, {
    token: f.proToken, body: { status: 'completed' },
  });

  // Segunda reserva del MISMO cliente, cancelada tarde sin comodín.
  const s = slotAt(30);
  const sl = await api('POST', '/api/slots', {
    token: f.proToken, body: { professional_id: f.professional.id, ...s },
  });
  assert.equal(sl.status, 201);
  const b = await api('POST', '/api/bookings', {
    token: f.client.token, body: { service_id: f.service.id, slot_id: sl.json.slot.id },
  });
  assert.equal(b.status, 201);
  const c2 = await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
    token: f.proToken, body: { status: 'confirmed' },
  });
  assert.equal(c2.status, 200);
  await makeLate(b.json.booking.id);
  await run(ctx.db, 'UPDATE wildcards SET balance = 0 WHERE owner_type = ? AND owner_id = ?',
    ['user', f.client.user.id]);
  const cancelled = await api('POST', `/api/bookings/${b.json.booking.id}/cancel`, {
    token: f.client.token, body: {},
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.resolucion, 'sin_comodin');

  const c = await api('GET', '/api/me/compliance', { token: f.client.token });
  assert.equal(c.status, 200);
  assert.deepEqual(
    Object.keys(c.json).sort(),
    ['cumplidas', 'estrellas_separadas', 'no_shows', 'score_pct', 'sello_confiable', 'tardias_sin_comodin'].sort());
  assert.equal(c.json.cumplidas, 1);
  assert.equal(c.json.tardias_sin_comodin, 1);
  assert.equal(c.json.no_shows, 0);
  assert.equal(c.json.score_pct, 50);
  assert.equal(c.json.sello_confiable, false);
});

test('GET /api/me/wildcards: forma completa', async () => {
  const { api } = ctx;
  const { token } = await ctx.register();
  const r = await api('GET', '/api/me/wildcards', { token });
  assert.equal(r.status, 200);
  assert.deepEqual(
    Object.keys(r.json).sort(),
    ['balance', 'completed_since_last', 'proximo_en', 'reset_fecha', 'trimester'].sort());
  assert.equal(r.json.balance, 3);
  assert.equal(r.json.proximo_en, 10);
});

// ---------- historial del negocio ----------

test('GET /api/businesses/:id/cancellation-history: JSON y CSV', async () => {
  const { api, register } = ctx;
  const owner = await register({ role: 'business' });
  const biz = await api('POST', '/api/businesses', {
    token: owner.token,
    body: { name: 'Salón Historial', services: [{ name: 'Corte', price_gs: 80000, deposit_type: 'none' }] },
  });
  assert.equal(biz.status, 201);
  const businessId = biz.json.business.id;
  const service = await queryOne(ctx.db, 'SELECT * FROM services WHERE business_id = ?', [businessId]);
  const client = await register();

  // Cancelación del negocio con motivo (gratis: sin turno).
  const b = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: service.id },
  });
  assert.equal(b.status, 201);
  await api('PATCH', `/api/bookings/${b.json.booking.id}`, {
    token: owner.token, body: { status: 'confirmed' },
  });
  const cancel = await api('POST', `/api/bookings/${b.json.booking.id}/cancel`, {
    token: owner.token, body: { reason: 'reprogramacion_interna', branch: 'Villa Morra' },
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.booking.cancelled_by, 'business');
  assert.match(cancel.json.booking.cancel_detail || '', /Villa Morra/);

  // Reprogramación.
  const { token: proToken, service: pService, professional } = await ctx.makePro();
  await run(ctx.db, 'UPDATE services SET business_id = ? WHERE id = ?', [businessId, pService.id]);
  const s1 = slotAt(30);
  const sl1 = await api('POST', '/api/slots', {
    token: proToken, body: { professional_id: professional.id, ...s1 },
  });
  const b2 = await api('POST', '/api/bookings', {
    token: client.token, body: { service_id: pService.id, slot_id: sl1.json.slot.id },
  });
  await api('PATCH', `/api/bookings/${b2.json.booking.id}`, {
    token: proToken, body: { status: 'confirmed' },
  });
  const s2 = slotAt(50);
  const sl2 = await api('POST', '/api/slots', {
    token: proToken, body: { professional_id: professional.id, ...s2 },
  });
  const re = await api('POST', `/api/bookings/${b2.json.booking.id}/reschedule`, {
    token: client.token, body: { slot_id: sl2.json.slot.id },
  });
  assert.equal(re.status, 200);

  const h = await api('GET', `/api/businesses/${businessId}/cancellation-history`, { token: owner.token });
  assert.equal(h.status, 200);
  const tipos = h.json.historial.map((i) => i.tipo);
  assert.ok(tipos.includes('gratis'), `esperaba 'gratis' en ${tipos}`);
  assert.ok(tipos.includes('reprogramacion'), `esperaba 'reprogramacion' en ${tipos}`);
  assert.ok(h.json.historial.every((i) => i.id && i.fecha && i.detalle));

  // Otro usuario → 403.
  const outsider = await register();
  const no = await api('GET', `/api/businesses/${businessId}/cancellation-history`, { token: outsider.token });
  assert.equal(no.status, 403);

  // CSV descargable.
  const res = await fetch(`${ctx.base}/api/businesses/${businessId}/cancellation-history?format=csv`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const csv = await res.text();
  assert.ok(csv.startsWith('id,fecha,tipo,detalle,servicio'));
  assert.match(csv, /gratis/);
  assert.match(csv, /reprogramacion/);
});
