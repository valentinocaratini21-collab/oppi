'use strict';

/**
 * Centinela — agente del equipo IA de Oppi.
 *
 * Vigila las reservas y dispara alertas:
 *  1. Reserva 'pending' hace más de 4h sin aceptar → alerta a cada admin
 *     (notificación 'support'). Una sola alerta por reserva (no spamea).
 *  2. Reserva 'confirmed' de HOY sin `en_route_at` y con el turno a ≤ 1h →
 *     'reminder' al profesional/negocio dueño del servicio ("avisá con
 *     Voy en camino 🛵"). Las reservas de negocio sin slot no tienen horario
 *     determinable: se saltean con elegancia.
 *  3. `no_show_count = 2` en users, professionals o businesses → alerta a
 *     admins ("está a 1 no-show de la suspensión"). Anti-spam: 7 días.
 *
 * Uso:
 *   node scripts/sentinel.js            → corre de verdad (notifica + registra)
 *   node scripts/sentinel.js --dry-run  → imprime las alertas sin enviar nada
 * Variables:
 *   DB_PATH  → ruta del sqlite (default: ./data/oppi.db)
 *   DATABASE_URL → si existe, usa Postgres
 */
const { openDb, migrate, queryAll, queryOne, run, closeDb } = require('../src/db');
const { notify } = require('../src/lib/notifications');

const DB_PATH = process.env.DB_PATH || './data/oppi.db';
const PENDING_ALERT_HOURS = 4;
const ENROUTE_WINDOW_MINUTES = 60;
const NOSHOW_SPAM_DAYS = 7;

/** 'AAAA-MM-DD HH:MM:SS' de hace N días (comparable con created_at en ambos drivers). */
function cutoffDateTime(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 3600 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
}

