'use strict';

/**
 * Oppi Empresas.
 *
 * Alta en 3 pasos (se aceptan juntos o progresivos en el mismo POST):
 *   1. datos del negocio (name, ruc, categories, barrio, address)
 *   2. servicios (services: [{name, price_gs, deposit_type, deposit_value}])
 *   3. horario (schedule: [{day, open, close}])
 * Al crearse queda con verification_status='pending'.
 *
 * Documentos como checklist de onboarding progresivo:
 *   POST /api/businesses/:id/documents {type} → crea el item en 'pending'.
 *   PATCH /api/businesses/:id/documents/:docId {status} → el negocio lo marca
 *   aprobado (simula la verificación; en producción lo aprueba un admin).
 *
 * Equipo: /api/team?business_id= — CRUD de miembros (solo el dueño).
 */
const express = require('express');
const { queryAll, queryOne, run, isUniqueViolation } = require('../db');
const { requireAuth } = require('../lib/auth');
const { validateDepositConfig } = require('../lib/deposit');
const { getEarnings, validatePeriodo } = require('../lib/earnings');
const { getClients, getStats, trackProfileView, visitorKeyFor } = require('../lib/stats');
const { optionalAuth } = require('../lib/auth');
const { geoParams, applyGeo, serviceDto, parseIncludes } = require('./catalog');
const {
  TEAM_PERMISOS, isTeamPermiso, getBusinessAccess, requireBusinessRole,
  businessIdFromParam, businessIdFromQuery, businessIdFromBody, businessIdFromTeamMember,
} = require('../lib/team-access');

const router = express.Router();
const safeJsonParse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

function businessDto(b) {
  return {
    id: b.id, user_id: b.user_id, name: b.name, ruc: b.ruc,
    categories: safeJsonParse(b.categories, []), verification_status: b.verification_status,
    // Taxonomía (mejora 7): category_id nullable; el nombre viene del join.
    category_id: b.category_id ?? null, category_name: b.category_name || null,
    barrio: b.barrio, address: b.address, schedule: safeJsonParse(b.schedule, []),
    lat: b.lat ?? null, lng: b.lng ?? null,
    // Política de cancelación y anticipación mínima (mejoras 2 y 1).
    cancel_free_hours: b.cancel_free_hours ?? 24,
    min_advance_hours: b.min_advance_hours ?? null,
  };
}

// SELECT compartido: negocio + nombre de su categoría (si tiene).
const BUSINESS_JOINS = 'LEFT JOIN categories c ON c.id = b.category_id';
const BUSINESS_FIELDS = 'b.*, c.nombre AS category_name';

async function ownBusiness(db, businessId, userId) {
  const b = await queryOne(db, `SELECT ${BUSINESS_FIELDS} FROM businesses b ${BUSINESS_JOINS} WHERE b.id = ?`, [businessId]);
  if (!b) return { error: 404 };
  if (b.user_id !== userId) return { error: 403 };
  return { business: b };
}

/** Valida un category_id opcional: null lo limpia; si viene, tiene que existir. */
async function validateCategoryId(db, category_id) {
  if (category_id === undefined || category_id === null) return { value: null };
  if (!Number.isInteger(category_id) || category_id <= 0) {
    return { error: 'La categoría no es válida.' };
  }
  const cat = await queryOne(db, 'SELECT id FROM categories WHERE id = ?', [category_id]);
  if (!cat) return { error: 'Esa categoría no existe en el catálogo.' };
  return { value: category_id };
}

// ---------- BUSINESSES ----------

