'use strict';

/**
 * Pagos: webhook de confirmación de Bancard (vPOS `single_buy_confirm`).
 * Lo llama Bancard servidor-a-servidor cuando el cliente paga el total en el
 * iframe. Contrato detallado en PAGOS.md.
 *
 * Flujo: verifica la firma MD5 → re-consulta la operación en Bancard
 * (zero-trust: ante la duda NO se acredita) → actualiza el pago contable y,
 * si es el cobro de una reserva, la marca como pagada.
 * Responde 200 rápido (Bancard reintenta si no hay 200 en ≤ 30 s), salvo que
 * la firma sea inválida (400: no hay nada que reintentar).
 */
const express = require('express');
const { queryOne, run } = require('../db');
const { getPaymentProvider, updatePaymentStatus, BancardProvider } = require('../lib/payments');

const router = express.Router();

// POST /api/payments/bancard-webhook — público (lo llama Bancard, no el usuario).
router.post('/payments/bancard-webhook', async (req, res) => {
  const provider = getPaymentProvider();
  if (!(provider instanceof BancardProvider)) {
    // Bancard solo llama acá si el comercio lo configuró en su portal.
    return res.json({ ok: false, error: 'El provider de pagos configurado no es Bancard.' });
  }

  let cb;
  try {
    cb = provider.verifyConfirmationCallback(req.body);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  // Zero-trust: re-consultar la operación en Bancard antes de acreditar.
  let conf = null;
  try {
    conf = await provider.getConfirmation(cb.shopProcessId);
  } catch (err) {
    console.error('[pagos] webhook: no se pudo reconfirmar en Bancard:', err.message);
    return res.json({ ok: false, error: 'No se pudo reconfirmar la operación con Bancard. El pago queda pendiente.' });
  }
  if (!conf) {
    return res.json({ ok: false, error: 'Bancard no reconoce esa operación. El pago queda pendiente.' });
  }

  const payment = await queryOne(req.db,
    'SELECT * FROM payments WHERE provider_payment_id = ? ORDER BY id DESC LIMIT 1',
    [cb.shopProcessId]);
  if (!payment) {
    return res.json({ ok: false, error: 'Pago no encontrado para ese shop_process_id.' });
  }
  if (payment.status === 'captured') {
    return res.json({ ok: true, already: true });
  }

  if (conf.approved) {
    await updatePaymentStatus(req.db, payment.id, 'captured');
    if (payment.reference_type === 'booking') {
      await run(req.db, 'UPDATE bookings SET paid = 1 WHERE id = ?', [payment.reference_id]);
    }
    // reference_type 'job': paid_gs ya se fijó al aceptar la oferta.
    return res.json({ ok: true, status: 'captured' });
  }
  await updatePaymentStatus(req.db, payment.id, 'failed');
  return res.json({ ok: true, status: 'failed' });
});

module.exports = router;
