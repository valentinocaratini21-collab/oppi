'use strict';

/**
 * Clientes (CRM derivado de reservas) y reportes (mejoras 4 y 6).
 *
 * Helpers compartidos entre profesionales independientes y negocios:
 *  - `getClients(db, { serviceWhere, serviceParams, toUserId })`
 *  - `getStats(db, { periodo, serviceWhere, serviceParams })`
 *
 * `serviceWhere`/`serviceParams` filtran los servicios del dueño
 * (ej. 's.professional_id = ?' o 's.business_id = ?'). Interpolación
 * interna, nunca viene del usuario.
 */
const { queryAll, queryOne, run } = require('../db');
const { validatePeriodo } = require('./earnings');

/** 'AAAA-MM-DD HH:MM:SS' en hora local (igual formato que created_at). */
function toDbDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 'AAAA-MM-DD' en hora local (para dedup de visitas por día). */
function toDbDay(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parsea 'AAAA-MM-DD HH:MM:SS' como hora local (null si no parsea). */
function parseDbDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6] || 0));
}

/**
 * Clave del visitante para el tracking: 'user:<id>' si hay sesión,
 * 'ip:<ip>' si es anónimo.
 */
function visitorKeyFor(req) {
  if (req.user && req.user.id) return `user:${req.user.id}`;
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  return `ip:${String(ip).slice(0, 100)}`;
}

/**
 * Registra una visita al perfil: 1 por día por visitante (dedup por índice
 * único). Devuelve { counted }: true si se contó, false si ya existía hoy.
 */
async function trackProfileView(db, { profileType, profileId, visitorKey }) {
  if (!['professional', 'business'].includes(profileType)) {
    throw Object.assign(new Error('Tipo de perfil inválido.'), { status: 400 });
  }
  if (!Number.isInteger(Number(profileId)) || Number(profileId) <= 0) {
    throw Object.assign(new Error('Perfil inválido.'), { status: 400 });
  }
  const now = new Date();
  const r = await run(db,
    `INSERT INTO profile_views (profile_type, profile_id, visitor_key, viewed_at, day)
     VALUES (?,?,?,?,?)
     ON CONFLICT DO NOTHING`,
    [profileType, Number(profileId), String(visitorKey), toDbDateTime(now), toDbDay(now)]);
  return { counted: Number(r.changes) > 0 };
}

/** Visitas del perfil desde el cutoff ('AAAA-MM-DD HH:MM:SS'). */
async function profileViewsCount(db, profileType, profileId, cutoff) {
  const row = await queryOne(db,
    `SELECT COUNT(*) AS c FROM profile_views
     WHERE profile_type = ? AND profile_id = ? AND viewed_at >= ?`,
    [profileType, profileId, cutoff]);
  return Number(row && row.c) || 0;
}

/**
 * Lista de clientes derivada de las reservas.
 * Devuelve [{ id, nombre, barrio, reservas_count, ultima_visita, gasto_total,
 * rating_promedio_dado }].
 *  - reservas_count: todas las reservas del cliente con este prestador.
 *  - ultima_visita: fecha de la última reserva completada (si no hay, la
 *    última reserva en cualquier estado).
 *  - gasto_total: suma de total_gs de reservas completed.
 *  - rating_promedio_dado: promedio de reseñas que el cliente le dejó a este
 *    prestador (toUserId); null si nunca lo calificó.
 */
async function getClients(db, { serviceWhere, serviceParams = [], toUserId }) {
  const rows = await queryAll(db,
    `SELECT u.id, u.name, u.barrio,
            COUNT(b.id) AS reservas_count,
            COALESCE(MAX(CASE WHEN b.status = 'completed' THEN b.created_at END),
                     MAX(b.created_at)) AS ultima_visita,
            COALESCE(SUM(CASE WHEN b.status = 'completed' THEN b.total_gs ELSE 0 END), 0) AS gasto_total
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN users u ON u.id = b.client_id
     WHERE ${serviceWhere}
     GROUP BY u.id, u.name, u.barrio
     ORDER BY reservas_count DESC, ultima_visita DESC`,
    serviceParams);

  const ids = rows.map((r) => Number(r.id));
  const ratings = {};
  if (ids.length > 0 && toUserId) {
    const placeholders = ids.map(() => '?').join(',');
    const avgRows = await queryAll(db,
      `SELECT from_user, AVG(rating) AS avg_rating FROM reviews
       WHERE to_user = ? AND from_user IN (${placeholders})
       GROUP BY from_user`,
      [toUserId, ...ids]);
    for (const r of avgRows) ratings[Number(r.from_user)] = Number(r.avg_rating);
  }

  return rows.map((r) => ({
    id: Number(r.id),
    nombre: r.name,
    barrio: r.barrio || '',
    reservas_count: Number(r.reservas_count),
    ultima_visita: r.ultima_visita || null,
    gasto_total: Number(r.gasto_total) || 0,
    rating_promedio_dado: ratings[Number(r.id)] !== undefined
      ? Math.round(ratings[Number(r.id)] * 10) / 10
      : null,
  }));
}

