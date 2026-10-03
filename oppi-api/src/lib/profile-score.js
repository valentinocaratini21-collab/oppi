'use strict';

/**
 * Score de completitud de perfil (0-100) — funciones PURAS, sin DB.
 *
 * Las usa el Guardián de calidad (scripts/guardian.js): el script junta los
 * datos desde la DB, arma el objeto de entrada y llama a estas funciones.
 * Al ser puras se testean sin base de datos (test/guardian.test.js).
 *
 * Cada chequeo: { key, label, cta, weight, ok }
 *  - key:    identificador corto (va al detail de agent_runs)
 *  - label:  qué falta, en sustantivo ("una foto de perfil")
 *  - cta:    qué hacer, en imperativo voseo ("subí una foto de perfil")
 *  - weight: puntos que aporta al score
 *  - ok:     boolean
 *
 * Retorna { score, checks, missing } donde `missing` son los chequeos no
 * cumplidos ordenados por peso descendente (para el "top 2" del nudge).
 */

const BIO_MIN_LENGTH = 20;

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Ordena los faltantes por peso descendente (estable: respeta el orden de definición en empates). */
function sortMissing(checks) {
  return checks
    .map((c, i) => ({ ...c, _i: i }))
    .filter((c) => !c.ok)
    .sort((a, b) => b.weight - a.weight || a._i - b._i)
    .map(({ _i, ...c }) => c);
}

function buildResult(checks) {
  const score = checks.reduce((acc, c) => acc + (c.ok ? c.weight : 0), 0);
  return { score, checks, missing: sortMissing(checks) };
}

/**
 * Score de un profesional.
 * input: { fotoUrl, bio, hasPricedService, hasCategory, barrio, hasAvailability }
 *  - hasPricedService: tiene ≥1 servicio con precio > 0
 *  - hasCategory:      categorías no vacías o profesión seteada
 *  - hasAvailability:  tiene slots libres a futuro o servicios activos
 */
function scoreProfessional(input = {}) {
  const checks = [
    {
      key: 'photo', label: 'una foto de perfil', cta: 'Subí una foto de perfil',
      weight: 20, ok: nonEmpty(input.fotoUrl),
    },
    {
      key: 'bio', label: 'una descripción de al menos 20 caracteres', cta: 'Escribí una descripción de al menos 20 caracteres',
      weight: 20, ok: typeof input.bio === 'string' && input.bio.trim().length >= BIO_MIN_LENGTH,
    },
    {
      key: 'service', label: 'al menos un servicio con precio', cta: 'Publicá al menos un servicio con precio',
      weight: 25, ok: Boolean(input.hasPricedService),
    },
    {
      key: 'category', label: 'tu categoría o profesión', cta: 'Elegí tu categoría o profesión',
      weight: 15, ok: Boolean(input.hasCategory),
    },
    {
      key: 'barrio', label: 'tu barrio', cta: 'Indicá tu barrio',
      weight: 10, ok: nonEmpty(input.barrio),
    },
    {
      key: 'availability', label: 'disponibilidad (turnos libres a futuro)', cta: 'Abrí turnos libres a futuro',
      weight: 10, ok: Boolean(input.hasAvailability),
    },
  ];
  return buildResult(checks);
}

/**
 * Score de un negocio.
 * input: { logoUrl, description, hasService, hasSchedule, addressOrBarrio }
 *  - hasService:       tiene ≥1 servicio
 *  - hasSchedule:      schedule no vacío (horario de atención cargado)
 *  - addressOrBarrio:  dirección o barrio cargados
 */
function scoreBusiness(input = {}) {
  const checks = [
    {
      key: 'logo', label: 'el logo o una foto del negocio', cta: 'Subí el logo o una foto del negocio',
      weight: 20, ok: nonEmpty(input.logoUrl),
    },
    {
      key: 'description', label: 'una descripción del negocio', cta: 'Escribí una descripción del negocio',
      weight: 20, ok: nonEmpty(input.description),
    },
    {
      key: 'service', label: 'al menos un servicio', cta: 'Publicá al menos un servicio',
      weight: 25, ok: Boolean(input.hasService),
    },
    {
      key: 'schedule', label: 'tu horario de atención', cta: 'Cargá tu horario de atención',
      weight: 20, ok: Boolean(input.hasSchedule),
    },
    {
      key: 'address', label: 'tu dirección o barrio', cta: 'Indicá tu dirección o barrio',
      weight: 15, ok: nonEmpty(input.addressOrBarrio),
    },
  ];
  return buildResult(checks);
}

module.exports = { scoreProfessional, scoreBusiness, BIO_MIN_LENGTH };
