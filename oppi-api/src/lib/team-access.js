'use strict';

/**
 * Acceso por roles a los negocios (pieza "lista para lanzar" 6).
 *
 * Niveles (jerarquía):
 *   - admin:   todo (el dueño del negocio siempre es admin).
 *   - editor:  agenda + reservas + servicios. NO equipo, NO finanzas/ganancias.
 *   - lectura: solo lectura (únicamente métodos GET).
 *
 * El rol de un miembro vive en `team_members.permiso`. El vínculo con una
 * cuenta real es `team_members.user_id` (NULL = ficha sin acceso). La columna
 * `team_members.role` sigue siendo el cargo en texto libre (ej. "Estilista"):
 * si al crear/editar un miembro `role` coincide con un permiso válido y no se
 * pasó `permiso` explícito, se usa como permiso.
 */
const { queryOne } = require('../db');

const TEAM_PERMISOS = ['admin', 'editor', 'lectura'];
const TEAM_LEVELS = { lectura: 1, editor: 2, admin: 3 };

function isTeamPermiso(v) {
  return TEAM_PERMISOS.includes(v);
}

/**
 * Rol de acceso de un usuario sobre un negocio.
 * Devuelve { role: 'admin'|'editor'|'lectura' } o { error: 404|403 }.
 */
async function getBusinessAccess(db, businessId, userId) {
  const b = await queryOne(db, 'SELECT id, user_id FROM businesses WHERE id = ?', [businessId]);
  if (!b) return { error: 404 };
  if (b.user_id === userId) return { role: 'admin' };
  const m = await queryOne(db,
    'SELECT permiso FROM team_members WHERE business_id = ? AND user_id = ?', [businessId, userId]);
  if (!m) return { error: 403 };
  return { role: isTeamPermiso(m.permiso) ? m.permiso : 'lectura' };
}

/**
 * Rol de un usuario para ACTUAR sobre las reservas de un servicio del negocio
 * (confirmar, cancelar, no-show, reprogramar, avisar en camino): admin o
 * editor. Devuelve el rol o null.
 */
async function businessActingRole(db, service, userId) {
  if (!service || !service.business_id) return null;
  const access = await getBusinessAccess(db, service.business_id, userId);
  if (access.error) return null;
  return (access.role === 'admin' || access.role === 'editor') ? access.role : null;
}

/**
 * Rol de un usuario para LEER datos del negocio de un servicio (cualquier
 * miembro del equipo). Devuelve el rol o null.
 */
async function businessReadingRole(db, service, userId) {
  if (!service || !service.business_id) return null;
  const access = await getBusinessAccess(db, service.business_id, userId);
  return access.error ? null : access.role;
}

/** Resolutores de business_id para requireBusinessRole. */
const businessIdFromParam = async (req) => req.params.id;
const businessIdFromQuery = async (req) => req.query.business_id;
const businessIdFromBody = async (req) => (req.body ? req.body.business_id : undefined);
const businessIdFromTeamMember = async (req) => {
  const m = await queryOne(req.db, 'SELECT business_id FROM team_members WHERE id = ?', [req.params.id]);
  return m ? m.business_id : undefined;
};

/**
 * Middleware: exige un nivel de rol sobre el negocio.
 *   requireBusinessRole({ read, write, businessId })
 * - En GET se exige el nivel `read`; en otros métodos, el nivel `write`.
 * - `businessId` es un resolvedor async (req) => id.
 * - Si falta el id: 400 (o el onMissing dado, ej. 404 para /team/:id).
 * Deja el rol en req.businessRole.
 */
function requireBusinessRole({ read = 'lectura', write = 'admin', businessId = businessIdFromParam, onMissing } = {}) {
  return async (req, res, next) => {
    try {
      const id = await businessId(req);
      if (id === undefined || id === null || id === '') {
        const miss = onMissing || { status: 400, message: 'Falta el negocio.' };
        return res.status(miss.status).json({ error: miss.message });
      }
      const access = await getBusinessAccess(req.db, id, req.user.id);
      if (access.error === 404) return res.status(404).json({ error: 'No encontramos ese negocio.' });
      if (access.error === 403) return res.status(403).json({ error: 'No tenés acceso a este negocio.' });
      const need = req.method === 'GET' ? read : write;
      if (TEAM_LEVELS[access.role] < TEAM_LEVELS[need]) {
        return res.status(403).json({ error: 'Tu rol en este negocio no te permite hacer esto.' });
      }
      req.businessRole = access.role;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  TEAM_PERMISOS, TEAM_LEVELS, isTeamPermiso,
  getBusinessAccess, businessActingRole, businessReadingRole,
  requireBusinessRole,
  businessIdFromParam, businessIdFromQuery, businessIdFromBody, businessIdFromTeamMember,
};
