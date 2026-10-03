'use strict';

const express = require('express');
const { openDb, migrate } = require('./db');
const { getUploadsDir } = require('./lib/storage');

/**
 * Express 4 no propaga al middleware de errores los rechazos de promesas de
 * handlers async (la petición quedaría colgada). Envolvemos cada handler de
 * cada router una sola vez.
 */
function wrapAsync(router) {
  for (const layer of router.stack || []) {
    const route = layer.route;
    if (!route) continue;
    for (const s of route.stack) {
      if (s.handle.__oppiWrapped) continue;
      const orig = s.handle;
      const wrapped = (req, res, next) => Promise.resolve(orig(req, res, next)).catch(next);
      wrapped.__oppiWrapped = true;
      s.handle = wrapped;
    }
  }
  return router;
}

/** Crea la app Express. dbPath: archivo SQLite ('data/oppi.db') o ':memory:' (tests). Con DATABASE_URL se usa Postgres (dbPath se ignora). */
async function createApp({ dbPath } = {}) {
  const db = openDb(dbPath || ':memory:');
  await migrate(db);

  const app = express();
  // /api/uploads trae su propio parser (raw binario o JSON con data_url):
  // el parser JSON global no lo toca.
  app.use((req, res, next) => {
    if (req.path === '/api/uploads') return next();
    return express.json({ limit: '2mb' })(req, res, next);
  });
  // CORS mínimo: la web de Oppi se sirve desde otro origen (hosting estático,
  // file:// en desarrollo) y consume esta API con fetch + Authorization.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use((req, _res, next) => { req.db = db; next(); });

  // Archivos subidos (fotos de tareas y chat con STORAGE_DRIVER=local).
  app.use('/uploads', express.static(getUploadsDir(), { maxAge: '30d', immutable: true }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'oppi-api', version: '1.0.0' }));

  app.use('/api', wrapAsync(require('./routes/auth')));         // /api/auth/*, /api/me
  app.use('/api', wrapAsync(require('./routes/catalog')));       // professionals, services, slots, favorites
  app.use('/api', wrapAsync(require('./routes/bookings')));
  app.use('/api', wrapAsync(require('./routes/chat')));          // conversations, messages
  app.use('/api', wrapAsync(require('./routes/market')));        // tasks, offers, jobs
  app.use('/api', wrapAsync(require('./routes/reviews')));
  app.use('/api', wrapAsync(require('./routes/business')));      // businesses, documents, team
  app.use('/api', wrapAsync(require('./routes/branches')));      // sucursales (mejora 1)
  app.use('/api', wrapAsync(require('./routes/taxonomy')));      // taxonomía pública (mejora 7)
  app.use('/api', wrapAsync(require('./routes/coupons')));        // cupones de negocios
  app.use('/api', wrapAsync(require('./routes/waitlist')));
  app.use('/api', wrapAsync(require('./routes/referrals')));
  app.use('/api', wrapAsync(require('./routes/notifications')));
  app.use('/api', wrapAsync(require('./routes/uploads')));       // POST /api/uploads
  app.use('/api', wrapAsync(require('./routes/payments')));      // webhook de Bancard
  app.use('/api', wrapAsync(require('./routes/config')));
  app.use('/api/whatsapp', wrapAsync(require('./routes/whatsapp'))); // webhook de WhatsApp (soporte)
  app.use('/api', wrapAsync(require('./routes/support')));           // bandeja de soporte /api/support/*
  app.use('/api', wrapAsync(require('./routes/admin')));             // panel admin /api/admin/* (pieza 1)

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Esa ruta no existe.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[oppi-api]', err);
    res.status(500).json({ error: 'Algo falló de nuestro lado. Probá de nuevo en un rato.' });
  });

  return { app, db };
}

module.exports = { createApp };
