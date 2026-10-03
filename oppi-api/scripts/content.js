'use strict';

/**
 * Agente CONTENIDO de Oppi — borradores pre-lanzamiento (oct 2026 → ene 2027).
 *
 * Genera con PLANTILLAS + REGLAS (sin API keys) un calendario de 3 posteos/semana
 * × 14 semanas = 42 borradores, con la voz de Oppi: voseo rioplatense, beneficios
 * concretos, CTA y hashtags.
 *
 * REGLA DURA: este script JAMÁS publica. No existe ningún path que ponga
 * status='published'. La publicación es siempre manual en Instagram, después de
 * una aprobación humana explícita (--approve). Ver CONTENIDO.md.
 *
 * Uso (desde la raíz del repo):
 *   node scripts/content.js --dry-run      # imprime los 42 borradores (no inserta)
 *   node scripts/content.js                # genera e inserta el calendario
 *   node scripts/content.js --list [--status=X]
 *   node scripts/content.js --approve <id> # marca approved + approved_at
 *
 * La DB se resuelve con DB_PATH (igual que el seed). Para no ensuciar la DB de
 * desarrollo:  DB_PATH=/tmp/oppi-test.db node scripts/content.js
 */
const { openDb, migrate, queryAll, queryOne, run, closeDb } = require('../src/db');

const DB_PATH = process.env.DB_PATH || './data/oppi.db';

const KINDS = ['beneficio', 'como_funciona', 'prueba_social', 'countdown'];
const STATUSES = ['draft', 'approved', 'published', 'discarded'];

// Lanzamiento: enero 2027. Primera semana del calendario: lunes 5/10/2026.
const LAUNCH = new Date(2027, 0, 31);       // 2027-01-31
const START_MONDAY = new Date(2026, 9, 5);  // lunes 2026-10-05
const WEEKS = 14;
const DAY_OFFSETS = [0, 2, 4];              // lun, mié, vie
const COUNTDOWN_FROM_WEEK = 11;             // las últimas 4 semanas son countdown

const BASE_TAGS = '#Oppi #Paraguay #Asunción';

const pad2 = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysUntilLaunch = (scheduled) =>
  Math.round((LAUNCH - scheduled) / 86400000);

/**
 * Plantillas por kind. caption: 2-4 líneas, beneficio + CTA, voseo rioplatense.
 * hashtags: base + del rubro.
 * Los nombres de prueba_social son personas ILUSTRATIVAS (placeholders) hasta
 * tener testimonios reales: nunca presentarlas como clientes verificados.
 */
