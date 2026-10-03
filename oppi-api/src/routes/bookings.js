'use strict';

/**
 * Reservas (bookings).
 *
 * Flujo:
 *  1. POST /api/bookings {service_id, slot_id?, apply_credit_gs?}
 *     → crea la reserva en estado 'pending'. El cliente paga el 100% del
 *       total (no hay seña).
 *     → el crédito del usuario se puede aplicar al total (no más que el total
 *       ni más que el crédito disponible); se descuenta de users.credit_gs.
 *     → si se pasa slot_id, el turno tiene que estar libre y se marca 'booked'.
 *  2. PATCH /api/bookings/:id {status:'confirmed'}
 *     → SOLO el profesional/negocio dueño del servicio confirma.
 *     → cobra el 100% del total con el PaymentProvider (paid=1) y lo registra
 *       en la tabla `payments` (PAYMENT_DRIVER, default mock — ver src/lib/payments.js).
 *  3. PATCH ... {status:'completed'} → solo el profesional/negocio.
 *     PATCH ... {status:'cancelled'} → el cliente o el profesional/negocio
 *     (usa el motor de cancelación con política de reembolso: ver abajo).
 *  4. POST /api/bookings/:id/reschedule {slot_id} → mueve una reserva
 *     confirmada a otro turno libre y futuro (el cobro no se toca).
 *  5. POST /api/bookings/:id/cancel-preview → calcula la política de
 *     cancelación sin ejecutar nada.
 *     POST /api/bookings/:id/cancel → cancela aplicando la política:
 *     con anticipación suficiente se devuelve el cobro completo; si no,
 *     queda para el prestador.
 *  6. POST /api/bookings/:id/no-show → marca que alguien no se presentó
 *     (solo si el turno ya pasó): si lo marca el prestador, el cobro queda
 *     para él; si lo marca el cliente, se devuelve completo y suma una
 *     falta al profesional.
 */
const express = require('express');
const { queryAll, queryOne, run } = require('../db');
const { requireAuth } = require('../lib/auth');
const { getPaymentProvider, recordPayment } = require('../lib/payments');
const { notify } = require('../lib/notifications');
const { gs, slotDateTime, formatSlot, calcCancelPolicy,
  computeFreeUntil, resolveCancellation, validateCancelReason, cancelPolicyText,
  isPilotMode, toDate, toDbDateTime, nowDbDateTime, trimesterResetLabel,
  NO_SHOW_SUSPEND_AT,
} = require('../lib/cancellation');
const {
  getWildcards, consumeWildcard, recordCompletion, addPoints, pointsBalance,
} = require('../lib/policy-store');
const { serviceOwnerUserId } = require('./catalog');
const { businessActingRole, businessReadingRole } = require('../lib/team-access');
const { validateCoupon } = require('./coupons');
const { reportNoShow, refundBookingCharge } = require('../lib/no-show');

const router = express.Router();

function bookingDto(b) {
  return {
    id: b.id, client_id: b.client_id, service_id: b.service_id, slot_id: b.slot_id,
    status: b.status, paid_gs: b.paid_gs || 0, paid: Boolean(b.paid),
    total_gs: b.total_gs, credit_applied_gs: b.credit_applied_gs,
    discount_gs: b.discount_gs || 0, coupon_code: b.coupon_code || null,
    service_name: b.service_name, created_at: b.created_at,
    // Campos enriquecidos para los clientes (web/app): fecha y hora del turno
    // y nombres del profesional, cliente y negocio. Aditivos: no cambian el
    // contrato existente.
    slot_date: b.slot_date || null, slot_time: b.slot_time || null,
    pro_id: b.pro_id || null, pro_name: b.pro_name || null,
    client_name: b.client_name || null,
    business_id: b.business_id || null, business_name: b.business_name || null,
    // Sucursal (mejora 1): opcional, solo para servicios de negocios.
    branch_id: b.branch_id || null, branch_name: b.branch_name || null,
    // El profesional/negocio avisó que va en camino (POST /api/bookings/:id/en-route).
    en_route_at: b.en_route_at || null,
    // Nueva política de cancelación (piloto).
    confirmed_at: b.confirmed_at || null,
    free_until: b.free_until || null,
    cancel_reason: b.cancel_reason || null,
    cancel_detail: b.cancel_detail || null,
    cancelled_by: b.cancelled_by || null,
    wildcard_used: Boolean(b.wildcard_used),
    free_cancel: Boolean(b.free_cancel),
    no_show_kind: b.no_show_kind || null,
    reschedule_count: b.reschedule_count || 0,
    points_gs: b.points_gs || 0,
  };
}

// SELECT compartido: trae la reserva con fecha/hora del turno y nombres.
const BOOKING_JOINS = `
  JOIN services s ON s.id = b.service_id
  LEFT JOIN slots sl ON sl.id = b.slot_id
  LEFT JOIN professionals p ON p.id = s.professional_id
  LEFT JOIN users up ON up.id = p.user_id
  LEFT JOIN businesses biz ON biz.id = s.business_id
  LEFT JOIN coupons c ON c.id = b.coupon_id
  LEFT JOIN branches br ON br.id = b.branch_id
  LEFT JOIN users uc ON uc.id = b.client_id`;
const BOOKING_FIELDS = `b.*, s.name AS service_name,
  sl.date AS slot_date, sl.time AS slot_time,
  p.id AS pro_id, up.name AS pro_name,
  uc.name AS client_name,
  c.code AS coupon_code,
  biz.id AS business_id, biz.name AS business_name,
  br.nombre AS branch_name`;

async function listFor(db, userId) {
  return await queryAll(db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS}
     WHERE b.client_id = ? OR s.professional_id IN (SELECT id FROM professionals WHERE user_id = ?)
        OR s.business_id IN (SELECT id FROM businesses WHERE user_id = ?)
        OR s.business_id IN (SELECT business_id FROM team_members WHERE user_id = ?)
     ORDER BY b.created_at DESC`,
    [userId, userId, userId, userId]);
}

// GET /api/bookings — mis reservas (como cliente o como prestador)
router.get('/bookings', requireAuth, async (req, res) => {
  const { status } = req.query;
  let rows = await listFor(req.db, req.user.id);
  if (status) rows = rows.filter((b) => b.status === status);
  return res.json({ bookings: rows.map(bookingDto) });
});

// GET /api/bookings/:id
router.get('/bookings/:id', requireAuth, async (req, res) => {
  const b = await queryOne(req.db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS} WHERE b.id = ?`,
    [req.params.id]);
  if (!b) return res.status(404).json({ error: 'No encontramos esa reserva.' });
  const service = await queryOne(req.db, 'SELECT * FROM services WHERE id = ?', [b.service_id]);
  const ownerId = await serviceOwnerUserId(req.db, service);
  const teamRole = await businessReadingRole(req.db, service, req.user.id);
  if (b.client_id !== req.user.id && ownerId !== req.user.id && !teamRole) {
    return res.status(403).json({ error: 'Esa reserva no es tuya.' });
  }
  return res.json({ booking: bookingDto(b) });
});

