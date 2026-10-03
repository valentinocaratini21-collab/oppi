'use strict';

/**
 * Política de cancelación de Oppi (nueva política del dueño).
 *
 * Este módulo es CÁLCULO PURO: ninguna función toca la DB ni la red.
 * Reciben `now` inyectable para testear bordes sin depender del reloj.
 *
 * Convención de fechas: los turnos y timestamps de negocio se guardan en
 * hora local de Paraguay como 'AAAA-MM-DD HH:MM:SS' (ver `toDate`).
 *
 * Además conserva el motor VIEJO de reembolsos (`calcCancelPolicy`), que se
 * usa cuando el piloto está apagado (`CANCELLATION_PILOT_MODE=false`).
 * Opera sobre el cobro del 100% del total (paid_gs): la seña ya no existe.
 * Con el piloto prendido (default), cancelar NO mueve plata.
 */

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "Gs. 30.000" */
function gs(n) {
  return `Gs. ${Number(n || 0).toLocaleString('es-PY')}`;
}

/**
 * Parsea un valor a Date interpretándolo como hora LOCAL.
 * Acepta Date, timestamp numérico, 'AAAA-MM-DD HH:MM:SS' o ISO sin zona.
 */
function toDate(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (typeof v === 'number') return new Date(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v || '').trim());
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] || 0));
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${v}`);
  return d;
}

/** Date → 'AAAA-MM-DD HH:MM:SS' en hora local. */
function toDbDateTime(d) {
  const x = toDate(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ` +
    `${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`;
}

/** Ahora en 'AAAA-MM-DD HH:MM:SS' local. */
function nowDbDateTime() {
  return toDbDateTime(new Date());
}

/**
 * Convierte un turno (date 'AAAA-MM-DD', time 'HH:MM') a Date local.
 * Los turnos se guardan en hora local de Paraguay; se interpretan como
 * hora local del servidor para comparar con el reloj.
 */
function slotDateTime(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}

/** "viernes 3 de octubre a las 14:30" */
function formatSlot(dateStr, timeStr) {
  const dt = slotDateTime(dateStr, timeStr);
  return `${DIAS[dt.getDay()]} ${dt.getDate()} de ${MESES[dt.getMonth()]} a las ${timeStr}`;
}

/** "3 de octubre a las 14:30" desde Date o 'AAAA-MM-DD HH:MM:SS'. */
function formatDateTimeHuman(v) {
  const dt = toDate(v);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getDate()} de ${MESES[dt.getMonth()]} a las ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// =====================================================================
// Nueva política — cálculo puro
// =====================================================================

/** Tope de comodines acumulables y otorgados por trimestre. */
const WILDCARD_MAX_BALANCE = 3;
/** Cada cuántas reservas completadas se gana 1 comodín. */
const WILDCARD_EARN_EVERY = 10;
/** No-shows para suspender una cuenta. */
const NO_SHOW_SUSPEND_AT = 3;
/** Puntaje mínimo para el sello "confiable". */
const TRUSTED_SEAL_MIN_PCT = 95;

/**
 * Calcula hasta cuándo se puede cancelar gratis.
 *
 * - Si entre la confirmación y el turno hay < 3 h → confirmación + 15 min.
 * - Si hay entre 3 h y 24 h → inicio del servicio − 3 h.
 * - Si hay >= 24 h → inicio del servicio − 24 h.
 *
 * @param {Date|string|number} confirmedAt
 * @param {Date|string|number} serviceStartsAt
 * @returns {Date} límite (hora local)
 */
function computeFreeUntil(confirmedAt, serviceStartsAt) {
  const c = toDate(confirmedAt).getTime();
  const s = toDate(serviceStartsAt).getTime();
  const diffH = (s - c) / 3600000;
  if (diffH < 3) return new Date(c + 15 * 60000);
  if (diffH < 24) return new Date(s - 3 * 3600000);
  return new Date(s - 24 * 3600000);
}

/**
 * Resuelve qué pasa si se cancela ahora.
 *
 * - 'gratis': dentro del plazo (o sin plazo aplicable).
 * - 'comodin': fuera de plazo pero hay comodines → se consume 1.
 * - 'sin_comodin': fuera de plazo y sin comodines → baja el cumplimiento.
 *
 * `pilotMode` se acepta por firma pero no cambia la resolución: el piloto
 * solo decide si se mueve plata, no la política en sí.
 */