// GET /api/businesses — público, ?barrio=&category=&lat=&lng=&radio_km=
// Con lat+lng: ordena por distancia (distance_km, 1 decimal) y filtra por radio.
router.get('/businesses', async (req, res) => {
  const { barrio, category } = req.query;
  const geo = geoParams(req.query);
  if (geo.error) return res.status(400).json({ error: geo.error });
  let sql = `SELECT ${BUSINESS_FIELDS} FROM businesses b ${BUSINESS_JOINS} WHERE 1=1`;
  const params = [];
  if (barrio) { sql += ' AND b.barrio LIKE ?'; params.push(`%${barrio}%`); }
  sql += ' ORDER BY b.name';
  let rows = await queryAll(req.db, sql, params);
  if (category) {
    const c = String(category).toLowerCase();
    rows = rows.filter((b) => safeJsonParse(b.categories, []).some((x) => String(x).toLowerCase().includes(c)));
  }
  if (geo.active) {
    const ranked = applyGeo(rows, geo, (b) => ({ lat: b.lat, lng: b.lng }));
    return res.json({
      businesses: ranked.map((x) => ({ ...businessDto(x.row), distance_km: x.distanceKm })),
    });
  }
  return res.json({ businesses: rows.map(businessDto) });
});

// POST /api/businesses — alta (rol business), verification_status = pending
router.post('/businesses', requireAuth, async (req, res) => {
  // Sin gate de rol: cualquier cuenta puede dar de alta su negocio (el registro
  // web no pide rol). Al crearlo, la cuenta pasa a rol 'business'.
  const { name, ruc, categories, category_id, barrio, address, services, schedule } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Poné el nombre de tu negocio.' });

  const db = req.db;
  const catV = await validateCategoryId(db, category_id);
  if (catV.error) return res.status(400).json({ error: catV.error });
  // Paso 2: validar servicios antes de crear nada.
  const svcList = services || [];
  for (const s of svcList) {
    if (!s.name || !Number.isInteger(s.price_gs) || s.price_gs <= 0) {
      return res.status(400).json({ error: 'Cada servicio necesita nombre y precio en guaraníes mayor a 0.' });
    }
    const err = validateDepositConfig(s);
    if (err) return res.status(400).json({ error: `Servicio "${s.name}": ${err}` });
    if (s.includes !== undefined && parseIncludes(s.includes) === null) {
      return res.status(400).json({ error: `Servicio "${s.name}": el campo "includes" tiene que ser una lista de textos.` });
    }
  }

  try {
    const r = await run(db,
      `INSERT INTO businesses (user_id, name, ruc, categories, category_id, barrio, address, schedule)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, name.trim(), ruc || '', JSON.stringify(categories || []), catV.value,
       barrio || '', address || '', JSON.stringify(schedule || [])]);
    const businessId = r.id;
    // Paso 2 (cont.): crear los servicios del negocio.
    for (const s of svcList) {
      await run(db,
        `INSERT INTO services (business_id, name, price_gs, deposit_type, deposit_value, photo_url, description, includes)
         VALUES (?,?,?,?,?,?,?,?)`,
        [businessId, s.name.trim(), s.price_gs, s.deposit_type || 'none', s.deposit_value ?? 0,
         s.photo_url || null, s.description || '', JSON.stringify(parseIncludes(s.includes))]);
    }
    const b = await queryOne(db, `SELECT ${BUSINESS_FIELDS} FROM businesses b ${BUSINESS_JOINS} WHERE b.id = ?`, [businessId]);
    const createdServices = (await queryAll(db, 'SELECT * FROM services WHERE business_id = ?', [businessId])).map(serviceDto);
    // La cuenta ahora es de negocio.
    await run(db, "UPDATE users SET role = 'business' WHERE id = ?", [req.user.id]);
    return res.status(201).json({ business: businessDto(b), services: createdServices });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Esta cuenta ya tiene un negocio dado de alta.' });
    }
    throw err;
  }
});

// GET /api/businesses/:id — público, con servicios, equipo, documentos y reseñas
router.get('/businesses/:id', async (req, res) => {
  const db = req.db;
  const b = await queryOne(db, `SELECT ${BUSINESS_FIELDS} FROM businesses b ${BUSINESS_JOINS} WHERE b.id = ?`, [req.params.id]);
  if (!b) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  const services = (await queryAll(db, 'SELECT * FROM services WHERE business_id = ?', [b.id])).map(serviceDto);
  const team = (await queryAll(db, 'SELECT * FROM team_members WHERE business_id = ?', [b.id]))
    .map((t) => ({ ...t, services: safeJsonParse(t.services, []) }));
  const documents = await queryAll(db, 'SELECT * FROM business_documents WHERE business_id = ?', [b.id]);
  const reviews = await queryAll(db,
    `SELECT r.*, u.name AS from_name FROM reviews r JOIN users u ON u.id = r.from_user
     WHERE r.to_user = ? ORDER BY r.created_at DESC`, [b.user_id]);
  return res.json({
    business: businessDto(b), services,
    team, documents,
    reviews: reviews.map((r) => ({
      id: r.id, from: r.from_name, rating: r.rating, text: r.text,
      photos: safeJsonParse(r.photos, []),
      reply_text: r.reply_text, reply_at: r.reply_at,
    })),
  });
});

// POST /api/businesses/:id/view — tracking de visitas al perfil (público).
// Cuenta 1 visita por día por visitante ('user:<id>' con sesión, 'ip:<ip>'
// sin sesión): los refreshes no inflan el contador.
// Devuelve { ok: true, counted }.
router.post('/businesses/:id/view', optionalAuth, async (req, res) => {
  const db = req.db;
  const b = await queryOne(db, 'SELECT id FROM businesses WHERE id = ?', [req.params.id]);
  if (!b) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  try {
    const { counted } = await trackProfileView(db, {
      profileType: 'business', profileId: b.id, visitorKey: visitorKeyFor(req),
    });
    return res.json({ ok: true, counted });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo registrar la visita.' });
  }
});

// PATCH /api/businesses/:id — solo admin del negocio (dueño o miembro admin)
router.patch('/businesses/:id', requireAuth,
  requireBusinessRole({ read: 'admin', write: 'admin', businessId: businessIdFromParam }),
  async (req, res) => {
  const db = req.db;
  const business = await queryOne(db, `SELECT ${BUSINESS_FIELDS} FROM businesses b ${BUSINESS_JOINS} WHERE b.id = ?`, [req.params.id]);
  if (!business) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  const { name, ruc, categories, category_id, barrio, address, schedule, cancel_free_hours, min_advance_hours } = req.body || {};
  // Política de cancelación: horas de anticipación para cancelar sin cargo.
  let newCancelFree = business.cancel_free_hours ?? 24;
  if (cancel_free_hours !== undefined) {
    if (!Number.isInteger(cancel_free_hours) || cancel_free_hours < 0) {
      return res.status(400).json({ error: 'Las horas de cancelación sin cargo tienen que ser un número entero mayor o igual a 0.' });
    }
    newCancelFree = cancel_free_hours;
  }
  // Anticipación mínima para reservar (null = sin mínimo).
  let newMinAdvance = business.min_advance_hours ?? null;
  if (min_advance_hours !== undefined) {
    if (min_advance_hours !== null && (!Number.isInteger(min_advance_hours) || min_advance_hours < 0)) {
      return res.status(400).json({ error: 'La anticipación mínima tiene que ser un número entero de horas mayor o igual a 0, o null para no exigirla.' });
    }
    newMinAdvance = min_advance_hours;
  }
  // Taxonomía (mejora 7).
  let newCategoryId = business.category_id ?? null;
  if (category_id !== undefined) {
    const catV = await validateCategoryId(db, category_id);
    if (catV.error) return res.status(400).json({ error: catV.error });
    newCategoryId = catV.value;
  }
  await run(db,
    `UPDATE businesses
     SET name = ?, ruc = ?, categories = ?, category_id = ?, barrio = ?, address = ?, schedule = ?,
         cancel_free_hours = ?, min_advance_hours = ?
     WHERE id = ?`,
    [name ?? business.name, ruc ?? business.ruc,
     JSON.stringify(categories ?? safeJsonParse(business.categories, [])),
     newCategoryId,
     barrio ?? business.barrio, address ?? business.address,
     JSON.stringify(schedule ?? safeJsonParse(business.schedule, [])),
     newCancelFree, newMinAdvance, business.id]);
  return res.json({ business: businessDto(await queryOne(db, `SELECT ${BUSINESS_FIELDS} FROM businesses b ${BUSINESS_JOINS} WHERE b.id = ?`, [business.id])) });
});

// ---------- CLIENTES (CRM derivado de reservas, mejora 4) ----------

// GET /api/businesses/:id/clients — clientes del negocio (admin o editor),
// derivados de las reservas de sus servicios.
// Cada item: { id, nombre, barrio, reservas_count, ultima_visita, gasto_total,
// rating_promedio_dado }.
router.get('/businesses/:id/clients', requireAuth,
  requireBusinessRole({ read: 'editor', write: 'admin', businessId: businessIdFromParam }),
  async (req, res) => {
  const db = req.db;
  const business = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [req.params.id]);
  if (!business) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  return res.json({
    clients: await getClients(db, {
      serviceWhere: 's.business_id = ?', serviceParams: [business.id], toUserId: business.user_id,
    }),
  });
});

// ---------- REPORTES (mejora 6) ----------

// GET /api/businesses/:id/stats?periodo=semana|mes — reporte del negocio
// (solo admin: son finanzas del negocio).
// { periodo, ingresos, reservas_count, top_servicios, clientes_nuevos,
//   clientes_recurrentes, conversion, conversion_pct, visitas_perfil,
//   response_time_median, top_staff, recurrent_pct }.
router.get('/businesses/:id/stats', requireAuth,
  requireBusinessRole({ read: 'admin', write: 'admin', businessId: businessIdFromParam }),
  async (req, res) => {
  const db = req.db;
  const business = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [req.params.id]);
  if (!business) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  try {
    // Usuarios que responden por el negocio: dueño + equipo con cuenta vinculada.
    const teamUsers = await queryAll(db,
      'SELECT user_id FROM team_members WHERE business_id = ? AND user_id IS NOT NULL',
      [business.id]);
    const providerUserIds = [business.user_id, ...teamUsers.map((t) => t.user_id)]
      .filter(Boolean);
    return res.json(await getStats(db, {
      periodo: req.query.periodo || 'mes',
      serviceWhere: 's.business_id = ?', serviceParams: [business.id],
      owner: {
        profileType: 'business', profileId: business.id,
        providerUserIds, businessId: business.id,
      },
    }));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo armar el reporte.' });
  }
});

// ---------- CANCELLATION HISTORY (nueva política) ----------

// GET /api/businesses/:id/cancellation-history — historial de cancelaciones,
// no-shows y reprogramaciones de los servicios del negocio (solo admin).
// Con ?format=csv devuelve un CSV descargable.
// Cada item: { id, fecha, tipo, detalle, servicio }.
// tipo: 'gratis' | 'tardia_comodin' | 'tardia_sin_comodin' | 'no_show' | 'reprogramacion'.
router.get('/businesses/:id/cancellation-history', requireAuth,
  requireBusinessRole({ read: 'admin', write: 'admin', businessId: businessIdFromParam }),
  async (req, res) => {
  const db = req.db;
  const business = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [req.params.id]);
  if (!business) return res.status(404).json({ error: 'No encontramos ese negocio.' });

  const rows = await queryAll(db,
    `SELECT b.id, b.status, b.free_cancel, b.wildcard_used, b.no_show_kind,
            b.cancel_reason, b.cancel_detail, b.cancelled_by, b.cancelled_at,
            b.reschedule_count, b.rescheduled_at, b.created_at,
            s.name AS service_name, u.name AS client_name
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN users u ON u.id = b.client_id
     WHERE s.business_id = ?
       AND (b.status IN ('cancelled', 'no_show_client', 'no_show_pro') OR b.reschedule_count > 0)
     ORDER BY COALESCE(b.cancelled_at, b.rescheduled_at, b.created_at) DESC`,
    [business.id]);

  const items = [];
  for (const r of rows) {
    if (r.no_show_kind) {
      items.push({
        id: r.id,
        fecha: r.cancelled_at || r.created_at,
        tipo: 'no_show',
        detalle: r.no_show_kind === 'client'
          ? `El cliente (${r.client_name}) no se presentó.`
          : 'El prestador no se presentó.',
        servicio: r.service_name,
      });
    } else if (r.status === 'cancelled') {
      const tipo = r.free_cancel ? 'gratis' : (r.wildcard_used ? 'tardia_comodin' : 'tardia_sin_comodin');
      const quien = r.cancelled_by === 'client' ? `el cliente (${r.client_name})`
        : r.cancelled_by === 'business' ? 'el negocio' : 'el profesional';
      const motivo = r.cancel_reason ? ` Motivo: ${r.cancel_reason}.` : '';
      items.push({
        id: r.id,
        fecha: r.cancelled_at || r.created_at,
        tipo,
        detalle: `Cancelada por ${quien}.${motivo}`,
        servicio: r.service_name,
      });
    }
    if ((r.reschedule_count || 0) > 0) {
      items.push({
        id: r.id,
        fecha: r.rescheduled_at || r.created_at,
        tipo: 'reprogramacion',
        detalle: `Reprogramada ${r.reschedule_count} ${Number(r.reschedule_count) === 1 ? 'vez' : 'veces'}.`,
        servicio: r.service_name,
      });
    }
  }

  if (req.query.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['id,fecha,tipo,detalle,servicio',
      ...items.map((i) => [i.id, i.fecha, i.tipo, i.detalle, i.servicio].map(esc).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="historial-cancelaciones-${business.id}.csv"`);
    return res.send(csv);
  }
  return res.json({ historial: items });
});

