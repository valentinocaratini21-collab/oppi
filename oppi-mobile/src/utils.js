/**
 * Utilidades compartidas: formato de guaraníes y helpers de fecha.
 * Pago 100%: ya no hay seña; el cliente paga el total al confirmar.
 */

/** Gs. 150.000 */
export function gs(amount) {
  const n = Number(amount) || 0;
  return `Gs. ${n.toLocaleString('es-PY')}`;
}

/** "2026-10-05" → "Lun 5 oct" */
export function shortDate(isoDate) {
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${days[dt.getDay()]} ${dt.getDate()} ${months[dt.getMonth()]}`;
  } catch {
    return isoDate;
  }
}

/** primera letra en mayúscula, para labels de estado */
export function label(status) {
  const map = {
    pending: 'Pendiente',
    confirmed: 'Confirmada',
    completed: 'Realizada',
    cancelled: 'Cancelada',
    open: 'Abierta',
    assigned: 'Asignada',
    done: 'Finalizada',
    quoting: 'Cotizando',
    in_progress: 'En curso',
    no_show_client: 'Cliente no vino',
    no_show_pro: 'Profesional no vino',
  };
  return map[status] || status;
}

/** "2026-10-05T18:00:00" (o "2026-10-05 18:00") → "Vie 3 oct · 18:00" */
export function dateTimeEs(iso) {
  if (!iso) return '';
  try {
    const d = new Date(String(iso).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return String(iso);
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} · ${hh}:${mm}`;
  } catch {
    return String(iso);
  }
}

/** "2026-10-05" o ISO → "Vie 3 oct" */
export function dateEs(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  return shortDate(s);
}
