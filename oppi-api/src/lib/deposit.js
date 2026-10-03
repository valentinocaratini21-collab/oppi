'use strict';

/**
 * Validación y cálculo de señas (depósitos).
 *
 * DEPRECADO (2026-10): la seña se eliminó del flujo de reservas y trabajos —
 * el cliente paga el 100% del total (ver src/lib/payments.js `charge`).
 * Este módulo solo queda para validar la config vieja de servicios: el
 * catálogo la acepta por compatibilidad, pero el flujo de reserva la ignora.
 * No usar en código nuevo.
 */

/** @returns {string|null} mensaje de error en voseo, o null si es válida. */
function validateDepositConfig({ price_gs, deposit_type, deposit_value }) {
  const type = deposit_type || 'none';
  if (type === 'none') return null;
  if (type === 'percent') {
    if (!Number.isInteger(deposit_value) || deposit_value < 1 || deposit_value > 100) {
      return 'La seña en porcentaje tiene que ser un número entero entre 1 y 100.';
    }
    return null;
  }
  if (type === 'fixed') {
    if (!Number.isInteger(deposit_value) || deposit_value <= 0) {
      return 'La seña fija tiene que ser un monto mayor a Gs. 0.';
    }
    if (deposit_value > price_gs) {
      return 'La seña fija no puede ser mayor que el precio del servicio.';
    }
    return null;
  }
  return 'El tipo de seña no es válido (usá percent, fixed o none).';
}

/** Calcula la seña en guaraníes. Lanza Error si la config es inválida. */
function calcDeposit({ price_gs, deposit_type, deposit_value }) {
  const err = validateDepositConfig({ price_gs, deposit_type, deposit_value });
  if (err) throw new Error(err);
  if (deposit_type === 'percent') return Math.round((price_gs * deposit_value) / 100);
  if (deposit_type === 'fixed') return deposit_value;
  return 0;
}

module.exports = { validateDepositConfig, calcDeposit };
