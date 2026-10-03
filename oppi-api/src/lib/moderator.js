'use strict';

/**
 * Moderador — equipo IA de Oppi.
 *
 * Revisa el texto de cada reseña ANTES de publicarla y decide si sale
 * publicada directo ('aprobada') o si queda en cola de revisión humana
 * ('retenida'). Sin falsos positivos agresivos: ante la duda, se publica.
 *
 * // HOOK-LLM: acá se enchufaría un modelo de lenguaje para análisis de
 * sentimiento fino (casos grises: sarcasmo, ironía, reseñas ambiguas).
 */
const { queryOne } = require('../db');

// Frontera de palabra que funciona con tildes (JS \b no las reconoce).
const B = String.raw`(?:^|[^\p{L}])`;
const B2 = String.raw`(?:[^\p{L}]|$)`;

// Insultos por raíces, matcheo por palabra, case-insensitive.
// OJO: "boludo" NO es insulto en este contexto — es trato rioplatense.
const INSULTOS = new RegExp(
  `${B}(pelotud\\w*|imb[ée]cil\\w*|est[úu]pid\\w*|idiot\\w*|mog[óo]lic\\w*|mierda\\w*|hijo\\s+de\\s+puta)${B2}`,
  'iu'
);

// Spam: URLs o más de 1 número de teléfono con formato paraguayo (09xx xxx xxx).
const URL_RE = /(?:https?:\/\/|www\.)/i;
const PY_PHONE_RE = /\b09\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g;

// Rating bajo con palabras muy positivas.
const MUY_POSITIVAS = new RegExp(
  `${B}(excelente\\w*|genial\\w*|recomiend\\w*|perfect\\w*|incre[íi]ble\\w*|lo\\s+mejor)${B2}`,
  'iu'
);
// Rating alto con palabras muy negativas.
const MUY_NEGATIVAS = new RegExp(
  `${B}(horrible\\w*|p[ée]sim\\w*|nunca\\s+m[áa]s|estafa\\w*|terrible\\w*|desastre\\w*)${B2}`,
  'iu'
);

/** % de letras en mayúsculas (cuenta solo letras). */
function upperRatio(text) {
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (!letters) return 0;
  const upper = (text.match(/\p{Lu}/gu) || []).length;
  return upper / letters;
}

/**
 * moderateReview({rating, text, fromUserId, db})
 * → { decision: 'aprobada' | 'retenida', reasons: string[] }
 *
 * async por el chequeo de duplicados contra la base de datos.
 */
async function moderateReview({ rating, text, fromUserId, db }) {
  const reasons = [];
  const t = (text || '').trim();

  // 1. Vacía o muy corta con rating bajo → pedimos contexto, no castigo.
  if (t.length < 3 && rating <= 2) {
    reasons.push('Sin detalle: contanos qué pasó para poder ayudarte mejor.');
  }

  // 2. Insultos.
  if (INSULTOS.test(t)) {
    reasons.push('Detectamos lenguaje ofensivo en la reseña.');
  }

  // 3. Spam: URLs o más de 1 teléfono paraguayo.
  const phones = t.match(PY_PHONE_RE) || [];
  if (URL_RE.test(t) || phones.length > 1) {
    reasons.push('Detectamos posible spam (enlaces o números de teléfono).');
  }

  // 4. TODO EN MAYÚSCULAS: >60% de letras en mayúsculas y ≥ 12 caracteres.
  if (t.length >= 12 && upperRatio(t) > 0.6) {
    reasons.push('El texto está todo en mayúsculas, se ve poco creíble.');
  }

  // 5. Texto duplicado: el mismo texto ya existe (de cualquiera) → posible reseña falsa.
  if (t) {
    const dup = await queryOne(
      db,
      `SELECT id FROM reviews WHERE TRIM(text) = ? LIMIT 1`,
      [t]
    );
    if (dup) {
      reasons.push('Esta reseña es idéntica a otra ya publicada.');
    }
  }

  // 6. Incoherencia entre rating y texto.
  if (rating <= 2 && MUY_POSITIVAS.test(t)) {
    reasons.push('El puntaje bajo no coincide con un texto tan positivo.');
  }
  if (rating >= 4 && MUY_NEGATIVAS.test(t)) {
    reasons.push('El puntaje alto no coincide con un texto tan negativo.');
  }

  return reasons.length
    ? { decision: 'retenida', reasons }
    : { decision: 'aprobada', reasons: [] };
}

module.exports = { moderateReview };
