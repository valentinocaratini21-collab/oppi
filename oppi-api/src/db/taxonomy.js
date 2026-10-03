'use strict';

/**
 * Taxonomía de rubros de Oppi (mejora 7).
 *
 * - `categories`: los 8 rubros madre.
 * - `professions`: oficios dentro de cada rubro (los elige el profesional).
 * - `subcategories`: tipos de trabajo dentro de cada rubro.
 *
 * `seedTaxonomy(db)` es idempotente: si ya hay categorías, no hace nada.
 * `mapLegacyTaxonomy(db)` migra los valores de texto libre que ya existían
 * (professionals.categories / businesses.categories) a la profesión o
 * categoría más cercana por coincidencia simple; si no hay coincidencia
 * razonable, deja el id en null ("Otro" lo maneja el frontend).
 */
const TAXONOMY = [
  {
    nombre: 'Belleza', icono: '💇',
    professions: ['Peluquero/a', 'Barbero/a', 'Manicura y pedicura', 'Maquillador/a', 'Esteticista', 'Depilador/a'],
    subcategories: ['Corte y peinados', 'Color', 'Uñas', 'Maquillaje', 'Tratamientos faciales'],
  },
  {
    nombre: 'Hogar', icono: '🏠',
    professions: ['Plomero/a', 'Electricista', 'Albañil', 'Pintor/a', 'Carpintero/a', 'Jardinero/a', 'Técnico en refrigeración', 'Gasista'],
    subcategories: ['Reparaciones', 'Instalaciones', 'Mantenimiento', 'Limpieza del hogar', 'Mudanzas'],
  },
  {
    nombre: 'Salud', icono: '💆',
    professions: ['Masajista', 'Nutricionista', 'Psicólogo/a', 'Kinesiólogo/a', 'Enfermero/a', 'Podólogo/a'],
    subcategories: ['Masajes', 'Consultas', 'Terapia', 'Cuidado a domicilio'],
  },
  {
    nombre: 'Deportes', icono: '⚽',
    professions: ['Entrenador/a personal', 'Profesor/a de yoga', 'Profesor/a de natación', 'Coach de pádel', 'Profesor/a de tenis', 'Preparador/a físico/a'],
    subcategories: ['Clases', 'Entrenamiento personalizado', 'Rehabilitación deportiva'],
  },
  {
    nombre: 'Educación', icono: '📚',
    professions: ['Profesor/a particular', 'Profesor/a de inglés', 'Profesor/a de guaraní', 'Tutor/a universitario/a', 'Profesor/a de música'],
    subcategories: ['Clases de apoyo', 'Idiomas', 'Música', 'Preparación de exámenes'],
  },
  {
    nombre: 'Eventos', icono: '🎉',
    professions: ['Fotógrafo/a', 'DJ', 'Catering', 'Decorador/a', 'Animador/a de fiestas', 'Sonido e iluminación'],
    subcategories: ['Bodas', 'Cumpleaños', 'Eventos corporativos', 'XV años'],
  },
  {
    nombre: 'Mascotas', icono: '🐾',
    professions: ['Peluquero/a canino/a', 'Paseador/a de perros', 'Veterinario/a a domicilio', 'Adiestrador/a', 'Cuidador/a de mascotas'],
    subcategories: ['Peluquería', 'Paseos', 'Cuidado', 'Adiestramiento'],
  },
  {
    nombre: 'Más', icono: '✨',
    professions: ['Changas generales', 'Cadetería', 'Limpieza', 'Otros servicios'],
    subcategories: ['Varios', 'Otros', 'Urgencias'],
  },
];