const TEMPLATES = {
  beneficio: [
    { title: 'Reservá sin llamar por teléfono',
      caption: 'Llamar 3 veces y que no te atiendan: nunca más.\nEn Oppi ves los horarios libres y reservás en 30 segundos, directo desde tu celu. 📲\nSeguinos para ser el primero en probarlo.',
      hashtags: `${BASE_TAGS} #ReserváOnline` },
    { title: 'Tu peluquera, sin WhatsApp',
      caption: 'Coordinar por WhatsApp es un ida y vuelta eterno. Con Oppi reservás el turno en dos toques y listo.\n¿Peluquería, barbería, manicura? Todo en un solo lugar.\nProbalo gratis cuando lancemos. ✨',
      hashtags: `${BASE_TAGS} #BellezaPy` },
    { title: 'La seña, protegida',
      caption: 'Dar una seña por transferencia a un desconocido da miedo. En Oppi la seña queda retenida y se libera cuando el trabajo está hecho. 🛡️\nReservá tranquilo, pagá seguro.\nSeguinos.' ,
      hashtags: `${BASE_TAGS} #PagosSeguros` },
    { title: 'Profesionales verificados',
      caption: 'En Oppi cada profesional verifica su identidad y muestra reseñas reales de otros clientes. ⭐\nReservá con alguien de confianza, no con un número random.\nSeguinos para el lanzamiento.' ,
      hashtags: `${BASE_TAGS} #Confianza` },
    { title: 'Tu agenda se llena sola',
      caption: '¿Sos profesional? Con Oppi tus clientes reservan solos y vos solo trabajás. Menos WhatsApp, más laburo. 💪\nSumate a la lista de profesionales y enterate primero.',
      hashtags: `${BASE_TAGS} #ProfesionalesPy` },
    { title: 'El plomero, sin drama',
      caption: 'La canilla gotea, el electricista no aparece. Con Oppi buscás el servicio, elegís el horario y el profesional confirma. Así de simple. 🔧\nGuardá este posteo para cuando lo necesites.',
      hashtags: `${BASE_TAGS} #Hogar` },
    { title: 'Precios claros desde el vamos',
      caption: 'Nada de "te paso el precio por privado". En Oppi ves el precio del servicio antes de reservar. 💰\nTransparente, como tiene que ser.\nSeguinos.' ,
      hashtags: `${BASE_TAGS} #PreciosClaros` },
    { title: 'Recordatorios automáticos',
      caption: '¿Te olvidaste del turno? Con Oppi no pasa: te avisamos antes de cada reserva. ⏰\nCero plantones, cero vueltas.\nProbalo gratis cuando lancemos.',
      hashtags: `${BASE_TAGS} #SinOlvidos` },
    { title: 'Reseñas de verdad',
      caption: 'Antes de reservar, leés lo que dijeron otros clientes. Después de tu turno, tu reseña ayuda a otros. ⭐\nLa confianza se construye entre todos.\nSeguinos.' ,
      hashtags: `${BASE_TAGS} #ReseñasReales` },
    { title: 'Todo Asunción en tu bolsillo',
      caption: 'Peluquería en Villa Morra, electricista en Sajonia, masajes en Carmelitas. Los mejores profesionales de Asunción, en una sola app. 📍\nLlegamos pronto. Seguinos.',
      hashtags: `${BASE_TAGS} #Asunción` },
  ],
  como_funciona: [
    { title: 'Así se reserva en Oppi',
      caption: '1️⃣ Buscá el servicio que necesitás.\n2️⃣ Elegí profesional y horario.\n3️⃣ Confirmá y listo: tu turno queda agendado.\nTan simple que duele. Seguinos. 👀',
      hashtags: `${BASE_TAGS} #CómoFunciona` },
    { title: 'Paso 1: buscá',
      caption: 'Abrís Oppi y buscás lo que necesitás: corte de pelo, plomero, manicura…\nFiltrás por barrio, precio y reseñas. 🔍\nProbalo gratis cuando lancemos.',
      hashtags: `${BASE_TAGS} #Buscá` },
    { title: 'Paso 2: elegí tu horario',
      caption: 'Ves los horarios reales del profesional y elegís el que te venga bien. Sin llamar, sin esperar respuesta. 📅\nTu tiempo vale. Seguinos.',
      hashtags: `${BASE_TAGS} #TuHorario` },
    { title: 'Paso 3: confirmá con seña',
      caption: 'Confirmás con una seña que Oppi retiene de forma segura. El profesional la recibe cuando termina el trabajo. 🤝\nAsí nadie pierde. Probalo gratis.',
      hashtags: `${BASE_TAGS} #SeñaSegura` },
    { title: 'Chat directo con el profesional',
      caption: '¿Dudas antes de reservar? Le hablás directo al profesional desde la app. 💬\nTodo queda registrado, todo claro.\nSeguinos para el lanzamiento.',
      hashtags: `${BASE_TAGS} #ChatDirecto` },
    { title: 'Cancelá sin drama',
      caption: '¿Te surgió algo? Cancelás desde la app, con las reglas claras desde el principio. Sin peleas, sin culpa. ✅\nOppi se ocupa del resto. Probalo gratis.',
      hashtags: `${BASE_TAGS} #SinDrama` },
    { title: 'Tu historial, en un lugar',
      caption: 'Tus turnos, tus reseñas y tus profesionales favoritos, guardados en tu perfil. 📋\nVolver a reservar con quien te gustó: dos toques.\nSeguinos.' ,
      hashtags: `${BASE_TAGS} #TuHistorial` },
    { title: 'Para profesionales: publicá tus servicios',
      caption: '¿Sos profesional? Cargás tus servicios, tus precios y tus horarios. Oppi hace el resto. 🛠️\nTus clientes reservan solos.\nSumate a la lista de profesionales.',
      hashtags: `${BASE_TAGS} #ProfesionalesPy` },
    { title: 'Para negocios: tu equipo en Oppi',
      caption: '¿Tenés un salón o un taller? Sumá a tu equipo, cada uno con su agenda. Oppi Empresas, pensado para vos. 🏢\nEscribinos para ser de los primeros.',
      hashtags: `${BASE_TAGS} #OppiEmpresas` },
    { title: 'Del match al turno en 1 minuto',
      caption: 'Buscar, elegir, confirmar. En menos de un minuto tenés tu turno agendado. ⏱️\nLa burocracia de reservar se terminó.\nSeguinos.' ,
      hashtags: `${BASE_TAGS} #EnUnMinuto` },
  ],
  prueba_social: [
    { title: 'María ya atiende con Oppi',
      caption: 'María es peluquera en Villa Morra. Antes perdía horas coordinando turnos por WhatsApp; ahora sus clientas reservan solas. ✂️\n¿Sos profesional? Sumate a la lista de espera.',
      hashtags: `${BASE_TAGS} #BellezaPy` },
    { title: 'Carlos llenó su agenda',
      caption: 'Carlos es electricista en Sajonia y vivía colgado del teléfono. Con Oppi publica sus horarios y los clientes llegan solos. ⚡\nVos también podés. Sumate como profesional.',
      hashtags: `${BASE_TAGS} #Hogar` },
    { title: 'Lucía y sus clientas felices',
      caption: 'Lucía hace manicura en Carmelitas y sus clientas la recomiendan una y otra vez. En Oppi las reseñas hablan por ella. 💅\nEl buen laburo se nota. Seguinos.',
      hashtags: `${BASE_TAGS} #BellezaPy` },
    { title: 'Pedro, el barbero que no pierde tiempo',
      caption: 'Pedro corta pelo en Las Mercedes. Con Oppi no pierde tiempo coordinando: abre la app y ve su día completo. 💈\nMenos mensajes, más cortes.\n¿Sos profesional? Sumate.',
      hashtags: `${BASE_TAGS} #Barbería` },
    { title: 'Ana reserva en 30 segundos',
      caption: 'Ana trabaja todo el día y no tiene tiempo de llamar por teléfono. Ahora reserva su masaje desde el colectivo. 📲\nVos también vas a poder. Seguinos.',
      hashtags: `${BASE_TAGS} #ReserváOnline` },
    { title: 'Jorge encontró plomero un domingo',
      caption: 'A Jorge se le rompió una canilla un domingo a la mañana. Buscó en Oppi, reservó, y a la tarde ya estaba arreglada. 🔧\nAsí tiene que funcionar. Seguinos.',
      hashtags: `${BASE_TAGS} #Hogar` },
    { title: 'Rosa maneja su salón desde el celu',
      caption: 'Rosa tiene un salón con 3 personas. Con Oppi cada una tiene su agenda y ella ve todo desde el celu. 💅\nOppi Empresas llega pronto. Escribinos.',
      hashtags: `${BASE_TAGS} #OppiEmpresas` },
    { title: 'Diego y el corte perfecto',
      caption: 'Diego buscaba barbero con buenas reseñas cerca de su laburo. Lo encontró en Oppi, reservó y salió chocho. 💈\nLas reseñas no mienten. Seguinos.',
      hashtags: `${BASE_TAGS} #Barbería` },
    { title: 'Paola dice chau al WhatsApp eterno',
      caption: 'Paola odiaba el ida y vuelta de coordinar por WhatsApp. Con Oppi elige horario y listo. ✅\nMenos mensajes, más turnos. Probalo gratis cuando lancemos.',
      hashtags: `${BASE_TAGS} #SinVueltas` },
    { title: 'Hugo, el carpintero recomendado',
      caption: 'A Hugo lo recomendaron 20 vecinos en Oppi y ahora tiene lista de espera. 🪚\nEl buen laburo se premia.\n¿Sos profesional? Sumate a la lista de espera.',
      hashtags: `${BASE_TAGS} #Hogar` },
  ],
  countdown: [
    { caption: 'La cuenta regresiva empezó: faltan {days} días para que Oppi llegue a Asunción.\nReservá servicios sin llamar por teléfono. 📲\nSeguinos para no perdértelo.',
      hashtags: `${BASE_TAGS} #CuentaRegresiva` },
    { caption: 'Faltan {days} días. ⏳\n¿Peluquería, barbería, plomero, manicura? Todo en un solo lugar, con precios claros y seña protegida.\nCompartilo con quien lo necesite.',
      hashtags: `${BASE_TAGS} #YaFaltaPoco` },
    { caption: 'Faltan {days} días para el lanzamiento.\n¿Sos profesional? Cargá tus servicios una vez y que los clientes reserven solos. 💪\nSumate a la lista de profesionales.',
      hashtags: `${BASE_TAGS} #ProfesionalesPy` },
    { caption: '{days} días. La espera se acorta.\nBuscar, elegir horario, confirmar con seña segura. Así vas a reservar en Oppi. 🤝\nGuardá este posteo.',
      hashtags: `${BASE_TAGS} #CómoFunciona` },
    { caption: 'Faltan {days} días ⏳ y Asunción va a reservar distinto.\nSin llamadas, sin WhatsApp eterno, sin seña por transferencia a un desconocido.\nSeguinos.',
      hashtags: `${BASE_TAGS} #ReserváOnline` },
    { caption: '{days} días para que tu agenda se llene sola.\n¿Tenés un salón, un taller, das servicios a domicilio? Oppi es para vos. 🏢\nEscribinos para ser de los primeros.',
      hashtags: `${BASE_TAGS} #OppiEmpresas` },
    { caption: 'Faltan {days} días.\nImaginate: domingo a la mañana, se rompe la canilla, y a la tarde ya está arreglada. Eso es Oppi. 🔧\nSeguinos para el lanzamiento.',
      hashtags: `${BASE_TAGS} #Hogar` },
    { caption: '{days} días ⏳\nReseñas reales, profesionales verificados, recordatorios automáticos. Reservar va a ser un placer.\nCompartilo con tu grupo.',
      hashtags: `${BASE_TAGS} #Confianza` },
    { caption: 'Faltan {days} días para decirle chau a coordinar por WhatsApp.\nElegís horario, confirmás, listo. ✅\nProbalo gratis cuando lancemos.',
      hashtags: `${BASE_TAGS} #SinVueltas` },
    { caption: '{days} días. Cada vez falta menos.\nOppi: la app paraguaya para reservar servicios. Hecha acá, para nosotros. 🇵🇾\nSeguinos.',
      hashtags: `${BASE_TAGS} #HechoEnParaguay` },
    { caption: 'Faltan {days} días ⏳\n¿Ya nos seguís? El día del lanzamiento los primeros van a tener beneficios especiales.\nNo te lo pierdas. 👀',
      hashtags: `${BASE_TAGS} #YaFaltaPoco` },
    { caption: '{days} días para el gran día.\nOppi llega a Asunción: reservá sin llamar, pagá seguro, viví tranquilo. 📲\nEsta es la última semana de espera. ¡Nos vemos adentro!',
      hashtags: `${BASE_TAGS} #Lanzamiento` },
  ],
};

