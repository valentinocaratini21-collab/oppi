'use strict';

/**
 * Catálogo: profesionales, servicios, slots (turnos) y favoritos.
 * GET de profesionales/servicios/slots: público (sin login).
 * Escrituras: solo el dueño (profesional o negocio).
 */
const express = require('express');
const { queryAll, queryOne, run, isUniqueViolation } = require('../db');
const { requireAuth, requireRole } = require('../lib/auth');
const { validateDepositConfig } = require('../lib/deposit');
const { getEarnings, validatePeriodo } = require('../lib/earnings');
const { getClients, getStats, trackProfileView, visitorKeyFor } = require('../lib/stats');
const { optionalAuth } = require('../lib/auth');
const { getBusinessAccess } = require('../lib/team-access');

const router = express.Router();

const safeJsonParse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

/** Normaliza el campo `includes` de un servicio a array de strings. */
function parseIncludes(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null; // inválido
  return v.map((x) => String(x)).filter((x) => x.trim() !== '');
}

/** DTO de servicio: expone el detalle (mejora 2) con `includes` parseado. */
function serviceDto(s) {
  return {
    id: s.id, professional_id: s.professional_id ?? null, business_id: s.business_id ?? null,
    name: s.name, price_gs: s.price_gs, deposit_type: s.deposit_type, deposit_value: s.deposit_value,
    photo_url: s.photo_url || null, description: s.description || '',
    includes: safeJsonParse(s.includes, []),
  };
}

/** Valida un profession_id opcional: null lo limpia; si viene, tiene que existir. */
async function validateProfessionId(db, profession_id) {
  if (profession_id === undefined || profession_id === null) return { value: null };
  if (!Number.isInteger(profession_id) || profession_id <= 0) {
    return { error: 'La profesión no es válida.' };
  }
  const p = await queryOne(db, 'SELECT id FROM professions WHERE id = ?', [profession_id]);
  if (!p) return { error: 'Esa profesión no existe en el catálogo.' };
  return { value: profession_id };
}

/** Distancia haversiana en km entre dos puntos (lat/lng en grados). */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad((lat2 - lat1) / 2)) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad((lng2 - lng1) / 2)) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Lee los query params de geolocalización. Devuelve:
 *  - { active: false } si no hay ningún param geo (comportamiento anterior),
 *  - { active: true, lat, lng, radioKm } si lat+lng son válidos,
 *  - { active: false, error } si vinieron pero están mal → responder 400.
 */
function geoParams(query) {
  const { lat, lng, radio_km } = query || {};
  if (lat === undefined && lng === undefined && radio_km === undefined) return { active: false };
  const la = Number(lat);
  const ln = Number(lng);
  if (lat === undefined || lng === undefined || !Number.isFinite(la) || !Number.isFinite(ln)
      || la < -90 || la > 90 || ln < -180 || ln > 180) {
    return { active: false, error: 'Pasame una ubicación válida: lat (entre -90 y 90) y lng (entre -180 y 180).' };
  }
  let radioKm = 50;
  if (radio_km !== undefined) {
    radioKm = Number(radio_km);
    if (!Number.isFinite(radioKm) || radioKm <= 0) {
      return { active: false, error: 'El radio tiene que ser un número mayor a 0 (en km).' };
    }
  }
  return { active: true, lat: la, lng: ln, radioKm };
}

/**
 * Calcula la distancia de cada fila, filtra las que están dentro del radio y
 * ordena por distancia ascendente. Devuelve [{ row, distanceKm }] con
 * distanceKm redondeado a 1 decimal. Las filas sin coordenadas quedan afuera.
 */
