'use strict';

/**
 * Marketplace handyman: tareas, ofertas y jobs.
 *
 * - Cualquiera publica una tarea (flag urgent = "lo necesito hoy").
 * - Los handymans ofertan (POST /api/tasks/:id/offers, rol handyman).
 * - El cliente acepta UNA oferta (POST /api/offers/:id/accept):
 *   → crea el job, marca la tarea 'assigned', rechaza las demás ofertas y
 *   cobra el 100% del precio acordado vía el PaymentProvider
 *   (PAYMENT_DRIVER, default mock — ver src/lib/payments.js).
 */
const express = require('express');
const { queryAll, queryOne, run } = require('../db');
const { requireAuth } = require('../lib/auth');
const { geoParams, applyGeo } = require('./catalog');
const { getPaymentProvider, recordPayment, updatePaymentStatus, findPayment } = require('../lib/payments');
const { notify } = require('../lib/notifications');

const router = express.Router();
const safeJsonParse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

function taskDto(t, clientName) {
  return {
    id: t.id, client_id: t.client_id, client_name: clientName || null,
    title: t.title, description: t.description, category: t.category, barrio: t.barrio,
    lat: t.lat ?? null, lng: t.lng ?? null,
    price_min_gs: t.price_min_gs, price_max_gs: t.price_max_gs,
    urgent: Boolean(t.urgent), photos: safeJsonParse(t.photos, []),
    status: t.status, created_at: t.created_at,
  };
}