// ---------- EARNINGS ----------

// GET /api/business/earnings?periodo=semana|mes — ganancias del negocio
// (solo admin: dueño o miembro del equipo con permiso admin). Solo cuentan
// reservas completed dentro del período.
// semana = últimos 7 días, mes = últimos 30 días. Comisión fija: 15%.
router.get('/business/earnings', requireAuth, async (req, res) => {
  const periodo = req.query.periodo || 'mes';
  const periodoErr = validatePeriodo(periodo);
  if (periodoErr) return res.status(400).json({ error: periodoErr });
  const db = req.db;
  // Negocio propio o uno donde soy admin del equipo (el miembro puede no
  // tener rol 'business' en su cuenta).
  let business = await queryOne(db, 'SELECT * FROM businesses WHERE user_id = ?', [req.user.id]);
  if (!business) {
    business = await queryOne(db,
      `SELECT b.* FROM team_members t JOIN businesses b ON b.id = t.business_id
       WHERE t.user_id = ? AND t.permiso = 'admin' ORDER BY b.id LIMIT 1`,
      [req.user.id]);
  }
  if (!business) {
    // Se preserva el contrato anterior: 404 para rol business sin negocio,
    // 403 para otros roles.
    if (req.user.role === 'business') {
      return res.status(404).json({ error: 'Todavía no tenés un negocio dado de alta.' });
    }
    return res.status(403).json({ error: 'Tu cuenta no tiene permiso para ver estas ganancias.' });
  }
  return res.json(await getEarnings(db, {
    periodo, serviceWhere: 's.business_id = ?', serviceParams: [business.id],
  }));
});