function applyGeo(rows, geo, getLatLng) {
  return rows
    .map((row) => {
      const c = getLatLng(row);
      if (c.lat == null || c.lng == null) return null;
      const distanceKm = Math.round(haversineKm(geo.lat, geo.lng, Number(c.lat), Number(c.lng)) * 10) / 10;
      return { row, distanceKm };
    })
    .filter((x) => x && x.distanceKm <= geo.radioKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function publicProfessional(row) {
  return {
    id: row.id, user_id: row.user_id, name: row.user_name, bio: row.bio,
    categories: safeJsonParse(row.categories, []), rating: row.rating,
    // Taxonomía (mejora 7): profession_id nullable; el nombre viene del join.
    profession_id: row.profession_id ?? null, profession_name: row.profession_name || null,
    verified: Boolean(row.verified), barrio: row.barrio,
    lat: row.lat ?? null, lng: row.lng ?? null,
  };
}

// SELECT compartido: profesional + nombre de su profesión (si tiene).
const PRO_JOINS = 'LEFT JOIN professions pr ON pr.id = p.profession_id';
const PRO_FIELDS = 'p.*, u.name AS user_name, pr.nombre AS profession_name';
const proSelectFrom = () => `SELECT ${PRO_FIELDS} FROM professionals p JOIN users u ON u.id = p.user_id ${PRO_JOINS}`;

// ---------- PROFESSIONALS ----------

// GET /api/professionals — público, filtros ?category=&barrio=&q=&lat=&lng=&radio_km=
// Con lat+lng: ordena por distancia (distance_km, 1 decimal) y filtra por radio.
router.get('/professionals', async (req, res) => {
  const { category, barrio, q } = req.query;
  const geo = geoParams(req.query);
  if (geo.error) return res.status(400).json({ error: geo.error });
  let sql = `${proSelectFrom()} WHERE 1=1`;
  const params = [];
  if (barrio) { sql += ' AND p.barrio LIKE ?'; params.push(`%${barrio}%`); }
  if (q) { sql += ' AND (u.name LIKE ? OR p.bio LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY p.rating DESC';
  let rows = await queryAll(req.db, sql, params);
  if (category) {
    const c = String(category).toLowerCase();
    rows = rows.filter((r) => safeJsonParse(r.categories, []).some((x) => String(x).toLowerCase().includes(c)));
  }
  if (geo.active) {
    const ranked = applyGeo(rows, geo, (r) => ({ lat: r.lat, lng: r.lng }));
    return res.json({
      professionals: ranked.map((x) => ({ ...publicProfessional(x.row), distance_km: x.distanceKm })),
    });
  }
  return res.json({ professionals: rows.map(publicProfessional) });
});

// GET /api/search — búsqueda unificada de profesionales.
// ?q=&rubro=&lat=&lng=&radio_km=&min_price=&max_price=&disponibilidad=&orden=
//  - min_price/max_price: filtran por precio de los servicios (el profesional
//    tiene que tener al menos un servicio dentro del rango).
//  - disponibilidad: hoy | manana | semana — solo profesionales con al menos
//    un turno libre en el rango.
//  - orden: relevancia | precio_asc | precio_desc | rating | distancia.
//    Default: distancia si hay geo, relevancia (rating) si no.
// Con lat+lng: incluye distance_km (1 decimal) y filtra por radio; sin geo,
// orden=distancia da 400.
router.get('/search', async (req, res) => {
  const { q, rubro, min_price, max_price, disponibilidad, orden } = req.query;
  const geo = geoParams(req.query);
  if (geo.error) return res.status(400).json({ error: geo.error });

  // Validar filtros numéricos / enumerados (mensajes en voseo).
  let minPrice = null, maxPrice = null;
  if (min_price !== undefined) {
    minPrice = Number(min_price);
    if (!Number.isFinite(minPrice) || minPrice < 0) {
      return res.status(400).json({ error: 'El precio mínimo tiene que ser un número mayor o igual a 0.' });
    }
  }
  if (max_price !== undefined) {
    maxPrice = Number(max_price);
    if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
      return res.status(400).json({ error: 'El precio máximo tiene que ser un número mayor a 0.' });
    }
  }
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    return res.status(400).json({ error: 'El precio mínimo no puede ser mayor que el máximo.' });
  }
  const DISPONIBILIDADES = ['hoy', 'manana', 'semana'];
  if (disponibilidad && !DISPONIBILIDADES.includes(disponibilidad)) {
    return res.status(400).json({ error: 'La disponibilidad tiene que ser "hoy", "manana" o "semana".' });
  }
  const ORDENES = ['relevancia', 'precio_asc', 'precio_desc', 'rating', 'distancia'];
  if (orden && !ORDENES.includes(orden)) {
    return res.status(400).json({ error: 'El orden tiene que ser relevancia, precio_asc, precio_desc, rating o distancia.' });
  }
  const ordenFinal = orden || (geo.active ? 'distancia' : 'relevancia');
  if (ordenFinal === 'distancia' && !geo.active) {
    return res.status(400).json({ error: 'Para ordenar por distancia pasame tu ubicación (lat y lng).' });
  }

  let sql = `${proSelectFrom()} WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND (u.name LIKE ? OR p.bio LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY p.rating DESC';
  let rows = await queryAll(req.db, sql, params);
  if (rubro) {
    const r = String(rubro).toLowerCase();
    rows = rows.filter((x) => safeJsonParse(x.categories, []).some((c) => String(c).toLowerCase().includes(r)));
  }
  if (rows.length === 0) return res.json({ results: [] });

  // Precios: precio mínimo de cada profesional (para filtrar y ordenar).
  const ids = rows.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');
  const priceRows = await queryAll(req.db,
    `SELECT professional_id, MIN(price_gs) AS min_price, MAX(price_gs) AS max_price
     FROM services WHERE professional_id IN (${placeholders}) GROUP BY professional_id`,
    ids);
  const priceByPro = new Map(priceRows.map((r) =>
    [Number(r.professional_id), { min: Number(r.min_price), max: Number(r.max_price) }]));

  if (minPrice !== null || maxPrice !== null) {
    rows = rows.filter((r) => {
      const pr = priceByPro.get(Number(r.id));
      if (!pr) return false;
      if (minPrice !== null && pr.max < minPrice) return false;
      if (maxPrice !== null && pr.min > maxPrice) return false;
      return true;
    });
  }

  // Disponibilidad: profesionales con al menos un turno libre en el rango.
  if (disponibilidad) {
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const startD = new Date();
    const endD = new Date();
    if (disponibilidad === 'manana') {
      startD.setDate(startD.getDate() + 1);
      endD.setDate(endD.getDate() + 1);
    } else if (disponibilidad === 'semana') {
      endD.setDate(endD.getDate() + 6);
    }
    const slotRows = await queryAll(req.db,
      `SELECT DISTINCT professional_id FROM slots
       WHERE status = 'free' AND date >= ? AND date <= ?`,
      [fmt(startD), fmt(endD)]);
    const withSlots = new Set(slotRows.map((s) => Number(s.professional_id)));
    rows = rows.filter((r) => withSlots.has(Number(r.id)));
  }

  const priceMinOf = (r) => priceByPro.get(Number(r.id))?.min ?? null;
  const sorters = {
    relevancia: (a, b) => (b.rating || 0) - (a.rating || 0),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    precio_asc: (a, b) => {
      const pa = priceMinOf(a), pb = priceMinOf(b);
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    },
    precio_desc: (a, b) => {
      const pa = priceMinOf(a), pb = priceMinOf(b);
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pb - pa;
    },
    distancia: null, // lo maneja applyGeo
  };

  const withPrice = (row) => ({ ...publicProfessional(row), precio_desde: priceMinOf(row) });

  if (geo.active) {
    const ranked = applyGeo(rows, geo, (x) => ({ lat: x.lat, lng: x.lng }));
    let list = ranked.map((x) => ({ ...withPrice(x.row), distance_km: x.distanceKm }));
    if (ordenFinal !== 'distancia') {
      const sorter = sorters[ordenFinal];
      // Ordenar estable por el criterio pedido (mantiene distancia como desempate).
      list = list
        .map((item, i) => ({ item, i }))
        .sort((a, b) => sorter(a.item, b.item) || a.i - b.i)
        .map(({ item }) => item);
    }
    return res.json({ results: list });
  }
  rows.sort(sorters[ordenFinal]);
  return res.json({ results: rows.map(withPrice) });
});

// POST /api/professionals — crear mi perfil (rol pro)
router.post('/professionals', requireAuth, async (req, res) => {
  if (req.user.role !== 'pro') {
    return res.status(403).json({ error: 'Solo una cuenta de profesional puede crear este perfil.' });
  }
  const { bio, categories, barrio, profession_id } = req.body || {};
  const profV = await validateProfessionId(req.db, profession_id);
  if (profV.error) return res.status(400).json({ error: profV.error });
  try {
    const r = await run(req.db,
      'INSERT INTO professionals (user_id, bio, categories, barrio, profession_id) VALUES (?,?,?,?,?)',
      [req.user.id, bio || '', JSON.stringify(categories || []), barrio || '', profV.value]);
    const row = await queryOne(req.db, `${proSelectFrom()} WHERE p.id = ?`, [r.id]);
    return res.status(201).json({ professional: publicProfessional(row) });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Ya tenés un perfil de profesional creado.' });
    throw err;
  }
});

// GET /api/professionals/:id — público, incluye reseñas con respuestas
router.get('/professionals/:id', async (req, res) => {
  const row = await queryOne(req.db,
    `${proSelectFrom()} WHERE p.id = ?`,
    [req.params.id]);
  if (!row) return res.status(404).json({ error: 'No encontramos ese profesional.' });
  const reviews = await queryAll(req.db,
    `SELECT r.*, u.name AS from_name FROM reviews r JOIN users u ON u.id = r.from_user
     WHERE r.to_user = (SELECT user_id FROM professionals WHERE id = ?) ORDER BY r.created_at DESC`,
    [req.params.id]);
  return res.json({
    professional: publicProfessional(row),
    reviews: reviews.map((r) => ({
      id: r.id, from: r.from_name, rating: r.rating, text: r.text,
      photos: safeJsonParse(r.photos, []),
      reply_text: r.reply_text, reply_at: r.reply_at, created_at: r.created_at,
    })),
  });
});

// POST /api/professionals/:id/view — tracking de visitas al perfil (público).
// Cuenta 1 visita por día por visitante ('user:<id>' con sesión, 'ip:<ip>'
// sin sesión): los refreshes no inflan el contador.
// Devuelve { ok: true, counted }.
router.post('/professionals/:id/view', optionalAuth, async (req, res) => {
  const db = req.db;
  const pro = await queryOne(db, 'SELECT id FROM professionals WHERE id = ?', [req.params.id]);
  if (!pro) return res.status(404).json({ error: 'No encontramos ese profesional.' });
  try {
    const { counted } = await trackProfileView(db, {
      profileType: 'professional', profileId: pro.id, visitorKey: visitorKeyFor(req),
    });
    return res.json({ ok: true, counted });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo registrar la visita.' });
  }
});

// PATCH /api/professionals/:id — solo el dueño
router.patch('/professionals/:id', requireAuth, async (req, res) => {
  const pro = await queryOne(req.db, 'SELECT * FROM professionals WHERE id = ?', [req.params.id]);
  if (!pro) return res.status(404).json({ error: 'No encontramos ese profesional.' });
  if (pro.user_id !== req.user.id) return res.status(403).json({ error: 'Solo el dueño del perfil puede editarlo.' });
  const { bio, categories, barrio, profession_id } = req.body || {};
  let professionId = pro.profession_id ?? null;
  if (profession_id !== undefined) {
    const profV = await validateProfessionId(req.db, profession_id);
    if (profV.error) return res.status(400).json({ error: profV.error });
    professionId = profV.value;
  }
  await run(req.db, 'UPDATE professionals SET bio = ?, categories = ?, barrio = ?, profession_id = ? WHERE id = ?',
    [bio ?? pro.bio, JSON.stringify(categories ?? safeJsonParse(pro.categories, [])), barrio ?? pro.barrio, professionId, pro.id]);
  const row = await queryOne(req.db, `${proSelectFrom()} WHERE p.id = ?`, [pro.id]);
  return res.json({ professional: publicProfessional(row) });
});

// GET /api/pro/earnings?periodo=semana|mes — ganancias del profesional propio
// (rol pro). Solo cuentan reservas completed de SUS servicios dentro del período.
// semana = últimos 7 días, mes = últimos 30 días. Comisión fija: 15%.
router.get('/pro/earnings', requireAuth, requireRole('pro'), async (req, res) => {
  const periodo = req.query.periodo || 'mes';
  const periodoErr = validatePeriodo(periodo);
  if (periodoErr) return res.status(400).json({ error: periodoErr });
  const db = req.db;
  const pro = await queryOne(db, 'SELECT * FROM professionals WHERE user_id = ?', [req.user.id]);
  if (!pro) return res.status(404).json({ error: 'Todavía no tenés un perfil de profesional creado.' });
  return res.json(await getEarnings(db, {
    periodo, serviceWhere: 's.professional_id = ?', serviceParams: [pro.id],
  }));
});

// ---------- CLIENTES (CRM derivado de reservas, mejora 4) ----------

// GET /api/pro/clients — mis clientes (rol pro), derivados de mis reservas.
// Cada item: { id, nombre, barrio, reservas_count, ultima_visita, gasto_total,
// rating_promedio_dado }.
router.get('/pro/clients', requireAuth, requireRole('pro'), async (req, res) => {
  const db = req.db;
  const pro = await queryOne(db, 'SELECT * FROM professionals WHERE user_id = ?', [req.user.id]);
  if (!pro) return res.status(404).json({ error: 'Todavía no tenés un perfil de profesional creado.' });
  return res.json({
    clients: await getClients(db, {
      serviceWhere: 's.professional_id = ?', serviceParams: [pro.id], toUserId: pro.user_id,
    }),
  });
});

// ---------- REPORTES (mejora 6) ----------

// GET /api/pro/stats?periodo=semana|mes — reporte del profesional propio.
// { periodo, ingresos, reservas_count, top_servicios, clientes_nuevos,
//   clientes_recurrentes, conversion, conversion_pct, visitas_perfil,
//   response_time_median, top_staff: null, recurrent_pct }.
router.get('/pro/stats', requireAuth, requireRole('pro'), async (req, res) => {
  const db = req.db;
  const pro = await queryOne(db, 'SELECT * FROM professionals WHERE user_id = ?', [req.user.id]);
  if (!pro) return res.status(404).json({ error: 'Todavía no tenés un perfil de profesional creado.' });
  try {
    return res.json(await getStats(db, {
      periodo: req.query.periodo || 'mes',
      serviceWhere: 's.professional_id = ?', serviceParams: [pro.id],
      owner: {
        profileType: 'professional', profileId: pro.id,
        providerUserIds: [pro.user_id],
      },
    }));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo armar el reporte.' });
  }
});

// ---------- SERVICES ----------

async function serviceOwnerUserId(db, service) {
  if (service.professional_id) {
    const p = await queryOne(db, 'SELECT user_id FROM professionals WHERE id = ?', [service.professional_id]);
    return p ? p.user_id : null;
  }
  if (service.business_id) {
    const b = await queryOne(db, 'SELECT user_id FROM businesses WHERE id = ?', [service.business_id]);
    return b ? b.user_id : null;
  }
  return null;
}

// GET /api/services — público, filtros ?professional_id=&business_id=
router.get('/services', async (req, res) => {
  const { professional_id, business_id } = req.query;
  let sql = 'SELECT * FROM services WHERE 1=1';
  const params = [];
  if (professional_id) { sql += ' AND professional_id = ?'; params.push(professional_id); }
  if (business_id) { sql += ' AND business_id = ?'; params.push(business_id); }
  const rows = await queryAll(req.db, sql, params);
  return res.json({ services: rows.map(serviceDto) });
});

// POST /api/services — el profesional crea servicios propios; el negocio los suyos.
// Acepta el detalle del servicio (mejora 2): photo_url, description, includes[].
router.post('/services', requireAuth, async (req, res) => {
  const { professional_id, business_id, name, price_gs, deposit_type, deposit_value,
    photo_url, description, includes } = req.body || {};
  if (!name || !Number.isInteger(price_gs) || price_gs <= 0) {
    return res.status(400).json({ error: 'El servicio necesita un nombre y un precio en guaraníes mayor a 0.' });
  }
  const depositErr = validateDepositConfig({ price_gs, deposit_type, deposit_value });
  if (depositErr) return res.status(400).json({ error: depositErr });
  const includesArr = parseIncludes(includes);
  if (includesArr === null) {
    return res.status(400).json({ error: 'El campo "includes" tiene que ser una lista de textos (qué incluye el servicio).' });
  }

  const db = req.db;
  if (professional_id) {
    const pro = await queryOne(db, 'SELECT * FROM professionals WHERE id = ?', [professional_id]);
    if (!pro) return res.status(404).json({ error: 'No encontramos ese profesional.' });
    if (pro.user_id !== req.user.id) return res.status(403).json({ error: 'Solo el profesional puede crear sus servicios.' });
  } else if (business_id) {
    const biz = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [business_id]);
    if (!biz) return res.status(404).json({ error: 'No encontramos ese negocio.' });
    // Roles en empresas (pieza 6): admin y editor pueden crear servicios;
    // lectura no.
    const access = await getBusinessAccess(db, business_id, req.user.id);
    if (access.error === 404) return res.status(404).json({ error: 'No encontramos ese negocio.' });
    if (access.error === 403) return res.status(403).json({ error: 'Solo el negocio puede crear sus servicios.' });
    if (access.role === 'lectura') {
      return res.status(403).json({ error: 'Tu rol en este negocio es de solo lectura: no podés crear servicios.' });
    }
  } else {
    return res.status(400).json({ error: 'Indicá a qué profesional o negocio pertenece el servicio.' });
  }

  const r = await run(db,
    `INSERT INTO services (professional_id, business_id, name, price_gs, deposit_type, deposit_value,
                           photo_url, description, includes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [professional_id || null, business_id || null, name.trim(), price_gs,
     deposit_type || 'none', deposit_value ?? 0,
     photo_url || null, description || '', JSON.stringify(includesArr)]);
  return res.status(201).json({ service: serviceDto(await queryOne(db, 'SELECT * FROM services WHERE id = ?', [r.id])) });
});

// PATCH /api/services/:id — solo el dueño; revalida la seña.
// También edita el detalle: photo_url, description, includes[].
// En servicios de un negocio, admin y editor del equipo pueden editar;
// lectura no.
router.patch('/services/:id', requireAuth, async (req, res) => {
  const db = req.db;
  const svc = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [req.params.id]);
  if (!svc) return res.status(404).json({ error: 'No encontramos ese servicio.' });
  if (svc.business_id) {
    const access = await getBusinessAccess(db, svc.business_id, req.user.id);
    if (access.error || access.role === 'lectura') {
      return res.status(403).json({ error: 'Solo el negocio puede editar este servicio.' });
    }
  } else if (await serviceOwnerUserId(db, svc) !== req.user.id) {
    return res.status(403).json({ error: 'Solo el dueño puede editar este servicio.' });
  }
  const next = {
    name: req.body?.name ?? svc.name,
    price_gs: req.body?.price_gs ?? svc.price_gs,
    deposit_type: req.body?.deposit_type ?? svc.deposit_type,
    deposit_value: req.body?.deposit_value ?? svc.deposit_value,
    photo_url: req.body?.photo_url !== undefined ? (req.body.photo_url || null) : svc.photo_url,
    description: req.body?.description ?? svc.description,
  };
  if (!next.name || !Number.isInteger(next.price_gs) || next.price_gs <= 0) {
    return res.status(400).json({ error: 'El servicio necesita un nombre y un precio en guaraníes mayor a 0.' });
  }
  const depositErr = validateDepositConfig(next);
  if (depositErr) return res.status(400).json({ error: depositErr });
  let includesArr = safeJsonParse(svc.includes, []);
  if (req.body?.includes !== undefined) {
    includesArr = parseIncludes(req.body.includes);
    if (includesArr === null) {
      return res.status(400).json({ error: 'El campo "includes" tiene que ser una lista de textos (qué incluye el servicio).' });
    }
  }
  await run(db,
    `UPDATE services SET name = ?, price_gs = ?, deposit_type = ?, deposit_value = ?,
                        photo_url = ?, description = ?, includes = ? WHERE id = ?`,
    [next.name, next.price_gs, next.deposit_type, next.deposit_value,
     next.photo_url, next.description, JSON.stringify(includesArr), svc.id]);
  return res.json({ service: serviceDto(await queryOne(db, 'SELECT * FROM services WHERE id = ?', [svc.id])) });
});