/** Valida las coords opcionales de una tarea: ambas juntas o ninguna, y en rango. */
function parseTaskCoords(body) {
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

// ---------- TASKS ----------

// GET /api/tasks — público, filtros ?urgent=1&category=&barrio=&status=&lat=&lng=&radio_km=
// Con lat+lng: cada tarea trae distance_km (1 decimal), se ordena por distancia
// ascendente (ante igual distancia, urgentes primero) y radio_km filtra fuera del
// radio (default 50 km). Sin coords: el orden y el contenido de siempre.
router.get('/tasks', async (req, res) => {
  const { urgent, category, barrio, status } = req.query;
  const geo = geoParams(req.query);
  if (geo.error) return res.status(400).json({ error: geo.error });
  let sql = `SELECT t.*, u.name AS client_name FROM tasks t JOIN users u ON u.id = t.client_id WHERE 1=1`;
  const params = [];
  if (urgent === '1' || urgent === 'true') sql += ' AND t.urgent = 1';
  if (category) { sql += ' AND t.category LIKE ?'; params.push(`%${category}%`); }
  if (barrio) { sql += ' AND t.barrio LIKE ?'; params.push(`%${barrio}%`); }
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  else { sql += " AND t.status = 'open'"; }
  sql += ' ORDER BY t.urgent DESC, t.created_at DESC';
  const rows = await queryAll(req.db, sql, params);
  if (geo.active) {
    const ranked = applyGeo(rows, geo, (r) => ({ lat: r.lat, lng: r.lng }));
    // A igual distancia, las urgentes ("lo necesito hoy") van primero.
    ranked.sort((a, b) => a.distanceKm - b.distanceKm || (b.row.urgent || 0) - (a.row.urgent || 0));
    return res.json({
      tasks: ranked.map((x) => ({ ...taskDto(x.row, x.row.client_name), distance_km: x.distanceKm })),
    });
  }
  return res.json({ tasks: rows.map((t) => taskDto(t, t.client_name)) });
});

// POST /api/tasks — publicar una tarea
router.post('/tasks', requireAuth, async (req, res) => {
  const { title, description, category, barrio, price_min_gs, price_max_gs, urgent, photos } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Contanos qué necesitás: poné un título.' });
  if (price_min_gs != null && price_max_gs != null && price_min_gs > price_max_gs) {
    return res.status(400).json({ error: 'El precio mínimo no puede ser mayor que el máximo.' });
  }
  const coords = parseTaskCoords(req.body);
  if (coords.error) return res.status(400).json({ error: coords.error });
  const db = req.db;
  const r = await run(db,
    `INSERT INTO tasks (client_id, title, description, category, barrio, lat, lng, price_min_gs, price_max_gs, urgent, photos)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [req.user.id, title.trim(), description || '', category || '', barrio || '',
     coords.lat, coords.lng,
     price_min_gs ?? null, price_max_gs ?? null, urgent ? 1 : 0, JSON.stringify(photos || [])]);
  const t = await queryOne(db, 'SELECT t.*, u.name AS client_name FROM tasks t JOIN users u ON u.id = t.client_id WHERE t.id = ?', [r.id]);
  return res.status(201).json({ task: taskDto(t, t.client_name) });
});

// GET /api/tasks/:id — con sus ofertas
router.get('/tasks/:id', async (req, res) => {
  const t = await queryOne(req.db,
    'SELECT t.*, u.name AS client_name FROM tasks t JOIN users u ON u.id = t.client_id WHERE t.id = ?',
    [req.params.id]);
  if (!t) return res.status(404).json({ error: 'No encontramos esa tarea.' });
  const offers = await queryAll(req.db,
    `SELECT o.*, u.name AS handyman_name FROM offers o JOIN users u ON u.id = o.handyman_id
     WHERE o.task_id = ? ORDER BY o.amount_gs ASC`, [t.id]);
  return res.json({ task: taskDto(t, t.client_name), offers });
});

// PATCH /api/tasks/:id — solo el cliente dueño (cambiar estado, editar)
router.patch('/tasks/:id', requireAuth, async (req, res) => {
  const db = req.db;
  const t = await queryOne(db, 'SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'No encontramos esa tarea.' });
  if (t.client_id !== req.user.id) return res.status(403).json({ error: 'Solo quien publicó la tarea puede editarla.' });
  const { title, description, category, barrio, price_min_gs, price_max_gs, urgent, status } = req.body || {};
  if (status && !['open', 'assigned', 'done', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Estado no válido.' });
  }
  await run(db,
    `UPDATE tasks SET title = ?, description = ?, category = ?, barrio = ?,
     price_min_gs = ?, price_max_gs = ?, urgent = ?, status = ? WHERE id = ?`,
    [title ?? t.title, description ?? t.description, category ?? t.category, barrio ?? t.barrio,
     price_min_gs ?? t.price_min_gs, price_max_gs ?? t.price_max_gs,
     urgent !== undefined ? (urgent ? 1 : 0) : t.urgent, status ?? t.status, t.id]);
  // Si la tarea se cancela con un job en curso, devolver el cobro.
  if (status === 'cancelled') {
    const job = await queryOne(db, 'SELECT * FROM jobs WHERE task_id = ? ORDER BY id DESC LIMIT 1', [t.id]);
    if (job) {
      const pay = await findPayment(db, 'job', job.id, 'captured');
      if (pay && pay.provider_payment_id) {
        try {
          await getPaymentProvider().refund(pay.provider_payment_id);
          await updatePaymentStatus(db, pay.id, 'refunded');
        } catch (err) {
          console.error(`[pagos] no se pudo devolver el cobro del job #${job.id}:`, err.message);
        }
      }
    }
  }
  const updated = await queryOne(db, 'SELECT t.*, u.name AS client_name FROM tasks t JOIN users u ON u.id = t.client_id WHERE t.id = ?', [t.id]);
  return res.json({ task: taskDto(updated, updated.client_name) });
});

// ---------- OFFERS ----------