// POST /api/bookings — crear reserva (cobro del 100% al confirmar) + crédito (+ cupón opcional)
router.post('/bookings', requireAuth, async (req, res) => {
  const { service_id, slot_id, apply_credit_gs, coupon_code, branch_id } = req.body || {};
  if (!service_id) return res.status(400).json({ error: 'Falta el servicio a reservar.' });
  const db = req.db;

  const service = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [service_id]);
  if (!service) return res.status(404).json({ error: 'No encontramos ese servicio.' });

  // Sucursal (mejora 1): opcional. Tiene que existir y pertenecer al negocio
  // del servicio. Los servicios de profesionales no tienen sucursales.
  let branchId = null;
  if (branch_id !== undefined && branch_id !== null) {
    if (!Number.isInteger(branch_id) || branch_id <= 0) {
      return res.status(400).json({ error: 'La sucursal no es válida.' });
    }
    const branch = await queryOne(db, 'SELECT * FROM branches WHERE id = ?', [branch_id]);
    if (!branch) return res.status(404).json({ error: 'No encontramos esa sucursal.' });
    if (service.business_id == null) {
      return res.status(400).json({ error: 'Este servicio es de un profesional y no tiene sucursales.' });
    }
    if (branch.business_id !== service.business_id) {
      return res.status(400).json({ error: 'Esa sucursal no pertenece al negocio de este servicio.' });
    }
    branchId = branch.id;
  }

  // Cuentas suspendidas (3 no-shows) no pueden crear ni recibir reservas nuevas.
  const meRow = await queryOne(db, 'SELECT suspended FROM users WHERE id = ?', [req.user.id]);
  if (meRow && meRow.suspended) {
    return res.status(403).json({ error: 'Tu cuenta está suspendida por faltas reiteradas. Escribinos para regularizar tu situación y volver a reservar.' });
  }
  if (service.professional_id) {
    const p = await queryOne(db, 'SELECT suspended FROM professionals WHERE id = ?', [service.professional_id]);
    if (p && p.suspended) {
      return res.status(403).json({ error: 'Este profesional está suspendido y no está recibiendo reservas por ahora.' });
    }
  }
  if (service.business_id) {
    const bz = await queryOne(db, 'SELECT suspended FROM businesses WHERE id = ?', [service.business_id]);
    if (bz && bz.suspended) {
      return res.status(403).json({ error: 'Este negocio está suspendido y no está recibiendo reservas por ahora.' });
    }
  }

  // Cupón (opcional): se valida ANTES de crear nada; si es inválido → 400
  // y la reserva no se crea.
  let coupon = null, discountGs = 0;
  if (coupon_code) {
    if (service.business_id == null) {
      return res.status(400).json({ error: 'Los cupones solo se pueden usar en servicios de un negocio.' });
    }
    const v = await validateCoupon(db, { code: coupon_code, businessId: service.business_id, serviceId: service.id });
    if (!v.ok) return res.status(400).json({ error: v.error });
    coupon = v.coupon;
    discountGs = v.discount_gs;
  }
  const totalGs = service.price_gs - discountGs;

  // Turno: tiene que estar libre y pertenecer al profesional del servicio.
  if (slot_id) {
    const slot = await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [slot_id]);
    if (!slot) return res.status(404).json({ error: 'No encontramos ese turno.' });
    if (slot.professional_id !== service.professional_id) {
      return res.status(400).json({ error: 'Ese turno no corresponde a este servicio.' });
    }
    if (slot.status !== 'free') {
      return res.status(409).json({ error: 'Ese turno ya está ocupado. Elegí otro.' });
    }
  }

  // Crédito: no más que el total ni más que el disponible.
  const user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [req.user.id]);
  let creditApplied = 0;
  if (apply_credit_gs) {
    if (!Number.isInteger(apply_credit_gs) || apply_credit_gs <= 0) {
      return res.status(400).json({ error: 'El crédito a aplicar tiene que ser un monto positivo.' });
    }
    if (apply_credit_gs > totalGs) {
      return res.status(400).json({ error: 'No podés aplicar más crédito que el total de la reserva.' });
    }
    if (apply_credit_gs > user.credit_gs) {
      return res.status(400).json({ error: `Solo tenés Gs. ${user.credit_gs.toLocaleString('es-PY')} de crédito disponible.` });
    }
    creditApplied = apply_credit_gs;
  }

  // Oppi Points: se aplican automáticamente como descuento en la próxima
  // reserva (lo ganado menos lo ya usado). Nunca superan el total.
  const pointsApplied = Math.min(await pointsBalance(db, req.user.id), totalGs);

  const r = await run(db,
    `INSERT INTO bookings (client_id, service_id, slot_id, status, paid_gs, paid, total_gs, credit_applied_gs, coupon_id, discount_gs, points_gs, branch_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.user.id, service_id, slot_id || null, 'pending', 0, 0, totalGs, creditApplied,
     coupon ? coupon.id : null, discountGs, pointsApplied, branchId]);
  // El cupón cuenta como usado una sola vez: acá, al crear la reserva.
  if (coupon) {
    await run(db, 'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [coupon.id]);
  }
  if (creditApplied > 0) {
    await run(db, 'UPDATE users SET credit_gs = credit_gs - ? WHERE id = ?', [creditApplied, req.user.id]);
  }
  if (slot_id) await run(db, "UPDATE slots SET status = 'booked' WHERE id = ?", [slot_id]);

  const b = await queryOne(db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS} WHERE b.id = ?`, [r.id]);
  // Avisar al profesional/negocio: tiene una reserva nueva para confirmar.
  const ownerId = await serviceOwnerUserId(db, service);
  if (ownerId && ownerId !== req.user.id) {
    await notify(db, {
      userId: ownerId, type: 'booking',
      title: `📅 Nueva reserva: ${service.name}`,
      body: `${user.name} quiere reservar "${service.name}" por Gs. ${totalGs.toLocaleString('es-PY')}. Confirmala desde tus reservas.`,
    });
  }
  return res.status(201).json({ booking: bookingDto(b) });
});