// DELETE /api/services/:id — solo el dueño (en negocios: admin o editor)
router.delete('/services/:id', requireAuth, async (req, res) => {
  const db = req.db;
  const svc = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [req.params.id]);
  if (!svc) return res.status(404).json({ error: 'No encontramos ese servicio.' });
  if (svc.business_id) {
    const access = await getBusinessAccess(db, svc.business_id, req.user.id);
    if (access.error || access.role === 'lectura') {
      return res.status(403).json({ error: 'Solo el negocio puede eliminar este servicio.' });
    }
  } else if (await serviceOwnerUserId(db, svc) !== req.user.id) {
    return res.status(403).json({ error: 'Solo el dueño puede eliminar este servicio.' });
  }
  await run(db, 'DELETE FROM services WHERE id = ?', [svc.id]);
  return res.json({ ok: true });
});

// ---------- SLOTS ----------

// GET /api/slots — público, ?professional_id=&date=
router.get('/slots', async (req, res) => {
  const { professional_id, date } = req.query;
  let sql = 'SELECT * FROM slots WHERE 1=1';
  const params = [];
  if (professional_id) { sql += ' AND professional_id = ?'; params.push(professional_id); }
  if (date) { sql += ' AND date = ?'; params.push(date); }
  sql += ' ORDER BY date, time';
  return res.json({ slots: await queryAll(req.db, sql, params) });
});

