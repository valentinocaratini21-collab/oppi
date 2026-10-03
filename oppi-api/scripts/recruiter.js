'use strict';

/**
 * Agente RECLUTADOR de Oppi — prospección manual de profesionales (sin API keys).
 *
 * Trabaja con plantillas + reglas sobre la tabla `prospects`:
 *   - Cada celda de la matriz (categoría × barrio) tiene una query de búsqueda
 *     lista para pegar en Instagram/Google:  peluquera "Villa Morra" instagram
 *   - El lote diario inserta las siguientes 10 combinaciones sin prospect
 *     (idempotente: nunca duplica una combinación existente).
 *   - El tracking (nuevo → contactado → respondio → registrado/descartado)
 *     se actualiza a mano con --set.
 *
 * Uso (desde la raíz del repo):
 *   node scripts/recruiter.js --dry-run        # matriz categoría×barrio, sin tocar la DB
 *   node scripts/recruiter.js                  # genera el lote diario (10 prospectos)
 *   node scripts/recruiter.js --list [--status=X]
 *   node scripts/recruiter.js --set <id> <nuevo|contactado|respondio|registrado|descartado>
 *
 * La DB se resuelve con DB_PATH (igual que el seed). Para no ensuciar la DB de
 * desarrollo:  DB_PATH=/tmp/oppi-test.db node scripts/recruiter.js
 */
const { openDb, migrate, queryAll, queryOne, run, closeDb } = require('../src/db');

const DB_PATH = process.env.DB_PATH || './data/oppi.db';
const BATCH_SIZE = 10;

const STATUSES = ['nuevo', 'contactado', 'respondio', 'registrado', 'descartado'];

const BARRIOS = [
  'Villa Morra', 'Carmelitas', 'Sajonia', 'Las Mercedes', 'Trinidad', 'Loma Pytá',
  'San Vicente', 'Barrio Obrero', 'Tacumbú', 'Recoleta', 'Villa Aurelia',
  'San Roque', 'La Encarnación', 'Catedral', 'General Díaz', 'Hipódromo',
];

/** Términos de búsqueda por categoría. Se rota por índice de barrio para variar. */
const QUERY_TERMS = {
  'Belleza':   ['peluquera', 'barbero', 'manicura', 'maquilladora', 'estilista'],
  'Hogar':     ['plomero', 'electricista', 'pintor', 'albañil', 'técnico aire acondicionado'],
  'Salud':     ['masoterapeuta', 'nutricionista', 'kinesiólogo', 'psicóloga', 'podólogo'],
  'Deportes':  ['entrenador personal', 'coach funcional', 'profesor de natación', 'instructor de yoga'],
  'Educación': ['profesor particular', 'tutora de inglés', 'maestro de música', 'profesor de guaraní'],
  'Eventos':   ['fotógrafo', 'decoradora de eventos', 'catering', 'animador de fiestas'],
  'Mascotas':  ['peluquería canina', 'veterinaria', 'adiestrador', 'paseador de perros'],
  'Más':       ['servicios', 'freelancer', 'técnico en reparaciones'],
};

const CATEGORIES = Object.keys(QUERY_TERMS);

/** Query lista para pegar, ej: peluquera "Villa Morra" instagram */
function buildQuery(category, barrioIdx) {
  const barrio = BARRIOS[barrioIdx];
  const terms = QUERY_TERMS[category];
  const term = terms[barrioIdx % terms.length];
  return `${term} "${barrio}" instagram`;
}

function usage() {
  console.log(`Reclutador Oppi — prospección manual de profesionales

Uso:
  node scripts/recruiter.js --dry-run        Matriz categoría×barrio con queries (no toca la DB)
  node scripts/recruiter.js                  Genera el lote diario: 10 combinaciones nuevas
  node scripts/recruiter.js --list [--status=X]  Lista prospectos
  node scripts/recruiter.js --set <id> <status>  Actualiza tracking

Estados: ${STATUSES.join(' | ')}
Docs: RECLUTADOR.md`);
}

/** --dry-run: imprime la matriz completa, sin abrir la DB. */
function dryRun() {
  console.log('== MATRIZ categoría × barrio (128 celdas) — queries listas para pegar ==\n');
  for (const category of CATEGORIES) {
    console.log(`# ${category}`);
    BARRIOS.forEach((barrio, i) => {
      console.log(`  ${barrio.padEnd(15)} ${buildQuery(category, i)}`);
    });
    console.log('');
  }
}