// ---------- DOCUMENTS (checklist de onboarding) ----------

// GET /api/businesses/:id/documents — checklist (solo admin del negocio)
router.get('/businesses/:id/documents', requireAuth,
  requireBusinessRole({ read: 'admin', write: 'admin', businessId: businessIdFromParam }),
  async (req, res) => {
  return res.json({
    documents: await queryAll(req.db, 'SELECT * FROM business_documents WHERE business_id = ?', [req.params.id]),
  });
});

// POST /api/businesses/:id/documents {type, file_url?, file_size?} — subir/marcar un documento (queda pending)
router.post('/businesses/:id/documents', requireAuth,
  requireBusinessRole({ read: 'admin', write: 'admin', businessId: businessIdFromParam }),
  async (req, res) => {
  const { type, file_url, file_size } = req.body || {};
  if (!type) return res.status(400).json({ error: 'Indicá el tipo de documento (ruc, habilitacion, identidad...).' });
  let fileUrl = null;
  if (file_url !== undefined && file_url !== null && file_url !== '') {
    try {
      const u = new URL(String(file_url));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocolo');
      fileUrl = u.toString();
    } catch {
      return res.status(400).json({ error: 'El link del archivo (file_url) tiene que ser una URL http/https válida.' });
    }
  }
  let fileSize = null;
  if (file_size !== undefined && file_size !== null) {
    const n = Number(file_size);
    if (!Number.isInteger(n) || n < 0) {
      return res.status(400).json({ error: 'El tamaño del archivo (file_size) tiene que ser un entero ≥ 0.' });
    }
    fileSize = n;
  }
  const db = req.db;
  const business = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [req.params.id]);
  if (!business) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  try {
    const r = await run(db,
      'INSERT INTO business_documents (business_id, type, file_url, file_size) VALUES (?,?,?,?)',
      [business.id, type, fileUrl, fileSize]);
    return res.status(201).json({ document: await queryOne(db, 'SELECT * FROM business_documents WHERE id = ?', [r.id]) });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Ese documento ya está en tu checklist.' });
    throw err;
  }
});