// POST /api/slots — el profesional publica sus turnos
router.post('/slots', requireAuth, async (req, res) => {
  const { professional_id, date, time } = req.body || {};
  if (!professional_id || !date || !time) {
    return res.status(400).json({ error: 'Pasame el profesional, la fecha (AAAA-MM-DD) y la hora (HH:MM).' });
  }
  const db = req.db;
  const pro = await queryOne(db, 'SELECT * FROM professionals WHERE id = ?', [professional_id]);
  if (!pro) return res.status(404).json({ error: 'No encontramos ese profesional.' });
  if (pro.user_id !== req.user.id) return res.status(403).json({ error: 'Solo el profesional puede publicar sus turnos.' });
  try {
    const r = await run(db, 'INSERT INTO slots (professional_id, date, time) VALUES (?,?,?)',
      [professional_id, date, time]);
    return res.status(201).json({ slot: await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [r.id]) });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Ese turno ya existe.' });
    throw err;
  }
});

// DELETE /api/slots/:id — solo el dueño y si está libre
router.delete('/slots/:id', requireAuth, async (req, res) => {
  const db = req.db;
  const slot = await queryOne(db, 'SELECT * FROM slots WHERE id = ?', [req.params.id]);
  if (!slot) return res.status(404).json({ error: 'No encontramos ese turno.' });
  const pro = await queryOne(db, 'SELECT * FROM professionals WHERE id = ?', [slot.professional_id]);
  if (!pro || pro.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo el profesional puede eliminar sus turnos.' });
  }
  if (slot.status !== 'free') return res.status(400).json({ error: 'Ese turno ya está reservado, no se puede eliminar.' });
  await run(db, 'DELETE FROM slots WHERE id = ?', [slot.id]);
  return res.json({ ok: true });
});