// PATCH /api/bookings/:id — cambiar estado con reglas de rol
router.patch('/bookings/:id', requireAuth, async (req, res) => {
  const { status } = req.body || {};
  const db = req.db;
  const b = await queryOne(db, 'SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!b) return res.status(404).json({ error: 'No encontramos esa reserva.' });
  const service = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [b.service_id]);
  const ownerId = await serviceOwnerUserId(db, service);
  const isOwner = ownerId === req.user.id;
  const isClient = b.client_id === req.user.id;
  if (!isOwner && !isClient) return res.status(403).json({ error: 'Esa reserva no es tuya.' });

  if (status === 'confirmed') {
    if (!isOwner) {
      return res.status(403).json({ error: 'Solo el profesional o el negocio puede confirmar la reserva.' });
    }
    if (b.status !== 'pending') return res.status(400).json({ error: `No se puede confirmar una reserva en estado "${b.status}".` });
    // Cobrar el 100% del total con la pasarela (PAYMENT_DRIVER; default: mock).
    const provider = getPaymentProvider();
    const amountToCharge = Number(b.total_gs) || 0;
    let charge = null;
    if (amountToCharge > 0) {
      try {
        charge = await provider.charge({
          amountGs: amountToCharge,
          description: `Reserva #${b.id} — ${service.name}`,
          metadata: { booking_id: b.id, client_id: b.client_id },
        });
      } catch (err) {
        console.error('[pagos] falló el cobro:', err.message);
        return res.status(502).json({ error: 'No pudimos cobrar con la pasarela de pago. Probá de nuevo en un rato.' });
      }
    }
    // Con Bancard el cobro queda 'pending' hasta que el webhook lo confirma;
    // con mock queda 'captured' en el acto. Sin monto a cobrar (total 0 por
    // crédito/puntos) se marca pagado directo.
    const paidNow = charge ? (charge.status === 'captured' ? 1 : 0) : 1;
    // Nueva política: al confirmar se fija hasta cuándo se puede cancelar gratis.
    const confirmedAtStr = nowDbDateTime();
    let freeUntilStr = null;
    if (b.slot_id) {
      const cslot = await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [b.slot_id]);
      if (cslot) {
        freeUntilStr = toDbDateTime(computeFreeUntil(new Date(), slotDateTime(cslot.date, cslot.time)));
      }
    }
    await run(db, 'UPDATE bookings SET status = ?, paid_gs = ?, paid = ?, confirmed_at = ?, free_until = ? WHERE id = ?',
      ['confirmed', amountToCharge, paidNow, confirmedAtStr, freeUntilStr, b.id]);
    if (charge) {
      await recordPayment(db, {
        referenceType: 'booking', referenceId: b.id, provider: provider.name,
        providerPaymentId: charge.paymentId, kind: 'charge', amountGs: amountToCharge, status: charge.status,
      });
    }
    await notify(db, {
      userId: b.client_id, type: 'booking',
      title: `✅ Reserva confirmada: ${service.name}`,
      body: paidNow
        ? `Tu reserva quedó confirmada. Se cobró el total de Gs. ${amountToCharge.toLocaleString('es-PY')}.`
        : 'Tu reserva quedó confirmada. Te avisamos cuando el pago quede acreditado.',
    });
  } else if (status === 'completed') {
    if (!isOwner) return res.status(403).json({ error: 'Solo el profesional o el negocio puede marcar el servicio como realizado.' });
    if (b.status !== 'confirmed') return res.status(400).json({ error: `No se puede completar una reserva en estado "${b.status}".` });
    await run(db, "UPDATE bookings SET status = 'completed' WHERE id = ?", [b.id]);
    // Nueva política: cada reserva completada suma 1 para el cliente y para
    // el prestador; cada 10 se gana 1 comodín (tope 3).
    const compClient = await recordCompletion(db, 'user', b.client_id);
    let compProvider = null;
    let providerUserId = null;
    if (service.business_id) {
      compProvider = await recordCompletion(db, 'business', service.business_id);
      providerUserId = (await queryOne(db, 'SELECT user_id FROM businesses WHERE id = ?',
        [service.business_id]) || {}).user_id;
    } else {
      providerUserId = await serviceOwnerUserId(db, service);
      if (providerUserId) compProvider = await recordCompletion(db, 'user', providerUserId);
    }
    if (compClient.earned) {
      await notify(db, {
        userId: b.client_id, type: 'booking',
        title: '🎟️ ¡Ganaste un comodín!',
        body: 'Completaste 10 reservas: sumaste 1 comodín para cancelar sin costo fuera del plazo gratis.',
      });
    }
    if (compProvider && compProvider.earned && providerUserId && providerUserId !== b.client_id) {
      await notify(db, {
        userId: providerUserId, type: 'booking',
        title: '🎟️ ¡Ganaste un comodín!',
        body: 'Completaste 10 reservas: sumaste 1 comodín para cancelar sin costo fuera del plazo gratis.',
      });
    }
  } else if (status === 'cancelled') {
    // Con el piloto prendido, la vía vieja usa la nueva política (sin mover plata).
    if (isPilotMode()) {
      const { reason, reason_detail } = req.body || {};
      try {
        const out = await executeCancelPolicy(db, b, service, req.user, isClient,
          { reason, reasonDetail: reason_detail });
        if (out.already_cancelled) return res.json({ booking: out.booking, already_cancelled: true });
        return res.json({ booking: out.booking, resolucion: out.resolucion, pilot_mode: true });
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message || 'No se pudo cancelar la reserva.' });
      }
    }
    // Vía vieja: usa el mismo motor con política de reembolso (mejora 2),
    // así que cancela con las mismas reglas que POST .../cancel.
    if (!['pending', 'confirmed'].includes(b.status)) {
      return res.status(400).json({ error: `Esta reserva ya está cerrada ("${b.status}") y no se puede cancelar.` });
    }
    const cancelledBy = isClient ? 'client' : (req.user.role === 'business' ? 'business' : 'pro');
    const { booking: cancelled } = await executeCancel(db, b, { cancelledBy });
    return res.json({ booking: cancelled });
  } else {
    return res.status(400).json({ error: 'Estado no válido (usá confirmed, completed o cancelled).' });
  }

  const updated = await queryOne(db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS} WHERE b.id = ?`, [b.id]);
  return res.json({ booking: bookingDto(updated) });
});

// =====================================================================
// Mejora 2 — motor de cancelación con política de reembolso
// =====================================================================

/** Calcula la política de cancelación de una reserva (sin ejecutar nada). */
async function buildCancelPolicy(db, booking) {
  const service = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [booking.service_id]);
  const slot = booking.slot_id
    ? await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [booking.slot_id])
    : null;
  let cancelFreeHours = 24;
  if (service && service.business_id) {
    const biz = await queryOne(db, 'SELECT cancel_free_hours FROM businesses WHERE id = ?', [service.business_id]);
    if (biz && biz.cancel_free_hours != null) cancelFreeHours = biz.cancel_free_hours;
  }
  return calcCancelPolicy({
    paidGs: booking.paid_gs, paid: booking.paid,
    slotDate: slot ? slot.date : null, slotTime: slot ? slot.time : null,
    cancelFreeHours,
  });
}

/**
 * Ejecuta la cancelación de una reserva aplicando la política de reembolso.
 * Lo usan POST /api/bookings/:id/cancel y la vía vieja PATCH {status:'cancelled'}.
 *
 * - Sin cargo (faltan >= cancel_free_hours): devuelve el cobro completo
 *   (refund) y marca paid=0.
 * - Con cargo: el cobro queda para el prestador (el cliente lo pierde).
 * - El dinero solo se mueve vía la interfaz del provider; si la pasarela
 *   falla es best effort con log, pero el estado contable en `payments` solo
 *   cambia cuando la pasarela confirma.
 * Devuelve { policy, booking }.
 */
async function executeCancel(db, booking, { cancelledBy }) {
  const service = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [booking.service_id]);
  const ownerId = await serviceOwnerUserId(db, service);
  const policy = await buildCancelPolicy(db, booking);
  const cancelledByClient = cancelledBy === 'client';

  if (policy.free_cancel && booking.paid) {
    await refundBookingCharge(db, booking.id);
    await run(db, 'UPDATE bookings SET paid = 0 WHERE id = ?', [booking.id]);
  }

  await run(db,
    "UPDATE bookings SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, free_cancel = ? WHERE id = ?",
    [cancelledBy, nowDbDateTime(), policy.free_cancel ? 1 : 0, booking.id]);
  if (booking.slot_id) await run(db, "UPDATE slots SET status = 'free' WHERE id = ?", [booking.slot_id]);

  // Avisar a ambas partes con el resultado contable.
  const clientName = (await queryOne(db, 'SELECT name FROM users WHERE id = ?', [booking.client_id]) || {}).name || 'El cliente';
  const moneyLine = policy.refund_gs > 0
    ? ` Se devuelven ${gs(policy.refund_gs)} a tu medio de pago.`
    : policy.forfeit_gs > 0
      ? ` Los ${gs(policy.forfeit_gs)} cobrados quedan para el prestador, según su política.`
      : '';
  if (ownerId && ownerId !== booking.client_id) {
    await notify(db, {
      userId: ownerId, type: 'booking',
      title: `❌ Se canceló la reserva: ${service.name}`,
      body: cancelledByClient
        ? `${clientName} canceló su reserva.${moneyLine}`
        : `Cancelaste la reserva de ${clientName}.${moneyLine}`,
    });
  }
  await notify(db, {
    userId: booking.client_id, type: 'booking',
    title: `❌ Se canceló tu reserva: ${service.name}`,
    body: cancelledByClient
      ? `Tu reserva quedó cancelada.${moneyLine}`
      : `El prestador canceló tu reserva.${moneyLine}`,
  });

  // Si se liberó un turno, avisar a la lista de espera de ese profesional.
  if (booking.slot_id && service && service.professional_id) {
    const waiting = await queryAll(db,
      'SELECT client_id FROM waitlist WHERE professional_id = ?', [service.professional_id]);
    const proName = (await queryOne(db,
      'SELECT u.name FROM professionals p JOIN users u ON u.id = p.user_id WHERE p.id = ?',
      [service.professional_id]) || {}).name || 'El profesional';
    for (const w of waiting) {
      await notify(db, {
        userId: w.client_id, type: 'waitlist',
        title: '🎊 ¡Se liberó un lugar!',
        body: `${proName} liberó un turno. Entrá ya a reservar antes de que lo tomen.`,
      });
    }
  }

  const updated = await queryOne(db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS} WHERE b.id = ?`, [booking.id]);
  return { policy, booking: bookingDto(updated) };
}