function resolveCancellation({ now = new Date(), freeUntil = null, wildcardBalance = 0, pilotMode = true } = {}) {
  void pilotMode;
  if (freeUntil == null || toDate(now).getTime() <= toDate(freeUntil).getTime()) return 'gratis';
  return Number(wildcardBalance) > 0 ? 'comodin' : 'sin_comodin';
}

/**
 * Puntaje de cumplimiento (0–100, redondeado).
 * Las cancelaciones tardías CON comodín no restan: para eso es el comodín.
 * Sin historial → 100 (nadie puede decir que fallaste).
 */
function complianceScore({ cumplidas = 0, tardiasSinComodin = 0, noShows = 0 } = {}) {
  const c = Math.max(0, Number(cumplidas) || 0);
  const t = Math.max(0, Number(tardiasSinComodin) || 0);
  const n = Math.max(0, Number(noShows) || 0);
  const total = c + t + n;
  if (total === 0) return 100;
  return Math.round((c / total) * 100);
}

/** true si el puntaje alcanza el sello "confiable" (>= 95). */
function hasTrustedSeal(scorePct) {
  return Number(scorePct) >= TRUSTED_SEAL_MIN_PCT;
}

/** 'YYYY-Qn' (Q1: ene–mar, Q2: abr–jun, Q3: jul–sep, Q4: oct–dic). */
function trimesterOf(date) {
  const d = toDate(date);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

/** Etiqueta del próximo reseteo trimestral: '1 de abril', '1 de julio', etc. */
function trimesterResetLabel(trimester) {
  const q = Number(String(trimester || '').split('-Q')[1]);
  return { 1: '1 de abril', 2: '1 de julio', 3: '1 de octubre', 4: '1 de enero' }[q] || '';
}

/** true cada 10 completadas (10, 20, 30, ...). */
function maybeEarnWildcard(completedSinceLast) {
  const n = Number(completedSinceLast);
  return Number.isInteger(n) && n > 0 && n % WILDCARD_EARN_EVERY === 0;
}

/**
 * Piloto de la nueva política: con el piloto prendido, cancelar NO mueve
 * plata (no se llama a la pasarela). Default 'true'; se apaga con
 * CANCELLATION_PILOT_MODE=false|0|no|off.
 */
function isPilotMode(env = process.env) {
  const v = env.CANCELLATION_PILOT_MODE;
  if (v == null || String(v).trim() === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(v).trim().toLowerCase());
}

/** Códigos de motivo válidos por rol. El cliente puede no dar motivo; pro/empresa es obligatorio. */
const CANCEL_REASONS = {
  client: ['imprevisto', 'salud', 'cambio_planes', 'transporte', 'otro'],
  pro: ['imprevisto_personal', 'salud', 'logistica', 'sobrecarga', 'otro'],
  business: ['problema_equipo', 'cierre_sucursal', 'reprogramacion_interna', 'otro'],
};

/**
 * Valida el motivo de cancelación. Devuelve null si está ok o el mensaje
 * de error (en voseo) si no.
 */
function validateCancelReason(cancelledBy, reason) {
  const codes = CANCEL_REASONS[cancelledBy];
  if (!codes) return 'No pudimos determinar quién cancela. Probá de nuevo.';
  const r = reason == null ? '' : String(reason).trim();
  if (cancelledBy === 'client') {
    if (r !== '' && !codes.includes(r)) {
      return `Ese motivo no es válido (usá: ${codes.join(', ')}).`;
    }
    return null;
  }
  if (r === '') return 'Contanos el motivo de la cancelación: es obligatorio.';
  if (!codes.includes(r)) return `Ese motivo no es válido (usá: ${codes.join(', ')}).`;
  return null;
}

/** Texto de la política para el preview, en voseo. */
function cancelPolicyText({ resolucion, freeUntil, wildcardBalance = 0, seriaNoShow = false }) {
  if (seriaNoShow) {
    return 'El profesional ya avisó que va en camino: si cancelás ahora se registra ' +
      'como que no te presentaste (no-show), no como cancelación.';
  }
  if (resolucion === 'gratis') {
    const hasta = freeUntil ? ` hasta el ${formatDateTimeHuman(freeUntil)}` : '';
    return `Podés cancelar sin costo${hasta}. Después de esa hora se usa un comodín ` +
      `(o baja tu cumplimiento si no te quedan).`;
  }
  const era = freeUntil ? ` (era hasta el ${formatDateTimeHuman(freeUntil)})` : '';
  if (resolucion === 'comodin') {
    return `Ya pasó el plazo gratis${era}. Si cancelás ahora se usa 1 comodín: te quedan ${Math.max(0, Number(wildcardBalance) - 1)}.`;
  }
  return `Ya pasó el plazo gratis${era} y no tenés comodines: esta cancelación tardía va a bajar tu cumplimiento.`;
}

// =====================================================================
// Motor VIEJO de reembolsos (piloto apagado) — NO TOCAR
// =====================================================================

/**
 * Calcula el resultado contable de cancelar una reserva.
 *
 * @param {Object} opts
 * @param {number} opts.paidGs      monto cobrado de la reserva (100% del total)
 * @param {boolean|number} opts.paid  el cobro está acreditado (1/true)
 * @param {string|null} opts.slotDate  'AAAA-MM-DD' o null si no hay turno
 * @param {string|null} opts.slotTime   'HH:MM'
 * @param {number} opts.cancelFreeHours horas de anticipación para cancelar sin cargo
 * @param {Date} opts.now              reloj inyectable (tests)
 * @returns {{ charged_gs, refund_gs, forfeit_gs, hours_before, free_cancel, policy_text }}
 */
function calcCancelPolicy({
  paidGs = 0, paid = false, slotDate = null, slotTime = null,
  cancelFreeHours = 24, now = new Date(),
} = {}) {
  const charged = Number(paidGs) || 0;
  const isPaid = Boolean(paid);
  const freeHours = Number.isFinite(cancelFreeHours) && cancelFreeHours >= 0 ? cancelFreeHours : 24;

  let hoursBefore = null;
  if (slotDate) {
    hoursBefore = Math.round(
      ((slotDateTime(slotDate, slotTime).getTime() - now.getTime()) / 3600000) * 100
    ) / 100;
  }
  // Sin turno asignado no hay forma de llegar tarde: se devuelve todo.
  const freeCancel = hoursBefore == null || hoursBefore >= freeHours;

  const refundGs = freeCancel && isPaid ? charged : 0;
  const forfeitGs = !freeCancel && isPaid ? charged : 0;

  let policyText;
  if (!isPaid || charged === 0) {
    policyText = 'Esta reserva no tiene ningún cobro acreditado, así que no hay nada que devolver.';
  } else if (hoursBefore == null) {
    policyText = `La reserva no tiene turno asignado: los ${gs(charged)} cobrados se devuelven completos.`;
  } else if (freeCancel) {
    policyText = `Cancelación sin cargo: faltan ${hoursBefore} h para el turno ` +
      `(el límite es ${freeHours} h), así que los ${gs(charged)} cobrados se devuelven completos.`;
  } else {
    policyText = `Cancelación con menos de ${freeHours} h de anticipación ` +
      `(faltan ${hoursBefore} h): los ${gs(charged)} cobrados quedan para el prestador, según su política.`;
  }

  return {
    charged_gs: charged, refund_gs: refundGs, forfeit_gs: forfeitGs,
    hours_before: hoursBefore, free_cancel: freeCancel, policy_text: policyText,
  };
}

module.exports = {
  // utilidades de fecha/moneda
  gs, toDate, toDbDateTime, nowDbDateTime, slotDateTime, formatSlot, formatDateTimeHuman,
  // nueva política (puro)
  WILDCARD_MAX_BALANCE, WILDCARD_EARN_EVERY, NO_SHOW_SUSPEND_AT, TRUSTED_SEAL_MIN_PCT,
  computeFreeUntil, resolveCancellation, complianceScore, hasTrustedSeal,
  trimesterOf, trimesterResetLabel, maybeEarnWildcard, isPilotMode,
  CANCEL_REASONS, validateCancelReason, cancelPolicyText,
  // motor viejo (piloto apagado)
  calcCancelPolicy,
};