/**
 * Mediana (en minutos) entre el primer mensaje del cliente y la primera
 * respuesta del prestador, por conversación. null si no hay datos.
 * `providerUserIds`: user ids del prestador (el pro, o dueño + equipo del
 * negocio). Solo cuentan conversaciones donde el cliente escribió primero.
 */
async function responseTimeMedian(db, providerUserIds) {
  const ids = (providerUserIds || []).map(Number).filter(Boolean);
  if (!ids.length) return null;
  const convs = await queryAll(db, 'SELECT id, participants FROM conversations');
  const mine = convs.filter((c) => {
    try {
      return JSON.parse(c.participants || '[]').some((p) => ids.includes(Number(p)));
    } catch { return false; }
  });
  if (!mine.length) return null;
  const deltas = [];
  for (const c of mine) {
    const msgs = await queryAll(db,
      'SELECT id, sender_id, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC',
      [c.id]);
    if (!msgs.length) continue;
    const firstClientIdx = msgs.findIndex((m) => !ids.includes(Number(m.sender_id)));
    if (firstClientIdx < 0) continue; // el prestador habló primero: no es una consulta entrante
    const firstClient = msgs[firstClientIdx];
    const t0 = parseDbDateTime(firstClient.created_at);
    if (!t0) continue;
    // Primera respuesta del prestador posterior al mensaje del cliente.
    const realReply = msgs.slice(firstClientIdx + 1)
      .find((m) => ids.includes(Number(m.sender_id)));
    if (!realReply) continue;
    const t1 = parseDbDateTime(realReply.created_at);
    if (!t1 || t1.getTime() < t0.getTime()) continue;
    deltas.push((t1.getTime() - t0.getTime()) / 60000);
  }
  if (!deltas.length) return null;
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2;
  return Math.round(median * 10) / 10;
}

/**
 * Colaborador del negocio con más reservas completadas del período.
 * La atribución sale de team_members.services (JSON con ids o nombres de
 * servicios). Devuelve { id, name, role, reservas_completadas } o null.
 */
async function topStaff(db, businessId, cutoff) {
  const team = await queryAll(db,
    'SELECT id, name, role, services FROM team_members WHERE business_id = ?', [businessId]);
  if (!team.length) return null;
  const completed = await queryAll(db,
    `SELECT b.service_id, s.name AS service_name
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE s.business_id = ? AND b.status = 'completed' AND b.created_at >= ?`,
    [businessId, cutoff]);
  if (!completed.length) return null;
  let best = null;
  for (const m of team) {
    let svcs = [];
    try { svcs = JSON.parse(m.services || '[]'); } catch { svcs = []; }
    const ids = new Set(svcs.map(Number).filter((n) => Number.isInteger(n)));
    const names = new Set(svcs.filter((x) => typeof x === 'string' && !/^\d+$/.test(x))
      .map((x) => x.toLowerCase()));
    let n = 0;
    for (const b of completed) {
      if (ids.has(Number(b.service_id)) || names.has(String(b.service_name || '').toLowerCase())) n += 1;
    }
    if (n > 0 && (!best || n > best.reservas_completadas)) {
      best = { id: m.id, name: m.name, role: m.role || '', reservas_completadas: n };
    }
  }
  return best;
}

/**
 * Clientes recurrentes (histórico del prestador): clientes con más de 1
 * reserva completada. Devuelve { count, pct } (pct sobre clientes con
 * al menos 1 completada).
 */
async function recurrentStats(db, serviceWhere, serviceParams = []) {
  const rows = await queryAll(db,
    `SELECT b.client_id, COUNT(*) AS c
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE ${serviceWhere} AND b.status = 'completed'
     GROUP BY b.client_id`,
    serviceParams);
  const total = rows.length;
  const count = rows.filter((r) => Number(r.c) > 1).length;
  return { count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 };
}