/** Carga la reserva + servicio + dueño, o responde 404/403. */
async function loadBookingFor(db, res, bookingId, userId) {
  const booking = await queryOne(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) { res.status(404).json({ error: 'No encontramos esa reserva.' }); return null; }
  const service = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [booking.service_id]);
  const ownerId = await serviceOwnerUserId(db, service);
  // Roles en empresas (pieza 6): admin/editor del equipo actúan como el
  // negocio; cualquier miembro puede leer.
  const actingRole = await businessActingRole(db, service, userId);
  const readingRole = await businessReadingRole(db, service, userId);
  const isOwner = ownerId === userId || actingRole !== null;
  const isClient = booking.client_id === userId;
  if (!isOwner && !isClient && !readingRole) {
    res.status(403).json({ error: 'Esa reserva no es tuya.' });
    return null;
  }
  return { booking, service, ownerId, isOwner, isClient, teamRole: readingRole };
}

// POST /api/bookings/:id/cancel-preview — calcula la política sin ejecutar nada.
// Con el piloto prendido devuelve la nueva política; apagado, la vieja (reembolso).
router.post('/bookings/:id/cancel-preview', requireAuth, async (req, res) => {
  const db = req.db;
  const ctx = await loadBookingFor(db, res, req.params.id, req.user.id);
  if (!ctx) return;
  if (!['pending', 'confirmed'].includes(ctx.booking.status)) {
    return res.status(400).json({ error: `Esta reserva ya está cerrada ("${ctx.booking.status}") y no se puede cancelar.` });
  }
  if (isPilotMode()) {
    return res.json(await buildNewCancelPreview(db, ctx.booking, ctx.service, req.user, ctx.isClient));
  }
  return res.json(await buildCancelPolicy(db, ctx.booking));
});

// GET /api/bookings/:id/cancel-preview — preview de la NUEVA política (piloto).
// No ejecuta nada. Devuelve { free_until, dentro_plazo_gratis, resolucion,
// comodines: { balance, proximo_en, reset_fecha }, policy_text, pilot_mode }.
router.get('/bookings/:id/cancel-preview', requireAuth, async (req, res) => {
  const db = req.db;
  const ctx = await loadBookingFor(db, res, req.params.id, req.user.id);
  if (!ctx) return;
  if (!['pending', 'confirmed'].includes(ctx.booking.status)) {
    return res.status(400).json({ error: `Esta reserva ya está cerrada ("${ctx.booking.status}") y no se puede cancelar.` });
  }
  return res.json(await buildNewCancelPreview(db, ctx.booking, ctx.service, req.user, ctx.isClient));
});

