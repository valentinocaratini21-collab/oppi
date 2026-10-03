'use strict';

/**
 * Referidos: cada usuario tiene un código único (se crea con la cuenta).
 * Al canjear un código válido: +Gs. 20.000 de crédito para quien canjea.
 *
 * Reglas (validadas en la API):
 *  - el código tiene que existir → 400
 *  - no podés canjear tu propio código (sin auto-canje) → 400
 *  - no podés canjear dos veces el mismo código → 400
 *  - el código tiene un tope de usos (max_uses) → 400 si se agotó
 */
const express = require('express');
const { queryAll, queryOne, run } = require('../db');
const { requireAuth } = require('../lib/auth');
const { notify } = require('../lib/notifications');

const router = express.Router();
const REFERRAL_BONUS_GS = Number(process.env.REFERRAL_BONUS_GS || 20000);

// GET /api/referrals — mis códigos y cuántos usos llevan
router.get('/referrals', requireAuth, async (req, res) => {
  const rows = await queryAll(req.db, 'SELECT code, max_uses, uses FROM referrals WHERE owner_user_id = ?',
    [req.user.id]);
  return res.json({ referrals: rows, bonus_gs: REFERRAL_BONUS_GS });
});

// POST /api/referrals/redeem {code}
router.post('/referrals/redeem', requireAuth, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Pasame el código de referido.' });
  const db = req.db;
  const ref = await queryOne(db, 'SELECT * FROM referrals WHERE code = ?', [String(code).trim().toUpperCase()]);
  if (!ref) {
    return res.status(400).json({ error: 'Ese código no existe. Revisalo e intentá de nuevo.' });
  }
  if (ref.owner_user_id === req.user.id) {
    return res.status(400).json({ error: 'No podés usar tu propio código de referido.' });
  }
  if (await queryOne(db, 'SELECT id FROM referral_redemptions WHERE code = ? AND user_id = ?',
    [ref.code, req.user.id])) {
    return res.status(400).json({ error: 'Ya usaste ese código antes.' });
  }
  if (ref.uses >= ref.max_uses) {
    return res.status(400).json({ error: 'Ese código ya llegó a su límite de usos.' });
  }

  await run(db, 'INSERT INTO referral_redemptions (code, user_id) VALUES (?,?)', [ref.code, req.user.id]);
  await run(db, 'UPDATE referrals SET uses = uses + 1 WHERE id = ?', [ref.id]);
  await run(db, 'UPDATE users SET credit_gs = credit_gs + ? WHERE id = ?', [REFERRAL_BONUS_GS, req.user.id]);
  // Avisar al dueño del código que alguien usó su referido.
  const redeemer = await queryOne(db, 'SELECT name FROM users WHERE id = ?', [req.user.id]);
  await notify(db, {
    userId: ref.owner_user_id, type: 'referral',
    title: '🎁 ¡Usaron tu código de referido!',
    body: `${redeemer.name} se unió con tu código ${ref.code}. ¡Seguí compartiéndolo!`,
  });

  const user = await queryOne(db, 'SELECT credit_gs FROM users WHERE id = ?', [req.user.id]);
  return res.json({
    ok: true,
    bonus_gs: REFERRAL_BONUS_GS,
    credit_gs: user.credit_gs,
    message: `¡Listo! Sumaste Gs. ${REFERRAL_BONUS_GS.toLocaleString('es-PY')} de crédito para tus próximas reservas.`,
  });
});

module.exports = router;
module.exports.REFERRAL_BONUS_GS = REFERRAL_BONUS_GS;
