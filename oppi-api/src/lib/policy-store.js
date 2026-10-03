'use strict';

/**
 * Persistencia de la nueva política de cancelación: comodines, Oppi Points
 * y estadísticas de cumplimiento. Todo pasa por acá; el cálculo puro vive
 * en src/lib/cancellation.js.
 *
 * Comodines (`wildcards`): únicos por (owner_type, owner_id, trimester).
 * Cada trimestre el balance vuelve a 3 (reseteo lazy: al leer/usar).
 * Cada 10 reservas completadas se gana 1 comodín (tope 3).
 */
const { queryAll, queryOne, run } = require('../db');
const {
  trimesterOf, trimesterResetLabel, maybeEarnWildcard,
  WILDCARD_MAX_BALANCE, nowDbDateTime,
} = require('./cancellation');

function wildcardRow(r) {
  if (!r) return null;
  return {
    id: r.id, owner_type: r.owner_type, owner_id: r.owner_id,
    balance: Number(r.balance) || 0, trimester: r.trimester,
    completed_since_last: Number(r.completed_since_last) || 0,
    updated_at: r.updated_at,
  };
}

/**
 * Trae (o crea) la fila de comodines del dueño, reseteando el trimestre
 * de forma lazy: si cambió el trimestre, balance vuelve a 3.
 */
async function getWildcards(db, ownerType, ownerId, now = new Date()) {
  const trimester = trimesterOf(now);
  let row = await queryOne(db,
    'SELECT * FROM wildcards WHERE owner_type = ? AND owner_id = ?',
    [ownerType, ownerId]);
  if (!row) {
    const r = await run(db,
      `INSERT INTO wildcards (owner_type, owner_id, balance, trimester, completed_since_last, updated_at)
       VALUES (?,?,?,?,?,?)`,
      [ownerType, ownerId, WILDCARD_MAX_BALANCE, trimester, 0, nowDbDateTime()]);
    row = await queryOne(db, 'SELECT * FROM wildcards WHERE id = ?', [r.id]);
    return wildcardRow(row);
  }
  if (row.trimester !== trimester) {
    await run(db,
      'UPDATE wildcards SET trimester = ?, balance = ?, completed_since_last = 0, updated_at = ? WHERE id = ?',
      [trimester, WILDCARD_MAX_BALANCE, nowDbDateTime(), row.id]);
    row = await queryOne(db, 'SELECT * FROM wildcards WHERE id = ?', [row.id]);
  }
  return wildcardRow(row);
}

/** Consume 1 comodín (si hay). Devuelve el balance resultante. */
async function consumeWildcard(db, ownerType, ownerId, now = new Date()) {
  const w = await getWildcards(db, ownerType, ownerId, now);
  if (w.balance <= 0) return w.balance;
  await run(db, 'UPDATE wildcards SET balance = balance - 1, updated_at = ? WHERE id = ?',
    [nowDbDateTime(), w.id]);
  return w.balance - 1;
}

/**
 * Registra una reserva completada para el dueño: completed_since_last + 1;
 * cada 10 → balance + 1 (tope 3). Devuelve { completed_since_last, balance, earned }.
 */
async function recordCompletion(db, ownerType, ownerId, now = new Date()) {
  const w = await getWildcards(db, ownerType, ownerId, now);
  const completed = w.completed_since_last + 1;
  const earned = maybeEarnWildcard(completed);
  const balance = earned ? Math.min(WILDCARD_MAX_BALANCE, w.balance + 1) : w.balance;
  await run(db,
    'UPDATE wildcards SET completed_since_last = ?, balance = ?, updated_at = ? WHERE id = ?',
    [completed, balance, nowDbDateTime(), w.id]);
  return { completed_since_last: completed, balance, earned };
}

/** Suma Oppi Points al usuario (ledger). amount_gs > 0. */
async function addPoints(db, userId, amountGs, reason, refType = null, refId = null) {
  const amount = Math.round(Number(amountGs) || 0);
  if (!userId || amount <= 0) return null;
  const r = await run(db,
    'INSERT INTO points_ledger (user_id, amount_gs, reason, ref_type, ref_id) VALUES (?,?,?,?,?)',
    [userId, amount, reason, refType, refId]);
  return r.id;
}

/**
 * Balance de Oppi Points canjeable: lo ganado menos lo ya aplicado como
 * descuento en reservas (bookings.points_gs).
 */
async function pointsBalance(db, userId) {
  const earned = await queryOne(db,
    'SELECT COALESCE(SUM(amount_gs),0) AS t FROM points_ledger WHERE user_id = ?', [userId]);
  const used = await queryOne(db,
    'SELECT COALESCE(SUM(points_gs),0) AS t FROM bookings WHERE client_id = ?', [userId]);
  return Math.max(0, (Number(earned.t) || 0) - (Number(used.t) || 0));
}