// POST /api/bookings/:id/cancel { reason, reason_detail?, branch?, team_member? }
// Con el piloto prendido aplica la nueva política (NO mueve plata).
// Motivo: opcional para el cliente, OBLIGATORIO para pro/empresa (con códigos).
// Idempotente: si ya está cancelada, devuelve el estado actual sin duplicar efectos.
router.post('/bookings/:id/cancel', requireAuth, async (req, res) => {
  const db = req.db;
  const ctx = await loadBookingFor(db, res, req.params.id, req.user.id);
  if (!ctx) return;
  // Actuar (cancelar) requiere ser cliente o actuar por el negocio
  // (dueño o equipo admin/editor); lectura solo puede ver el preview.
  if (!ctx.isOwner && !ctx.isClient) {
    return res.status(403).json({ error: 'Solo el cliente o el negocio pueden cancelar esta reserva.' });
  }
  if (isPilotMode()) {
    const { reason, reason_detail, branch, team_member } = req.body || {};
    try {
      const out = await executeCancelPolicy(db, ctx.booking, ctx.service, req.user, ctx.isClient,
        { reason, reasonDetail: reason_detail, branch, teamMember: team_member });
      if (out.already_cancelled) {
        return res.json({ booking: out.booking, already_cancelled: true, pilot_mode: true });
      }
      return res.json({ ...out, pilot_mode: true });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message || 'No se pudo cancelar la reserva.' });
    }
  }
  if (!['pending', 'confirmed'].includes(ctx.booking.status)) {
    return res.status(400).json({ error: `Esta reserva ya está cerrada ("${ctx.booking.status}") y no se puede cancelar.` });
  }
  const cancelledBy = ctx.isClient ? 'client' : (req.user.role === 'business' ? 'business' : 'pro');
  const { policy, booking } = await executeCancel(db, ctx.booking, { cancelledBy });
  return res.json({ ...policy, booking });
});

// =====================================================================
// Nueva política de cancelación (piloto: CANCELLATION_PILOT_MODE, default true)
// Con el piloto prendido, cancelar NO mueve plata: no se llama a la pasarela.
// El motor viejo de reembolsos queda intacto para cuando se apague el piloto.
// =====================================================================

/** 'client' | 'pro' | 'business' según quién cancela. */
function cancelledByFor(user, isClient) {
  if (isClient) return 'client';
  return user.role === 'business' ? 'business' : 'pro';
}

/** Dueño de los comodines que se consumen al cancelar. */
function wildcardOwnerFor(cancelledBy, userId, service) {
  if (cancelledBy === 'business') return ['business', service.business_id];
  return ['user', userId];
}

/** Preview de la nueva política (cálculo, sin ejecutar nada). */
async function buildNewCancelPreview(db, booking, service, user, isClient, now = new Date()) {
  const cancelledBy = cancelledByFor(user, isClient);
  const [ownerType, ownerId] = wildcardOwnerFor(cancelledBy, user.id, service);

  const slot = booking.slot_id
    ? await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [booking.slot_id])
    : null;
  let freeUntil = booking.free_until || null;
  if (!freeUntil && slot) {
    // Reservas confirmadas antes de este deploy: se reconstruye el límite.
    freeUntil = toDbDateTime(computeFreeUntil(
      booking.confirmed_at || booking.created_at, slotDateTime(slot.date, slot.time)));
  }

  // Si el pro ya avisó que va en camino y cancela el cliente → no-show.
  const seriaNoShow = cancelledBy === 'client'
    && Boolean(booking.en_route_at)
    && toDate(now).getTime() >= toDate(booking.en_route_at).getTime();

  const w = await getWildcards(db, ownerType, ownerId, now);
  const resolucion = resolveCancellation({ now, freeUntil, wildcardBalance: w.balance });

  return {
    free_until: freeUntil,
    dentro_plazo_gratis: resolucion === 'gratis',
    resolucion,
    seria_no_show: seriaNoShow,
    comodines: {
      balance: w.balance,
      proximo_en: Math.max(0, 10 - w.completed_since_last),
      reset_fecha: trimesterResetLabel(w.trimester),
    },
    policy_text: cancelPolicyText({ resolucion, freeUntil, wildcardBalance: w.balance, seriaNoShow }),
    pilot_mode: isPilotMode(),
  };
}

/**
 * Ejecuta la cancelación con la nueva política.
 * NO mueve plata (piloto). Lanza Error con `.status` si la validación falla.
 * Devuelve { resolucion, booking, policy_text, comodines } o
 * { already_cancelled: true, booking } (idempotente) o { no_show: true, booking }.
 */
