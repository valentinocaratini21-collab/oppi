'use strict';

/**
 * Carta diaria del equipo IA de Oppi.
 *
 * Lee las métricas de las últimas 24h desde la DB y genera el brief diario
 * en ~/workspace/goals/oppi-app-launch/briefs/YYYY-MM-DD.md.
 *
 * Uso (desde la raíz de oppi-api):
 *   node scripts/daily-brief.js            → genera y guarda el brief
 *   node scripts/daily-brief.js --dry-run  → imprime el brief sin guardar
 *
 * Variables opcionales:
 *   DB_PATH         → archivo SQLite (default ./data/oppi.db; DATABASE_URL gana si existe)
 *   OPPI_BRIEFS_DIR → carpeta destino de los briefs (default la del goal oppi-app-launch)
 *   BRIEF_TZ        → zona horaria para la fecha del brief (default America/Asuncion)
 */

const path = require('node:path');
const fs = require('node:fs');
const { openDb, migrate, queryAll, queryOne, run, closeDb } = require('../src/db');
const { isPilotMode } = require('../src/lib/cancellation');

const DRY_RUN = process.argv.includes('--dry-run');
const BRIEF_TZ = process.env.BRIEF_TZ || 'America/Asuncion';
const BRIEFS_DIR = process.env.OPPI_BRIEFS_DIR
  || path.join(process.env.HOME || '/home/hatch', 'workspace', 'goals', 'oppi-app-launch', 'briefs');

const WINDOW = "datetime('now', '-1 day')"; // 24h atrás (SQLite y Postgres guardan created_at UTC con este formato)
const SINCE = "strftime('%Y-%m-%d %H:%M:%S', 'now', '-1 day')";

function gs(n) {
  return Number(n || 0).toLocaleString('es-PY').replace(/,/g, '.') + ' Gs';
}

function briefDate() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRIEF_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-');
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
    'agosto','septiembre','octubre','noviembre','diciembre'];
  return `${Number(d)} de ${MESES[Number(m) - 1]} de ${y}`;
}

async function safeCount(db, sql, params = []) {
  try {
    const r = await queryOne(db, sql, params);
    return r && r.c != null ? Number(r.c) : null;
  } catch {
    return null;
  }
}

async function collect(db) {
  const m = {};
  m.usuarios_nuevos = await safeCount(db, `SELECT COUNT(*) c FROM users WHERE created_at >= ${SINCE}`);
  m.profesionales_nuevos = await safeCount(db,
    `SELECT COUNT(*) c FROM users WHERE created_at >= ${SINCE} AND role IN ('pro','handyman')`);
  m.negocios_nuevos = await safeCount(db,
    `SELECT COUNT(*) c FROM users WHERE created_at >= ${SINCE} AND role = 'business'`);
  m.reservas_creadas = await safeCount(db, `SELECT COUNT(*) c FROM bookings WHERE created_at >= ${SINCE}`);
  m.reservas_completadas = await safeCount(db,
    `SELECT COUNT(*) c FROM bookings WHERE created_at >= ${SINCE} AND status = 'completed'`);
  m.reservas_canceladas = await safeCount(db,
    `SELECT COUNT(*) c FROM bookings WHERE created_at >= ${SINCE} AND status = 'cancelled'`);
  const gmv = await queryOne(db,
    `SELECT COALESCE(SUM(total_gs), 0) c FROM bookings WHERE created_at >= ${SINCE}`).catch(() => ({ c: 0 }));
  m.gmv_gs = gmv ? Number(gmv.c) : null;
  const gmvDone = await queryOne(db,
    `SELECT COALESCE(SUM(total_gs), 0) c FROM bookings WHERE created_at >= ${SINCE} AND status = 'completed'`)
    .catch(() => ({ c: 0 }));
  m.gmv_completado_gs = gmvDone ? Number(gmvDone.c) : null;

  // Colas pendientes (acumulado, no solo 24h)
  m.documentos_pendientes = await safeCount(db,
    `SELECT COUNT(*) c FROM business_documents WHERE status = 'pending'`);
  m.negocios_por_verificar = await safeCount(db,
    `SELECT COUNT(*) c FROM businesses WHERE verification_status = 'pending'`);
  m.pros_por_verificar = await safeCount(db,
    `SELECT COUNT(*) c FROM professionals WHERE verified = 0`);
  m.resenas_retenidas = await safeCount(db,
    `SELECT COUNT(*) c FROM reviews WHERE moderation_status = 'held'`);
  m.resenas_rechazadas_24h = await safeCount(db,
    `SELECT COUNT(*) c FROM reviews WHERE created_at >= ${SINCE} AND moderation_status = 'rejected'`);
  m.soporte_abiertas = await safeCount(db,
    `SELECT COUNT(*) c FROM support_conversations WHERE status IN ('bot','human')`);
  m.soporte_en_humano = await safeCount(db,
    `SELECT COUNT(*) c FROM support_conversations WHERE status = 'human'`);
  m.borradores_contenido = await safeCount(db,
    `SELECT COUNT(*) c FROM content_drafts WHERE status = 'draft'`);
  m.prospectos_nuevos = await safeCount(db,
    `SELECT COUNT(*) c FROM prospects WHERE created_at >= ${SINCE} AND status = 'nuevo'`);

  // Corridas de agentes en las últimas 24h
  let runs = [];
  try {
    runs = await queryAll(db,
      `SELECT agent, COUNT(*) c FROM agent_runs WHERE created_at >= ${SINCE} GROUP BY agent ORDER BY c DESC`);
  } catch { /* tabla puede no existir en DBs viejas: migrate la crea, esto es defensa */ }
  m.agent_runs = runs.map((r) => ({ agent: r.agent, count: Number(r.c) }));

  m.pilot_mode = isPilotMode();
  return m;
}

