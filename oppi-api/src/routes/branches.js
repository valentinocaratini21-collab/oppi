'use strict';

/**
 * Sucursales de un negocio (mejora 1).
 *
 * - GET /api/businesses/:id/branches — público: sucursales del negocio.
 * - POST /api/businesses/:id/branches — el dueño crea una sucursal.
 * - PATCH /api/branches/:id — el dueño la edita.
 * - DELETE /api/branches/:id — el dueño la elimina.
 *
 * Las reservas aceptan `branch_id` opcional (ver POST /api/bookings): se
 * valida que la sucursal pertenezca al negocio del servicio. Los comodines
 * y el indicador de cumplimiento no cambian: siguen siendo de la cuenta.
 */
const express = require('express');
const { queryAll, queryOne, run } = require('../db');
const { requireAuth } = require('../lib/auth');
const { ownBusiness } = require('./business');
const {
  getBusinessAccess, requireBusinessRole, businessIdFromParam,
} = require('../lib/team-access');

const router = express.Router();

function branchDto(b) {
  return {
    id: b.id, business_id: b.business_id, nombre: b.nombre,
    direccion: b.direccion || '', lat: b.lat ?? null, lng: b.lng ?? null,
    telefono: b.telefono || '', horario: b.horario || '',
  };
}

/** business_id de la sucursal :id (para el middleware de roles). */
async function businessIdFromBranch(req) {
  const br = await queryOne(req.db, 'SELECT business_id FROM branches WHERE id = ?', [req.params.id]);
  return br ? br.business_id : undefined;
}

/** Carga la sucursal y valida que el usuario sea admin del negocio (dueño o equipo admin). */
async function ownBranch(db, branchId, userId) {
  const branch = await queryOne(db, 'SELECT * FROM branches WHERE id = ?', [branchId]);
  if (!branch) return { error: 404 };
  const access = await getBusinessAccess(db, branch.business_id, userId);
  if (access.error) return { error: access.error };
  if (access.role !== 'admin') return { error: 403 };
  return { branch };
}

/** Valida lat/lng opcionales: ambos juntos o ninguno, y en rango. */
function parseBranchCoords(body) {
  const lat = body?.lat, lng = body?.lng;
  if (lat === undefined && lng === undefined) return { lat: null, lng: null };
  if (lat === undefined || lng === undefined) {
    return { error: 'Si pasás ubicación, tiene que venir lat y lng juntos.' };
  }
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
    return { error: 'Pasame una ubicación válida: lat (entre -90 y 90) y lng (entre -180 y 180).' };
  }
  return { lat: la, lng: ln };
}

// GET /api/businesses/:id/branches — público
router.get('/businesses/:id/branches', async (req, res) => {
  const b = await queryOne(req.db, 'SELECT id FROM businesses WHERE id = ?', [req.params.id]);
  if (!b) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  const rows = await queryAll(req.db, 'SELECT * FROM branches WHERE business_id = ? ORDER BY id', [b.id]);
  return res.json({ branches: rows.map(branchDto) });
});

// POST /api/businesses/:id/branches — solo admin del negocio
router.post('/businesses/:id/branches', requireAuth,
  requireBusinessRole({ read: 'admin', write: 'admin', businessId: businessIdFromParam }),
  async (req, res) => {
  const db = req.db;
  const business = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [req.params.id]);
  if (!business) return res.status(404).json({ error: 'No encontramos ese negocio.' });

  const { nombre, direccion, telefono, horario } = req.body || {};
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'La sucursal necesita un nombre (ej. "Sucursal Villa Morra").' });
  }
  const coords = parseBranchCoords(req.body);
  if (coords.error) return res.status(400).json({ error: coords.error });

  const r = await run(db,
    `INSERT INTO branches (business_id, nombre, direccion, lat, lng, telefono, horario)
     VALUES (?,?,?,?,?,?,?)`,
    [business.id, String(nombre).trim(), direccion || '', coords.lat, coords.lng,
     telefono || '', horario || '']);
  return res.status(201).json({ branch: branchDto(await queryOne(db, 'SELECT * FROM branches WHERE id = ?', [r.id])) });
});

// PATCH /api/branches/:id — solo admin del negocio de la sucursal
router.patch('/branches/:id', requireAuth,
  requireBusinessRole({
    read: 'admin', write: 'admin', businessId: businessIdFromBranch,
    onMissing: { status: 404, message: 'No encontramos esa sucursal.' },
  }),
  async (req, res) => {
  const db = req.db;
  const { branch, error } = await ownBranch(db, req.params.id, req.user.id);
  if (error === 404) return res.status(404).json({ error: 'No encontramos esa sucursal.' });
  if (error === 403) return res.status(403).json({ error: 'Solo el dueño del negocio puede editar sus sucursales.' });

  const { nombre, direccion, telefono, horario } = req.body || {};
  const nextNombre = nombre !== undefined ? String(nombre).trim() : branch.nombre;
  if (!nextNombre) {
    return res.status(400).json({ error: 'La sucursal necesita un nombre.' });
  }
  let lat = branch.lat, lng = branch.lng;
  if (req.body && (req.body.lat !== undefined || req.body.lng !== undefined)) {
    const coords = parseBranchCoords(req.body);
    if (coords.error) return res.status(400).json({ error: coords.error });
    lat = coords.lat; lng = coords.lng;
  }
  await run(db,
    'UPDATE branches SET nombre = ?, direccion = ?, lat = ?, lng = ?, telefono = ?, horario = ? WHERE id = ?',
    [nextNombre, direccion ?? branch.direccion, lat, lng,
     telefono ?? branch.telefono, horario ?? branch.horario, branch.id]);
  return res.json({ branch: branchDto(await queryOne(db, 'SELECT * FROM branches WHERE id = ?', [branch.id])) });
});

// DELETE /api/branches/:id — solo admin del negocio de la sucursal
router.delete('/branches/:id', requireAuth,
  requireBusinessRole({
    read: 'admin', write: 'admin', businessId: businessIdFromBranch,
    onMissing: { status: 404, message: 'No encontramos esa sucursal.' },
  }),
  async (req, res) => {
  const db = req.db;
  const { branch, error } = await ownBranch(db, req.params.id, req.user.id);
  if (error === 404) return res.status(404).json({ error: 'No encontramos esa sucursal.' });
  if (error === 403) return res.status(403).json({ error: 'Solo el dueño del negocio puede eliminar sus sucursales.' });

  // Las reservas que ya usaban esta sucursal quedan con branch_id en null
  // (se conserva el historial de la reserva, sin la sucursal).
  await run(db, 'UPDATE bookings SET branch_id = NULL WHERE branch_id = ?', [branch.id]);
  await run(db, 'DELETE FROM branches WHERE id = ?', [branch.id]);
  return res.json({ ok: true });
});

module.exports = router;