/** Genera los 42 borradores del calendario (puro: no toca la DB). */
function buildCalendar() {
  const drafts = [];
  const counters = { beneficio: 0, como_funciona: 0, prueba_social: 0, countdown: 0 };
  const rotate = ['beneficio', 'como_funciona', 'prueba_social'];

  for (let w = 0; w < WEEKS; w++) {
    for (const offset of DAY_OFFSETS) {
      const scheduled = addDays(START_MONDAY, w * 7 + offset);
      const kind = (w + 1) >= COUNTDOWN_FROM_WEEK ? 'countdown' : rotate[w % rotate.length];
      const pool = TEMPLATES[kind];
      const tpl = pool[counters[kind] % pool.length];
      counters[kind] += 1;

      const days = daysUntilLaunch(scheduled);
      const title = kind === 'countdown' ? `Faltan ${days} días ⏳` : tpl.title;
      const caption = kind === 'countdown' ? tpl.caption.replaceAll('{days}', String(days)) : tpl.caption;

      drafts.push({
        kind,
        title,
        caption,
        hashtags: tpl.hashtags,
        scheduled_for: fmt(scheduled),
      });
    }
  }
  return drafts;
}

function printDraft(d, idx) {
  console.log(`--- #${idx + 1} [${d.kind}] ${d.scheduled_for} ---`);
  console.log(`Título: ${d.title}`);
  console.log(d.caption);
  console.log(d.hashtags);
  console.log('');
}

