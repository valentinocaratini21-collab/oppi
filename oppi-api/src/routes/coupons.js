'use strict';

/**
 * Cupones de descuento para negocios (Oppi Empresas).
 *
 * Solo el dueño del negocio puede crearlos, listarlos y pausarlos.
 *
 *  - GET   /api/businesses/:id/coupons — lista los cupones del negocio.
 *  - POST  /api/businesses/:id/coupons {code, type, value, max_uses?, valid_from?, valid_until?}
 *          → crea un cupón (el código se guarda en mayúsculas, único por negocio).
 *  - PATCH /api/coupons/:id {active: 0|1} — pausa o activa el cupón.
 *  - POST  /api/coupons/validate {code, business_id, service_id}
 *          → { valid, discount_gs, coupon } o { valid: false, error }.
 *          Valida: que exista, esté activo, vigente, con usos restantes y que
 *          el servicio pertenezca al negocio.
 *
 * La aplicación al reservar vive en routes/bookings.js (coupon_code opcional
 * en POST /api/bookings): el descuento se aplica al total y la seña se
 * calcula sobre el total CON descuento.
 */
const express = require('express');
const { queryAll, queryOne, run, isUniqueViolation } = require('../db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
const CODE_RE = /^[A-Z0-9]{4,20}$/;
// Fecha AAAA-MM-DD o fecha+hora "AAAA-MM-DD HH:MM[:SS]".
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

function couponDto(c) {
  return {
    id: c.id, business_id: c.business_id, code: c.code, type: c.type, value: c.value,
    max_uses: c.max_uses ?? null, used_count: c.used_count, active: Boolean(c.active),
    valid_from: c.valid_from || null, valid_until: c.valid_until || null,
    created_at: c.created_at,
  };
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Dueño del negocio o {error: 404|403}. */
async function ownBusiness(db, businessId, userId) {
  const b = await queryOne(db, 'SELECT * FROM businesses WHERE id = ?', [businessId]);
  if (!b) return { error: 404 };
  if (b.user_id !== userId) return { error: 403 };
  return { business: b };
}

/** Dueño del negocio dueño del cupón o {error: 404|403}. */
async function ownCoupon(db, couponId, userId) {
  const c = await queryOne(db, 'SELECT * FROM coupons WHERE id = ?', [couponId]);
  if (!c) return { error: 404 };
  return ownBusiness(db, c.business_id, userId).then((r) => ({ ...r, coupon: c }));
}

/** Normaliza una fecha de vigencia: "AAAA-MM-DD" → día completo. */
function normalizeDate(input, isEnd) {
  const s = String(input || '').trim().replace('T', ' ');
  if (!DATE_RE.test(s)) return { error: 'La vigencia tiene que ser AAAA-MM-DD o AAAA-MM-DD HH:MM.' };
  const d = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return { error: 'Esa fecha de vigencia no es válida.' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { value: isEnd ? `${s} 23:59:59` : `${s} 00:00:00` };
  }
  return { value: s.length <= 16 ? `${s}:00` : s };
}

/**
 * Valida un cupón para un servicio. Uso compartido por
 * POST /api/coupons/validate y POST /api/bookings.
 * @returns { ok: true, coupon, discount_gs } | { ok: false, error }
 */
async function validateCoupon(db, { code, businessId, serviceId }) {
  const normalized = normalizeCode(code);
  if (!normalized || !businessId || !serviceId) {
    return { ok: false, error: 'Faltan el código, el negocio o el servicio.' };
  }
  const service = await queryOne(db, 'SELECT * FROM services WHERE id = ?', [serviceId]);
  if (!service) return { ok: false, error: 'No encontramos ese servicio.' };
  if (service.business_id == null) {
    return { ok: false, error: 'Los cupones solo se pueden usar en servicios de un negocio.' };
  }
  if (Number(service.business_id) !== Number(businessId)) {
    return { ok: false, error: 'Ese servicio no pertenece a este negocio.' };
  }
  const coupon = await queryOne(db,
    'SELECT * FROM coupons WHERE business_id = ? AND code = ?', [businessId, normalized]);
  if (!coupon) return { ok: false, error: `El cupón "${normalized}" no existe.` };
  if (!coupon.active) return { ok: false, error: 'Ese cupón está pausado.' };
  const now = nowStr();
  if (coupon.valid_from && coupon.valid_from > now) {
    return { ok: false, error: 'Ese cupón todavía no está vigente.' };
  }
  if (coupon.valid_until && coupon.valid_until < now) {
    return { ok: false, error: 'Ese cupón ya venció.' };
  }
  if (coupon.max_uses != null && Number(coupon.used_count) >= Number(coupon.max_uses)) {
    return { ok: false, error: 'Ese cupón ya se usó todas las veces permitidas.' };
  }
  const price = service.price_gs;
  const discountGs = coupon.type === 'percent'
    ? Math.round((price * coupon.value) / 100)
    : Math.min(Number(coupon.value), price);
  return { ok: true, coupon, discount_gs: discountGs };
}

// GET /api/businesses/:id/coupons — lista (solo el dueño)
router.get('/businesses/:id/coupons', requireAuth, async (req, res) => {
  const { business, error } = await ownBusiness(req.db, req.params.id, req.user.id);
  if (error === 404) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  if (error === 403) return res.status(403).json({ error: 'Solo el dueño ve los cupones.' });
  const rows = await queryAll(req.db,
    'SELECT * FROM coupons WHERE business_id = ? ORDER BY created_at DESC', [business.id]);
  return res.json({ coupons: rows.map(couponDto) });
});

// POST /api/businesses/:id/coupons — crear (solo el dueño)
router.post('/businesses/:id/coupons', requireAuth, async (req, res) => {
  const { business, error } = await ownBusiness(req.db, req.params.id, req.user.id);
  if (error === 404) return res.status(404).json({ error: 'No encontramos ese negocio.' });
  if (error === 403) return res.status(403).json({ error: 'Solo el dueño crea cupones.' });
  const { code, type, value, max_uses, valid_from, valid_until } = req.body || {};

  const normalized = normalizeCode(code);
  if (!CODE_RE.test(normalized)) {
    return res.status(400).json({ error: 'El código tiene que tener entre 4 y 20 letras o números (sin espacios ni símbolos).' });
  }
  if (!['percent', 'fixed'].includes(type)) {
    return res.status(400).json({ error: 'El tipo tiene que ser percent o fixed.' });
  }
  if (!Number.isInteger(value) || value <= 0) {
    return res.status(400).json({ error: 'El valor del cupón tiene que ser un número entero mayor a 0.' });
  }
  if (type === 'percent' && value > 90) {
    return res.status(400).json({ error: 'El descuento en porcentaje no puede pasar el 90%.' });
  }
  let maxUses = null;
  if (max_uses != null && max_uses !== '') {
    if (!Number.isInteger(max_uses) || max_uses < 1) {
      return res.status(400).json({ error: 'El máximo de usos tiene que ser un número entero mayor a 0 (o vacío para ilimitado).' });
    }
    maxUses = max_uses;
  }
  let from = null, until = null;
  if (valid_from) {
    const n = normalizeDate(valid_from, false);
    if (n.error) return res.status(400).json({ error: n.error });
    from = n.value;
  }
  if (valid_until) {
    const n = normalizeDate(valid_until, true);
    if (n.error) return res.status(400).json({ error: n.error });
    until = n.value;
  }
  if (from && until && from > until) {
    return res.status(400).json({ error: 'La fecha de inicio no puede ser posterior a la de fin.' });
  }

  try {
    const r = await run(req.db,
      `INSERT INTO coupons (business_id, code, type, value, max_uses, valid_from, valid_until)
       VALUES (?,?,?,?,?,?,?)`,
      [business.id, normalized, type, value, maxUses, from, until]);
    const created = await queryOne(req.db, 'SELECT * FROM coupons WHERE id = ?', [r.id]);
    return res.status(201).json({ coupon: couponDto(created) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Ya tenés un cupón con ese código.' });
    }
    throw err;
  }
});

// PATCH /api/coupons/:id {active: 0|1} — pausar/activar (solo el dueño)
router.patch('/coupons/:id', requireAuth, async (req, res) => {
  const { active } = req.body || {};
  if (active !== 0 && active !== 1) {
    return res.status(400).json({ error: 'active tiene que ser 0 o 1.' });
  }
  const db = req.db;
  const { coupon, error } = await ownCoupon(db, req.params.id, req.user.id);
  if (error === 404) return res.status(404).json({ error: 'No encontramos ese cupón.' });
  if (error === 403) return res.status(403).json({ error: 'Solo el dueño gestiona los cupones.' });
  await run(db, 'UPDATE coupons SET active = ? WHERE id = ?', [active, coupon.id]);
  return res.json({ coupon: couponDto(await queryOne(db, 'SELECT * FROM coupons WHERE id = ?', [coupon.id])) });
});

// POST /api/coupons/validate {code, business_id, service_id} — pública:
// cualquier cliente puede chequear su cupón antes de reservar.
router.post('/coupons/validate', async (req, res) => {
  const { code, business_id, service_id } = req.body || {};
  const v = await validateCoupon(req.db, { code, businessId: business_id, serviceId: service_id });
  if (!v.ok) return res.json({ valid: false, error: v.error });
  return res.json({
    valid: true,
    discount_gs: v.discount_gs,
    coupon: { code: v.coupon.code, type: v.coupon.type, value: v.coupon.value },
  });
});

module.exports = router;
module.exports.validateCoupon = validateCoupon;
module.exports.couponDto = couponDto;