/** Fecha local 'AAAA-MM-DD'. */
function todayLocal() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parsea un 'AAAA-MM-DD HH:MM:SS' guardado en UTC (datetime('now')). */
function parseUtc(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ¿Ya hay un run del centinela para esta acción/objetivo? (sinceDays null = alguna vez). */
async function runExists(db, action, targetType, targetId, sinceDays = null) {
  const params = ['sentinel', action, targetType, targetId];
  let sql = `SELECT 1 FROM agent_runs
             WHERE agent = ? AND action = ? AND target_type = ? AND target_id = ?`;
  if (sinceDays != null) {
    sql += ' AND created_at >= ?';
    params.push(cutoffDateTime(sinceDays));
  }
  const row = await queryOne(db, `${sql} LIMIT 1`, params);
  return Boolean(row);
}

async function recordRun(db, action, targetType, targetId, detail) {
  await run(db,
    `INSERT INTO agent_runs (agent, action, target_type, target_id, detail)
     VALUES ('sentinel', ?, ?, ?, ?)`,
    [action, targetType, targetId, detail || '']);
}

async function adminIds(db) {
  const rows = await queryAll(db,
    'SELECT id FROM users WHERE is_admin = 1 AND deleted_at IS NULL');
  return rows.map((r) => r.id);
}

/** user_id del dueño (profesional o negocio) del servicio de una reserva. */
async function serviceOwnerUserId(db, serviceId) {
  const svc = await queryOne(db,
    'SELECT professional_id, business_id FROM services WHERE id = ?', [serviceId]);
  if (!svc) return null;
  if (svc.professional_id != null) {
    const p = await queryOne(db,
      'SELECT user_id FROM professionals WHERE id = ?', [svc.professional_id]);
    return p ? p.user_id : null;
  }
  if (svc.business_id != null) {
    const b = await queryOne(db,
      'SELECT user_id FROM businesses WHERE id = ?', [svc.business_id]);
    return b ? b.user_id : null;
  }
  return null;
}

/** 1. Reservas pendientes hace más de 4h → alerta a admins (1 por reserva). */
async function checkPending(db, { dryRun, admins }) {
  const rows = await queryAll(db,
    `SELECT b.id, b.created_at, s.name AS service_name
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     WHERE b.status = 'pending'
     ORDER BY b.created_at`);
  const now = Date.now();
  let alerted = 0;

  for (const b of rows) {
    const created = parseUtc(b.created_at);
    if (!created) continue; // sin fecha determinable: se saltea con elegancia
    const hours = Math.floor((now - created.getTime()) / 3600000);
    if (hours <= PENDING_ALERT_HOURS) continue;
    if (await runExists(db, 'alert_pending', 'booking', b.id)) continue;

    const title = `⏳ Reserva #${b.id} sin aceptar hace ${hours}h`;
    const body = `La reserva #${b.id} (${b.service_name || 'servicio'}) sigue pendiente ` +
      `hace ${hours} horas. Fijate que el profesional o negocio la acepte antes de que el cliente se enfríe.`;
    const detail = JSON.stringify({ hours_pending: hours });

    if (dryRun) {
      console.log(`[dry-run] alertaría a ${admins.length} admin(s): "${title}" — ${body}`);
      continue;
    }
    for (const adminId of admins) {
      await notify(db, { userId: adminId, type: 'support', title, body });
    }
    await recordRun(db, 'alert_pending', 'booking', b.id, detail);
    alerted += 1;
  }
  return { checked: rows.length, alerted };
}

/** 2. Turnos confirmados de hoy a ≤1h sin "voy en camino" → reminder al dueño. */
async function checkEnRoute(db, { dryRun }) {
  const rows = await queryAll(db,
    `SELECT b.id, b.service_id, sl.date, sl.time
     FROM bookings b
     JOIN slots sl ON sl.id = b.slot_id
     WHERE b.status = 'confirmed' AND b.en_route_at IS NULL AND sl.date = ?
     ORDER BY sl.time`,
    [todayLocal()]);
  const now = Date.now();
  let reminded = 0; let skipped = 0;

  for (const b of rows) {
    const slotAt = new Date(`${b.date}T${b.time}:00`);
    if (Number.isNaN(slotAt.getTime())) { skipped += 1; continue; }
    const minutesLeft = (slotAt.getTime() - now) / 60000;
    if (minutesLeft <= 0 || minutesLeft > ENROUTE_WINDOW_MINUTES) { skipped += 1; continue; }
    if (await runExists(db, 'reminder_enroute', 'booking', b.id)) { skipped += 1; continue; }

    const ownerId = await serviceOwnerUserId(db, b.service_id);
    if (!ownerId) { skipped += 1; continue; } // dueño no determinable: se saltea

    const title = `Tu reserva de las ${b.time} es en una hora`;
    const body = `Tu reserva de las ${b.time} es en una hora — avisá con Voy en camino 🛵 ` +
      `así el cliente se queda tranquilo.`;
    const detail = JSON.stringify({ slot: `${b.date} ${b.time}` });

    if (dryRun) {
      console.log(`[dry-run] reminder al dueño (user #${ownerId}) de la reserva #${b.id}: ` +
        `"${title}" — ${body}`);
      continue;
    }
    await notify(db, { userId: ownerId, type: 'reminder', title, body });
    await recordRun(db, 'reminder_enroute', 'booking', b.id, detail);
    reminded += 1;
  }
  return { checked: rows.length, reminded, skipped };
}

/** 3. no_show_count = 2 → alerta a admins (a 1 no-show de la suspensión). */
async function checkNoShows(db, { dryRun, admins }) {
  const cases = [
    {
      targetType: 'user',
      rows: await queryAll(db,
        `SELECT id, name FROM users WHERE no_show_count = 2 AND deleted_at IS NULL`),
      describe: (r) => `el cliente ${r.name || `#${r.id}`}`,
    },
    {
      targetType: 'professional',
      rows: await queryAll(db,
        `SELECT p.id, u.name FROM professionals p
         JOIN users u ON u.id = p.user_id
         WHERE p.no_show_count = 2 AND u.deleted_at IS NULL`),
      describe: (r) => `el profesional ${r.name || `#${r.id}`}`,
    },
    {
      targetType: 'business',
      rows: await queryAll(db,
        `SELECT b.id, b.name FROM businesses b
         JOIN users u ON u.id = b.user_id
         WHERE b.no_show_count = 2 AND u.deleted_at IS NULL`),
      describe: (r) => `el negocio ${r.name || `#${r.id}`}`,
    },
  ];
  let alerted = 0;

  for (const { targetType, rows, describe } of cases) {
    for (const r of rows) {
      if (await runExists(db, 'alert_noshow_risk', targetType, r.id, NOSHOW_SPAM_DAYS)) continue;
      const who = describe(r);
      const whoCap = who.charAt(0).toUpperCase() + who.slice(1);
      const title = `⚠️ ${whoCap} está a 1 no-show de la suspensión`;
      const body = `${whoCap} ya suma 2 no-shows. ` +
        `Al tercero se suspende automáticamente: ¿querés intervenir antes?`;

      if (dryRun) {
        console.log(`[dry-run] alertaría a ${admins.length} admin(s): "${title}"`);
        continue;
      }
      for (const adminId of admins) {
        await notify(db, { userId: adminId, type: 'support', title, body });
      }
      await recordRun(db, 'alert_noshow_risk', targetType, r.id,
        JSON.stringify({ no_show_count: 2 }));
      alerted += 1;
    }
  }
  const total = cases.reduce((acc, c) => acc + c.rows.length, 0);
  return { checked: total, alerted };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = openDb(DB_PATH);
  try {
    await migrate(db);
    const admins = await adminIds(db);
    const pending = await checkPending(db, { dryRun, admins });
    const enroute = await checkEnRoute(db, { dryRun });
    const noshow = await checkNoShows(db, { dryRun, admins });
    const tag = dryRun ? '[dry-run] ' : '';
    console.log(`${tag}centinela listo: ${pending.checked} pendientes revisadas ` +
      `(${pending.alerted} alertas${dryRun ? ' que se mandarían' : ''}), ` +
      `${enroute.checked} turnos de hoy (${enroute.reminded} reminders${dryRun ? ' que se mandarían' : ''}), ` +
      `${noshow.checked} casos de 2 no-shows (${noshow.alerted} alertas${dryRun ? ' que se mandarían' : ''}). ` +
      `${admins.length} admin(s) configurados.`);
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error('[centinela] falló:', err.message);
  process.exitCode = 1;
});