// ---------- FAVORITES ----------

// GET /api/favorites — mis favoritos
router.get('/favorites', requireAuth, async (req, res) => {
  const rows = await queryAll(req.db,
    `SELECT p.*, u.name AS user_name, pr.nombre AS profession_name FROM favorites f
     JOIN professionals p ON p.id = f.professional_id JOIN users u ON u.id = p.user_id
     LEFT JOIN professions pr ON pr.id = p.profession_id
     WHERE f.client_id = ?`, [req.user.id]);
  return res.json({ favorites: rows.map(publicProfessional) });
});

// POST /api/favorites {professional_id}
router.post('/favorites', requireAuth, async (req, res) => {
  const { professional_id } = req.body || {};
  if (!professional_id) return res.status(400).json({ error: 'Falta el profesional.' });
  const pro = await queryOne(req.db, 'SELECT id FROM professionals WHERE id = ?', [professional_id]);
  if (!pro) return res.status(404).json({ error: 'No encontramos ese profesional.' });
  try {
    await run(req.db, 'INSERT INTO favorites (client_id, professional_id) VALUES (?,?)',
      [req.user.id, professional_id]);
    return res.status(201).json({ ok: true });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Ya lo tenés en favoritos.' });
    throw err;
  }
});

// DELETE /api/favorites/:professional_id
router.delete('/favorites/:professional_id', requireAuth, async (req, res) => {
  const r = await run(req.db, 'DELETE FROM favorites WHERE client_id = ? AND professional_id = ?',
    [req.user.id, req.params.professional_id]);
  if (r.changes === 0) return res.status(404).json({ error: 'No estaba en tus favoritos.' });
  return res.json({ ok: true });
});

module.exports = router;
module.exports.serviceOwnerUserId = serviceOwnerUserId;
module.exports.haversineKm = haversineKm;
module.exports.geoParams = geoParams;
module.exports.applyGeo = applyGeo;
module.exports.serviceDto = serviceDto;
module.exports.parseIncludes = parseIncludes;
module.exports.validateProfessionId = validateProfessionId;
