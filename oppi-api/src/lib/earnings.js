'use strict';

/**
 * Cálculo de ganancias compartido entre negocios y profesionales independientes.
 *
 * Solo cuentan reservas en estado 'completed' dentro del período
 * (semana = últimos 7 días, mes = últimos 30 días).
 * Comisión fija de Oppi: 15% sobre los ingresos brutos.
 */
const { queryAll } = require('../db');

const COMISION_PCT = 0.15;

/** Valida el query param `periodo`. Devuelve el mensaje de error o null. */
function validatePeriodo(periodo) {
  if (!['semana', 'mes'].includes(periodo)) {
    return 'El período tiene que ser "semana" o "mes".';
  }
  return null;
}

/**
 * Resumen de ganancias.
 *
 * @param {object} db
 * @param {object} opts
 * @param {'semana'|'mes'} opts.periodo
 * @param {string} opts.serviceWhere — filtro SQL sobre los servicios
 *   (ej. 's.business_id = ?' o 's.professional_id = ?'). Interpolación interna,
 *   nunca viene del usuario.
 * @param {Array} [opts.serviceParams] — params del filtro.
 */
async function getEarnings(db, { periodo = 'mes', serviceWhere, serviceParams = [] }) {
  const days = periodo === 'semana' ? 7 : 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  const rows = await queryAll(db,
    `SELECT s.id AS servicio_id, s.name AS nombre, COUNT(*) AS reservas, SUM(b.total_gs) AS ingresos
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE ${serviceWhere} AND b.status = 'completed' AND b.created_at >= ?
     GROUP BY s.id, s.name ORDER BY ingresos DESC`,
    [...serviceParams, cutoff]);
  const porServicio = rows.map((r) => ({
    servicio_id: Number(r.servicio_id), nombre: r.nombre,
    reservas: Number(r.reservas), ingresos: Number(r.ingresos) || 0,
  }));
  const reservasCount = porServicio.reduce((a, s) => a + s.reservas, 0);
  const brutos = porServicio.reduce((a, s) => a + s.ingresos, 0);
  const comision = Math.round(brutos * COMISION_PCT);
  return {
    periodo,
    ingresos_brutos: brutos,
    comision,
    neto: brutos - comision,
    reservas_count: reservasCount,
    ticket_promedio: reservasCount ? brutos / reservasCount : 0,
    por_servicio: porServicio,
  };
}

module.exports = { getEarnings, validatePeriodo, COMISION_PCT };