async function executeCancelPolicy(db, booking, service, user, isClient, opts = {}) {
  const now = opts.now || new Date();
  const nowStr = nowDbDateTime();
  const cancelledBy = cancelledByFor(user, isClient);
  const [ownerType, ownerId] = wildcardOwnerFor(cancelledBy, user.id, service);

  const dtoOf = () => queryOne(db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS} WHERE b.id = ?`, [booking.id])
    .then((b) => bookingDto(b));

  // Idempotencia: ya cancelada → estado actual, sin duplicar efectos.
  if (booking.status === 'cancelled') {
    return { already_cancelled: true, booking: await dtoOf() };
  }
  if (!['pending', 'confirmed'].includes(booking.status)) {
    const err = new Error(`Esta reserva ya está cerrada ("${booking.status}") y no se puede cancelar.`);
    err.status = 400;
    throw err;
  }

  const reasonErr = validateCancelReason(cancelledBy, opts.reason);
  if (reasonErr) {
    const err = new Error(reasonErr);
    err.status = 400;
    throw err;
  }

  // Regla en-route → no-show: el cliente cancela DESPUÉS de que el pro avisó
  // que va en camino → se registra como no-show del cliente, no como cancelación.
  if (cancelledBy === 'client' && booking.en_route_at
      && toDate(now).getTime() >= toDate(booking.en_route_at).getTime()) {
    await applyClientNoShow(db, booking, service, { viaCancel: true, now });
    return { no_show: true, booking: await dtoOf() };
  }

  const slot = booking.slot_id
    ? await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [booking.slot_id])
    : null;
  let freeUntil = booking.free_until || null;
  if (!freeUntil && slot) {
    freeUntil = toDbDateTime(computeFreeUntil(
      booking.confirmed_at || booking.created_at, slotDateTime(slot.date, slot.time)));
  }
  const w = await getWildcards(db, ownerType, ownerId, now);
  const resolucion = resolveCancellation({ now, freeUntil, wildcardBalance: w.balance });
  const wildcardUsed = resolucion === 'comodin' ? 1 : 0;
  const newBalance = wildcardUsed ? await consumeWildcard(db, ownerType, ownerId, now) : w.balance;

  let detail = opts.reasonDetail ? String(opts.reasonDetail).trim() : '';
  if (cancelledBy === 'business') {
    const extra = [
      opts.branch ? `Sucursal: ${opts.branch}` : '',
      opts.teamMember ? `Colaborador: ${opts.teamMember}` : '',
    ].filter(Boolean).join(' · ');
    if (extra) detail = detail ? `${extra} · ${detail}` : extra;
  }

  await run(db,
    `UPDATE bookings
     SET status = 'cancelled', cancel_reason = ?, cancel_detail = ?, cancelled_by = ?,
         cancelled_at = ?, wildcard_used = ?, free_cancel = ?
     WHERE id = ?`,
    [opts.reason || null, detail || null, cancelledBy, nowStr,
     wildcardUsed, resolucion === 'gratis' ? 1 : 0, booking.id]);
  if (booking.slot_id) await run(db, "UPDATE slots SET status = 'free' WHERE id = ?", [booking.slot_id]);

  // Avisos. Con el piloto prendido la plata no se toca: no hay línea de dinero.
  const policyText = cancelPolicyText({ resolucion, freeUntil, wildcardBalance: w.balance });
  const ownerIdSvc = await serviceOwnerUserId(db, service);
  const clientName = (await queryOne(db, 'SELECT name FROM users WHERE id = ?',
    [booking.client_id]) || {}).name || 'El cliente';
  const lateLine = resolucion === 'gratis'
    ? 'Fue dentro del plazo gratis.'
    : resolucion === 'comodin' ? 'Usó 1 comodín.' : 'Fue una cancelación tardía sin comodín.';
  if (cancelledBy === 'client') {
    if (ownerIdSvc && ownerIdSvc !== booking.client_id) {
      await notify(db, {
        userId: ownerIdSvc, type: 'booking',
        title: `❌ Se canceló la reserva: ${service.name}`,
        body: `${clientName} canceló su reserva. ${lateLine}`,
      });
    }
    await notify(db, {
      userId: booking.client_id, type: 'booking',
      title: `❌ Cancelaste tu reserva: ${service.name}`,
      body: policyText,
    });
  } else {
    // Cancela el prestador: se le ofrecen alternativas al cliente.
    await notify(db, {
      userId: booking.client_id, type: 'booking',
      title: `❌ El prestador canceló tu reserva: ${service.name}`,
      body: 'Te pedimos disculpas. Podemos reprogramar tu turno, asignarte otro colaborador ' +
        'o ayudarte a elegir otro profesional. Escribinos y lo resolvemos ya.',
    });
    if (ownerIdSvc && ownerIdSvc !== booking.client_id) {
      await notify(db, {
        userId: ownerIdSvc, type: 'booking',
        title: `❌ Cancelaste la reserva: ${service.name}`,
        body: `${clientName} fue avisado con alternativas. ${lateLine}`,
      });
    }
  }

  // Si se liberó un turno, avisar a la lista de espera de ese profesional.
  if (booking.slot_id && service && service.professional_id) {
    const waiting = await queryAll(db,
      'SELECT client_id FROM waitlist WHERE professional_id = ?', [service.professional_id]);
    const proName = (await queryOne(db,
      'SELECT u.name FROM professionals p JOIN users u ON u.id = p.user_id WHERE p.id = ?',
      [service.professional_id]) || {}).name || 'El profesional';
    for (const wrow of waiting) {
      await notify(db, {
        userId: wrow.client_id, type: 'waitlist',
        title: '🎊 ¡Se liberó un lugar!',
        body: `${proName} liberó un turno. Entrá ya a reservar antes de que lo tomen.`,
      });
    }
  }

  return {
    resolucion,
    booking: await dtoOf(),
    policy_text: policyText,
    comodines: { balance: newBalance },
  };
}

/**
 * Registra no-show del CLIENTE (lo marca el pro/empresa, o cae por la regla
 * en-route→no-show). Suma la falta al cliente; con 3 → cuenta suspendida.
 * El prestador recibe Oppi Points (10% del servicio) y —si es profesional—
 * queda destacado 7 días.
 */
async function applyClientNoShow(db, booking, service, { viaCancel = false, notes = '', now = new Date() } = {}) {
  const nowStr = nowDbDateTime();
  await run(db,
    "UPDATE bookings SET status = 'no_show_client', no_show_kind = 'client', cancelled_at = ? WHERE id = ?",
    [nowStr, booking.id]);

  const client = await queryOne(db, 'SELECT id, no_show_count FROM users WHERE id = ?', [booking.client_id]);
  const newCount = (Number(client.no_show_count) || 0) + 1;
  const suspended = newCount >= NO_SHOW_SUSPEND_AT;
  await run(db, 'UPDATE users SET no_show_count = ?, suspended = ? WHERE id = ?',
    [newCount, suspended ? 1 : 0, booking.client_id]);

  const ownerUserId = await serviceOwnerUserId(db, service);
  const amount = Math.round((Number(booking.total_gs) || 0) * 0.10);
  if (ownerUserId && amount > 0) {
    await addPoints(db, ownerUserId, amount, 'no_show_client', 'booking', booking.id);
  }
  if (service.professional_id) {
    await run(db, 'UPDATE professionals SET featured_until = ? WHERE id = ?',
      [toDbDateTime(new Date(now.getTime() + 7 * 86400000)), service.professional_id]);
  }

  const notesLine = notes ? ` Nota: ${notes}` : '';
  await notify(db, {
    userId: booking.client_id, type: 'booking',
    title: viaCancel
      ? `😶 Se registró que no te presentaste: ${service.name}`
      : `😶 No te presentaste a tu turno: ${service.name}`,
    body: `Quedó registrado como no-show.${notesLine}` +
      (suspended
        ? ' Con 3 no-shows tu cuenta quedó suspendida: no vas a poder crear reservas nuevas.'
        : ''),
  });
  if (ownerUserId) {
    await notify(db, {
      userId: ownerUserId, type: 'booking',
      title: `⭐ Te compensamos el no-show: ${service.name}`,
      body: amount > 0
        ? `El cliente no se presentó. Te sumamos ${gs(amount)} en Oppi Points` +
          (service.professional_id ? ' y tu perfil queda destacado 7 días.' : '.')
        : 'El cliente no se presentó.',
    });
  }
  if (suspended) {
    await notify(db, {
      userId: booking.client_id, type: 'booking',
      title: '⛔ Tu cuenta quedó suspendida',
      body: 'Acumulaste 3 no-shows. Tu cuenta está suspendida y no podés crear reservas nuevas. ' +
        'Escribinos para regularizar tu situación.',
    });
  }
  return { no_show_count: newCount, suspended };
}

/**
 * Registra no-show del PRESTADOR (lo reporta el cliente). Suma la falta al
 * profesional o al negocio; con 3 → suspendido. El cliente recibe el 10% del
 * servicio en Oppi Points, canjeables como descuento en su próxima reserva.
 */
async function applyProNoShow(db, booking, service, { notes = '', now = new Date() } = {}) {
  const nowStr = nowDbDateTime();
  await run(db,
    "UPDATE bookings SET status = 'no_show_pro', no_show_kind = 'pro', cancelled_at = ? WHERE id = ?",
    [nowStr, booking.id]);

  let suspended = false;
  if (service.professional_id) {
    const p = await queryOne(db, 'SELECT no_show_count FROM professionals WHERE id = ?',
      [service.professional_id]);
    const newCount = (Number(p.no_show_count) || 0) + 1;
    suspended = newCount >= NO_SHOW_SUSPEND_AT;
    await run(db, 'UPDATE professionals SET no_show_count = ?, suspended = ? WHERE id = ?',
      [newCount, suspended ? 1 : 0, service.professional_id]);
  } else if (service.business_id) {
    const bzb = await queryOne(db, 'SELECT no_show_count FROM businesses WHERE id = ?',
      [service.business_id]);
    const newCount = (Number(bzb.no_show_count) || 0) + 1;
    suspended = newCount >= NO_SHOW_SUSPEND_AT;
    await run(db, 'UPDATE businesses SET no_show_count = ?, suspended = ? WHERE id = ?',
      [newCount, suspended ? 1 : 0, service.business_id]);
  }

  const amount = Math.round((Number(booking.total_gs) || 0) * 0.10);
  if (amount > 0) {
    await addPoints(db, booking.client_id, amount, 'no_show_pro', 'booking', booking.id);
  }

  const notesLine = notes ? ` Nota: ${notes}` : '';
  await notify(db, {
    userId: booking.client_id, type: 'booking',
    title: `⭐ Te compensamos la falta: ${service.name}`,
    body: amount > 0
      ? `El prestador no se presentó.${notesLine} Te sumamos ${gs(amount)} en Oppi Points para tu próxima reserva.`
      : `El prestador no se presentó.${notesLine}`,
  });
  const ownerUserId = await serviceOwnerUserId(db, service);
  if (ownerUserId) {
    await notify(db, {
      userId: ownerUserId, type: 'booking',
      title: `😶 Te marcaron una falta: ${service.name}`,
      body: `El cliente marcó que no te presentaste.${notesLine}` +
        (suspended ? ' Con 3 faltas tu cuenta quedó suspendida.' : ''),
    });
    if (suspended) {
      await notify(db, {
        userId: ownerUserId, type: 'booking',
        title: '⛔ Tu cuenta quedó suspendida',
        body: 'Acumulaste 3 no-shows como prestador. Tu cuenta está suspendida y no vas a recibir reservas nuevas.',
      });
    }
  }
  return { suspended, points_gs: amount };
}

/**
 * Handler compartido de POST /api/bookings/:id/report-no-show.
 * `forcedKind` permite reutilizarlo desde la vía vieja POST .../no-show
 * (el rol sale del que pide).
 */
async function handleReportNoShow(req, res, forcedKind = null) {
  const db = req.db;
  const ctx = await loadBookingFor(db, res, req.params.id, req.user.id);
  if (!ctx) return;
  const { booking: b, service, isOwner, isClient } = ctx;
  const { kind: bodyKind, notes, photo_url } = req.body || {};
  const kind = forcedKind || bodyKind;
  if (!['client', 'pro'].includes(kind)) {
    return res.status(400).json({ error: 'El tipo de no-show tiene que ser "client" o "pro".' });
  }
  if (b.status !== 'confirmed') {
    return res.status(400).json({ error: `Solo se puede marcar no-show en una reserva confirmada (está "${b.status}").` });
  }
  if (kind === 'client' && !isOwner) {
    return res.status(403).json({ error: 'Solo el profesional o el negocio puede marcar que el cliente no vino.' });
  }
  if (kind === 'pro' && !isClient) {
    return res.status(403).json({ error: 'Solo el cliente puede marcar que el prestador no se presentó.' });
  }
  const slot = b.slot_id ? await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [b.slot_id]) : null;
  if (!slot) return res.status(400).json({ error: 'Esta reserva no tiene turno asignado.' });
  const past = slotDateTime(slot.date, slot.time).getTime() < Date.now();
  if (!past && !b.en_route_at) {
    return res.status(400).json({ error: 'El turno todavía no pasó. Esperá a que pase la hora para marcarlo.' });
  }
  void photo_url; // se acepta por contrato; la evidencia queda en la nota/notificación.

  let result;
  if (kind === 'client') {
    result = await applyClientNoShow(db, b, service, { notes: notes ? String(notes) : '' });
  } else {
    result = await applyProNoShow(db, b, service, { notes: notes ? String(notes) : '' });
  }
  const updated = await queryOne(db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS} WHERE b.id = ?`, [b.id]);
  return res.json({ ok: true, kind, ...result, booking: bookingDto(updated), pilot_mode: isPilotMode() });
}

