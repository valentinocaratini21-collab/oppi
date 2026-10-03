'use strict';

/**
 * Uploads: POST /api/uploads — subir una foto (tareas, chat).
 *
 * Dos formas (el cuerpo binario es lo más simple con curl):
 *  1. Binario:  Content-Type: image/jpeg (o png/webp/gif) + ?filename=foto.jpg
 *     curl -X POST --data-binary @foto.jpg \
 *       -H "Authorization: Bearer <token>" -H "Content-Type: image/jpeg" \
 *       "http://localhost:3000/api/uploads?filename=foto.jpg"
 *  2. JSON: { "filename": "foto.jpg", "data_url": "data:image/jpeg;base64,..." }
 *
 * Responde 201 { file: { url, key, filename, content_type, size_bytes } }.
 * La `url` se guarda en photos[] de la tarea/mensaje (mismo formato que antes).
 * Límite: 5 MB. Formatos: JPG, PNG, WEBP, GIF.
 */
const express = require('express');
const path = require('node:path');
const { requireAuth } = require('../lib/auth');
const { getStorageProvider, EXT_BY_TYPE } = require('../lib/storage');

const router = express.Router();

const MAX_BYTES = 5 * 1024 * 1024;

function safeFilename(name) {
  const base = path.basename(String(name || 'foto')).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return base || 'foto';
}

// POST /api/uploads
router.post('/uploads',
  requireAuth,
  express.raw({ type: ['image/*', 'application/octet-stream'], limit: '6mb' }),
  express.json({ limit: '7mb' }),
  async (req, res) => {
    let buffer = null;
    let filename = 'foto';
    let contentType = null;

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      buffer = req.body;
      filename = req.query.filename || 'foto';
      contentType = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    } else if (req.body && typeof req.body.data_url === 'string') {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(req.body.data_url.trim());
      if (!m) return res.status(400).json({ error: 'El data_url no es una imagen válida (usá data:image/jpeg;base64,...).' });
      contentType = m[1].toLowerCase();
      filename = req.body.filename || 'foto';
      try { buffer = Buffer.from(m[2].replace(/\s/g, ''), 'base64'); }
      catch { return res.status(400).json({ error: 'El base64 de la imagen no se pudo leer.' }); }
    } else {
      return res.status(400).json({ error: 'Mandá la imagen como cuerpo binario (image/jpeg, etc.) o como JSON { filename, data_url }.' });
    }

    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: 'La foto es muy pesada (máximo 5 MB). Probá con una más liviana.' });
    }
    if (!EXT_BY_TYPE[contentType]) {
      return res.status(400).json({ error: 'Formato no soportado: usá JPG, PNG, WEBP o GIF.' });
    }

    try {
      const storage = getStorageProvider();
      const { url, key } = await storage.save(buffer, { filename, contentType });
      return res.status(201).json({
        file: {
          url, key,
          filename: safeFilename(filename).replace(/\.(jpe?g|png|webp|gif)$/i, '') + EXT_BY_TYPE[contentType],
          content_type: contentType,
          size_bytes: buffer.length,
        },
      });
    } catch (err) {
      console.error('[uploads]', err.message);
      return res.status(500).json({ error: 'No pudimos guardar la foto. Probá de nuevo en un rato.' });
    }
  });

module.exports = router;