// PATCH /api/businesses/:id/documents/:docId {status} — simula la verificación
// (solo admin del negocio)
router.patch('/businesses/:id/documents/:docId', requireAuth,
  requireBusinessRole({ read: 'admin', write: 'admin', businessId: businessIdFromParam }),
  async (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Estado no válido (pending, approved o rejected).' });
  }
  const db = req.db;
  const doc = await queryOne(db, 'SELECT * FROM business_documents WHERE id = ? AND business_id = ?',
    [req.params.docId, req.params.id]);
  if (!doc) return res.status(404).json({ error: 'No encontramos ese documento.' });
  // NOTA: en producción este cambio lo hace un admin/revisor de Oppi.
  // Acá el dueño lo simula para el onboarding progresivo.
  await run(db, 'UPDATE business_documents SET status = ? WHERE id = ?', [status, doc.id]);
  return res.json({ document: await queryOne(db, 'SELECT * FROM business_documents WHERE id = ?', [doc.id]) });
});

// ---------- TEAM ----------

function teamMemberDto(t) {
  return {
    id: t.id, business_id: t.business_id, user_id: t.user_id ?? null,
    name: t.name, role: t.role || '', permiso: t.permiso || 'lectura',
    services: safeJsonParse(t.services, []),
  };
}

/**
 * Resuelve el permiso de un miembro nuevo/editado.
 * - `permiso` explícito manda (validado).
 * - Si no viene y `role` es un permiso válido ('admin'|'editor'|'lectura'),
 *   se usa como permiso (compatibilidad con clientes que mandan role).
 * - Si no, default 'lectura' (mínimo privilegio).
 */