/** Siembra la taxonomía si la tabla está vacía. Idempotente. */
async function seedTaxonomy(db) {
  // require perezoso: este módulo lo carga db/index.js (evita ciclo al inicio).
  const { queryOne, queryAll, run } = require('./index');
  const count = await queryOne(db, 'SELECT COUNT(*) AS n FROM categories');
  if (Number(count.n) > 0) return { seeded: false };
  for (const cat of TAXONOMY) {
    const rc = await run(db, 'INSERT INTO categories (nombre, icono) VALUES (?,?)', [cat.nombre, cat.icono]);
    for (const p of cat.professions) {
      await run(db, 'INSERT INTO professions (category_id, nombre) VALUES (?,?)', [rc.id, p]);
    }
    for (const s of cat.subcategories) {
      await run(db, 'INSERT INTO subcategories (category_id, nombre) VALUES (?,?)', [rc.id, s]);
    }
  }
  const nProf = await queryOne(db, 'SELECT COUNT(*) AS n FROM professions');
  const nSub = await queryOne(db, 'SELECT COUNT(*) AS n FROM subcategories');
  return { seeded: true, categories: TAXONOMY.length, professions: Number(nProf.n), subcategories: Number(nSub.n) };
}

/** Normaliza para comparar: minúsculas, sin tildes, solo alfanuméricos. */
function norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Largo del prefijo común entre dos strings normalizados. */
function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/**
 * Coincidencia simple entre un texto libre y un candidato del catálogo.
 * Devuelve un puntaje (> 0 = hay coincidencia razonable):
 *  - 100: iguales normalizados,
 *  - 90: uno contiene al otro,
 *  - largo del prefijo común si es >= 5 (ej. "peluquería" ↔ "peluquero").
 */
function matchScore(free, candidate) {
  const a = norm(free), b = norm(candidate);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 90;
  const cp = commonPrefix(a, b);
  return cp >= 5 ? cp : 0;
}

/** Devuelve el candidato con mejor puntaje, o null si ninguno matchea. */
function bestMatch(free, candidates) {
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const s = matchScore(free, c.nombre);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}

const safeJsonParse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

/**
 * Migra valores de texto libre existentes a la taxonomía.
 * - professionals.categories[0] → professions.id más cercana (profession_id).
 * - businesses.categories[0] → categories.id más cercana (category_id).
 * Solo toca filas con el id en null. Idempotente.
 */
async function mapLegacyTaxonomy(db) {
  const { queryAll, run } = require('./index');
  const result = { professionals: 0, businesses: 0 };

  const professions = await queryAll(db, 'SELECT id, nombre FROM professions');
  if (professions.length > 0) {
    const pros = await queryAll(db,
      'SELECT id, categories FROM professionals WHERE profession_id IS NULL');
    for (const p of pros) {
      const first = (safeJsonParse(p.categories, [])[0] || '').trim();
      if (!first) continue;
      const match = bestMatch(first, professions);
      if (match) {
        await run(db, 'UPDATE professionals SET profession_id = ? WHERE id = ?', [match.id, p.id]);
        result.professionals += 1;
      }
    }
  }

  const categories = await queryAll(db, 'SELECT id, nombre FROM categories');
  const profCats = await queryAll(db, 'SELECT id, category_id FROM professions');
  const catOfProf = new Map(profCats.map((p) => [p.id, p.category_id]));
  if (categories.length > 0) {
    const bizs = await queryAll(db,
      'SELECT id, categories FROM businesses WHERE category_id IS NULL');
    for (const b of bizs) {
      const first = (safeJsonParse(b.categories, [])[0] || '').trim();
      if (!first) continue;
      let match = bestMatch(first, categories);
      let categoryId = match ? match.id : null;
      if (!categoryId && professions.length > 0) {
        // Fallback: la profesión más cercana define la categoría
        // (ej. "peluquería" → Peluquero/a → Belleza).
        const profMatch = bestMatch(first, professions);
        if (profMatch) categoryId = catOfProf.get(profMatch.id) ?? null;
      }
      if (categoryId) {
        await run(db, 'UPDATE businesses SET category_id = ? WHERE id = ?', [categoryId, b.id]);
        result.businesses += 1;
      }
    }
  }
  return result;
}

module.exports = { TAXONOMY, seedTaxonomy, mapLegacyTaxonomy, norm, matchScore, bestMatch };
