'use strict';

/**
 * Verificador — pre-chequeo automático de negocios y profesionales pendientes
 * de verificación (cola del panel admin, GET /api/admin/verifications).
 *
 * REGLA DURA: este módulo SOLO puntúa. No aprueba, no rechaza, no escribe en
 * la base, no dispara notificaciones. La decisión siempre la toma un humano
 * en el panel admin, con el score y los flags como insumo.
 *
 * Formato de salida (ambos prechecks):
 *   { score: 0-100, flags: [{ code, message, severity: 'alta'|'media'|'baja' }] }
 * El score arranca en 100 y resta 25 por flag alta, 10 por media, 5 por baja
 * (piso en 0).
 */

const DOC_TYPES_ESPERADOS = ['ruc', 'habilitacion', 'identidad'];

// RUC paraguayo: 6 a 9 dígitos + guión + dígito verificador (ej. 1234567-8).
const RUC_PY_RE = /^\d{6,9}-\d$/;

const PESO_SEVERIDAD = { alta: 25, media: 10, baja: 5 };

const MIN_ARCHIVO_BYTES = 5 * 1024;        // menos de 5KB → sospechosamente chico
const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024; // más de 10MB → muy pesado

const BIO_MIN_CHARS = 20;

function flag(code, message, severity) {
  return { code, message, severity };
}

function vacio(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function scoreDe(flags) {
  let score = 100;
  for (const f of flags) score -= PESO_SEVERIDAD[f.severity] || 0;
  return Math.max(0, score);
}

/**
 * Pre-chequeo de un negocio pendiente de verificación.
 * @param {object} business fila de `businesses` (name, ruc, barrio, address).
 * @param {object[]} documents filas de `business_documents` (type, file_url, file_size).
 */
function precheckBusiness(business, documents) {
  const b = business || {};
  const docs = Array.isArray(documents) ? documents : [];
  const flags = [];

  const porTipo = {};
  for (const d of docs) porTipo[d.type] = d;

  // 1. Tipos esperados presentes en el checklist.
  for (const t of DOC_TYPES_ESPERADOS) {
    if (!porTipo[t]) {
      flags.push(flag(
        `doc-faltante:${t}`,
        `Todavía no se agregó el documento de ${t} al checklist.`,
        'media',
      ));
    }
  }

  // 2. Estado del archivo de cada documento.
  for (const d of docs) {
    // HOOK-VISION: acá se enchufaría un modelo de visión para validar legibilidad del documento
    // (bajar el file_url y preguntarle al modelo si el documento se lee bien: datos visibles,
    //  sin recortes ni borrosidad). Mientras tanto, solo chequeamos presencia y tamaño.
    if (!d.file_url) {
      flags.push(flag(
        `doc-sin-archivo:${d.type}`,
        `Documento "${d.type}": todavía no subió el archivo.`,
        'alta',
      ));
      continue;
    }
    const size = d.file_size == null ? null : Number(d.file_size);
    if (size === null || size === 0) {
      flags.push(flag(
        `doc-vacio:${d.type}`,
        `Documento "${d.type}": el archivo parece vacío o corrupto.`,
        'alta',
      ));
    } else if (size < MIN_ARCHIVO_BYTES) {
      flags.push(flag(
        `doc-muy-chico:${d.type}`,
        `Documento "${d.type}": el archivo es muy chico, puede estar corrupto.`,
        'media',
      ));
    } else if (size > MAX_ARCHIVO_BYTES) {
      flags.push(flag(
        `doc-muy-pesado:${d.type}`,
        `Documento "${d.type}": el archivo es muy pesado.`,
        'baja',
      ));
    }
  }

  // 3. RUC paraguayo con formato válido.
  if (!RUC_PY_RE.test(String(b.ruc || '').trim())) {
    flags.push(flag(
      'ruc-formato-invalido',
      'RUC con formato inválido (se espera algo como 1234567-8).',
      'alta',
    ));
  }

  // 4. Completitud del registro.
  const campos = [
    ['name', 'el nombre del negocio'],
    ['barrio', 'el barrio'],
    ['address', 'la dirección'],
  ];
  for (const [campo, etiqueta] of campos) {
    if (vacio(b[campo])) {
      flags.push(flag(
        `campo-vacio:${campo}`,
        `Falta ${etiqueta} en el registro.`,
        'baja',
      ));
    }
  }

  return { score: scoreDe(flags), flags };
}

/**
 * Pre-chequeo de un profesional pendiente de verificación.
 * @param {object} user fila de `users` (name, foto_url).
 * @param {object} professional fila de `professionals` (bio, categories, profession_id).
 * @param {object[]} services filas de `services` del profesional (price_gs).
 */
function precheckProfessional(user, professional, services) {
  const u = user || {};
  const p = professional || {};
  const svcs = Array.isArray(services) ? services : [];
  const flags = [];

  // 1. Nombre presente (es la identidad mínima del perfil).
  if (vacio(u.name)) {
    flags.push(flag('nombre-faltante', 'Falta el nombre del profesional.', 'alta'));
  }

  // 2. Foto de perfil.
  if (vacio(u.foto_url)) {
    flags.push(flag('foto-faltante', 'Todavía no subió foto de perfil.', 'alta'));
  }

  // 3. Bio con contenido mínimo.
  if (String(p.bio || '').trim().length < BIO_MIN_CHARS) {
    flags.push(flag(
      'bio-corta',
      `La bio es muy corta o está vacía (menos de ${BIO_MIN_CHARS} caracteres).`,
      'media',
    ));
  }

  // 4. Categoría o profesión seteada.
  let categorias = [];
  try {
    categorias = typeof p.categories === 'string' ? JSON.parse(p.categories || '[]') : (p.categories || []);
  } catch { categorias = []; }
  if (!p.profession_id && !categorias.length) {
    flags.push(flag(
      'categoria-faltante',
      'No tiene categoría ni profesión seteada.',
      'media',
    ));
  }

  // 5. Al menos un servicio con precio > 0.
  const conPrecio = svcs.filter((s) => Number(s.price_gs) > 0);
  if (conPrecio.length === 0) {
    flags.push(flag(
      'servicios-sin-precio',
      'No tiene ningún servicio con precio cargado.',
      'alta',
    ));
  }

  return { score: scoreDe(flags), flags };
}

module.exports = {
  precheckBusiness,
  precheckProfessional,
  DOC_TYPES_ESPERADOS,
  RUC_PY_RE,
  MIN_ARCHIVO_BYTES,
  MAX_ARCHIVO_BYTES,
};