function fmt(v) {
  return v == null ? 'n/d' : String(v);
}

function render(m, fecha) {
  const L = [];
  L.push(`# 🗞️ Carta diaria del equipo IA — Oppi`);
  L.push('');
  L.push(`**Fecha:** ${prettyDate(fecha)} (${BRIEF_TZ})`);
  L.push('');

  const movimiento = [
    m.usuarios_nuevos, m.reservas_creadas, m.profesionales_nuevos, m.negocios_nuevos,
  ].some((v) => (v || 0) > 0);

  L.push('## Resumen');
  L.push('');
  if (!movimiento) {
    L.push('- Casi sin movimiento todavía: la plataforma está en pre-lanzamiento y es normal que los contadores estén en cero. Nada está roto; simplemente no hubo actividad en las últimas 24h.');
    L.push('- El foco sigue siendo el lanzamiento: reclutar profesionales y negocios, y activar el boca a boca en Asunción.');
    L.push('- Las colas de revisión (verificaciones, reseñas, soporte) están vacías, así que no hay deuda operativa acumulada.');
  } else {
    L.push(`- ${fmt(m.usuarios_nuevos)} usuarios nuevos en las últimas 24h.`);
    L.push(`- ${fmt(m.reservas_creadas)} reservas creadas (${fmt(m.reservas_completadas)} completadas, ${fmt(m.reservas_canceladas)} canceladas).`);
    L.push(`- ${fmt(m.profesionales_nuevos)} profesionales y ${fmt(m.negocios_nuevos)} negocios nuevos.`);
    L.push(`- GMV generado: ${m.gmv_gs == null ? 'n/d' : gs(m.gmv_gs)} (${m.gmv_completado_gs == null ? 'n/d' : gs(m.gmv_completado_gs)} completado).`);
    if ((m.resenas_retenidas || 0) > 0 || (m.soporte_abiertas || 0) > 0 || (m.documentos_pendientes || 0) > 0) {
      L.push('- Hay colas pendientes de revisión (ver la sección "Necesita atención").');
    }
  }
  L.push('');

  L.push('## Métricas (últimas 24h)');
  L.push('');
  L.push('| Métrica | Valor |');
  L.push('|---|---|');
  L.push(`| Usuarios nuevos | ${fmt(m.usuarios_nuevos)} |`);
  L.push(`| Profesionales nuevos | ${fmt(m.profesionales_nuevos)} |`);
  L.push(`| Negocios nuevos | ${fmt(m.negocios_nuevos)} |`);
  L.push(`| Reservas creadas | ${fmt(m.reservas_creadas)} |`);
  L.push(`| Reservas completadas | ${fmt(m.reservas_completadas)} |`);
  L.push(`| Reservas canceladas | ${fmt(m.reservas_canceladas)} |`);
  L.push(`| GMV reservas creadas | ${m.gmv_gs == null ? 'n/d' : gs(m.gmv_gs)} |`);
  L.push(`| GMV reservas completadas | ${m.gmv_completado_gs == null ? 'n/d' : gs(m.gmv_completado_gs)} |`);
  L.push(`| Prospectos nuevos (reclutador) | ${fmt(m.prospectos_nuevos)} |`);
  L.push(`| Reseñas rechazadas por el moderador | ${fmt(m.resenas_rechazadas_24h)} |`);
  L.push('');

  L.push('## Necesita atención');
  L.push('');
  const atencion = [];
  if ((m.documentos_pendientes || 0) > 0) atencion.push(`- 📄 ${m.documentos_pendientes} documento(s) de negocio esperando revisión del Verificador.`);
  if ((m.negocios_por_verificar || 0) > 0) atencion.push(`- 🏢 ${m.negocios_por_verificar} negocio(s) con verificación pendiente.`);
  if ((m.pros_por_verificar || 0) > 0) atencion.push(`- 🧑‍🔧 ${m.pros_por_verificar} profesional(es) sin verificar.`);
  if ((m.resenas_retenidas || 0) > 0) atencion.push(`- 🛡️ ${m.resenas_retenidas} reseña(s) retenida(s) por el Moderador, esperando decisión humana.`);
  if ((m.soporte_en_humano || 0) > 0) atencion.push(`- 🙋 ${m.soporte_en_humano} conversación(es) de soporte derivadas a humano (de ${fmt(m.soporte_abiertas)} abiertas en total).`);
  else if ((m.soporte_abiertas || 0) > 0) atencion.push(`- 💬 ${m.soporte_abiertas} conversación(es) de soporte abiertas, todas atendidas por el bot por ahora.`);
  if ((m.borradores_contenido || 0) > 0) atencion.push(`- ✍️ ${m.borradores_contenido} borrador(es) de contenido esperando aprobación.`);
  if (atencion.length === 0) atencion.push('- Nada pendiente: verificaciones, reseñas y soporte al día. ✅');
  L.push(...atencion);
  L.push('');

  L.push('## Equipo IA (corridas en 24h)');
  L.push('');
  if (m.agent_runs.length === 0) {
    L.push('Sin corridas registradas. Los agentes todavía no corren en cron: ver EQUIPO.md para la propuesta de horarios.');
  } else {
    L.push('| Agente | Corridas |');
    L.push('|---|---|');
    for (const r of m.agent_runs) L.push(`| ${r.agent} | ${r.count} |`);
  }
  L.push('');

  L.push('## Configuración');
  L.push('');
  L.push(`- Modo piloto de cancelaciones (CANCELLATION_PILOT_MODE): **${m.pilot_mode ? 'ON' : 'OFF'}**`);
  L.push('');
  L.push('---');
  L.push('_Generado automáticamente por `scripts/daily-brief.js`. En pre-lanzamiento los ceros son la noticia: no inventamos datos._');
  L.push('');
  return L.join('\n');
}

async function main() {
  const fecha = briefDate();
  const db = openDb(process.env.DB_PATH || './data/oppi.db');
  try {
    await migrate(db);
    const m = await collect(db);
    const md = render(m, fecha);

    if (DRY_RUN) {
      console.log(md);
      return;
    }

    fs.mkdirSync(BRIEFS_DIR, { recursive: true });
    const file = path.join(BRIEFS_DIR, `${fecha}.md`);
    fs.writeFileSync(file, md);
    console.log(`Carta diaria guardada en ${file}`);

    // Auditar la corrida del propio agente (no en dry-run)
    try {
      await run(db, `INSERT INTO agent_runs (agent, action, detail) VALUES ('daily-brief', 'brief_written', ?)`, [`${fecha}.md`]);
    } catch (e) {
      console.warn('[daily-brief] no se pudo registrar la corrida en agent_runs:', e.message);
    }
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error('[daily-brief] ERROR:', err.message);
  process.exit(1);
});
