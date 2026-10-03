'use strict';

/**
 * Taxonomía pública de rubros (mejora 7).
 *
 * GET /api/taxonomy → { categories: [{ id, nombre, icono,
 *   professions: [{ id, nombre }], subcategories: [{ id, nombre }] }] }
 *
 * La tabla se siembra en la migración (src/db/taxonomy.js). Los profesionales
 * eligen su profession_id y los negocios su category_id en sus endpoints de
 * perfil (ver catalog.js y business.js).
 */
const express = require('express');
const { queryAll } = require('../db');

const router = express.Router();

// GET /api/taxonomy — público
router.get('/taxonomy', async (req, res) => {
  const db = req.db;
  const categories = await queryAll(db, 'SELECT * FROM categories ORDER BY id');
  const professions = await queryAll(db, 'SELECT * FROM professions ORDER BY category_id, id');
  const subcategories = await queryAll(db, 'SELECT * FROM subcategories ORDER BY category_id, id');
  const byCat = new Map(categories.map((c) => [c.id, {
    id: c.id, nombre: c.nombre, icono: c.icono || '',
    professions: [], subcategories: [],
  }]));
  for (const p of professions) {
    byCat.get(p.category_id)?.professions.push({ id: p.id, nombre: p.nombre });
  }
  for (const s of subcategories) {
    byCat.get(s.category_id)?.subcategories.push({ id: s.id, nombre: s.nombre });
  }
  return res.json({ categories: [...byCat.values()] });
});

module.exports = router;