/**
 * Reporte del período.
 * Devuelve { periodo, ingresos, reservas_count,
 *   top_servicios: [{ nombre, count, ingresos }],
 *   clientes_nuevos, clientes_recurrentes, conversion,
 *   conversion_pct, response_time_median, top_staff, recurrent_pct }.
 *  - Solo cuentan reservas creadas dentro del período (semana = últimos 7
 *    días, mes = últimos 30 días).
 *  - ingresos y top_servicios: solo reservas completed.
 *  - clientes_nuevos: clientes distintos del período cuya primera reserva
 *    (con este prestador) cae dentro del período.
 *  - clientes_recurrentes: clientes distintos del período con reservas
 *    anteriores al período.
 *  - conversion: alias histórico (reservas/visitas) — hoy se calcula de
 *    verdad con el tracking de visitas; si no hay visitas es null.
 *  - conversion_pct: reservas del período / visitas al perfil del período
 *    (null si no hay visitas: no se inventan datos).
 *  - response_time_median: mediana en minutos entre el primer mensaje del
 *    cliente y la primera respuesta del prestador (null sin datos).
 *  - top_staff: solo negocios — colaborador con más completadas del período.
 *  - recurrent_pct: { count, pct } de clientes con >1 reserva completada.
 *
 * `owner` (opcional): { profileType: 'professional'|'business', profileId,
 * providerUserIds, businessId } — sin esto, las métricas nuevas son null.
 */
async function getStats(db, { periodo = 'mes', serviceWhere, serviceParams = [], owner = null }) {
  const periodoErr = validatePeriodo(periodo);
  if (periodoErr) throw Object.assign(new Error(periodoErr), { status: 400 });
  const days = periodo === 'semana' ? 7 : 30;
  const cutoff = toDbDateTime(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  const inPeriod = await queryAll(db,
    `SELECT b.id, b.client_id, b.service_id, b.status, b.total_gs, b.created_at,
            s.name AS service_name
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE ${serviceWhere} AND b.created_at >= ?`,
    [...serviceParams, cutoff]);

  const completed = inPeriod.filter((b) => b.status === 'completed');
  const ingresos = completed.reduce((a, b) => a + (Number(b.total_gs) || 0), 0);

  const byService = new Map();
  for (const b of completed) {
    const key = b.service_id;
    if (!byService.has(key)) {
      byService.set(key, { nombre: b.service_name, count: 0, ingresos: 0 });
    }
    const agg = byService.get(key);
    agg.count += 1;
    agg.ingresos += Number(b.total_gs) || 0;
  }
  const top_servicios = [...byService.values()].sort((a, b) => b.ingresos - a.ingresos);

  // Primera reserva histórica por cliente (con este prestador).
  const firsts = await queryAll(db,
    `SELECT b.client_id, MIN(b.created_at) AS primera
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE ${serviceWhere}
     GROUP BY b.client_id`,
    serviceParams);
  const primeraDe = new Map(firsts.map((r) => [Number(r.client_id), r.primera]));
  const clientsInPeriod = new Set(inPeriod.map((b) => Number(b.client_id)));
  let clientes_nuevos = 0, clientes_recurrentes = 0;
  for (const cid of clientsInPeriod) {
    const primera = primeraDe.get(cid);
    if (primera && primera >= cutoff) clientes_nuevos += 1;
    else clientes_recurrentes += 1;
  }

  // Visitas al perfil en el período (para la conversión).
  const visitas = owner && owner.profileType && owner.profileId
    ? await profileViewsCount(db, owner.profileType, owner.profileId, cutoff)
    : 0;

  return {
    periodo,
    ingresos,
    reservas_count: inPeriod.length,
    top_servicios,
    clientes_nuevos,
    clientes_recurrentes,
    // Conversión: reservas / visitas al perfil en el período. Sin visitas
    // no se inventa el número: null.
    conversion: visitas > 0 ? Math.round((inPeriod.length / visitas) * 1000) / 10 : null,
    conversion_pct: visitas > 0 ? Math.round((inPeriod.length / visitas) * 1000) / 10 : null,
    visitas_perfil: visitas,
    response_time_median: await responseTimeMedian(db, owner && owner.providerUserIds),
    // Solo negocios: colaborador con más reservas completadas del período.
    top_staff: owner && owner.businessId ? await topStaff(db, owner.businessId, cutoff) : null,
    recurrent_pct: await recurrentStats(db, serviceWhere, serviceParams),
  };
}

module.exports = {
  getClients, getStats, toDbDateTime, toDbDay,
  trackProfileView, visitorKeyFor, profileViewsCount,
  responseTimeMedian, topStaff, recurrentStats,
};