function resolvePermiso(body, current) {
  const { permiso, role } = body || {};
  if (permiso !== undefined) {
    if (!isTeamPermiso(permiso)) {
      return { error: 'El permiso tiene que ser admin, editor o lectura.' };
    }
    return { value: permiso };
  }
  if (isTeamPermiso(role)) return { value: role };
  return { value: current || 'lectura' };
}

/** Valida un user_id opcional para vincular la cuenta del miembro. */
async function resolveTeamUserId(db, user_id) {
  if (user_id === undefined || user_id === null) return { value: null };
  if (!Number.isInteger(user_id) || user_id <= 0) {
    return { error: 'El usuario a vincular no es válido.' };
  }
  const u = await queryOne(db, 'SELECT id, deleted_at FROM users WHERE id = ?', [user_id]);
  if (!u || u.deleted_at) return { error: 'No encontramos ese usuario para vincularlo al equipo.' };
  return { value: u.id };
}

// GET /api/team?business_id= — solo admin del negocio
router.get('/team', requireAuth,
  requireBusinessRole({ read: 'admin', write: 'admin', businessId: businessIdFromQuery }),
  async (req, res) => {
  const team = await queryAll(req.db, 'SELECT * FROM team_members WHERE business_id = ?', [req.query.business_id]);
  return res.json({ team: team.map(teamMemberDto) });
});