/**
 * Estadísticas de cumplimiento del usuario para el score.
 * - Cliente: sus reservas como cliente.
 * - Pro/handyman: las reservas de sus servicios (su propio comportamiento).
 * - Negocio: las reservas de los servicios del negocio.
 * Devuelve { cumplidas, tardiasSinComodin, noShows }.
 */
async function getComplianceStats(db, userId) {
  const user = await queryOne(db, 'SELECT id, role FROM users WHERE id = ?', [userId]);
  const role = user ? user.role : 'client';

  if (role === 'business') {
    const biz = await queryAll(db, 'SELECT id FROM businesses WHERE user_id = ?', [userId]);
    const ids = biz.map((b) => b.id);
    if (!ids.length) return { cumplidas: 0, tardiasSinComodin: 0, noShows: 0 };
    const ph = ids.map(() => '?').join(',');
    const scope = `b.service_id IN (SELECT id FROM services WHERE business_id IN (${ph}))`;
    const [c, t, n] = await Promise.all([
      queryOne(db, `SELECT COUNT(*) AS c FROM bookings b WHERE ${scope} AND b.status = 'completed'`, ids),
      queryOne(db,
        `SELECT COUNT(*) AS c FROM bookings b WHERE ${scope} AND b.status = 'cancelled'
         AND COALESCE(b.free_cancel,0) = 0 AND COALESCE(b.wildcard_used,0) = 0
         AND b.no_show_kind IS NULL AND b.cancelled_by IN ('pro','business')`, ids),
      queryOne(db, `SELECT COUNT(*) AS c FROM bookings b WHERE ${scope} AND b.no_show_kind = 'pro'`, ids),
    ]);
    return { cumplidas: Number(c.c), tardiasSinComodin: Number(t.c), noShows: Number(n.c) };
  }

  if (role === 'pro' || role === 'handyman') {
    const pros = await queryAll(db, 'SELECT id FROM professionals WHERE user_id = ?', [userId]);
    const ids = pros.map((p) => p.id);
    if (!ids.length) return { cumplidas: 0, tardiasSinComodin: 0, noShows: 0 };
    const ph = ids.map(() => '?').join(',');
    const scope = `b.service_id IN (SELECT id FROM services WHERE professional_id IN (${ph}))`;
    const [c, t, n] = await Promise.all([
      queryOne(db, `SELECT COUNT(*) AS c FROM bookings b WHERE ${scope} AND b.status = 'completed'`, ids),
      queryOne(db,
        `SELECT COUNT(*) AS c FROM bookings b WHERE ${scope} AND b.status = 'cancelled'
         AND COALESCE(b.free_cancel,0) = 0 AND COALESCE(b.wildcard_used,0) = 0
         AND b.no_show_kind IS NULL AND b.cancelled_by IN ('pro','business')`, ids),
      queryOne(db, `SELECT COUNT(*) AS c FROM bookings b WHERE ${scope} AND b.no_show_kind = 'pro'`, ids),
    ]);
    return { cumplidas: Number(c.c), tardiasSinComodin: Number(t.c), noShows: Number(n.c) };
  }

  // Cliente.
  const [c, t, n] = await Promise.all([
    queryOne(db, "SELECT COUNT(*) AS c FROM bookings WHERE client_id = ? AND status = 'completed'", [userId]),
    queryOne(db,
      `SELECT COUNT(*) AS c FROM bookings WHERE client_id = ? AND status = 'cancelled'
       AND COALESCE(free_cancel,0) = 0 AND COALESCE(wildcard_used,0) = 0
       AND no_show_kind IS NULL AND cancelled_by = 'client'`, [userId]),
    queryOne(db, "SELECT COUNT(*) AS c FROM bookings WHERE client_id = ? AND no_show_kind = 'client'", [userId]),
  ]);
  return { cumplidas: Number(c.c), tardiasSinComodin: Number(t.c), noShows: Number(n.c) };
}

/** Resumen de comodines para /api/me/wildcards y el preview. */
async function wildcardSummary(db, ownerType, ownerId, now = new Date()) {
  const w = await getWildcards(db, ownerType, ownerId, now);
  return {
    balance: w.balance,
    trimester: w.trimester,
    completed_since_last: w.completed_since_last,
    proximo_en: Math.max(0, 10 - w.completed_since_last),
    reset_fecha: trimesterResetLabel(w.trimester),
  };
}

module.exports = {
  getWildcards, consumeWildcard, recordCompletion,
  addPoints, pointsBalance, getComplianceStats, wildcardSummary,
};