function usage() {
  console.log(`Contenido Oppi — borradores pre-lanzamiento (oct 2026 → ene 2027)

Uso:
  node scripts/content.js --dry-run        Imprime los 42 borradores (no inserta)
  node scripts/content.js                 Genera e inserta el calendario (42 borradores)
  node scripts/content.js --list [--status=X]  Lista borradores
  node scripts/content.js --approve <id>  Marca approved + approved_at

REGLA DURA: ningún comando publica. 'published' solo lo pone un humano en la DB
después de publicar a mano en Instagram. Docs: CONTENIDO.md`);
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

async function generate() {
  return withDb(async (db) => {
    const existing = await queryOne(db, 'SELECT COUNT(*) AS n FROM content_drafts', []);
    if (existing.n > 0) {
      console.log(`Ya existen ${existing.n} borradores en content_drafts: no se genera de nuevo (anti-duplicados).`);
      console.log('Si querés regenerar, borrá los borradores en draft a mano primero.');
      return;
    }
    const drafts = buildCalendar();
    for (const d of drafts) {
      await run(db,
        `INSERT INTO content_drafts (kind, title, caption, hashtags, status, scheduled_for)
         VALUES (?,?,?,?,?,?)`,
        [d.kind, d.title, d.caption, d.hashtags, 'draft', d.scheduled_for]);
    }
    console.log(`✅ Calendario generado: ${drafts.length} borradores (status=draft), lun/mié/vie del 2026-10-05 al 2027-01-08.`);
    console.log('   Semanas 1–10: beneficio / como_funciona / prueba_social rotando.');
    console.log('   Semanas 11–14: countdown al lanzamiento (2027-01-31).');
  });
}

async function listDrafts(statusFilter) {
  if (statusFilter && !STATUSES.includes(statusFilter)) {
    console.error(`Estado inválido: ${statusFilter}. Válidos: ${STATUSES.join(', ')}`);
    process.exit(1);
  }
  return withDb(async (db) => {
    const rows = statusFilter
      ? await queryAll(db, 'SELECT * FROM content_drafts WHERE status = ? ORDER BY scheduled_for, id', [statusFilter])
      : await queryAll(db, 'SELECT * FROM content_drafts ORDER BY scheduled_for, id', []);
    if (rows.length === 0) {
      console.log('Todavía no hay borradores. Generá el calendario sin flags.');
      return;
    }
    console.log(`# Borradores${statusFilter ? ` [${statusFilter}]` : ''}: ${rows.length}\n`);
    for (const r of rows) {
      console.log(`#${r.id} [${r.kind}] [${r.status}] ${r.scheduled_for || 'sin fecha'} — ${r.title}`);
    }
  });
}

async function approve(id) {
  if (!Number.isInteger(Number(id))) {
    console.error('El <id> tiene que ser un número.');
    process.exit(1);
  }
  return withDb(async (db) => {
    const d = await queryOne(db, 'SELECT * FROM content_drafts WHERE id = ?', [id]);
    if (!d) {
      console.error(`No existe el borrador #${id}.`);
      process.exit(1);
    }
    if (d.status !== 'draft') {
      console.error(`El borrador #${id} está en "${d.status}": solo se puede aprobar desde "draft".`);
      process.exit(1);
    }
    // approved_by NULL: la aprobación es manual desde el CLI, no de un usuario.
    // Nota de auditoría: "aprobación manual CLI".
    await run(db, "UPDATE content_drafts SET status = 'approved', approved_at = datetime('now'), approved_by = NULL WHERE id = ?",
      [id]);
    console.log(`✅ #${id} "${d.title}" → approved (aprobación manual CLI, ${new Date().toISOString()}).`);
    console.log('   Recordá: la publicación en Instagram es manual. Este script nunca publica.');
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return usage();

  if (args.includes('--dry-run')) {
    const drafts = buildCalendar();
    console.log(`== Calendario pre-lanzamiento: ${drafts.length} borradores (no se inserta nada) ==\n`);
    drafts.forEach(printDraft);
    return;
  }

  if (args[0] === '--list') {
    const stArg = args.find((a) => a.startsWith('--status='));
    const status = stArg ? stArg.slice('--status='.length) : null;
    return listDrafts(status);
  }

  if (args[0] === '--approve') {
    if (!args[1]) {
      console.error('Uso: node scripts/content.js --approve <id>');
      process.exit(1);
    }
    return approve(args[1]);
  }

  if (args.length === 0) return generate();

  console.error('Flag desconocido.');
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error('[contenido] falló:', err.message);
  process.exit(1);
});