// POST /api/bookings/:id/report-no-show { kind: 'client'|'pro', notes?, photo_url? }
// Nueva política (piloto): sin mover plata. El reporte se toma como confirmado.
router.post('/bookings/:id/report-no-show', requireAuth, async (req, res) => {
  return handleReportNoShow(req, res);
});

// =====================================================================
// Mejora 1 — reprogramar reserva
// =====================================================================

// POST /api/bookings/:id/reschedule { slot_id } — mueve una reserva
// confirmada a otro turno libre y futuro. El cobro (monto, pago) no se toca.
router.post('/bookings/:id/reschedule', requireAuth, async (req, res) => {
  const { slot_id } = req.body || {};
  const db = req.db;
  const ctx = await loadBookingFor(db, res, req.params.id, req.user.id);
  if (!ctx) return;
  const { booking: b, service, ownerId } = ctx;
  if (b.status !== 'confirmed') {
    return res.status(400).json({ error: `Solo se puede reprogramar una reserva confirmada (está "${b.status}").` });
  }
  // Reprogramar es una acción: cliente o quien actúa por el negocio.
  if (!ctx.isOwner && !ctx.isClient) {
    return res.status(403).json({ error: 'Solo el cliente o el negocio pueden reprogramar esta reserva.' });
  }
  if (!slot_id) return res.status(400).json({ error: 'Pasame el turno nuevo (slot_id).' });
  if (Number(slot_id) === b.slot_id) {
    return res.status(400).json({ error: 'La reserva ya está en ese turno.' });
  }
  const slot = await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [slot_id]);
  if (!slot) return res.status(404).json({ error: 'No encontramos ese turno.' });
  if (slot.professional_id !== service.professional_id) {
    return res.status(400).json({ error: 'Ese turno no corresponde a este servicio.' });
  }
  if (slot.status !== 'free') {
    return res.status(400).json({ error: 'Ese turno ya está ocupado. Elegí otro.' });
  }
  const slotAt = slotDateTime(slot.date, slot.time);
  if (!(slotAt.getTime() > Date.now())) {
    return res.status(400).json({ error: 'Ese turno ya pasó. Elegí uno futuro.' });
  }
  // Antelación mínima: solo si el servicio es de un negocio que la configuró.
  if (service.business_id) {
    const biz = await queryOne(db, 'SELECT min_advance_hours FROM businesses WHERE id = ?', [service.business_id]);
    if (biz && biz.min_advance_hours != null && Number.isInteger(biz.min_advance_hours) && biz.min_advance_hours > 0) {
      if (slotAt.getTime() - Date.now() < biz.min_advance_hours * 3600000) {
        return res.status(400).json({
          error: `Este negocio pide reservar con al menos ${biz.min_advance_hours} h de anticipación. Elegí un turno más lejano.`,
        });
      }
    }
  }

  // Mover los turnos: el viejo vuelve a 'free', el nuevo queda 'booked'.
  if (b.slot_id) await run(db, "UPDATE slots SET status = 'free' WHERE id = ?", [b.slot_id]);
  await run(db, "UPDATE slots SET status = 'booked' WHERE id = ?", [slot.id]);
  await run(db, 'UPDATE bookings SET slot_id = ?, reschedule_count = reschedule_count + 1, rescheduled_at = ? WHERE id = ?',
    [slot.id, nowDbDateTime(), b.id]);

  const cuando = formatSlot(slot.date, slot.time);
  const clientName = (await queryOne(db, 'SELECT name FROM users WHERE id = ?', [b.client_id]) || {}).name || 'El cliente';
  await notify(db, {
    userId: b.client_id, type: 'booking',
    title: `🔄 Tu reserva se movió al ${cuando}`,
    body: `"${service.name}" ahora es el ${cuando}. El pago quedó igual, no se movió plata.`,
  });
  if (ownerId && ownerId !== b.client_id) {
    await notify(db, {
      userId: ownerId, type: 'booking',
      title: `🔄 Reserva reprogramada: ${service.name}`,
      body: `${clientName} movió su turno al ${cuando}.`,
    });
  }

  const updated = await queryOne(db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS} WHERE b.id = ?`, [b.id]);
  return res.json({ booking: bookingDto(updated) });
});

// =====================================================================
// Mejora 3 — no-show
// =====================================================================

// POST /api/bookings/:id/no-show — sin body; el rol sale del que pide.
// Solo sobre reservas confirmadas cuyo turno ya pasó.
//  - Lo pide el dueño del servicio → status 'no_show_client': el cliente no
//    vino y el cobro queda para el prestador (ya se cobró al confirmar).
//  - Lo pide el cliente → status 'no_show_pro': el prestador no se presentó,
//    se devuelve el cobro completo y suma una falta al profesional.
// La lógica vive en src/lib/no-show.js (la comparte el bot de WhatsApp).
router.post('/bookings/:id/no-show', requireAuth, async (req, res) => {
  const db = req.db;
  if (isPilotMode()) {
    // En piloto, el no-show va por la nueva política (sin mover plata);
    // el tipo sale del rol del que pide.
    const booking = await queryOne(db, 'SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'No encontramos esa reserva.' });
    const service = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [booking.service_id]);
    const ownerId = service ? await serviceOwnerUserId(db, service) : null;
    const actingRole = service ? await businessActingRole(db, service, req.user.id) : null;
    return handleReportNoShow(req, res, (ownerId === req.user.id || actingRole) ? 'client' : 'pro');
  }
  const r = await reportNoShow(db, req.params.id, req.user.id);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  const updated = await queryOne(db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS} WHERE b.id = ?`, [r.bookingId]);
  return res.json({ booking: bookingDto(updated) });
});

