'use strict';

/**
 * Lógica de no-show compartida.
 *
 * La usan dos caminos:
 *  - POST /api/bookings/:id/no-show (src/routes/bookings.js)
 *  - El bot de WhatsApp de Oppi Empresas → "Reportar un no-show"
 *    (src/lib/supportBot.js)
 *
 * Reglas (idénticas a las del endpoint original):
 *  - Solo sobre reservas 'confirmed' cuyo turno ya pasó.
 *  - Lo marca el dueño del servicio → 'no_show_client': el cobro del 100%
 *    ya quedó acreditado al confirmar, así que no se mueve plata.
 *  - Lo marca el cliente → 'no_show_pro': se devuelve el cobro completo y
 *    suma una falta al profesional.
 *
 * Devuelve `{ ok: true, bookingId, asOwner, ... }` o
 * `{ ok: false, status, error }` (el endpoint HTTP mapea status/error).
 */
const { queryOne, run } = require('../db');
const { notify } = require('./notifications');
const { gs, slotDateTime } = require('./cancellation');
const { getPaymentProvider, updatePaymentStatus } = require('./payments');
const { serviceOwnerUserId } = require('../routes/catalog');

/**
 * Devuelve al cliente el cobro de la reserva (best effort): reembolsa el
 * pago si está cobrado. La pasarela es la fuente de verdad del dinero:
 * el estado contable en `payments` solo cambia si la pasarela confirma.
 * Si la pasarela falla, se loguea y el estado contable queda como estaba.
 * Devuelve true si el dinero se movió.
 */
async function refundBookingCharge(db, bookingId) {
  const pay = await queryOne(db,
    `SELECT * FROM payments
     WHERE reference_type = 'booking' AND reference_id = ?
       AND status = 'captured'
     ORDER BY id DESC LIMIT 1`,
    [bookingId]);
  if (!pay || !pay.provider_payment_id) return false;
  const provider = getPaymentProvider();
  try {
    await provider.refund(pay.provider_payment_id);
    await updatePaymentStatus(db, pay.id, 'refunded');
    return true;
  } catch (err) {
    console.error(`[pagos] no se pudo devolver el cobro de la reserva #${bookingId}:`, err.message);
    return false;
  }
}

async function reportNoShow(db, bookingId, actorUserId) {
  const booking = await queryOne(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) return { ok: false, status: 404, error: 'No encontramos esa reserva.' };
  const service = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [booking.service_id]);
  if (!service) return { ok: false, status: 404, error: 'No encontramos esa reserva.' };
  const ownerId = await serviceOwnerUserId(db, service);
  const isOwner = ownerId === actorUserId;
  const isClient = booking.client_id === actorUserId;
  if (!isOwner && !isClient) {
    return { ok: false, status: 403, error: 'Esa reserva no es tuya.' };
  }
  if (booking.status !== 'confirmed') {
    return { ok: false, status: 400, error: `Solo se puede marcar no-show en una reserva confirmada (está "${booking.status}").` };
  }
  const slot = booking.slot_id ? await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [booking.slot_id]) : null;
  if (!slot) return { ok: false, status: 400, error: 'Esta reserva no tiene turno asignado.' };
  if (slotDateTime(slot.date, slot.time).getTime() >= Date.now()) {
    return { ok: false, status: 400, error: 'El turno todavía no pasó. Esperá a que pase la hora para marcarlo.' };
  }

  if (isOwner) {
    // El prestador marca que el cliente no vino: el cobro ya quedó
    // acreditado al confirmar, no se mueve plata.
    await run(db, "UPDATE bookings SET status = 'no_show_client' WHERE id = ?", [booking.id]);
    await notify(db, {
      userId: booking.client_id, type: 'booking',
      title: `😶 No te presentaste a tu turno: ${service.name}`,
      body: booking.paid
        ? `El prestador marcó que no viniste. Los ${gs(booking.paid_gs)} que pagaste quedaron para él, según su política.`
        : 'El prestador marcó que no viniste al turno.',
    });
  } else {
    // El cliente marca que el prestador no se presentó: reembolso total.
    if (booking.paid) {
      await refundBookingCharge(db, booking.id);
      await run(db, 'UPDATE bookings SET paid = 0 WHERE id = ?', [booking.id]);
    }
    await run(db, "UPDATE bookings SET status = 'no_show_pro' WHERE id = ?",
      [booking.id]);
    if (service.professional_id) {
      await run(db, 'UPDATE professionals SET no_show_count = no_show_count + 1 WHERE id = ?', [service.professional_id]);
    }
    if (ownerId) {
      await notify(db, {
        userId: ownerId, type: 'booking',
        title: `😶 Te marcaron una falta: ${service.name}`,
        body: booking.paid
          ? `El cliente marcó que no te presentaste y los ${gs(booking.paid_gs)} se le devolvieron completos.`
          : 'El cliente marcó que no te presentaste al turno.',
      });
    }
  }

  return {
    ok: true, bookingId: booking.id, asOwner: isOwner,
    clientId: booking.client_id, ownerId, serviceName: service.name,
    newStatus: isOwner ? 'no_show_client' : 'no_show_pro',
  };
}

module.exports = { reportNoShow, refundBookingCharge };
