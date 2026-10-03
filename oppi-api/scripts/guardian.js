'use strict';

/**
 * Guardián de calidad — agente del equipo IA de Oppi.
 *
 * Recorre profesionales y negocios, calcula su score de completitud de
 * perfil (0-100, ver src/lib/profile-score.js) y si está por debajo de 80
 * les manda un nudge al dueño (notificación 'reminder') con el top 2 de
 * cosas que les faltan, en voseo rioplatense.
 *
 * Anti-spam: no se le escribe a nadie que ya haya recibido un nudge del
 * guardián en los últimos 7 días (tabla agent_runs).
 *
 * Uso:
 *   node scripts/guardian.js            → corre de verdad (notifica + registra)
 *   node scripts/guardian.js --dry-run  → imprime a quién le escribiría y por
 *                                         qué, sin insertar nada
 * Variables:
 *   DB_PATH  → ruta del sqlite (default: ./data/oppi.db)
 *   DATABASE_URL → si existe, usa Postgres
 */
const { openDb, migrate, queryAll, queryOne, run, closeDb } = require('../src/db');
const { notify } = require('../src/lib/notifications');
const { scoreProfessional, scoreBusiness } = require('../src/lib/profile-score');

const DB_PATH = process.env.DB_PATH || './data/oppi.db';
const SCORE_THRESHOLD = 80;
const NUDGE_WINDOW_DAYS = 7;

/** 'AAAA-MM-DD HH:MM:SS' de hace N días (comparable con created_at en ambos drivers). */
function cutoffDateTime(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 3600 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
}

/** Fecha local 'AAAA-MM-DD' (para comparar con slots.date). */
function todayLocal() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function isNonEmptyJsonArray(s) {
  if (!s) return false;
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) && a.length > 0;
  } catch {
    return false;
  }
}

/** ¿Recibió ya un nudge del guardián en la ventana anti-spam? */
async function nudgedRecently(db, targetType, targetId) {
  const row = await queryOne(db,
    `SELECT 1 FROM agent_runs
     WHERE agent = 'guardian' AND action = 'nudge_profile'
       AND target_type = ? AND target_id = ?
       AND created_at >= ?
     LIMIT 1`,
    [targetType, targetId, cutoffDateTime(NUDGE_WINDOW_DAYS)]);
  return Boolean(row);
}

/** Arma el cuerpo del nudge con el top 2 de faltantes (voseo). */
function buildNudgeBody(missing) {
  const top = missing.slice(0, 2).map((m) => m.cta);
  const joined = top.length === 2 ? `${top[0]} y ${top[1].charAt(0).toLowerCase()}${top[1].slice(1)}`
    : top[0];
  return `${joined} para recibir más reservas 💪`;
}

async function processProfessionals(db, { dryRun }) {
  const pros = await queryAll(db,
    `SELECT p.id, p.user_id, p.bio, p.categories, p.profession_id, p.barrio,
            u.name, u.foto_url, u.barrio AS user_barrio
     FROM professionals p
     JOIN users u ON u.id = p.user_id
     WHERE u.deleted_at IS NULL
     ORDER BY p.id`);
  const today = todayLocal();
  let nudged = 0; let skipped = 0;

  for (const p of pros) {
    const svc = await queryOne(db,
      'SELECT COUNT(*) AS n FROM services WHERE professional_id = ?', [p.id]);
    const freeSlot = await queryOne(db,
      `SELECT 1 FROM slots WHERE professional_id = ? AND status = 'free' AND date >= ? LIMIT 1`,
      [p.id, today]);
    const hasService = Number(svc && svc.n) > 0;

    const { score, missing } = scoreProfessional({
      fotoUrl: p.foto_url,
      bio: p.bio,
      hasPricedService: hasService,
      hasCategory: isNonEmptyJsonArray(p.categories) || p.profession_id != null,
      barrio: p.barrio || p.user_barrio,
      hasAvailability: Boolean(freeSlot) || hasService,
    });

    if (score >= SCORE_THRESHOLD) { skipped += 1; continue; }
    if (await nudgedRecently(db, 'professional', p.id)) { skipped += 1; continue; }

    const title = `Tu perfil está al ${score}%`;
    const body = buildNudgeBody(missing);
    const detail = JSON.stringify({ score, missing: missing.map((m) => m.key) });

    if (dryRun) {
      console.log(`[dry-run] profesional #${p.id} (${p.name || 'sin nombre'}) score ${score} → ` +
        `le escribiría: "${title}" / "${body}" [faltan: ${missing.map((m) => m.key).join(', ')}]`);
      continue;
    }
    await notify(db, { userId: p.user_id, type: 'reminder', title, body });
    await run(db,
      `INSERT INTO agent_runs (agent, action, target_type, target_id, detail)
       VALUES ('guardian', 'nudge_profile', 'professional', ?, ?)`,
      [p.id, detail]);
    nudged += 1;
  }
  return { total: pros.length, nudged, skipped };
}

async function processBusinesses(db, { dryRun }) {
  const bizs = await queryAll(db,
    `SELECT b.id, b.user_id, b.name, b.logo_url, b.description, b.schedule,
            b.barrio, b.address, u.name AS owner_name
     FROM businesses b
     JOIN users u ON u.id = b.user_id
     WHERE u.deleted_at IS NULL
     ORDER BY b.id`);
  let nudged = 0; let skipped = 0;

  for (const b of bizs) {
    const svc = await queryOne(db,
      'SELECT COUNT(*) AS n FROM services WHERE business_id = ?', [b.id]);
    const hasService = Number(svc && svc.n) > 0;

    const { score, missing } = scoreBusiness({
      logoUrl: b.logo_url,
      description: b.description,
      hasService,
      hasSchedule: isNonEmptyJsonArray(b.schedule),
      addressOrBarrio: b.address || b.barrio,
    });

    if (score >= SCORE_THRESHOLD) { skipped += 1; continue; }
    if (await nudgedRecently(db, 'business', b.id)) { skipped += 1; continue; }

    const title = `Tu perfil está al ${score}%`;
    const body = buildNudgeBody(missing);
    const detail = JSON.stringify({ score, missing: missing.map((m) => m.key) });

    if (dryRun) {
      console.log(`[dry-run] negocio #${b.id} (${b.name}) score ${score} → ` +
        `le escribiría a ${b.owner_name || 'el dueño'}: "${title}" / "${body}" ` +
        `[faltan: ${missing.map((m) => m.key).join(', ')}]`);
      continue;
    }
    await notify(db, { userId: b.user_id, type: 'reminder', title, body });
    await run(db,
      `INSERT INTO agent_runs (agent, action, target_type, target_id, detail)
       VALUES ('guardian', 'nudge_profile', 'business', ?, ?)`,
      [b.id, detail]);
    nudged += 1;
  }
  return { total: bizs.length, nudged, skipped };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = openDb(DB_PATH);
  try {
    await migrate(db);
    const pros = await processProfessionals(db, { dryRun });
    const bizs = await processBusinesses(db, { dryRun });
    const tag = dryRun ? '[dry-run] ' : '';
    console.log(`${tag}guardián listo: ${pros.total} profesionales ` +
      `(${pros.nudged} nudges${dryRun ? ' que se mandarían' : ''}, ${pros.skipped} ok/ya avisados), ` +
      `${bizs.total} negocios (${bizs.nudged} nudges${dryRun ? ' que se mandarían' : ''}, ${bizs.skipped} ok/ya avisados).`);
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error('[guardián] falló:', err.message);
  process.exitCode = 1;
});