// POST /api/team {business_id, name, role, services[], user_id?, permiso?}
// Solo admin del negocio. `role` = cargo en texto libre; `permiso` = nivel de
// acceso (admin|editor|lectura).
router.post('/team', requireAuth,
  requireBusinessRole({ read: 'admin', write: 'admin', businessId: businessIdFromBody }),
  async (req, res) => {
  const { business_id, name, role, services } = req.body || {};
  if (!business_id || !name) return res.status(400).json({ error: 'Faltan el negocio y el nombre del integrante.' });
  const db = req.db;
  const business = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [business_id]);
  if (!business) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  const perm = resolvePermiso(req.body, null);
  if (perm.error) return res.status(400).json({ error: perm.error });
  const linked = await resolveTeamUserId(db, req.body.user_id);
  if (linked.error) return res.status(404).json({ error: linked.error });
  const r = await run(db,
    'INSERT INTO team_members (business_id, user_id, name, role, permiso, services) VALUES (?,?,?,?,?,?)',
    [business.id, linked.value, name.trim(), role || '', perm.value, JSON.stringify(services || [])]);
  const t = await queryOne(db, 'SELECT * FROM team_members WHERE id = ?', [r.id]);
  return res.status(201).json({ member: teamMemberDto(t) });
});

// PATCH /api/team/:id — solo admin del negocio
router.patch('/team/:id', requireAuth,
  requireBusinessRole({
    read: 'admin', write: 'admin', businessId: businessIdFromTeamMember,
    onMissing: { status: 404, message: 'No encontramos ese integrante.' },
  }),
  async (req, res) => {
  const db = req.db;
  const m = await queryOne(db, 'SELECT * FROM team_members WHERE id = ?', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'No encontramos ese integrante.' });
  const { name, role, services } = req.body || {};
  const perm = resolvePermiso(req.body, m.permiso);
  if (perm.error) return res.status(400).json({ error: perm.error });
  const linked = await resolveTeamUserId(db, req.body.user_id);
  if (linked.error) return res.status(404).json({ error: linked.error });
  await run(db, 'UPDATE team_members SET user_id = ?, name = ?, role = ?, permiso = ?, services = ? WHERE id = ?',
    [req.body.user_id === undefined ? m.user_id : linked.value,
     name ?? m.name, role ?? m.role, perm.value,
     JSON.stringify(services ?? safeJsonParse(m.services, [])), m.id]);
  const t = await queryOne(db, 'SELECT * FROM team_members WHERE id = ?', [m.id]);
  return res.json({ member: teamMemberDto(t) });
});

// DELETE /api/team/:id — solo admin del negocio
router.delete('/team/:id', requireAuth,
  requireBusinessRole({
    read: 'admin', write: 'admin', businessId: businessIdFromTeamMember,
    onMissing: { status: 404, message: 'No encontramos ese integrante.' },
  }),
  async (req, res) => {
  const db = req.db;
  const m = await queryOne(db, 'SELECT * FROM team_members WHERE id = ?', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'No encontramos ese integrante.' });
  await run(db, 'DELETE FROM team_members WHERE id = ?', [m.id]);
  return res.json({ ok: true });
});

module.exports = router;
module.exports.ownBusiness = ownBusiness;
module.exports.validateCategoryId = validateCategoryId;