async function withDb(fn) {
  const db = openDb(DB_PATH);
  try {
    await migrate(db);
    return await fn(db);
  } finally {
    await closeDb(db);
  }
}

/** Sin flags: inserta las siguientes 10 combinaciones (categoría, barrio) sin prospect. */
async function generateBatch() {
  return withDb(async (db) => {
    const existing = await queryAll(db, 'SELECT category, barrio FROM prospects', []);
    const taken = new Set(existing.map((r) => `${r.category}|||${r.barrio}`));

    const pending = [];
    outer:
    for (const category of CATEGORIES) {
      for (let i = 0; i < BARRIOS.length; i++) {
        if (!taken.has(`${category}|||${BARRIOS[i]}`)) {
          pending.push({ category, barrio: BARRIOS[i], query: buildQuery(category, i) });
          if (pending.length >= BATCH_SIZE) break outer;
        }
      }
    }

    if (pending.length === 0) {
      console.log('✅ La matriz está completa: las 128 combinaciones ya tienen prospect.');
      return;
    }

    for (const p of pending) {
      const notes = [
        `Query sugerida: ${p.query}`,
        'Pasos: 1) buscar en Instagram/Google, 2) anotar el @handle real en `name` y el dato de contacto en `contact`,',
        '3) mover a `contactado` al enviar el primer mensaje (ver RECLUTADOR.md).',
      ].join(' ');
      const r = await run(db,
        `INSERT INTO prospects (name, source, category, barrio, contact, status, notes)
         VALUES (?,?,?,?,?,?,?)`,
        [`${p.category} · ${p.barrio}`, 'manual', p.category, p.barrio, '', 'nuevo', notes]);
      console.log(`[+] #${r.id}  ${p.category} · ${p.barrio}  →  ${p.query}`);
    }
    console.log(`\n✅ Lote diario: ${pending.length} prospectos nuevos (status=nuevo, source=manual).`);
  });
}

async function listProspects(statusFilter) {
  if (statusFilter && !STATUSES.includes(statusFilter)) {
    console.error(`Estado inválido: ${statusFilter}. Válidos: ${STATUSES.join(', ')}`);
    process.exit(1);
  }
  return withDb(async (db) => {
    const rows = statusFilter
      ? await queryAll(db, 'SELECT * FROM prospects WHERE status = ? ORDER BY updated_at DESC', [statusFilter])
      : await queryAll(db, 'SELECT * FROM prospects ORDER BY updated_at DESC', []);
    if (rows.length === 0) {
      console.log(statusFilter ? `Sin prospectos en estado "${statusFilter}".` : 'Todavía no hay prospectos. Corré el lote diario sin flags.');
      return;
    }
    console.log(`# Prospectos${statusFilter ? ` [${statusFilter}]` : ''}: ${rows.length}\n`);
    for (const r of rows) {
      console.log(`#${r.id} [${r.status}] ${r.name}`);
      console.log(`    ${r.category} · ${r.barrio}  ·  contacto: ${r.contact || '—'}`);
      console.log(`    actualizado: ${r.updated_at}`);
    }
  });
}

async function setStatus(id, status) {
  if (!STATUSES.includes(status)) {
    console.error(`Estado inválido: ${status}. Válidos: ${STATUSES.join(', ')}`);
    process.exit(1);
  }
  if (!Number.isInteger(Number(id))) {
    console.error('El <id> tiene que ser un número.');
    process.exit(1);
  }
  return withDb(async (db) => {
    const p = await queryOne(db, 'SELECT * FROM prospects WHERE id = ?', [id]);
    if (!p) {
      console.error(`No existe el prospecto #${id}.`);
      process.exit(1);
    }
    await run(db, "UPDATE prospects SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [status, id]);
    console.log(`✅ #${id} "${p.name}" → ${p.status} → ${status}`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return usage();

  if (args.includes('--dry-run')) return dryRun();

  if (args[0] === '--list') {
    const stArg = args.find((a) => a.startsWith('--status='));
    const status = stArg ? stArg.slice('--status='.length) : null;
    return listProspects(status);
  }

  if (args[0] === '--set') {
    if (!args[1] || !args[2]) {
      console.error('Uso: node scripts/recruiter.js --set <id> <nuevo|contactado|respondio|registrado|descartado>');
      process.exit(1);
    }
    return setStatus(args[1], args[2]);
  }

  if (args.length === 0) return generateBatch();

  console.error('Flag desconocido.');
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error('[reclutador] falló:', err.message);
  process.exit(1);
});