// POST /api/tasks/:id/offers — ofertar. Abierto: cualquiera puede ofertar en una
// tarea ajena (marketplace: "cualquiera publica, cualquiera oferta"). Sin gate de
// rol: el rol 'handyman' se gana cuando te aceptan una oferta (ver accept).
router.post('/tasks/:id/offers', requireAuth, async (req, res) => {
  const db = req.db;
  const t = await queryOne(db, 'SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'No encontramos esa tarea.' });
  if (t.status !== 'open') return res.status(400).json({ error: 'Esa tarea ya no está abierta a ofertas.' });
  if (t.client_id === req.user.id) return res.status(400).json({ error: 'No podés ofertar en tu propia tarea.' });
  const { amount_gs, message } = req.body || {};
  if (!Number.isInteger(amount_gs) || amount_gs <= 0) {
    return res.status(400).json({ error: 'La oferta necesita un monto en guaraníes mayor a 0.' });
  }
  const r = await run(db, 'INSERT INTO offers (task_id, handyman_id, amount_gs, message) VALUES (?,?,?,?)',
    [t.id, req.user.id, amount_gs, message || '']);
  const handyman = await queryOne(db, 'SELECT name FROM users WHERE id = ?', [req.user.id]);
  await notify(db, {
    userId: t.client_id, type: 'offer',
    title: `💰 Nueva oferta en "${t.title}"`,
    body: `${handyman.name} ofertó Gs. ${amount_gs.toLocaleString('es-PY')}. Mirá todas las ofertas y elegí.`,
  });
  return res.status(201).json({ offer: await queryOne(db, 'SELECT * FROM offers WHERE id = ?', [r.id]) });
});

// GET /api/tasks/:id/offers — ofertas de una tarea (el dueño las ve todas)
router.get('/tasks/:id/offers', requireAuth, async (req, res) => {
  const db = req.db;
  const t = await queryOne(db, 'SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'No encontramos esa tarea.' });
  const rows = await queryAll(db,
    `SELECT o.*, u.name AS handyman_name FROM offers o JOIN users u ON u.id = o.handyman_id
     WHERE o.task_id = ? ORDER BY o.created_at DESC`, [t.id]);
  return res.json({ offers: rows });
});

// POST /api/offers/:id/accept — el cliente acepta → crea el job y cobra el 100%
router.post('/offers/:id/accept', requireAuth, async (req, res) => {
  const db = req.db;
  const offer = await queryOne(db, 'SELECT * FROM offers WHERE id = ?', [req.params.id]);
  if (!offer) return res.status(404).json({ error: 'No encontramos esa oferta.' });
  if (offer.status !== 'pending') return res.status(400).json({ error: 'Esa oferta ya fue respondida.' });
  const task = await queryOne(db, 'SELECT * FROM tasks WHERE id = ?', [offer.task_id]);
  if (task.client_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo quien publicó la tarea puede aceptar una oferta.' });
  }
  if (task.status !== 'open') return res.status(400).json({ error: 'Esa tarea ya no está abierta.' });

  const r = await run(db,
    `INSERT INTO jobs (task_id, offer_id, client_id, handyman_id, agreed_price_gs, status, paid_gs)
     VALUES (?,?,?,?,?,'quoting',?)`,
    [task.id, offer.id, task.client_id, offer.handyman_id, offer.amount_gs, offer.amount_gs]);
  await run(db, "UPDATE offers SET status = 'accepted' WHERE id = ?", [offer.id]);
  const rejected = await queryAll(db,
    "SELECT handyman_id FROM offers WHERE task_id = ? AND id != ? AND status = 'pending'",
    [task.id, offer.id]);
  await run(db, "UPDATE offers SET status = 'rejected' WHERE task_id = ? AND id != ? AND status = 'pending'",
    [task.id, offer.id]);
  await run(db, "UPDATE tasks SET status = 'assigned' WHERE id = ?", [task.id]);
  // El elegido pasa a tener rol 'handyman': el rol se gana trabajando, no se
  // elige al registrarse (el registro web no pide rol).
  await run(db, "UPDATE users SET role = 'handyman' WHERE id = ? AND role = 'client'",
    [offer.handyman_id]);

  // Cobrar el 100% del precio acordado con la pasarela (PAYMENT_DRIVER; default: mock).
  const provider = getPaymentProvider();
  let charge = null;
  try {
    charge = await provider.charge({
      amountGs: offer.amount_gs,
      description: `Trabajo "${task.title}"`,
      metadata: { task_id: task.id, offer_id: offer.id },
    });
  } catch (err) {
    console.error('[pagos] falló el cobro del job:', err.message);
    return res.status(502).json({ error: 'No pudimos cobrar con la pasarela de pago. Probá de nuevo en un rato.' });
  }
  await recordPayment(db, {
    referenceType: 'job', referenceId: r.id, provider: provider.name,
    providerPaymentId: charge.paymentId, kind: 'charge', amountGs: offer.amount_gs, status: charge.status,
  });

  const job = await queryOne(db, 'SELECT * FROM jobs WHERE id = ?', [r.id]);
  // Avisar al elegido y a los que quedaron afuera.
  await notify(db, {
    userId: offer.handyman_id, type: 'offer',
    title: '🎉 ¡Aceptaron tu oferta!',
    body: `Tu oferta de Gs. ${offer.amount_gs.toLocaleString('es-PY')} por "${task.title}" fue aceptada. Coordiná el trabajo por el chat.`,
  });
  for (const rej of rejected) {
    await notify(db, {
      userId: rej.handyman_id, type: 'offer',
      title: `Oferta no elegida: "${task.title}"`,
      body: 'El cliente eligió otra oferta esta vez. ¡Suerte en la próxima!',
    });
  }
  return res.status(201).json({ job });
});

// ---------- JOBS ----------

function jobVisible(db, job, userId) {
  return job.client_id === userId || job.handyman_id === userId;
}

// GET /api/jobs — mis trabajos (como cliente o handyman)
router.get('/jobs', requireAuth, async (req, res) => {
  const rows = await queryAll(req.db,
    `SELECT j.*, t.title AS task_title, uc.name AS client_name, uh.name AS handyman_name
     FROM jobs j JOIN tasks t ON t.id = j.task_id
     JOIN users uc ON uc.id = j.client_id JOIN users uh ON uh.id = j.handyman_id
     WHERE j.client_id = ? OR j.handyman_id = ? ORDER BY j.created_at DESC`,
    [req.user.id, req.user.id]);
  return res.json({ jobs: rows });
});

// GET /api/jobs/:id
router.get('/jobs/:id', requireAuth, async (req, res) => {
  const job = await queryOne(req.db, 'SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'No encontramos ese trabajo.' });
  if (!jobVisible(req.db, job, req.user.id)) return res.status(403).json({ error: 'Ese trabajo no es tuyo.' });
  return res.json({ job });
});

// PATCH /api/jobs/:id {status} — quoting → in_progress → completed (solo involucrados)
router.patch('/jobs/:id', requireAuth, async (req, res) => {
  const { status } = req.body || {};
  const db = req.db;
  const job = await queryOne(db, 'SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'No encontramos ese trabajo.' });
  if (!jobVisible(db, job, req.user.id)) return res.status(403).json({ error: 'Ese trabajo no es tuyo.' });

  const transitions = { quoting: ['in_progress'], in_progress: ['completed'] };
  if (!transitions[job.status] || !transitions[job.status].includes(status)) {
    return res.status(400).json({ error: `No se puede pasar de "${job.status}" a "${status || '?'}".` });
  }
  await run(db, 'UPDATE jobs SET status = ? WHERE id = ?', [status, job.id]);
  if (status === 'completed') {
    // El cobro ya se hizo al aceptar la oferta: no se mueve más plata.
    const task = await queryOne(db, 'SELECT title FROM tasks WHERE id = ?', [job.task_id]);
    await notify(db, {
      userId: job.client_id, type: 'job',
      title: `🏁 Trabajo completado: ${task ? task.title : ''}`.trim(),
      body: 'El trabajo se marcó como completado. ¡Dejá tu reseña para ayudar a la comunidad!',
    });
  }
  return res.json({ job: await queryOne(db, 'SELECT * FROM jobs WHERE id = ?', [job.id]) });
});

module.exports = router;