/** Fecha local (AAAA-MM-DD): los slots se guardan en fecha local del negocio. */
function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// POST /api/bookings/:id/en-route — "voy en camino"
// Solo el dueño del servicio (profesional o negocio), solo si la reserva está
// 'confirmed' y el turno es HOY. Setea en_route_at y avisa al cliente.
// Idempotente: si ya se avisó, devuelve ok sin duplicar la notificación.
router.post('/bookings/:id/en-route', requireAuth, async (req, res) => {
  const db = req.db;
  const b = await queryOne(db, 'SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!b) return res.status(404).json({ error: 'No encontramos esa reserva.' });
  const service = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [b.service_id]);
  const ownerId = await serviceOwnerUserId(db, service);
  const actingRole = await businessActingRole(db, service, req.user.id);
  if (ownerId !== req.user.id && !actingRole) {
    return res.status(403).json({ error: 'Solo el profesional o el negocio puede avisar que va en camino.' });
  }
  if (b.status !== 'confirmed') {
    return res.status(400).json({
      error: `La reserva tiene que estar confirmada para avisar que vas en camino (está "${b.status}").`,
    });
  }
  const withJoins = () => queryOne(db,
    `SELECT ${BOOKING_FIELDS} FROM bookings b ${BOOKING_JOINS} WHERE b.id = ?`, [b.id]);
  if (b.en_route_at) {
    // Idempotente: ya se avisó, no duplicar la notificación.
    return res.json({ booking: bookingDto(await withJoins()), already_notified: true });
  }
  const slot = b.slot_id ? await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [b.slot_id]) : null;
  if (!slot) {
    return res.status(400).json({ error: 'Esta reserva no tiene un turno con fecha asignada.' });
  }
  if (slot.date !== todayLocal()) {
    return res.status(400).json({ error: 'Solo podés avisar que vas en camino el día del turno.' });
  }
  await run(db, 'UPDATE bookings SET en_route_at = ? WHERE id = ?',
    [new Date().toISOString().slice(0, 19).replace('T', ' '), b.id]);
  const ownerName = (await queryOne(db, 'SELECT name FROM users WHERE id = ?', [req.user.id])).name || 'Tu profesional';
  await notify(db, {
    userId: b.client_id, type: 'booking',
    title: `🛵 ${ownerName} va en camino`,
    body: `🛵 ${ownerName} va en camino a tu servicio.`,
  });
  return res.json({ booking: bookingDto(await withJoins()) });
});

module.exports = router;
