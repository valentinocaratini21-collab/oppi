'use strict';

/**
 * Config pública: comisión y textos de "Cómo ganamos".
 */
const express = require('express');

const router = express.Router();

router.get('/config', async (req, res) => {
  res.json({
    commission_percent: 15,
    referral_bonus_gs: Number(process.env.REFERRAL_BONUS_GS || 20000),
    currency: 'Gs.',
    texts: {
      how_we_earn_title: 'Cómo gana Oppi',
      how_we_earn: [
        'Oppi cobra una comisión del 15% sobre cada reserva confirmada. El precio que ves publicado ya la incluye: nunca pagás de más.',
        'En el marketplace handyman, el cobro al aceptar una oferta también incluye la comisión del 15%.',
        'Los profesionales y negocios no pagan suscripción para publicar sus servicios.',
      ],
      payment_info: 'Pagás el 100% del total al confirmar. Si el profesional cancela, te lo devolvemos completo.',
    },
  });
});

module.exports = router;
