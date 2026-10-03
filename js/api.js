/* ============================================================================
 * Oppi — Capa de datos (js/api.js)
 * ----------------------------------------------------------------------------
 * Toda la app habla con el backend a través de `OppiAPI`. Hoy usa
 * `MockAdapter` (datos semilla + localStorage). Para conectar el backend
 * real:
 *
 *   1. Implementá `RestAdapter` con los mismos métodos (ver INTEGRATION
 *      POINTS abajo) usando fetch() contra la API real.
 *   2. Cambiá `const ADAPTER = MockAdapter` por `RestAdapter`.
 *   3. Pagos reales: reemplazá `MockAdapter.payTotal()` por la llamada
 *      al proveedor (ej. Bancard / Stripe) — el flujo de la app no cambia.
 *
 * Ninguna vista toca localStorage ni fetch directamente: todo pasa por acá.
 * ========================================================================== */
'use strict';

/* Storage seguro: localStorage en el navegador, memoria en Node/tests */
const OppiStore = (() => {
  const mem = {};
  const hasLS = typeof localStorage !== 'undefined';
  return {
    get(k) {
      try {
        if (hasLS) { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
        return k in mem ? JSON.parse(mem[k]) : null;
      } catch (e) { return null; }
    },
    set(k, v) {
      try {
        const s = JSON.stringify(v);
        if (hasLS) localStorage.setItem(k, s); else mem[k] = s;
      } catch (e) { /* cuota llena: se sigue en memoria de la sesión */ }
    },
    del(k) {
      try { if (hasLS) localStorage.removeItem(k); else delete mem[k]; } catch (e) {}
    },
  };
})();

const STATE_KEY = 'oppi_web_state_v1';
const SEED = (typeof OPPI_SEED !== 'undefined') ? OPPI_SEED : require('./data.js').OPPI_SEED;

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtGs(n) {
  return 'Gs. ' + Number(n || 0).toLocaleString('es-PY');
}

/* Distancia en km entre dos puntos (fórmula de Haversine). */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* Hash determinista de un string (para datos mock estables entre renders). */
function hashStr(s) {
  let h = 0;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ------------------------- Taxonomía (8 categorías) ---------------------- */
/* Contrato: GET /api/taxonomy → {categories: [{id, nombre, icono,
   professions: [{id, nombre}], subcategories: [{id, nombre}]}]}.
   El mock sirve esta semilla; el HttpAdapter la usa de fallback hasta que
   el backend la sirva. */
const TAXONOMY_SEED = {
  categories: [
    { id: 'belleza', nombre: 'Belleza', icono: '💇',
      professions: [{ id: 'peluquero', nombre: 'Peluquero/a' }, { id: 'barbero', nombre: 'Barbero/a' }, { id: 'manicurista', nombre: 'Manicurista' }, { id: 'maquillador', nombre: 'Maquillador/a' }],
      subcategories: [{ id: 'peluqueria', nombre: 'Peluquería' }, { id: 'barberia', nombre: 'Barbería' }, { id: 'unas', nombre: 'Uñas' }, { id: 'maquillaje', nombre: 'Maquillaje' }, { id: 'depilacion', nombre: 'Depilación' }] },
    { id: 'hogar', nombre: 'Hogar', icono: '🏠',
      professions: [{ id: 'electricista', nombre: 'Electricista' }, { id: 'plomero', nombre: 'Plomero/a' }, { id: 'pintor', nombre: 'Pintor/a' }, { id: 'limpieza', nombre: 'Limpieza profesional' }],
      subcategories: [{ id: 'plomeria', nombre: 'Plomería' }, { id: 'electricidad', nombre: 'Electricidad' }, { id: 'pintura', nombre: 'Pintura' }, { id: 'limpieza-hogar', nombre: 'Limpieza' }, { id: 'mudanzas', nombre: 'Mudanzas' }] },
    { id: 'mascotas', nombre: 'Mascotas', icono: '🐾',
      professions: [{ id: 'veterinario', nombre: 'Veterinario/a' }, { id: 'peluquero-canino', nombre: 'Peluquero/a canino' }, { id: 'paseador', nombre: 'Paseador/a' }],
      subcategories: [{ id: 'veterinaria', nombre: 'Veterinaria' }, { id: 'peluqueria-canina', nombre: 'Peluquería canina' }, { id: 'paseos', nombre: 'Paseos' }] },
    { id: 'clases', nombre: 'Clases', icono: '📚',
      professions: [{ id: 'profesor-idiomas', nombre: 'Profesor/a de idiomas' }, { id: 'profesor-apoyo', nombre: 'Profesor/a de apoyo escolar' }, { id: 'profesor-musica', nombre: 'Profesor/a de música' }],
      subcategories: [{ id: 'idiomas', nombre: 'Idiomas' }, { id: 'apoyo-escolar', nombre: 'Apoyo escolar' }, { id: 'musica', nombre: 'Música' }] },
    { id: 'eventos', nombre: 'Eventos', icono: '📸',
      professions: [{ id: 'fotografo', nombre: 'Fotógrafo/a' }, { id: 'dj', nombre: 'DJ' }, { id: 'catering', nombre: 'Catering' }],
      subcategories: [{ id: 'fotografia', nombre: 'Fotografía' }, { id: 'video', nombre: 'Video' }, { id: 'dj-eventos', nombre: 'DJ' }, { id: 'decoracion', nombre: 'Decoración' }] },
    { id: 'bienestar', nombre: 'Bienestar', icono: '💆',
      professions: [{ id: 'masoterapeuta', nombre: 'Masoterapeuta' }, { id: 'fisioterapeuta', nombre: 'Fisioterapeuta' }, { id: 'psicologo', nombre: 'Psicólogo/a' }],
      subcategories: [{ id: 'masajes', nombre: 'Masajes' }, { id: 'fisioterapia', nombre: 'Fisioterapia' }, { id: 'terapias', nombre: 'Terapias' }] },
    { id: 'salud', nombre: 'Salud', icono: '🩺',
      professions: [{ id: 'medico', nombre: 'Médico/a' }, { id: 'odontologo', nombre: 'Odontólogo/a' }, { id: 'nutricionista', nombre: 'Nutricionista' }],
      subcategories: [{ id: 'medicina-general', nombre: 'Medicina general' }, { id: 'odontologia', nombre: 'Odontología' }, { id: 'nutricion', nombre: 'Nutrición' }] },
    { id: 'tecnologia', nombre: 'Tecnología', icono: '💻',
      professions: [{ id: 'tecnico-pc', nombre: 'Técnico/a de PC' }, { id: 'disenador', nombre: 'Diseñador/a' }, { id: 'programador', nombre: 'Programador/a' }],
      subcategories: [{ id: 'soporte-tecnico', nombre: 'Soporte técnico' }, { id: 'diseno', nombre: 'Diseño' }, { id: 'desarrollo', nombre: 'Desarrollo' }] },
  ],
};

/* ------------------------------ MockAdapter ------------------------------ */
const MockAdapter = {
  /* --- estado ---------------------------------------------------------- */
  _state: null,

  _load() {
    if (this._state) return this._state;
    let s = OppiStore.get(STATE_KEY);
    if (!s || !s.v) {
      s = {
        v: 1,
        user: null,
        favorites: ['p1', 'p7'],
        bookings: [
          {
            id: 'b_ayer', proId: 'p7', proName: 'Nadia López', proInitials: 'NL', proColor: '#14B8A6',
            serviceId: 'p7s1', serviceName: 'Masaje descontracturante (60 min)',
            price: 180000, paid: 180000, date: todayPlus(1), time: '10:00',
            status: 'confirmed', createdAt: '2026-09-29',
          },
        ],
        tasks: deepClone(SEED.tasks),
        jobs: [deepClone(SEED.myHandymanJob), deepClone(SEED.myClientJob)],
        chatThreads: deepClone(SEED.chatThreads),
        waitlist: [],
        notifications: deepClone(SEED.notificationsSeed),
        credit: 0,
        points: 120, // Oppi Points de la cuenta (se ganan completando reservas)
        referralUsed: false,
        business: null, // se crea al completar el alta de Oppi Empresas
        busySlots: {},  // proId -> { 'YYYY-MM-DD': ['10:00', ...] }
      };
      // Semilla: Camila (p1) con horarios llenos mañana -> muestra lista de espera
      const tmr = todayPlus(1);
      s.busySlots.p1 = {};
      s.busySlots.p1[tmr] = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];
      OppiStore.set(STATE_KEY, s);
    }
    // Migración suave: ledger de pagos y cupones en estados guardados viejos.
    let migrated = false;
    if (!Array.isArray(s.payments)) {
      s.payments = s.bookings.filter(b => (b.paid || 0) > 0).map(b => ({
        id: uid('pay'), fecha: b.createdAt || todayPlus(0), concepto: 'Pago — ' + b.serviceName,
        monto_gs: b.paid, estado: 'cobrado', booking_id: b.id, tipo: 'pago',
      }));
      migrated = true;
    }
    if (!Array.isArray(s.coupons)) { s.coupons = []; migrated = true; }
    // Comodines del trimestre + historial de cancelaciones de la cuenta.
    if (!s.wildcards) {
      s.wildcards = { balance: 3, proximo_en: 4, reset_fecha: '31 de diciembre de 2026' };
      migrated = true;
    }
    if (!Array.isArray(s.cancelHistory)) {
      s.cancelHistory = [
        { nro: '1387', tipo: 'Cancelación tardía', detalle: 'Comodín', fecha: '2026-09-28' },
        { nro: '1250', tipo: 'Reprogramación', detalle: '—', fecha: '2026-09-20' },
        { nro: '1106', tipo: 'No-show confirmado', detalle: '—', fecha: '2026-09-12' },
        { nro: '1098', tipo: 'Dentro del plazo', detalle: 'Gratis', fecha: '2026-09-05' },
      ];
      migrated = true;
    }
    // Bandeja de soporte (agentes): conversaciones, mensajes y equipo.
    if (!s.support || !Array.isArray(s.support.conversations)) {
      s.support = { conversations: this._seedSupport(), agents: [] };
      migrated = true;
    }
    if (migrated) OppiStore.set(STATE_KEY, s);
    this._state = s;
    return s;
  },

  _save() { OppiStore.set(STATE_KEY, this._state); },

  reset() { OppiStore.del(STATE_KEY); this._state = null; },

  /* --- catálogo -------------------------------------------------------- */
  getCategories() { return deepClone(SEED.categories); },
  getTaskCategories() { return deepClone(SEED.taskCategories); },
  getBarrios() { return SEED.barrios.slice(); },

  searchProfessionals({ q, category, barrio, minRating } = {}) {
    const query = (q || '').toLowerCase().trim();
    return SEED.professionals.filter(p => {
      if (category && p.category !== category) return false;
      if (barrio && p.barrio !== barrio) return false;
      if (minRating && p.rating < minRating) return false;
      if (query && !(p.name + ' ' + p.specialty + ' ' + p.barrio).toLowerCase().includes(query)) return false;
      return true;
    }).map(deepClone);
  },

  getProfessional(id) {
    const p = SEED.professionals.find(x => x.id === id);
    if (!p) return null;
    const m = deepClone(p);
    // El backend trae `photos` en las reseñas (máx 3, URLs de /api/uploads);
    // la semilla vieja no las tiene: se normaliza.
    (m.reviews || []).forEach(r => { if (!Array.isArray(r.photos)) r.photos = []; });
    return m;
  },

  /* --- pago 100% ------------------------------------------------------- */
  /* Oppi cobra el 100% al reservar/aceptar: no hay seña ni retenciones.
     INTEGRATION POINT: el cálculo del monto vive acá para reusarlo en la
     web; el backend lo valida igual antes de crear la reserva. */

  /* --- pagos (SIMULADO) ------------------------------------------------ */
  /* INTEGRATION POINT — PAGOS REALES: reemplazar este método por la
     integración con la pasarela (Bancard/Stripe/MercadoPago). La app llama
     a payTotal() y solo continúa si devuelve { ok: true }. El resto del
     flujo (crear reserva, cobrar el 100%) no cambia. */
  payTotal({ amount, concept }) {
    if (!amount || amount <= 0) return { ok: false, error: 'Monto inválido.' };
    // Simulación: siempre aprueba. En producción, acá va el checkout real.
    return { ok: true, txId: 'SIM_' + uid('tx'), amount, concept };
  },

  /* --- reservas -------------------------------------------------------- */
  getDaySlots(proId, dateISO) {
    const s = this._load();
    const base = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];
    const busy = (s.busySlots[proId] && s.busySlots[proId][dateISO]) || [];
    // id estable del slot: lo usa rescheduleBooking (contrato: { slot_id })
    return base.map(t => ({ id: `${proId}|${dateISO}|${t}`, time: t, free: !busy.includes(t) }));
  },

  createBooking({ proId, serviceId, date, time, payWithCredit, coupon_code }) {
    const s = this._load();
    const pro = this.getProfessional(proId);
    if (!pro) return { ok: false, error: 'Profesional no encontrado.' };
    const svc = pro.services.find(x => x.id === serviceId);
    if (!svc) return { ok: false, error: 'Servicio no encontrado.' };

    let price = svc.price, discount = 0, couponCode = null;
    if (coupon_code) {
      const ac = this._applyCoupon({ code: coupon_code, business_id: null, service_id: serviceId, price });
      if (!ac.ok) return { ok: false, error: ac.error };
      discount = ac.discount_gs; price -= discount; couponCode = ac.coupon.code;
    }

    // Pago 100%: el crédito de referidos descuenta del total.
    let paid = price, creditUsed = 0;
    if (payWithCredit && s.credit > 0) {
      creditUsed = Math.min(s.credit, paid);
      paid -= creditUsed;
      s.credit -= creditUsed;
    }
    if (paid > 0) {
      const pay = this.payTotal({ amount: paid, concept: 'Pago — ' + svc.name });
      if (!pay.ok) return { ok: false, error: pay.error };
    }
    const booking = {
      id: uid('bk'), proId, proName: pro.name, proInitials: pro.initials, proColor: pro.color,
      serviceId, serviceName: svc.name, price, originalPrice: svc.price,
      discount_gs: discount, coupon_code: couponCode,
      paid, creditUsed,
      date, time, status: 'confirmed', createdAt: new Date().toISOString(),
    };
    s.bookings.unshift(booking);
    // marcar el slot como ocupado
    s.busySlots[proId] = s.busySlots[proId] || {};
    s.busySlots[proId][date] = s.busySlots[proId][date] || [];
    s.busySlots[proId][date].push(time);
    // ledger de pagos: el 100% queda cobrado
    (s.payments = s.payments || []).unshift({
      id: uid('pay'), fecha: new Date().toISOString(), concepto: 'Pago — ' + svc.name,
      monto_gs: booking.paid, estado: 'cobrado', booking_id: booking.id, tipo: 'pago',
    });
    this._notify({
      icon: '📅', title: 'Reserva confirmada',
      text: `${svc.name} con ${pro.name}, ${this._prettyDate(date)} a las ${time}. Te avisamos un día antes.`,
      link: '#/reservas',
    });
    this._save();
    return { ok: true, booking: deepClone(booking) };
  },

  getBookings() { return deepClone(this._load().bookings); },

  /* Busca la reserva por id en todas las listas (copia del cliente,
     del negocio y del panel propio) y devuelve todas las copias. */
  _bookingCopies(bookingId) {
    const s = this._load();
    const lists = [s.bookings, s.bizBookings || [], (s.business && s.business.bizBookings) || []];
    const copies = [];
    for (const list of lists) {
      const x = list.find(y => y.id === bookingId);
      if (x) copies.push(x);
    }
    return copies;
  },

  /* Reprogramar: mueve la reserva a otro slot libre; lo ya pagado queda intacto.
     INTEGRATION POINT: POST /api/bookings/:id/reschedule { slot_id }. */
  rescheduleBooking(bookingId, slotId) {
    const s = this._load();
    const copies = this._bookingCopies(bookingId);
    const b = copies[0];
    if (!b) return { ok: false, error: 'Reserva no encontrada.' };
    if (b.status !== 'confirmed' && b.status !== 'pending')
      return { ok: false, error: 'Esa reserva ya no se puede reprogramar.' };
    const parts = String(slotId || '').split('|');
    if (parts.length !== 3 || !parts[1] || !parts[2])
      return { ok: false, error: 'Turno inválido. Elegí otro.' };
    const [proKey, date, time] = parts;
    const busy = (s.busySlots[proKey] && s.busySlots[proKey][date]) || [];
    if (busy.includes(time))
      return { ok: false, error: 'Ese turno ya está ocupado. Elegí otro.' };
    // liberar el slot viejo
    const oldKey = b.proId ? b.proId : (b.bizId ? 'b_' + b.bizId : null);
    if (oldKey && s.busySlots[oldKey] && s.busySlots[oldKey][b.date]) {
      s.busySlots[oldKey][b.date] = s.busySlots[oldKey][b.date].filter(t => t !== b.time);
    }
    // ocupar el nuevo
    s.busySlots[proKey] = s.busySlots[proKey] || {};
    s.busySlots[proKey][date] = s.busySlots[proKey][date] || [];
    s.busySlots[proKey][date].push(time);
    for (const x of copies) { x.date = date; x.time = time; }
    this._notify({
      icon: '📅', title: 'Turno reprogramado',
      text: `${b.serviceName}: ahora es el ${this._prettyDate(date)} a las ${time}. Tu pago de ${fmtGs(b.paid)} se mantiene intacto.`,
      link: '#/reservas',
    });
    this._save();
    return { ok: true, booking: deepClone(b) };
  },

  /* Vista previa de cancelación: desglose exacto ANTES de confirmar.
     INTEGRATION POINT: POST /api/bookings/:id/cancel-preview →
     { paid_gs, refund_gs, forfeit_gs, hours_before, free_cancel, policy_text } */
  previewCancel(bookingId) {
    const s = this._load();
    const copies = this._bookingCopies(bookingId);
    const b = copies[0];
    if (!b) return { ok: false, error: 'Reserva no encontrada.' };
    const freeHours = (s.business && b.bizId && String(b.bizId) === String(s.business.id) &&
      s.business.cancel_free_hours != null) ? s.business.cancel_free_hours : 24;
    const when = new Date(b.date + 'T' + (b.time || '00:00') + ':00').getTime();
    const hoursBefore = (when - Date.now()) / 36e5;
    const free = hoursBefore >= freeHours;
    const paid = b.paid || 0;
    return {
      ok: true,
      paid_gs: paid,
      refund_gs: free ? paid : 0,
      forfeit_gs: free ? 0 : paid,
      hours_before: Math.max(0, Math.round(hoursBefore)),
      free_cancel: free,
      policy_text: `Cancelación gratis hasta ${freeHours} h antes del turno. ` +
        (free
          ? `Estás dentro del plazo: se te devuelve el 100% (${fmtGs(paid)}).`
          : `Ya pasó el plazo: los ${fmtGs(paid)} quedan para el profesional.`),
    };
  },

  /* INTEGRATION POINT: POST /api/bookings/:id/cancel → ejecuta y devuelve
     el cálculo + la reserva. */
  cancelBooking(id) {
    const s = this._load();
    const copies = this._bookingCopies(id);
    const b = copies[0];
    if (!b) return { ok: false, error: 'Reserva no encontrada.' };
    const pv = this.previewCancel(id);
    for (const x of copies) x.status = 'cancelled';
    // ledger: dentro del plazo se reembolsa el 100%; fuera, lo cobra el profesional
    const pay = (s.payments || []).find(p => p.booking_id === id && p.estado === 'cobrado');
    if (pay) pay.estado = pv.free_cancel ? 'reembolsado' : 'cobrado';
    this._save();
    return {
      ok: true, booking: deepClone(b),
      paid_gs: pv.paid_gs, refund_gs: pv.refund_gs,
      forfeit_gs: pv.forfeit_gs, free_cancel: pv.free_cancel,
    };
  },

  /* No-show: quién reporta decide el destino del pago.
     byPro=true → "el cliente no vino": el pago queda para el prestador.
     byPro=false → "el profesional no vino": reembolso total al cliente.
     INTEGRATION POINT: POST /api/bookings/:id/no-show (el backend decide
     por la sesión; la web pasa el hint para que el mock se comporte igual). */
  markNoShow(bookingId, byPro) {
    const s = this._load();
    const copies = this._bookingCopies(bookingId);
    const b = copies[0];
    if (!b) return { ok: false, error: 'Reserva no encontrada.' };
    if (b.status !== 'confirmed' && b.status !== 'pending')
      return { ok: false, error: 'Esa reserva ya está cerrada.' };
    const outcome = byPro ? 'no_show_client' : 'no_show_pro';
    for (const x of copies) x.status = outcome;
    const pay = (s.payments || []).find(p => p.booking_id === bookingId && p.estado === 'cobrado');
    if (pay) pay.estado = byPro ? 'cobrado' : 'reembolsado';
    this._save();
    // el pago puede vivir solo en la copia del cliente
    const withPaid = copies.find(x => x.paid != null) || b;
    return { ok: true, booking: deepClone(b), outcome, amount_gs: withPaid.paid || 0 };
  },

  /* "Voy en camino": solo el día del turno.
     INTEGRATION POINT: POST /api/bookings/:id/en-route (solo el dueño). */
  markEnRoute(bookingId) {
    const s = this._load();
    const copies = this._bookingCopies(bookingId);
    const b = copies[0];
    if (!b) return { ok: false, error: 'Reserva no encontrada.' };
    const today = new Date().toISOString().slice(0, 10);
    if (b.date !== today)
      return { ok: false, error: 'Solo podés marcar que vas en camino el día del turno.' };
    const at = new Date().toISOString();
    for (const x of copies) x.en_route_at = at;
    this._save();
    return { ok: true, booking: deepClone(b) };
  },

  /* --- política de cancelación: comodines + cumplimiento ---------------- */
  /* INTEGRATION POINT: GET /api/bookings/:id/cancel-preview →
     { free_until, dentro_plazo_gratis, resolucion ('gratis'|'comodin'|
       'sin_comodin'), comodines: { balance, proximo_en, reset_fecha },
       policy_text, pilot_mode } */
  cancelPolicyPreview(bookingId) {
    const s = this._load();
    const copies = this._bookingCopies(bookingId);
    const b = copies[0];
    if (!b) return { ok: false, error: 'Reserva no encontrada.' };
    const freeHours = (s.business && b.bizId && String(b.bizId) === String(s.business.id) &&
      s.business.cancel_free_hours != null) ? s.business.cancel_free_hours : 24;
    const when = new Date(b.date + 'T' + (b.time || '00:00') + ':00').getTime();
    const freeUntil = new Date(when - freeHours * 36e5);
    const dentro = Date.now() < freeUntil.getTime();
    const wc = this.getWildcards();
    const balance = wc.balance;
    const resolucion = dentro ? 'gratis' : (balance > 0 ? 'comodin' : 'sin_comodin');
    return {
      ok: true,
      free_until: freeUntil.toISOString(),
      dentro_plazo_gratis: dentro,
      resolucion,
      en_camino: !!b.en_route_at,
      paid_gs: b.paid || 0,
      paid_se_devuelve: dentro,
      comodines: { balance, proximo_en: wc.proximo_en, reset_fecha: wc.reset_fecha },
      policy_text: dentro
        ? `Cancelación gratis hasta ${freeHours} h antes del turno. No usa comodines.`
        : `Ya pasó tu límite gratis (hasta ${freeHours} h antes). Esta cancelación usa 1 comodín.`,
      pilot_mode: true,
    };
  },

  /* INTEGRATION POINT: POST /api/bookings/:id/cancel { reason,
     reason_detail? } → ejecuta y devuelve la resolución. */
  executeCancel(bookingId, { reason, reason_detail } = {}) {
    const s = this._load();
    const copies = this._bookingCopies(bookingId);
    const b = copies[0];
    if (!b) return { ok: false, error: 'Reserva no encontrada.' };
    if (b.status !== 'confirmed' && b.status !== 'pending')
      return { ok: false, error: 'Esa reserva ya no se puede cancelar.' };
    const pv = this.cancelPolicyPreview(bookingId);
    const resolucion = pv.ok ? pv.resolucion : 'gratis';
    let comodin_usado = false;
    if (resolucion === 'comodin' && s.wildcards && s.wildcards.balance > 0) {
      s.wildcards.balance -= 1;
      comodin_usado = true;
    }
    // El pago se comporta como en cancelBooking (gratis → reembolso del
    // 100%, tardía → lo cobra el prestador).
    const pvOld = this.previewCancel(bookingId);
    for (const x of copies) {
      x.status = 'cancelled';
      x.cancel_reason = reason || null;
      x.cancel_reason_detail = reason_detail || null;
    }
    const pay = (s.payments || []).find(p => p.booking_id === bookingId && p.estado === 'cobrado');
    if (pay) pay.estado = pvOld.free_cancel ? 'reembolsado' : 'cobrado';
    // Historial de la cuenta (vista de Oppi Empresas).
    if (Array.isArray(s.cancelHistory)) {
      s.cancelHistory.unshift({
        nro: String(Math.floor(1000 + Math.random() * 9000)),
        tipo: resolucion === 'gratis' ? 'Dentro del plazo' : 'Cancelación tardía',
        detalle: resolucion === 'gratis' ? 'Gratis' : 'Comodín',
        fecha: new Date().toISOString().slice(0, 10),
      });
    }
    this._save();
    return {
      ok: true, booking: deepClone(b), resolucion, comodin_usado,
      free_cancel: pvOld.free_cancel, refund_gs: pvOld.refund_gs,
      forfeit_gs: pvOld.forfeit_gs, reason: reason || null,
    };
  },

  /* INTEGRATION POINT: POST /api/bookings/:id/report-no-show
     { kind ('pro'|'cliente'), notes?, photo_url? }.
     kind 'pro' → "el profesional no vino" (reembolso al cliente);
     kind 'cliente' → "el cliente no vino" (el pago queda para el prestador). */
  reportNoShow(bookingId, { kind, notes, photo_url } = {}) {
    const r = this.markNoShow(bookingId, kind === 'cliente');
    if (!r.ok) return r;
    const s = this._load();
    const copies = this._bookingCopies(bookingId);
    for (const x of copies) { x.noshow_notes = notes || null; x.noshow_photo = photo_url || null; }
    if (Array.isArray(s.cancelHistory)) {
      s.cancelHistory.unshift({
        nro: String(Math.floor(1000 + Math.random() * 9000)),
        tipo: 'No-show confirmado',
        detalle: kind === 'cliente' ? 'Reportado por el profesional' : 'Reportado por la clienta',
        fecha: new Date().toISOString().slice(0, 10),
      });
    }
    this._save();
    return {
      ok: true, booking: r.booking, outcome: r.outcome, amount_gs: r.amount_gs,
      mensaje: kind === 'cliente'
        ? 'Reporte enviado. No usa tus comodines ni afecta tu cumplimiento.'
        : 'Reporte enviado. Te escribimos por WhatsApp en menos de 1 hora hábil.',
    };
  },

  /* INTEGRATION POINT: GET /api/me/compliance → indicador de cumplimiento. */
  getCompliance() {
    const s = this._load();
    const wc = this.getWildcards();
    const reservas = 50;
    const pct = 97;
    return {
      ok: true, porcentaje: pct, reservas_totales: reservas,
      reservas_evaluadas: reservas, sello: pct >= 95, no_shows: 0,
      estrellas: 4.9,
      comodines: { balance: wc.balance, proximo_en: wc.proximo_en, reset_fecha: wc.reset_fecha },
    };
  },

  /* INTEGRATION POINT: GET /api/me/wildcards → comodines del trimestre. */
  getWildcards() {
    const s = this._load();
    const w = s.wildcards || { balance: 3, proximo_en: 4, reset_fecha: '31 de diciembre de 2026' };
    return { ok: true, balance: w.balance, proximo_en: w.proximo_en, reset_fecha: w.reset_fecha };
  },

  /* INTEGRATION POINT: GET /api/businesses/:id/cancellation-history →
     historial de cancelaciones de la cuenta. */
  getCancellationHistory() {
    const s = this._load();
    const wc = this.getWildcards();
    return {
      ok: true, items: deepClone(s.cancelHistory || []),
      cumplimiento_operativo: 96,
      comodines: { balance: wc.balance, proximo_en: wc.proximo_en, reset_fecha: wc.reset_fecha },
    };
  },

  /* CSV del historial (botón "Descargar historial" en Oppi Empresas).
     INTEGRATION POINT: GET /api/businesses/:id/cancellation-history?format=csv */
  downloadCancellationCsv() {
    const s = this._load();
    const rows = [['Nro', 'Tipo', 'Detalle', 'Fecha']];
    (s.cancelHistory || []).forEach(x => rows.push([x.nro, x.tipo, x.detalle, x.fecha]));
    const csv = rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
    return { ok: true, csv, filename: 'historial-cancelaciones.csv' };
  },

  /* --- cupones (Oppi Empresas) ---------------------------------------- */
  /* INTEGRATION POINT: GET/POST /api/businesses/:id/coupons,
     PATCH /api/coupons/:id { active },
     POST /api/coupons/validate { code, business_id, service_id }. */
  getCoupons() {
    const s = this._load();
    return deepClone(s.coupons || []).filter(c =>
      !s.business || String(c.business_id) === String(s.business.id));
  },

  createCoupon({ code, type, value, maxUses, validFrom, validTo }) {
    const s = this._load();
    if (!s.business) return { ok: false, error: 'Creá tu negocio primero.' };
    const c = String(code || '').trim().toUpperCase();
    if (!c) return { ok: false, error: 'Poné un código para el cupón.' };
    if ((s.coupons || []).some(x => x.code === c))
      return { ok: false, error: 'Ese código ya existe.' };
    const t = type === 'fixed' ? 'fixed' : 'percent';
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0)
      return { ok: false, error: 'El valor tiene que ser mayor a cero.' };
    if (t === 'percent' && v > 100)
      return { ok: false, error: 'El porcentaje no puede pasar de 100.' };
    const coupon = {
      id: uid('cpn'), business_id: s.business.id, code: c, type: t, value: v,
      max_uses: Math.max(1, Number(maxUses) || 1), used_count: 0, active: true,
      valid_from: validFrom || null, valid_to: validTo || null,
    };
    s.coupons = s.coupons || [];
    s.coupons.unshift(coupon);
    this._save();
    return { ok: true, coupon: deepClone(coupon) };
  },

  toggleCoupon(id, active) {
    const s = this._load();
    const c = (s.coupons || []).find(x => x.id === id);
    if (!c) return { ok: false, error: 'Cupón no encontrado.' };
    c.active = active !== false;
    this._save();
    return { ok: true, coupon: deepClone(c) };
  },

  validateCoupon({ code, business_id, service_id }) {
    const s = this._load();
    const c = (s.coupons || []).find(x => x.code === String(code || '').trim().toUpperCase());
    if (!c || !c.active) return { valid: false, error: 'Ese cupón no existe o está pausado.' };
    if (business_id && String(c.business_id) !== String(business_id))
      return { valid: false, error: 'Ese cupón no es de este negocio.' };
    const today = new Date().toISOString().slice(0, 10);
    if (c.valid_from && today < c.valid_from) return { valid: false, error: 'Ese cupón todavía no está vigente.' };
    if (c.valid_to && today > c.valid_to) return { valid: false, error: 'Ese cupón ya venció.' };
    if ((c.used_count || 0) >= c.max_uses) return { valid: false, error: 'Ese cupón se agotó.' };
    const biz = (s.business && (!business_id || String(s.business.id) === String(business_id))) ? s.business : null;
    const svc = biz && (biz.services || []).find(x => x.id === service_id);
    const price = svc ? svc.price : 0;
    const discount = c.type === 'percent' ? Math.round(price * c.value / 100) : Math.min(c.value, price);
    return { valid: true, discount_gs: discount, coupon: deepClone(c) };
  },

  /* Valida el cupón y descuenta un uso. Uso interno (mock). */
  _applyCoupon({ code, business_id, service_id, price }) {
    if (!code) return { ok: true, discount_gs: 0, coupon: null };
    const vc = this.validateCoupon({ code, business_id, service_id });
    if (!vc.valid) return { ok: false, error: vc.error };
    const s = this._load();
    const cpn = (s.coupons || []).find(x => x.id === vc.coupon.id);
    if (cpn) { cpn.used_count = (cpn.used_count || 0) + 1; this._save(); }
    return { ok: true, discount_gs: Math.min(vc.discount_gs, price), coupon: vc.coupon };
  },

  /* --- mis pagos ------------------------------------------------------- */
  /* INTEGRATION POINT: GET /api/me/payments →
     { payments: [{ id, fecha, concepto, monto_gs, estado, booking_id?, tipo }] } */
  getMyPayments() {
    const s = this._load();
    return deepClone(s.payments || [])
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  },

  /* --- mi resumen (cliente) ------------------------------------------------ */
  /* INTEGRATION POINT: GET /api/me/summary →
     { completed_bookings, total_spent_gs, points }.
     MOCK: completadas = reservas con estado completed (o confirmadas ya
     pasadas); gastado = suma de lo pagado en esas reservas; points = saldo
     de Oppi Points de la cuenta. */
  getMySummary() {
    const s = this._load();
    const today = new Date().toISOString().slice(0, 10);
    const done = (s.bookings || []).filter(b =>
      b.status === 'completed' || ((b.status === 'confirmed') && b.date && b.date < today));
    return {
      ok: true,
      completed_bookings: done.length,
      total_spent_gs: done.reduce((a, b) => a + (b.paid || 0), 0),
      points: s.points != null ? s.points : 0,
    };
  },

  /* --- tracking de vistas (perfiles públicos) ------------------------------ */
  /* INTEGRATION POINT: POST /api/professionals/:id/view y
     POST /api/businesses/:id/view. Las vistas los disparan fire-and-forget
     (no bloquean el render). MOCK: cuenta visitas en el estado local. */
  trackProView(proId) {
    const s = this._load();
    s.views = s.views || { pros: {}, biz: {} };
    s.views.pros[proId] = (s.views.pros[proId] || 0) + 1;
    this._save();
    return { ok: true };
  },
  trackBizView(bizId) {
    const s = this._load();
    s.views = s.views || { pros: {}, biz: {} };
    s.views.biz[bizId] = (s.views.biz[bizId] || 0) + 1;
    this._save();
    return { ok: true };
  },

  /* --- ganancias del profesional --------------------------------------- */
  /* INTEGRATION POINT: GET /api/pro/earnings?periodo=semana|mes —
     misma forma que /api/business/earnings. Mock: trabajos completados
     como handyman (comisión 15% igual que empresas). */
  getProEarnings(periodo) {
    const per = periodo === 'mes' ? 'mes' : 'semana';
    const days = per === 'mes' ? 30 : 7;
    const cutoff = Date.now() - days * 864e5;
    const s = this._load();
    const done = s.jobs.filter(j =>
      j.handymanId === 'me' && j.status === 'completed' &&
      (!j.completedAt || new Date(j.completedAt).getTime() >= cutoff));
    const bySvc = {};
    for (const j of done) {
      const k = j.category || 'Trabajos';
      bySvc[k] = bySvc[k] || { servicio_id: k, nombre: k, reservas: 0, ingresos: 0 };
      bySvc[k].reservas++;
      bySvc[k].ingresos += j.agreedPrice || 0;
    }
    const por = Object.values(bySvc);
    const brutos = por.reduce((a, x) => a + x.ingresos, 0);
    const count = por.reduce((a, x) => a + x.reservas, 0);
    const comision = Math.round(brutos * 0.15);
    return {
      periodo: per, ingresos_brutos: brutos, comision, neto: brutos - comision,
      reservas_count: count, ticket_promedio: count ? Math.round(brutos / count) : 0,
      por_servicio: por,
    };
  },

  /* --- config del negocio ---------------------------------------------- */
  /* "Cancelación gratis hasta (horas)": default 24. La usa previewCancel.
     INTEGRATION POINT: el backend lo guarda en el negocio
     (PATCH /api/businesses/:id { cancel_free_hours }). */
  updateBusinessSettings({ cancel_free_hours }) {
    const s = this._load();
    if (!s.business) return { ok: false, error: 'Sin negocio.' };
    const h = Number(cancel_free_hours);
    if (!Number.isFinite(h) || h < 0 || h > 720)
      return { ok: false, error: 'Las horas tienen que estar entre 0 y 720.' };
    s.business.cancel_free_hours = h;
    this._save();
    return { ok: true, cancel_free_hours: h };
  },

  /* --- lista de espera ------------------------------------------------- */
  joinWaitlist({ proId, serviceId, date, time }) {
    const s = this._load();
    const pro = this.getProfessional(proId);
    const svc = pro && pro.services.find(x => x.id === serviceId);
    if (s.waitlist.some(w => w.proId === proId && w.date === date && w.time === time))
      return { ok: false, error: 'Ya estás en la lista de espera para ese horario.' };
    s.waitlist.unshift({
      id: uid('wl'), proId, proName: pro.name, serviceId,
      serviceName: svc ? svc.name : '', date, time, createdAt: new Date().toISOString(),
    });
    this._notify({
      icon: '⏳', title: 'Estás en la lista de espera',
      text: `Te avisamos si se libera ${time} el ${this._prettyDate(date)} con ${pro.name}.`,
      link: '#/reservas',
    });
    this._save();
    return { ok: true };
  },

  getWaitlist() { return deepClone(this._load().waitlist); },

  /* --- favoritos ------------------------------------------------------- */
  /* Los ids 'b_*' son negocios (perfil público #/negocio/:id); el resto,
     profesionales. El toggle sigue siendo genérico por id. */
  getFavorites() {
    const s = this._load();
    return s.favorites.map(id => {
      if (String(id).startsWith('b_')) {
        const b = this.getPublicBusiness(String(id).slice(2));
        return b ? Object.assign({ kind: 'business' }, b) : null;
      }
      return this.getProfessional(id);
    }).filter(Boolean);
  },
  isFavorite(proId) { return this._load().favorites.includes(proId); },
  toggleFavorite(proId) {
    const s = this._load();
    const i = s.favorites.indexOf(proId);
    if (i >= 0) s.favorites.splice(i, 1); else s.favorites.push(proId);
    this._save();
    return { ok: true, favorite: i < 0 };
  },

  /* --- chat ------------------------------------------------------------ */
  getChatThreads() { return deepClone(this._load().chatThreads); },
  getChatThread(id) {
    const t = this._load().chatThreads.find(x => x.id === id);
    return t ? deepClone(t) : null;
  },
  ensureChatThread(proId) {
    const s = this._load();
    const p = this.getProfessional(proId);
    if (!p) return { ok: false, error: 'Profesional no encontrado.' };
    let t = s.chatThreads.find(x => x.id === 'c_' + proId);
    if (!t) {
      t = { id: 'c_' + proId, peerName: p.name, peerInitials: p.initials, peerColor: p.color, proId: p.id, messages: [] };
      s.chatThreads.unshift(t);
      this._save();
    }
    return { ok: true, thread: deepClone(t) };
  },
  sendChatMessage(threadId, text) {
    const s = this._load();
    const t = s.chatThreads.find(x => x.id === threadId);
    if (!t) return { ok: false, error: 'Chat no encontrado.' };
    t.messages.push({ from: 'me', text, time: 'ahora' });
    this._save();
    return { ok: true, autoReply: this._cannedReply() };
  },
  pushChatReply(threadId, text) {
    const s = this._load();
    const t = s.chatThreads.find(x => x.id === threadId);
    if (!t) return;
    t.messages.push({ from: 'them', text, time: 'ahora' });
    this._save();
  },
  _cannedReply() {
    const r = [
      'Dale, perfecto 👌', 'Buenísimo, nos vemos entonces!',
      'Sí, sin problema 😊', 'Te confirmo en un ratito',
    ];
    return r[Math.floor(Math.random() * r.length)];
  },

  /* --- soporte: bandeja de agentes (WhatsApp) -------------------------- */
  /* INTEGRATION POINT: la bandeja de soporte vive en el backend
     (GET/POST /api/support/*). El mock replica los contratos:
     conversaciones [{ id, kind, status, last_message, updated_at,
     user_name, unread }], mensajes [{ id, from 'user'|'agent',
     sender 'bot'|'human'|null, text, created_at }] y agentes
     [{ id, email, added_at }]. El 403 se replica: sin agentes
     registrados cualquiera entra (demo); con agentes, solo ellos. */
  _seedSupport() {
    const now = Date.now();
    const iso = mins => new Date(now - mins * 60000).toISOString();
    return [
      {
        id: 'sup1', kind: 'client', status: 'bot', user_name: 'Camila Duarte',
        last_message: 'Quiero reservar un corte para mañana a la mañana',
        updated_at: iso(4), unread: 2,
        messages: [
          { id: 'sup1m1', from: 'user', sender: null, text: 'Hola! Quiero reservar un corte para mañana a la mañana', created_at: iso(12) },
          { id: 'sup1m2', from: 'agent', sender: 'bot', text: 'Hola Camila! 👋 Te muestro los horarios libres de mañana…', created_at: iso(11) },
          { id: 'sup1m3', from: 'user', sender: null, text: 'Dale, ¿a las 10 tenés?', created_at: iso(5) },
          { id: 'sup1m4', from: 'user', sender: null, text: 'Quiero reservar un corte para mañana a la mañana', created_at: iso(4) },
        ],
      },
      {
        id: 'sup2', kind: 'business', status: 'human', user_name: 'Pelo & Arte',
        last_message: 'Perfecto, ya les avisé a las chicas',
        updated_at: iso(38), unread: 0,
        messages: [
          { id: 'sup2m1', from: 'user', sender: null, text: 'Hola, soy Dahiana de Pelo & Arte. No me llegan las notificaciones de reservas nuevas', created_at: iso(70) },
          { id: 'sup2m2', from: 'agent', sender: 'human', text: 'Hola Dahiana! Revisamos tu negocio: tenías las notificaciones pausadas en el perfil. Ya las activamos de nuevo 🙌', created_at: iso(40) },
          { id: 'sup2m3', from: 'user', sender: null, text: 'Perfecto, ya les avisé a las chicas', created_at: iso(38) },
        ],
      },
      {
        id: 'sup3', kind: 'client', status: 'resolved', user_name: 'Jorge Benítez',
        last_message: 'Genial, gracias!',
        updated_at: iso(60 * 5), unread: 0,
        messages: [
          { id: 'sup3m1', from: 'user', sender: null, text: 'Me cobraron dos veces el mismo turno 😕', created_at: iso(60 * 6) },
          { id: 'sup3m2', from: 'agent', sender: 'human', text: 'Hola Jorge! Ya lo vemos: fue un reintento del pago, te devolvemos una de las dos en el día.', created_at: iso(60 * 5 + 30) },
          { id: 'sup3m3', from: 'user', sender: null, text: 'Genial, gracias!', created_at: iso(60 * 5) },
        ],
      },
    ];
  },

  /* ¿El usuario actual es agente de soporte? Sin agentes registrados el
     mock deja entrar (demo); con agentes, solo los registrados. */
  _supportIsAgent() {
    const s = this._load();
    const agents = (s.support && s.support.agents) || [];
    if (!agents.length) return true;
    const email = (s.user && s.user.email || '').toLowerCase();
    return agents.some(a => String(a.email).toLowerCase() === email);
  },

  _supportGuard() {
    if (!this._supportIsAgent())
      throw new HttpError(403, 'No tenés acceso a la bandeja de soporte');
  },

  _supportConv(id) {
    const s = this._load();
    return (s.support.conversations || []).find(c => c.id === id);
  },

  /* Lista de conversaciones. Filtra por status: 'bot'|'human'|'resolved'.
     Lanza HttpError 403 si no es agente (igual que el backend real). */
  getSupportConversations({ status } = {}) {
    this._supportGuard();
    const s = this._load();
    return deepClone(s.support.conversations || [])
      .filter(c => !status || c.status === status)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .map(c => ({ id: c.id, kind: c.kind, status: c.status, last_message: c.last_message, updated_at: c.updated_at, user_name: c.user_name, unread: c.unread || 0 }));
  },

  getSupportMessages(id) {
    this._supportGuard();
    const c = this._supportConv(id);
    if (!c) throw new HttpError(404, 'Conversación no encontrada.');
    c.unread = 0; // el agente la leyó
    this._save();
    return deepClone(c.messages || []);
  },

  replySupportConversation(id, { body } = {}) {
    this._supportGuard();
    const c = this._supportConv(id);
    if (!c) return { ok: false, error: 'Conversación no encontrada.' };
    const text = String(body || '').trim();
    if (!text) return { ok: false, error: 'Escribí tu respuesta.' };
    c.messages.push({ id: uid('sm'), from: 'agent', sender: 'human', text, created_at: new Date().toISOString() });
    c.last_message = text;
    c.updated_at = new Date().toISOString();
    c.status = 'human';
    this._save();
    return { ok: true };
  },

  handoffSupportConversation(id) {
    this._supportGuard();
    const c = this._supportConv(id);
    if (!c) return { ok: false, error: 'Conversación no encontrada.' };
    c.status = 'human';
    this._save();
    return { ok: true };
  },

  botSupportConversation(id) {
    this._supportGuard();
    const c = this._supportConv(id);
    if (!c) return { ok: false, error: 'Conversación no encontrada.' };
    c.status = 'bot';
    this._save();
    return { ok: true };
  },

  resolveSupportConversation(id) {
    this._supportGuard();
    const c = this._supportConv(id);
    if (!c) return { ok: false, error: 'Conversación no encontrada.' };
    c.status = 'resolved';
    this._save();
    return { ok: true };
  },

  getSupportAgents() {
    this._supportGuard();
    return deepClone((this._load().support.agents) || []);
  },

  addSupportAgent({ email } = {}) {
    const s = this._load();
    const agents = s.support.agents || [];
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || !clean.includes('@')) return { ok: false, error: 'Ingresá un email válido.' };
    // El primer agente se puede agregar sin ser agente (bootstrap de la demo).
    if (agents.length) this._supportGuard();
    if (agents.some(a => String(a.email).toLowerCase() === clean))
      return { ok: false, error: 'Ese email ya es agente.' };
    const agent = { id: uid('sa'), email: clean, added_at: new Date().toISOString().slice(0, 10) };
    agents.push(agent);
    this._save();
    return { ok: true, agent: deepClone(agent) };
  },

  /* Estado de la conexión de WhatsApp (mock: siempre modo demo). */
  getWhatsappStatus() {
    return { mode: 'mock', connected: false };
  },

  /* --- soporte: chat integrado con bot (cliente) ----------------------- */
  /* Contratos del backend:
     POST /api/support/chat { body } → { reply, quick_replies[], status 'bot'|'human' }
     GET /api/support/chat/history → { messages: [{ id, sender 'user'|'bot'|'agent', body, created_at }] }
     El mock replica el contrato con un bot de respuestas por palabras
     clave (voseo rioplatense) y handoff a humano. */
  _supportChatState() {
    const s = this._load();
    if (!s.supportChat) {
      s.supportChat = {
        status: 'bot',
        messages: [
          { id: 'sc0', sender: 'bot', body: '¡Hola! 👋 Soy el asistente de Oppi. ¿En qué te puedo ayudar hoy?', created_at: new Date().toISOString() },
        ],
      };
      this._save();
    }
    return s.supportChat;
  },

  supportChatHistory() {
    return deepClone(this._supportChatState().messages || []);
  },

  _supportBotReply(text) {
    const low = String(text || '').toLowerCase();
    const chips = ['Cómo reservo', 'Cómo pago', 'Cancelar un turno', 'Hablar con un asesor'];
    if (/humano|asesor|persona|alguien real|operador/.test(low))
      return { human: true };
    if (/reserv|turno|agend|cita/.test(low))
      return { reply: 'Reservar es re fácil: buscá el servicio que querés, elegí el día y la hora, y pagás el total ahí mismo 👌', quick_replies: chips };
    if (/seña|pago|pag|precio|cuánto|cuanto|tarjeta/.test(low))
      return { reply: 'Pagás el 100% al reservar, online y seguro. El total siempre lo ves clarito antes de pagar 💳', quick_replies: chips };
    if (/cancel/.test(low))
      return { reply: 'Podés cancelar gratis hasta 24 h antes del turno y te devolvemos el 100%. Si querés, lo hacemos juntos desde Mis reservas 📅', quick_replies: chips };
    if (/hola|buenas|buen/.test(low))
      return { reply: '¡Hola! 👋 Contame en qué te ayudo: reservas, pagos, cancelaciones o tu cuenta.', quick_replies: chips };
    if (/gracias/.test(low))
      return { reply: '¡De nada! 💜 Acá estoy para lo que necesites.', quick_replies: chips };
    return {
      reply: 'Buena pregunta 🤔 Puedo ayudarte con reservas, pagos, cancelaciones y tu cuenta. Si preferís, te paso con un asesor.',
      quick_replies: chips,
    };
  },

  supportChatSend({ body } = {}) {
    const text = String(body || '').trim();
    if (!text) return { ok: false, error: 'Escribí tu mensaje.' };
    const st = this._supportChatState();
    const now = new Date().toISOString();
    st.messages.push({ id: uid('sc'), sender: 'user', body: text, created_at: now });
    const r = this._supportBotReply(text);
    if (r.human) {
      st.status = 'human';
      const reply = 'Te paso con un asesor 👌 Enseguida te escribe una persona del equipo.';
      st.messages.push({ id: uid('sc'), sender: 'agent', body: reply, created_at: now });
      this._save();
      return { ok: true, reply, quick_replies: [], status: 'human' };
    }
    st.messages.push({ id: uid('sc'), sender: st.status === 'human' ? 'agent' : 'bot', body: r.reply, created_at: now });
    this._save();
    return { ok: true, reply: r.reply, quick_replies: r.quick_replies || [], status: st.status };
  },

  /* --- handyman: tareas ----------------------------------------------- */
  getTasks({ q, category, urgentOnly, barrio, mine, lat, lng, radio_km } = {}) {
    const s = this._load();
    const query = (q || '').toLowerCase().trim();
    const hasGeo = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    const rLat = hasGeo ? Number(lat) : null, rLng = hasGeo ? Number(lng) : null;
    const radio = Number(radio_km);
    return s.tasks.filter(t => {
      if (t.status !== 'open') return false;
      if (category && t.category !== category) return false;
      if (urgentOnly && !t.urgent) return false;
      if (barrio && t.barrio !== barrio) return false;
      if (mine && t.createdBy !== 'me') return false;
      if (query && !(t.title + ' ' + t.description).toLowerCase().includes(query)) return false;
      return true;
    }).map(t => {
      const c = Object.assign(deepClone(t), { offers: undefined });
      c.offersCount = t.offers.length;
      c.distance_km = hasGeo && Number.isFinite(Number(t.lat)) && Number.isFinite(Number(t.lng))
        ? haversineKm(rLat, rLng, Number(t.lat), Number(t.lng)) : null;
      return c;
    }).filter(t => !(hasGeo && Number.isFinite(radio) && radio > 0 &&
      (t.distance_km == null || t.distance_km > radio)))
      .sort((a, b) => hasGeo
        ? ((a.distance_km == null ? 1e9 : a.distance_km) - (b.distance_km == null ? 1e9 : b.distance_km))
        : ((b.urgent - a.urgent) || (b.createdAt < a.createdAt ? -1 : 1)));
  },

  getTask(id) {
    const t = this._load().tasks.find(x => x.id === id);
    return t ? deepClone(t) : null;
  },

  createTask({ title, category, description, barrio, budgetMin, budgetMax, urgent, photos, lat, lng }) {
    const s = this._load();
    if (!title || !title.trim()) return { ok: false, error: 'Poné un título para tu tarea.' };
    if (!category) return { ok: false, error: 'Elegí una categoría.' };
    const task = {
      id: uid('t'), title: title.trim(), category, description: (description || '').trim(),
      barrio: barrio || 'Villa Morra',
      budgetMin: Number(budgetMin) || 0, budgetMax: Number(budgetMax) || 0,
      urgent: !!urgent, photos: photos || [], status: 'open',
      createdBy: 'me', createdAt: new Date().toISOString().slice(0, 10), offers: [],
    };
    // Ubicación opcional: solo se guarda si vino lat/lng válidos del botón
    // "Usar mi ubicación". Sin coords, la tarea se publica igual que antes.
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      task.lat = Number(lat);
      task.lng = Number(lng);
    }
    s.tasks.unshift(task);
    this._notify({ icon: '🔨', title: 'Tarea publicada', text: `"${task.title}" ya está visible para handymans cercanos.`, link: '#/handyman/tarea/' + task.id });
    this._save();
    return { ok: true, task: deepClone(task) };
  },

  makeOffer({ taskId, amount, message }) {
    const s = this._load();
    const t = s.tasks.find(x => x.id === taskId);
    if (!t || t.status !== 'open') return { ok: false, error: 'La tarea ya no acepta ofertas.' };
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, error: 'Ingresá un monto válido en guaraníes.' };
    const offer = {
      id: uid('o'), handymanId: 'me', handymanName: 'Vos',
      rating: 5.0, jobs: 0, amount, message: (message || '').trim(), status: 'pending',
    };
    t.offers.push(offer);
    this._notify({ icon: '💰', title: 'Oferta enviada', text: `Ofertaste ${fmtGs(amount)} en "${t.title}".`, link: '#/handyman/tarea/' + taskId });
    this._save();
    return { ok: true, offer: deepClone(offer) };
  },

  /* Aceptar oferta -> crea el trabajo y cobra el 100% (simulado) */
  acceptOffer({ taskId, offerId }) {
    const s = this._load();
    const t = s.tasks.find(x => x.id === taskId);
    if (!t) return { ok: false, error: 'Tarea no encontrada.' };
    const offer = t.offers.find(o => o.id === offerId);
    if (!offer || offer.status !== 'pending') return { ok: false, error: 'Oferta no válida.' };
    offer.status = 'accepted';
    t.offers.forEach(o => { if (o.id !== offerId && o.status === 'pending') o.status = 'rejected'; });
    t.status = 'assigned';

    const pay = this.payTotal({ amount: offer.amount, concept: 'Pago — ' + t.title });
    if (!pay.ok) return { ok: false, error: pay.error };

    const job = {
      id: uid('j'), taskId: t.id, title: t.title, category: t.category, barrio: t.barrio,
      description: t.description, clientName: 'Vos', clientId: 'me',
      handymanId: offer.handymanId, handymanName: offer.handymanName,
      agreedPrice: offer.amount, paid: offer.amount, status: 'in_progress',
      photos: (t.photos || []).slice(), quotes: [],
      messages: [{ from: 'them', text: 'Gracias por aceptarme! Coordinamos por acá 👷', time: 'ahora' }],
    };
    s.jobs.unshift(job);
    // ledger: el pago del trabajo queda cobrado
    (s.payments = s.payments || []).unshift({
      id: uid('pay'), fecha: new Date().toISOString(), concepto: 'Pago — ' + t.title,
      monto_gs: offer.amount, estado: 'cobrado', booking_id: null, tipo: 'pago', job_id: job.id,
    });
    this._notify({ icon: '🤝', title: 'Oferta aceptada', text: `${offer.handymanName} va a hacer "${t.title}". Pagaste el 100% (${fmtGs(offer.amount)}).`, link: '#/handyman/trabajo/' + job.id });
    this._save();
    return { ok: true, job: deepClone(job) };
  },

  rejectOffer({ taskId, offerId }) {
    const s = this._load();
    const t = s.tasks.find(x => x.id === taskId);
    const offer = t && t.offers.find(o => o.id === offerId);
    if (!offer) return { ok: false, error: 'Oferta no encontrada.' };
    offer.status = 'rejected';
    this._save();
    return { ok: true };
  },

  /* --- handyman: trabajos ---------------------------------------------- */
  getJobs() { return deepClone(this._load().jobs); },
  getJob(id) {
    const j = this._load().jobs.find(x => x.id === id);
    return j ? deepClone(j) : null;
  },

  /* Separación de roles: solo el handyman cotiza, solo el cliente decide. */
  sendQuote({ jobId, amount, detail }) {
    const s = this._load();
    const j = s.jobs.find(x => x.id === jobId);
    if (!j) return { ok: false, error: 'Trabajo no encontrado.' };
    if (j.handymanId !== 'me') return { ok: false, error: 'Solo el handyman puede enviar la cotización.' };
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, error: 'Ingresá un monto válido en guaraníes.' };
    const q = { id: uid('q'), amount, detail: (detail || '').trim(), status: 'pending' };
    j.quotes.push(q);
    j.messages.push({ from: 'me', text: 'Te mando mi cotización cerrada 👇', time: 'ahora', quoteId: q.id });
    this._save();
    return { ok: true, quote: deepClone(q) };
  },

  respondQuote({ jobId, quoteId, accept }) {
    const s = this._load();
    const j = s.jobs.find(x => x.id === jobId);
    if (!j) return { ok: false, error: 'Trabajo no encontrado.' };
    if (j.clientId !== 'me') return { ok: false, error: 'Solo el cliente puede aceptar la cotización.' };
    const q = j.quotes.find(x => x.id === quoteId);
    if (!q || q.status !== 'pending') return { ok: false, error: 'Cotización no válida.' };
    if (accept) {
      q.status = 'accepted';
      j.agreedPrice = q.amount;
      j.status = 'in_progress';
      const pay = this.payTotal({ amount: q.amount, concept: 'Pago — ' + j.title });
      if (!pay.ok) return { ok: false, error: pay.error };
      j.paid = q.amount;
      j.messages.push({ from: 'me', text: 'Acepto la cotización ✅', time: 'ahora' });
      (s.payments = s.payments || []).unshift({
        id: uid('pay'), fecha: new Date().toISOString(), concepto: 'Pago — ' + j.title,
        monto_gs: q.amount, estado: 'cobrado', booking_id: null, tipo: 'pago', job_id: j.id,
      });
      this._notify({ icon: '🤝', title: 'Cotización aceptada', text: `Precio acordado: ${fmtGs(q.amount)}. Pagaste el 100%.`, link: '#/handyman/trabajo/' + jobId });
    } else {
      q.status = 'rejected';
      j.messages.push({ from: 'me', text: 'Gracias, pero no me sirve ese precio.', time: 'ahora' });
    }
    this._save();
    return { ok: true, job: deepClone(j) };
  },

  sendJobMessage({ jobId, text, photoDataUrl }) {
    const s = this._load();
    const j = s.jobs.find(x => x.id === jobId);
    if (!j) return { ok: false, error: 'Trabajo no encontrado.' };
    const from = (j.clientId === 'me') ? 'me' : 'me'; // el usuario simulado habla como "me"
    j.messages.push({ from, text: text || '', photo: photoDataUrl || null, time: 'ahora' });
    if (photoDataUrl) j.photos.push(photoDataUrl);
    this._save();
    return { ok: true };
  },

  completeJob({ jobId, rating, review, photos }) {
    const s = this._load();
    const j = s.jobs.find(x => x.id === jobId);
    if (!j) return { ok: false, error: 'Trabajo no encontrado.' };
    if (j.status !== 'in_progress') return { ok: false, error: 'El trabajo no está en curso.' };
    const ph = (photos || []).slice(0, 3);
    if ((photos || []).length > 3) return { ok: false, error: 'Máximo 3 fotos en la reseña.' };
    // El 100% ya se cobró al aceptar: completar solo cierra el trabajo.
    j.status = 'completed';
    j.completedAt = new Date().toISOString();
    j.myRating = Number(rating) || 5;
    j.myReview = (review || '').trim();
    j.myReviewPhotos = ph;
    this._notify({ icon: '⭐', title: '¿Cómo te fue?', text: `Contanos cómo te fue con "${j.title}" y dejá tu reseña.`, link: '#/handyman/trabajo/' + jobId });
    this._save();
    return { ok: true, job: deepClone(j), paidTotal: j.agreedPrice };
  },

  /* --- referidos ------------------------------------------------------- */
  /* INTEGRATION POINT: en producción el código se valida contra la API y el
     crédito se acredita solo cuando el referido completa su primera reserva. */
  redeemReferral(code) {
    const s = this._load();
    const clean = (code || '').trim().toUpperCase();
    if (s.referralUsed) return { ok: false, error: 'Ya usaste tu código de invitado.' };
    if (clean !== 'OPPI-AMIGO') return { ok: false, error: 'Código inválido o ya usado.' };
    s.referralUsed = true;
    s.credit += 20000;
    (s.payments = s.payments || []).unshift({
      id: uid('pay'), fecha: new Date().toISOString(), concepto: 'Crédito por invitar a un amigo',
      monto_gs: 20000, estado: 'credito', booking_id: null, tipo: 'credito',
    });
    this._notify({ icon: '🎁', title: 'Crédito acreditado', text: 'Tenés Gs. 20.000 de crédito para tu próxima reserva.', link: '#/perfil' });
    this._save();
    return { ok: true, credit: s.credit };
  },
  getCredit() { return this._load().credit; },
  myReferralCode() { return 'OPPI-' + 'VALE' + Math.floor(1000 + Math.random() * 9000); },

  /* --- notificaciones -------------------------------------------------- */
  getNotifications() { return deepClone(this._load().notifications); },
  unreadCount() { return this._load().notifications.filter(n => !n.read).length; },
  markAllRead() {
    const s = this._load();
    s.notifications.forEach(n => { n.read = true; });
    this._save();
  },
  _notify({ icon, title, text, link }) {
    const s = this._load();
    s.notifications.unshift({ id: uid('n'), icon, title, text, link: link || '#/', time: 'ahora', read: false });
  },
  _prettyDate(iso) {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' });
  },

  /* --- auth (mock) ----------------------------------------------------- */
  /* INTEGRATION POINT — AUTH REAL: login/registro contra la API (JWT /
     OAuth). La app solo usa user = { name, email } y el token. */
  login({ email, password }) {
    if (!email || !email.includes('@')) return { ok: false, error: 'Ingresá un email válido.' };
    if (!password) return { ok: false, error: 'Ingresá tu contraseña.' };
    const s = this._load();
    s.user = { name: email.split('@')[0].replace(/[._-]+/g, ' '), email, createdAt: new Date().toISOString() };
    this._save();
    return { ok: true, user: deepClone(s.user) };
  },
  register({ name, email, password, role, terms_accepted }) {
    if (!name || !name.trim()) return { ok: false, error: 'Ingresá tu nombre.' };
    if (!email || !email.includes('@')) return { ok: false, error: 'Ingresá un email válido.' };
    if (!password || password.length < 4) return { ok: false, error: 'La contraseña tiene que tener al menos 4 caracteres.' };
    if (terms_accepted !== true) return { ok: false, error: 'Tenés que aceptar los Términos y la Política de privacidad para crear tu cuenta.' };
    const validRoles = ['client', 'pro', 'handyman', 'business'];
    const finalRole = validRoles.includes(role) ? role : 'client';
    const s = this._load();
    s.user = { name: name.trim(), email, role: finalRole, createdAt: new Date().toISOString() };
    this._save();
    return { ok: true, user: deepClone(s.user) };
  },
  logout() { const s = this._load(); s.user = null; this._save(); },
  currentUser() {
    const u = this._load().user;
    return u ? deepClone(u) : { name: 'Visitante', email: '' };
  },

  /* Roles reales del usuario (los usa el chrome para el nav y los guards
     de rutas). El backend los trae en GET /api/me (campo `roles`).
     MOCK: 'client' siempre; 'handyman' si tiene trabajos como prestador;
     'business' si dio de alta su negocio. */
  myRoles() {
    const s = this._load();
    const roles = ['client'];
    const userRole = s.user && s.user.role;
    if (userRole === 'pro' || userRole === 'handyman') roles.push('handyman');
    if (userRole === 'business') roles.push('business');
    if ((s.jobs || []).some(j => j.handymanId === 'me' && j.status !== 'rejected') && !roles.includes('handyman')) roles.push('handyman');
    if (s.business && !roles.includes('business')) roles.push('business');
    return roles;
  },

  /* ¿Es admin de la plataforma? El backend lo trae en GET /api/me (role).
     Mock: se activa en tests con _setMockAdmin(true). */
  isAdmin() {
    const u = this._load().user;
    return !!(u && u.role === 'admin');
  },
  _setMockAdmin(flag) {
    const s = this._load();
    if (!s.user) s.user = { name: 'Admin Demo', email: 'admin@oppi.com.py', createdAt: new Date().toISOString() };
    if (flag) s.user.role = 'admin';
    else if (s.user.role === 'admin') s.user.role = 'client';
    this._save();
    return { ok: true };
  },
  /* Editar perfil propio (nombre, email, barrio). Aditivo: no cambia la
     interfaz existente; el HttpAdapter lo mapea a PUT /api/me. */
  updateProfile({ name, email, barrio }) {
    const s = this._load();
    if (!s.user) return { ok: false, error: 'No hay sesión activa.' };
    if (name && name.trim()) s.user.name = name.trim();
    if (email !== undefined) s.user.email = String(email || '').trim();
    if (barrio !== undefined) s.user.barrio = barrio;
    this._save();
    return { ok: true, user: deepClone(s.user) };
  },

  /* Editar perfil — contrato del backend: PATCH /api/me con
     { nombre, telefono, barrio, foto_url }. El mock guarda los mismos
     campos y mantiene `name` sincronizado por compatibilidad. */
  updateMe({ nombre, telefono, barrio, foto_url }) {
    const s = this._load();
    if (!s.user) return { ok: false, error: 'No hay sesión activa.' };
    const n = (nombre || '').trim();
    if (!n) return { ok: false, error: 'Ingresá tu nombre.' };
    if (telefono !== undefined && String(telefono).trim() && !/^[0-9+\s()-]{6,20}$/.test(String(telefono).trim()))
      return { ok: false, error: 'El teléfono no parece válido.' };
    s.user.nombre = n;
    s.user.name = n;
    s.user.telefono = telefono !== undefined ? String(telefono || '').trim() : (s.user.telefono || '');
    s.user.barrio = barrio !== undefined ? barrio : s.user.barrio;
    s.user.foto_url = foto_url !== undefined ? String(foto_url || '').trim() : (s.user.foto_url || '');
    this._save();
    return { ok: true, user: deepClone(s.user) };
  },

  /* Subida de foto de perfil (mock): no hay servidor, se guarda el dataURL. */
  uploadPhoto({ dataUrl, filename }) {
    if (!dataUrl || !String(dataUrl).startsWith('data:'))
      return { ok: false, error: 'No se pudo leer la foto.' };
    return { ok: true, url: String(dataUrl) };
  },

  /* Preferencias de notificación (mock): GET/PATCH /api/me/notification-prefs. */
  getNotificationPrefs() {
    const s = this._load();
    if (!s.notifPrefs) s.notifPrefs = { reminders: true, offers: true, messages: true, promos: true };
    return deepClone(s.notifPrefs);
  },
  updateNotificationPrefs(patch) {
    const s = this._load();
    if (!s.notifPrefs) s.notifPrefs = { reminders: true, offers: true, messages: true, promos: true };
    ['reminders', 'offers', 'messages', 'promos'].forEach(k => {
      if (patch && typeof patch[k] === 'boolean') s.notifPrefs[k] = patch[k];
    });
    this._save();
    return { ok: true, prefs: deepClone(s.notifPrefs) };
  },

  /* Eliminar cuenta (mock): DELETE /api/me. Borra los datos personales; las
     reservas pasadas quedan anónimas. */
  deleteMe({ password } = {}) {
    const s = this._load();
    if (!s.user) return { ok: false, error: 'No hay sesión activa.' };
    if (!password) return { ok: false, error: 'Ingresá tu contraseña para confirmar.' };
    s.user = null;
    s.notifPrefs = null;
    (s.bookings || []).forEach(b => { b.clientAnon = true; });
    this._save();
    return { ok: true };
  },

  /* ------------------------- panel admin (mock) ------------------------ */
  _admin() {
    const s = this._load();
    if (!s.admin) {
      s.admin = {
        overview: { usuarios: 1284, reservas_hoy: 42, reservas_semana: 268, ingresos_brutos_gs: 21460000, no_shows: 9, suspendidas: 2 },
        verifications: [
          {
            id: 'av1', business_name: 'Pelo & Arte', owner_name: 'Ana Gómez', owner_email: 'ana@test.com',
            rubro: 'Peluquería', barrio: 'Villa Morra', submitted_at: '2026-10-01', status: 'pending',
            documents: [
              { id: 'av1d1', type: 'ruc', name: 'RUC', photo_url: 'https://picsum.photos/seed/oppi-doc-ruc1/600/800' },
              { id: 'av1d2', type: 'habilitacion', name: 'Habilitación municipal', photo_url: 'https://picsum.photos/seed/oppi-doc-hab1/600/800' },
              { id: 'av1d3', type: 'identidad', name: 'Cédula del titular', photo_url: 'https://picsum.photos/seed/oppi-doc-ci1/600/800' },
            ],
          },
          {
            id: 'av2', business_name: 'Fix Hogar', owner_name: 'Rolo Benítez', owner_email: 'rolo@test.com',
            rubro: 'Plomería', barrio: 'San Lorenzo', submitted_at: '2026-09-30', status: 'pending',
            documents: [
              { id: 'av2d1', type: 'ruc', name: 'RUC', photo_url: 'https://picsum.photos/seed/oppi-doc-ruc2/600/800' },
              { id: 'av2d2', type: 'identidad', name: 'Cédula del titular', photo_url: 'https://picsum.photos/seed/oppi-doc-ci2/600/800' },
            ],
          },
          {
            id: 'av3', business_name: 'Masajes Lumi', owner_name: 'Luz Ferreira', owner_email: 'luz@test.com',
            rubro: 'Bienestar', barrio: 'Recoleta', submitted_at: '2026-09-28', status: 'approved', decided_at: '2026-09-29',
            documents: [
              { id: 'av3d1', type: 'ruc', name: 'RUC', photo_url: 'https://picsum.photos/seed/oppi-doc-ruc3/600/800' },
            ],
          },
        ],
        users: [
          { id: 'u1', name: 'Ana Gómez', email: 'ana@test.com', role: 'business', suspended: false, created_at: '2026-09-12', reservas: 34 },
          { id: 'u2', name: 'Rolo Benítez', email: 'rolo@test.com', role: 'pro', suspended: false, created_at: '2026-09-15', reservas: 58 },
          { id: 'u3', name: 'Juan Pérez', email: 'juan@test.com', role: 'client', suspended: true, created_at: '2026-09-02', reservas: 3 },
          { id: 'u4', name: 'María Vera', email: 'maria@test.com', role: 'client', suspended: false, created_at: '2026-09-25', reservas: 7 },
        ],
      };
      this._save();
    }
    return s.admin;
  },
  _guardAdmin() {
    return this.isAdmin() ? { ok: true } : { ok: false, error: 'Sin permiso. Solo administradores.' };
  },
  getAdminOverview() {
    const g = this._guardAdmin();
    if (!g.ok) return g;
    return { ok: true, overview: deepClone(this._admin().overview) };
  },
  getAdminVerifications() {
    const g = this._guardAdmin();
    if (!g.ok) return g;
    return { ok: true, verifications: deepClone(this._admin().verifications) };
  },
  // Equipo IA (mock): cola de moderación vacía en modo demo.
  getAdminModeration() {
    const g = this._guardAdmin();
    if (!g.ok) return g;
    return { ok: true, queue: [] };
  },
  decideModeration(id, decision) {
    const g = this._guardAdmin();
    if (!g.ok) return g;
    if (decision !== 'approve' && decision !== 'reject')
      return { ok: false, error: 'Decisión inválida.' };
    return { ok: true };
  },
  decideVerification(id, decision, reason) {
    const g = this._guardAdmin();
    if (!g.ok) return g;
    if (decision !== 'approved' && decision !== 'rejected')
      return { ok: false, error: 'Decisión inválida.' };
    if (decision === 'rejected' && !(reason || '').trim())
      return { ok: false, error: 'Indicá el motivo del rechazo: el negocio lo va a ver.' };
    const v = this._admin().verifications.find(x => x.id === id);
    if (!v) return { ok: false, error: 'Verificación no encontrada.' };
    if (v.status !== 'pending') return { ok: false, error: 'Esta verificación ya fue decidida.' };
    v.status = decision === 'approved' ? 'approved' : 'rejected';
    v.reason = decision === 'rejected' ? reason.trim() : '';
    v.decided_at = new Date().toISOString().slice(0, 10);
    this._save();
    return { ok: true, verification: deepClone(v) };
  },
  getAdminUsers({ q } = {}) {
    const g = this._guardAdmin();
    if (!g.ok) return g;
    let users = this._admin().users;
    if (q && q.trim()) {
      const t = q.trim().toLowerCase();
      users = users.filter(u => (u.name || '').toLowerCase().includes(t) || (u.email || '').toLowerCase().includes(t));
    }
    return { ok: true, users: deepClone(users) };
  },
  suspendUser(id) {
    const g = this._guardAdmin();
    if (!g.ok) return g;
    const u = this._admin().users.find(x => x.id === id);
    if (!u) return { ok: false, error: 'Usuario no encontrado.' };
    u.suspended = true;
    this._save();
    return { ok: true, user: deepClone(u) };
  },
  unsuspendUser(id) {
    const g = this._guardAdmin();
    if (!g.ok) return g;
    const u = this._admin().users.find(x => x.id === id);
    if (!u) return { ok: false, error: 'Usuario no encontrado.' };
    u.suspended = false;
    this._save();
    return { ok: true, user: deepClone(u) };
  },

  /* Búsqueda para el mapa: acepta { q, rubro, lat, lng, radio_km }. Con
     lat/lng calcula la distancia haversiana, filtra por radio_km y ordena
     por distancia; cada resultado trae `distance_km`. */
  search({ q, rubro, lat, lng, radio_km } = {}) {
    const query = (q || '').toLowerCase().trim();
    const hasGeo = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    const rLat = hasGeo ? Number(lat) : null, rLng = hasGeo ? Number(lng) : null;
    const radio = Number(radio_km);
    const list = SEED.professionals.filter(p => {
      if (rubro && p.category !== rubro) return false;
      if (query && !(p.name + ' ' + p.specialty + ' ' + p.barrio).toLowerCase().includes(query)) return false;
      return true;
    }).map(p => {
      const m = deepClone(p);
      m.distance_km = hasGeo && Number.isFinite(p.lat) && Number.isFinite(p.lng)
        ? haversineKm(rLat, rLng, p.lat, p.lng) : null;
      return m;
    }).filter(p => !(hasGeo && Number.isFinite(radio) && radio > 0 &&
      (p.distance_km == null || p.distance_km > radio)));
    if (hasGeo) list.sort((a, b) => (a.distance_km == null ? 1e9 : a.distance_km) - (b.distance_km == null ? 1e9 : b.distance_km));
    return list;
  },

  /* Ganancias del negocio — contrato del backend:
     GET /api/business/earnings?periodo=semana|mes.
     Mock determinista: reservas completadas simuladas por servicio
     (comisión fija del 15%). Sin negocio: ceros. */
  getEarnings(periodo) {
    const per = periodo === 'mes' ? 'mes' : 'semana';
    const s = this._load();
    const b = s.business;
    const empty = { periodo: per, ingresos_brutos: 0, comision: 0, neto: 0, reservas_count: 0, ticket_promedio: 0, por_servicio: [] };
    if (!b || !(b.services || []).length) return empty;
    const days = per === 'mes' ? 30 : 7;
    const por = b.services.map(svc => {
      let reservas = 0, ingresos = 0;
      for (let d = 0; d < days; d++) {
        const n = hashStr(svc.id + '|' + per + '|' + d) % 4; // 0..3 por día
        reservas += n;
        ingresos += n * svc.price;
      }
      return { servicio_id: svc.id, nombre: svc.name, reservas, ingresos };
    });
    const brutos = por.reduce((a, x) => a + x.ingresos, 0);
    const count = por.reduce((a, x) => a + x.reservas, 0);
    const comision = Math.round(brutos * 0.15);
    return {
      periodo: per, ingresos_brutos: brutos, comision, neto: brutos - comision,
      reservas_count: count, ticket_promedio: count ? Math.round(brutos / count) : 0,
      por_servicio: por.filter(x => x.reservas > 0),
    };
  },

  /* ================ MEJORAS OPPI (8) — MockAdapter ================= */

  /* --- taxonomía -------------------------------------------------------- */
  /* Contrato: GET /api/taxonomy → {categories: [{id, nombre, icono,
     professions: [{id, nombre}], subcategories: [{id, nombre}]}]} */
  getTaxonomy() { return deepClone(TAXONOMY_SEED); },

  /* --- búsqueda avanzada ------------------------------------------------ */
  /* Contrato: GET /api/search?min_price=&max_price=&disponibilidad=hoy|
     manana|semana&orden=relevancia|precio_asc|precio_desc|rating|distancia */
  searchAdvanced({ q, category, barrio, minRating, min_price, max_price, disponibilidad, orden } = {}) {
    let list = this.searchProfessionals({ q, category, barrio, minRating });
    const minP = Number(min_price), maxP = Number(max_price);
    const minSvcPrice = p => Math.min(...p.services.map(s => s.price));
    if (Number.isFinite(minP) && minP > 0) list = list.filter(p => minSvcPrice(p) >= minP);
    if (Number.isFinite(maxP) && maxP > 0) list = list.filter(p => minSvcPrice(p) <= maxP);
    if (disponibilidad === 'hoy' || disponibilidad === 'manana') {
      const d = todayPlus(disponibilidad === 'hoy' ? 0 : 1);
      list = list.filter(p => this.getDaySlots(p.id, d).some(s => s.free));
    } else if (disponibilidad === 'semana') {
      list = list.filter(p => {
        for (let i = 0; i < 7; i++)
          if (this.getDaySlots(p.id, todayPlus(i)).some(s => s.free)) return true;
        return false;
      });
    }
    if (orden === 'precio_asc') list.sort((a, b) => minSvcPrice(a) - minSvcPrice(b));
    else if (orden === 'precio_desc') list.sort((a, b) => minSvcPrice(b) - minSvcPrice(a));
    else if (orden === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (orden === 'distancia') {
      // MOCK: sin geo del cliente se ordena por distancia al centro de Asunción.
      const C = { lat: -25.2635, lng: -57.5759 };
      list.forEach(p => { p.distance_km = haversineKm(C.lat, C.lng, p.lat, p.lng); });
      list.sort((a, b) => a.distance_km - b.distance_km);
    }
    return list;
  },

  /* --- sucursales ------------------------------------------------------- */
  /* Contrato:
     GET    /api/businesses/:id/branches → [{id, business_id, nombre, direccion, lat, lng, telefono, horario}]
     POST   /api/businesses/:id/branches {nombre, direccion, lat, lng, telefono, horario}
     PATCH  /api/branches/:id
     DELETE /api/branches/:id */
  getBranches(businessId) {
    const s = this._load();
    if (!s.branches) s.branches = {};
    return deepClone(s.branches[businessId] || []);
  },

  createBranch(businessId, data) {
    const s = this._load();
    if (!s.branches) s.branches = {};
    const d = data || {};
    if (!d.nombre || !String(d.nombre).trim())
      return { ok: false, error: 'Poné el nombre de la sucursal.' };
    const br = {
      id: uid('br'), business_id: businessId,
      nombre: String(d.nombre).trim(),
      direccion: d.direccion || '',
      lat: d.lat != null && d.lat !== '' ? Number(d.lat) : null,
      lng: d.lng != null && d.lng !== '' ? Number(d.lng) : null,
      telefono: d.telefono || '', horario: d.horario || '',
    };
    (s.branches[businessId] = s.branches[businessId] || []).push(br);
    this._save();
    return { ok: true, branch: deepClone(br) };
  },

  updateBranch(branchId, patch) {
    const s = this._load();
    const all = Object.values(s.branches || {}).flat();
    const br = all.find(x => x.id === branchId);
    if (!br) return { ok: false, error: 'Sucursal no encontrada.' };
    if (patch.nombre != null && !String(patch.nombre).trim())
      return { ok: false, error: 'El nombre no puede estar vacío.' };
    const clean = Object.assign({}, patch);
    delete clean.id; delete clean.business_id;
    Object.assign(br, clean);
    if (br.nombre) br.nombre = String(br.nombre).trim();
    this._save();
    return { ok: true, branch: deepClone(br) };
  },

  deleteBranch(branchId) {
    const s = this._load();
    for (const k of Object.keys(s.branches || {})) {
      const i = (s.branches[k] || []).findIndex(x => x.id === branchId);
      if (i >= 0) { s.branches[k].splice(i, 1); this._save(); return { ok: true }; }
    }
    return { ok: false, error: 'Sucursal no encontrada.' };
  },

  /* --- detalle de servicio -------------------------------------------- */
  /* Los servicios "traen" {photo_url, description, includes[]}. Resuelve
     servicios de profesionales (semilla) y del negocio propio/demo. */
  _decorateService(svc, owner) {
    const includes = Array.isArray(svc.includes) && svc.includes.length ? svc.includes
      : ['Atención personalizada', 'Productos profesionales', 'Garantía Oppi'];
    return {
      id: svc.id, name: svc.name, price: svc.price, durationMin: svc.durationMin || 45,
      photo_url: svc.photo_url || null,
      description: svc.description || '',
      includes, owner,
    };
  },

  getServiceDetail(serviceId) {
    const s = this._load();
    const overrides = s.serviceOverrides || {};
    if (s.business) {
      const svc = (s.business.services || []).find(x => x.id === serviceId);
      if (svc) return this._decorateService(svc, { type: 'business', id: s.business.id, name: s.business.name, rating: 5 });
    }
    for (const p of SEED.professionals) {
      const svc = p.services.find(x => x.id === serviceId);
      if (svc) {
        const merged = Object.assign({}, svc, overrides[serviceId] || {});
        return this._decorateService(merged, { type: 'pro', id: p.id, name: p.name, rating: p.rating });
      }
    }
    const demo = (SEED.businessSeed.services || []).find(x => x.id === serviceId);
    if (demo) return this._decorateService(demo, { type: 'business', id: 'demo', name: SEED.businessSeed.name, rating: 4.8 });
    return null;
  },

  /* Edición de foto/descripción/incluye desde "Mis servicios". */
  updateServiceDetails(serviceId, patch) {
    const s = this._load();
    if (patch.photo_url != null && String(patch.photo_url).trim() && !/^https?:\/\//i.test(String(patch.photo_url).trim()) && !String(patch.photo_url).startsWith('data:'))
      return { ok: false, error: 'La foto tiene que ser una URL válida (http…) o una imagen subida.' };
    const clean = {};
    if (patch.photo_url != null) clean.photo_url = String(patch.photo_url).trim() || null;
    if (patch.description != null) clean.description = String(patch.description);
    if (patch.includes != null) {
      clean.includes = String(patch.includes).split('\n').map(x => x.trim()).filter(Boolean).slice(0, 12);
    }
    // Negocio propio: PATCH directo.
    if (s.business && (s.business.services || []).some(x => x.id === serviceId)) {
      return this.updateBusinessService(serviceId, clean);
    }
    // Profesionales (semilla): overlay en el estado para que persista en la sesión.
    const isProSvc = SEED.professionals.some(p => p.services.some(x => x.id === serviceId));
    if (!isProSvc) return { ok: false, error: 'Servicio no encontrado.' };
    if (!s.serviceOverrides) s.serviceOverrides = {};
    s.serviceOverrides[serviceId] = Object.assign(s.serviceOverrides[serviceId] || {}, clean);
    this._save();
    return { ok: true, service: this.getServiceDetail(serviceId) };
  },

  /* --- clientes ------------------------------------------------------- */
  /* Contrato: GET /api/pro/clients y GET /api/businesses/:id/clients →
     [{id, nombre, barrio, reservas_count, ultima_visita, gasto_total,
       rating_promedio_dado}] */
  getProClients() {
    const s = this._load();
    const mine = (s.jobs || []).filter(j => j.handymanId === 'me');
    const by = {};
    for (const j of mine) {
      const id = j.clientId || j.clientName || 'anon';
      const c = by[id] = by[id] || {
        id: String(id), nombre: j.clientName || 'Cliente', barrio: j.barrio || '',
        reservas_count: 0, ultima_visita: '', gasto_total: 0, _ratings: [],
      };
      c.reservas_count++;
      c.gasto_total += j.agreedPrice || 0;
      const d = (j.completedAt || j.createdAt || '').slice(0, 10);
      if (d && d > c.ultima_visita) c.ultima_visita = d;
      if (Number.isFinite(j.rating)) c._ratings.push(j.rating);
    }
    return Object.values(by).map(c => ({
      id: c.id, nombre: c.nombre, barrio: c.barrio, reservas_count: c.reservas_count,
      ultima_visita: c.ultima_visita, gasto_total: c.gasto_total,
      rating_promedio_dado: c._ratings.length
        ? Math.round(c._ratings.reduce((a, x) => a + x, 0) / c._ratings.length * 10) / 10 : null,
    })).sort((a, b) => b.gasto_total - a.gasto_total);
  },

  getBizClients() {
    const s = this._load();
    const all = [...(s.bizBookings || []), ...((s.business && s.business.bizBookings) || [])];
    const by = {};
    for (const b of all) {
      const id = b.clientId || b.clientName || 'anon';
      const c = by[id] = by[id] || {
        id: String(id), nombre: b.clientName || 'Cliente', barrio: b.clientBarrio || '',
        reservas_count: 0, ultima_visita: '', gasto_total: 0, _ratings: [],
      };
      c.reservas_count++;
      c.gasto_total += b.price || 0;
      if (b.date && b.date > c.ultima_visita) c.ultima_visita = b.date;
      if (Number.isFinite(b.clientRating)) c._ratings.push(b.clientRating);
    }
    return Object.values(by).map(c => ({
      id: c.id, nombre: c.nombre, barrio: c.barrio, reservas_count: c.reservas_count,
      ultima_visita: c.ultima_visita, gasto_total: c.gasto_total,
      rating_promedio_dado: c._ratings.length
        ? Math.round(c._ratings.reduce((a, x) => a + x, 0) / c._ratings.length * 10) / 10 : null,
    })).sort((a, b) => b.gasto_total - a.gasto_total);
  },

  /* Historial de reservas de un cliente (pro o empresa). */
  getClientHistory(clientId, scope) {
    const s = this._load();
    const id = String(clientId);
    const out = [];
    if (!scope || scope === 'pro') {
      for (const j of (s.jobs || []).filter(j => j.handymanId === 'me')) {
        if (String(j.clientId || j.clientName || 'anon') !== id) continue;
        out.push({
          id: j.id, titulo: j.title || j.category, fecha: (j.completedAt || j.createdAt || '').slice(0, 10),
          monto: j.agreedPrice || 0, estado: j.status, tipo: 'trabajo', rating: Number.isFinite(j.rating) ? j.rating : null,
        });
      }
    }
    if (!scope || scope === 'empresa') {
      const all = [...(s.bizBookings || []), ...((s.business && s.business.bizBookings) || [])];
      for (const b of all) {
        if (String(b.clientId || b.clientName || 'anon') !== id) continue;
        out.push({
          id: b.id, titulo: b.serviceName, fecha: b.date, monto: b.price || 0,
          estado: b.status, tipo: 'reserva', rating: Number.isFinite(b.clientRating) ? b.clientRating : null,
        });
      }
    }
    out.sort((a, b) => (b.fecha || '') < (a.fecha || '') ? -1 : 1);
    return out;
  },

  /* --- detalle de reserva --------------------------------------------- */
  /* MOCK: si la reserva pertenece al negocio del usuario logueado, devuelve
     rol 'empresa' (el backend real decide el rol por sesión). */
  getBookingDetail(id) {
    const s = this._load();
    const all = [...(s.bizBookings || []), ...((s.business && s.business.bizBookings) || [])];
    const bb = all.find(x => String(x.id) === String(id));
    if (bb && s.business && String(bb.bizId) === String(s.business.id)) {
      // Fusionar las copias (cliente → negocio → panel) para la vista empresa.
      const merged = { kind: 'business' };
      for (const c of this._bookingCopies(id)) Object.assign(merged, c);
      if (!merged.clientName) merged.clientName = (s.user && s.user.name) || 'Cliente';
      return { ok: true, booking: deepClone(merged), rol: 'empresa' };
    }
    const b = (s.bookings || []).find(x => String(x.id) === String(id));
    if (b) return { ok: true, booking: deepClone(b), rol: 'cliente' };
    if (bb) return { ok: true, booking: deepClone(Object.assign({ kind: 'business' }, bb)), rol: 'empresa' };
    return { ok: false, error: 'Reserva no encontrada.' };
  },

  /* --- reportes ------------------------------------------------------- */
  /* Contrato: GET /api/pro/stats?periodo= y GET /api/businesses/:id/stats?periodo= →
     {ingresos, reservas_count, top_servicios[], clientes_nuevos,
      clientes_recurrentes, recurrent_pct, conversion_pct,
      response_time_median, top_staff}.
     - conversion_pct: % visitas→reservas (null si no hay visitas medidas).
     - response_time_median: mediana en minutos (null si no hay datos).
     - top_staff: { nombre, reservas } del colaborador top (solo negocio).
     MOCK: conversion_pct es null (el mock no mide visitas) → la vista
     muestra el mensaje amable "compartí tu perfil para empezar a medir". */
  _statsFrom(items, per) {
    const ingresos = items.reduce((a, x) => a + x.monto, 0);
    const bySvc = {};
    for (const x of items) {
      const k = bySvc[x.nombre] = bySvc[x.nombre] || { nombre: x.nombre, reservas: 0, ingresos: 0 };
      k.reservas++; k.ingresos += x.monto;
    }
    const top_servicios = Object.values(bySvc).sort((a, b) => b.ingresos - a.ingresos).slice(0, 5);
    const byCli = {};
    for (const x of items) byCli[x.cliente] = (byCli[x.cliente] || 0) + 1;
    const nuevos = Object.values(byCli).filter(n => n === 1).length;
    const recurrentes = Object.values(byCli).filter(n => n >= 2).length;
    const totalCli = nuevos + recurrentes;
    return {
      periodo: per, ingresos, reservas_count: items.length, top_servicios,
      clientes_nuevos: nuevos,
      clientes_recurrentes: recurrentes,
      recurrent_pct: totalCli ? Math.round(recurrentes / totalCli * 1000) / 10 : 0,
      conversion_pct: null,
      response_time_median: null,
      top_staff: null,
    };
  },

  getProStats(periodo) {
    const per = periodo === 'mes' ? 'mes' : 'semana';
    const days = per === 'mes' ? 30 : 7;
    const s = this._load();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const done = (s.jobs || []).filter(j =>
      j.handymanId === 'me' && j.status === 'completed' && j.completedAt && new Date(j.completedAt) >= cutoff);
    const st = this._statsFrom(done.map(j => ({
      nombre: j.title || j.category || 'Trabajo', cliente: String(j.clientId || j.clientName || 'anon'),
      monto: j.agreedPrice || 0, fecha: j.completedAt,
    })), per);
    // MOCK: tiempo de respuesta mediano coherente; el backend lo calcula
    // con los mensajes reales del chat.
    st.response_time_median = 25;
    return st;
  },

  getBizStats(bizId, periodo) {
    // Compat: acepta getBizStats('mes') (solo periodo) o
    // getBizStats(id, periodo) como las vistas y el HttpAdapter.
    const per = (periodo || bizId) === 'mes' ? 'mes' : 'semana';
    const days = per === 'mes' ? 30 : 7;
    const s = this._load();
    const cutoff = todayPlus(-days);
    const all = [...(s.bizBookings || []), ...((s.business && s.business.bizBookings) || [])];
    const done = all.filter(b =>
      (b.status === 'confirmed' || b.status === 'completed') && b.date && b.date >= cutoff);
    const st = this._statsFrom(done.map(b => ({
      nombre: b.serviceName || 'Servicio', cliente: String(b.clientId || b.clientName || 'anon'),
      monto: b.price || 0, fecha: b.date,
    })), per);
    // Top colaborador: el staff con más reservas en el período.
    const byStaff = {};
    for (const b of done) {
      if (!b.staffName || b.staffName === 'Sin preferencia') continue;
      byStaff[b.staffName] = (byStaff[b.staffName] || 0) + 1;
    }
    const top = Object.entries(byStaff).sort((a, b) => b[1] - a[1])[0];
    st.top_staff = top ? { nombre: top[0], reservas: top[1] } : null;
    return st;
  },

  /* ============ FIN MEJORAS OPPI (8) — MockAdapter ============ */

  /* --- Oppi Empresas --------------------------------------------------- */
  /* INTEGRATION POINT: el alta y la gestión del negocio van contra
     /api/business/* en el backend real, con verificación de documentos. */
  getBusiness() {
    const b = this._load().business;
    return b ? deepClone(b) : null;
  },

  /* --- negocio público (perfil visible para clientes) ------------------ */
  /* INTEGRATION POINT: el perfil público del negocio sale de
     GET /api/businesses/:id en el backend real. Acá se decora la semilla
     (o el negocio creado por el usuario) con datos presentacionales que
     el backend todavía no provee: portada, horarios semanales, estado
     abierto/cerrado (aproximación por hora local) y política completa.
     Todo lo marcado MOCK se reemplaza por datos reales al integrar. */
  getPublicBusiness(id) {
    const s = this._load();
    if (s.business && (!id || s.business.id === id)) return this._decorateBiz(s.business, s.business.id);
    if (id && id !== 'demo') return null;
    return this._decorateBiz(deepClone(SEED.businessSeed), 'demo');
  },

  _decorateBiz(b, id) {
    const h = String(b.name || '?').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const palettes = [['#6B5BD0', '#8B7CF0'], ['#0EA5E9', '#6B5BD0'], ['#8B5CF6', '#EC4899'], ['#10B981', '#0EA5E9']];
    const pal = palettes[h % palettes.length];
    // MOCK: horario de atención fijo; el backend lo va a traer por negocio.
    const hoursWeek = [
      { d: 'Lunes a viernes', h: '9:00 – 19:00' },
      { d: 'Sábado', h: '9:00 – 13:00' },
      { d: 'Domingo', h: 'Cerrado' },
    ];
    const now = new Date();
    const day = now.getDay(); // 0 = domingo
    const hh = now.getHours() + now.getMinutes() / 60;
    const open = day !== 0 && hh >= 9 && hh < (day === 6 ? 13 : 19);
    const services = (b.services || []).map(x => Object.assign({ cat: 'Servicios', active: true }, x));
    const cats = [];
    services.forEach(x => { if (!cats.includes(x.cat)) cats.push(x.cat); });
    return {
      id: String(id), name: b.name, category: b.category || 'Servicios', categories: cats,
      barrio: b.barrio || '', address: b.address || '', phone: b.phone || '',
      verified: Boolean(b.verified),
      rating: 4.8, // MOCK: promedio cuando el backend agregue ratings del negocio
      reviewsCount: (b.reviews || []).length,
      cover: pal, logoColor: pal[0],
      hoursWeek, openNow: open,
      openLabel: open ? 'Abierto · hasta ' + (day === 6 ? '13:00' : '19:00') : 'Cerrado · abre 9:00',
      // MOCK: política completa; el backend la va a traer editable por negocio.
      cancelPolicyFull: 'Cancelación gratis hasta 24 h antes del turno: te devolvemos el 100%. Si el negocio cancela tu turno, te devolvemos el 100% siempre.',
      paymentMethods: ['Efectivo en el local', 'Transferencia bancaria'],
      services,
      team: (b.team || []).map((m, i) => Object.assign({ rating: i === 0 ? 4.9 : 4.8 }, m)),
      reviews: (b.reviews || []).map(r => Object.assign({ photos: [] }, r)),
    };
  },

  /* Reserva en un negocio (3 pasos: servicio+staff, fecha/hora, confirmar).
     La reserva también aparece en "Mis reservas" del cliente (s.bookings)
     y, si el negocio es el del usuario, en su panel (bizBookings). */
  createBusinessBooking({ bizId, serviceId, staffId, date, time, coupon_code }) {
    const s = this._load();
    const biz = this.getPublicBusiness(bizId);
    if (!biz) return { ok: false, error: 'Negocio no encontrado.' };
    const svc = biz.services.find(x => x.id === serviceId && x.active !== false);
    if (!svc) return { ok: false, error: 'Servicio no disponible.' };
    if (!date || !time) return { ok: false, error: 'Elegí fecha y hora.' };

    // Cupón: descuento sobre el total; el pago es el 100% del total con descuento.
    let price = svc.price, discount = 0, couponCode = null;
    if (coupon_code) {
      const ac = this._applyCoupon({ code: coupon_code, business_id: biz.id, service_id: svc.id, price });
      if (!ac.ok) return { ok: false, error: ac.error };
      discount = ac.discount_gs; price -= discount; couponCode = ac.coupon.code;
    }

    const staff = (biz.team || []).find(m => m.id === staffId);
    const booking = {
      id: uid('bb'), bizId: biz.id, bizName: biz.name,
      serviceId: svc.id, serviceName: svc.name,
      staffId: staff ? staff.id : null, staffName: staff ? staff.name : 'Sin preferencia',
      price, originalPrice: svc.price, discount_gs: discount, coupon_code: couponCode,
      paid: price,
      date, time, status: 'pending', createdAt: new Date().toISOString(),
    };
    s.bizBookings = s.bizBookings || [];
    s.bizBookings.unshift(deepClone(booking));
    // marcar el slot como ocupado (clave 'b_<bizId>', igual que rescheduleBooking)
    s.busySlots['b_' + biz.id] = s.busySlots['b_' + biz.id] || {};
    s.busySlots['b_' + biz.id][date] = s.busySlots['b_' + biz.id][date] || [];
    s.busySlots['b_' + biz.id][date].push(time);
    // Vista cliente: aparece en Mis reservas (cancelable como cualquier reserva)
    const me = (s.user && s.user.name) || 'Vos';
    s.bookings.unshift({
      id: booking.id, proId: null, bizId: biz.id, proName: biz.name,
      proInitials: biz.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      proColor: biz.logoColor,
      serviceId: svc.id, serviceName: svc.name + (staff ? ' · con ' + staff.name : ''),
      price, discount_gs: discount, coupon_code: couponCode,
      paid: price, date, time,
      status: 'pending', createdAt: booking.createdAt,
    });
    // ledger: el 100% queda cobrado
    (s.payments = s.payments || []).unshift({
      id: uid('pay'), fecha: new Date().toISOString(), concepto: 'Pago — ' + svc.name + ' (' + biz.name + ')',
      monto_gs: price, estado: 'cobrado', booking_id: booking.id, tipo: 'pago',
    });
    // Vista negocio propio: si es mi negocio, entra al panel como pendiente
    if (s.business && s.business.id === biz.id) {
      s.business.bizBookings = s.business.bizBookings || [];
      s.business.bizBookings.unshift({
        id: booking.id, clientName: me, serviceName: svc.name,
        date, time, price, paid: price, status: 'pending',
      });
    }
    this._notify({
      icon: '📅', title: 'Reserva creada en ' + biz.name,
      text: `${svc.name} · ${date} ${time}. El negocio la confirma en breve.`,
      link: '#/reservas',
    });
    this._save();
    return { ok: true, booking: deepClone(booking) };
  },

  getBizBookings() { return deepClone(this._load().bizBookings || []); },

  createBusiness({ name, category, barrio, address, phone, services, hours }) {
    const s = this._load();
    if (!name || !name.trim()) return { ok: false, error: 'Poné el nombre de tu negocio.' };
    if (!services || !services.length) return { ok: false, error: 'Agregá al menos un servicio.' };
    for (const svc of services) {
      if (!svc.price || Number(svc.price) <= 0)
        return { ok: false, error: `Precio inválido en "${svc.name}".` };
    }
    s.business = {
      id: uid('biz'),
      name: name.trim(), category: category || 'Servicios', barrio: barrio || 'Villa Morra',
      address: address || '', phone: phone || '', hours: hours || 'Lun a Sáb 9:00–18:00',
      verified: false, // badge "En verificación"
      cancel_free_hours: 24, // cancelación gratis hasta N horas antes (configurable)
      services: services.map(x => Object.assign({ id: uid('bs'), active: true }, x)),
      team: [],
      reviews: deepClone(SEED.businessSeed.reviews),
      documents: deepClone(SEED.businessSeed.documents),
      bizBookings: [
        {
          id: 'bb1', clientName: 'Sofía R.', serviceName: services[0].name,
          price: services[0].price, date: todayPlus(1), time: '10:00', status: 'pending',
        },
        {
          id: 'bb2', clientName: 'Diego A.', serviceName: services[0].name,
          price: services[0].price, date: todayPlus(1), time: '15:00', status: 'confirmed',
        },
      ],
    };
    this._notify({ icon: '🏪', title: 'Tu negocio ya está publicado', text: `"${s.business.name}" está visible con el badge "En verificación". Subí tus documentos cuando quieras.`, link: '#/empresas/panel' });
    this._save();
    return { ok: true, business: deepClone(s.business) };
  },

  updateBusinessService(serviceId, patch) {
    const s = this._load();
    if (!s.business) return { ok: false, error: 'Sin negocio.' };
    const svc = s.business.services.find(x => x.id === serviceId);
    if (!svc) return { ok: false, error: 'Servicio no encontrado.' };
    if (patch.price != null && Number(patch.price) <= 0)
      return { ok: false, error: 'El precio tiene que ser mayor a cero.' };
    delete patch.deposit; // la seña ya no existe: se cobra el 100%
    Object.assign(svc, patch);
    this._save();
    return { ok: true, service: deepClone(svc) };
  },

  addBusinessService(svc) {
    const s = this._load();
    if (!s.business) return { ok: false, error: 'Sin negocio.' };
    if (!svc.name || !svc.name.trim()) return { ok: false, error: 'Poné un nombre al servicio.' };
    if (!svc.price || Number(svc.price) <= 0) return { ok: false, error: 'Poné un precio mayor a cero.' };
    delete svc.deposit; // la seña ya no existe: se cobra el 100%
    const created = Object.assign({ id: uid('bs'), active: true }, svc);
    s.business.services.push(created);
    this._save();
    return { ok: true, service: deepClone(created) };
  },

  /* Rol de acceso del equipo: admin (todo) · editor (agenda, reservas y
     servicios) · lectura (solo ver). `role` sigue siendo el cargo
     profesional ("Colorista"); `access_role` es el permiso en el panel. */
  addTeamMember({ name, email, role, access_role }) {
    const s = this._load();
    if (!s.business) return { ok: false, error: 'Sin negocio.' };
    if (!name || !name.trim()) return { ok: false, error: 'Poné el nombre.' };
    const initials = name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const colors = ['#8B5CF6', '#3B82F6', '#EC4899', '#10B981', '#F59E0B'];
    const m = {
      id: uid('tm'), name: name.trim(), email: String(email || '').trim(),
      role: role || 'Staff',
      access_role: ['admin', 'editor', 'lectura'].includes(access_role) ? access_role : 'lectura',
      initials, color: colors[s.business.team.length % colors.length],
    };
    s.business.team.push(m);
    this._save();
    return { ok: true, member: deepClone(m) };
  },
  updateTeamMemberRole(id, access_role) {
    const s = this._load();
    if (!s.business) return { ok: false, error: 'Sin negocio.' };
    if (!['admin', 'editor', 'lectura'].includes(access_role)) return { ok: false, error: 'Rol inválido.' };
    const m = (s.business.team || []).find(x => x.id === id);
    if (!m) return { ok: false, error: 'Integrante no encontrado.' };
    m.access_role = access_role;
    this._save();
    return { ok: true, member: deepClone(m) };
  },
  /* Rol de acceso del usuario logueado en su negocio: el dueño es admin; un
     integrante que entra con su propio email tiene su access_role.
     _setMockAccessRole(role|null): override solo para tests/demos. */
  myTeamAccessRole() {
    const s = this._load();
    if (s.mockAccessRole) return s.mockAccessRole;
    if (!s.business || !s.user || !s.user.email) return null;
    const me = String(s.user.email).toLowerCase();
    const m = (s.business.team || []).find(x => String(x.email || '').toLowerCase() === me);
    return m ? (m.access_role || 'lectura') : 'admin';
  },
  _setMockAccessRole(role) {
    const s = this._load();
    if (role) s.mockAccessRole = role;
    else delete s.mockAccessRole;
    this._save();
    return { ok: true };
  },

  respondBusinessBooking(id, accept) {
    const s = this._load();
    if (!s.business) return { ok: false, error: 'Sin negocio.' };
    const mine = (s.business.bizBookings || []).find(x => x.id === id);
    if (!mine) return { ok: false, error: 'Reserva no encontrada.' };
    // Como markEnRoute: actualizar TODAS las copias (panel, negocio, cliente).
    for (const x of this._bookingCopies(id)) x.status = accept ? 'confirmed' : 'rejected';
    this._save();
    return { ok: true };
  },

  replyReview(reviewId, text) {
    const s = this._load();
    if (!s.business) return { ok: false, error: 'Sin negocio.' };
    const r = s.business.reviews.find(x => x.id === reviewId);
    if (!r) return { ok: false, error: 'Reseña no encontrada.' };
    if (!text || !text.trim()) return { ok: false, error: 'Escribí tu respuesta.' };
    r.reply = text.trim();
    this._save();
    return { ok: true };
  },

  uploadDocument(docId) {
    const s = this._load();
    if (!s.business) return { ok: false, error: 'Sin negocio.' };
    const d = s.business.documents.find(x => x.id === docId);
    if (!d) return { ok: false, error: 'Documento no encontrado.' };
    d.status = 'review'; // simulado: queda "en revisión"
    this._save();
    return { ok: true };
  },
};

/* ------------------------------ HttpAdapter ------------------------------
 * Adapter contra el backend REAL (~/workspace/oppi-api).
 *
 * Implementa la MISMA interfaz que MockAdapter: mismos nombres de método,
 * mismos parámetros y mismos formatos de retorno. La diferencia es que los
 * métodos que necesitan red devuelven Promises — las vistas usan `await`
 * (que también funciona con los valores sincrónicos del mock), así que
 * ambos adapters son intercambiables sin tocar la lógica de las vistas.
 *
 * Ids: el backend usa enteros; el adapter los expone como strings (igual
 * que el mock) y los convierte a Number al enviarlos en el body.
 *
 * Auth: el JWT se guarda en localStorage (`oppi_token`) al hacer
 * login/registro y se envía como `Authorization: Bearer <token>`.
 * Ante un 401 con sesión previa: se limpia el token y se redirige al login.
 * ========================================================================== */

/* --- helpers del adapter ------------------------------------------------ */
const TOKEN_KEY = 'oppi_token';
const API_URL_KEY = 'oppi_api_url';
const API_DEFAULT_URL = 'http://localhost:3000';

function apiBase() {
  /* ?api= en la URL: permite cambiar el backend desde la query, lo guarda
     en localStorage y tiene prioridad sobre window.OPPI_API_URL. */
  try {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      const q = new URLSearchParams(window.location.search).get('api');
      if (q && q.trim()) {
        try { localStorage.setItem(API_URL_KEY, q.trim()); } catch (e) { /* sin localStorage */ }
        return String(q.trim()).replace(/\/+$/, '');
      }
    }
  } catch (e) { /* URL malformada o sin location: seguir con el resto */ }
  const w = (typeof window !== 'undefined' && window.OPPI_API_URL) ? window.OPPI_API_URL : null;
  let ls = null;
  try { ls = (typeof localStorage !== 'undefined') ? localStorage.getItem(API_URL_KEY) : null; }
  catch (e) { /* sin localStorage */ }
  return String(w || ls || API_DEFAULT_URL).replace(/\/+$/, '');
}

function safeParse(s, fallback) {
  if (Array.isArray(s)) return s; // el backend ya devuelve arrays parseados
  try { const v = JSON.parse(s); return v == null ? fallback : v; }
  catch (e) { return fallback; }
}

function capitalize(s) {
  s = String(s || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const ini = parts.map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return ini || '?';
}

const AVATAR_COLORS = ['#8B5CF6', '#3B82F6', '#EC4899', '#10B981', '#F59E0B', '#14B8A6', '#F97316', '#0EA5E9', '#A855F7', '#6366F1'];
function colorOf(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/* Fecha/hora relativa para chats y notificaciones (created_at viene en UTC). */
function relTime(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(iso).slice(0, 16);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return 'hace ' + mins + ' min';
  const hs = Math.floor(mins / 60);
  if (hs < 24) return 'hace ' + hs + ' h';
  return d.toLocaleDateString('es-PY', { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}

/* Mapeo categoría de la web -> palabras clave de las categorías del backend.
   (El backend guarda categorías libres como 'peluquería'; la web filtra por
   'belleza', 'hogar', etc.) */
const WEB_CATEGORY_KEYWORDS = {
  belleza: ['peluquer', 'color', 'barber', 'manicur', 'uñas', 'maquillaje', 'estetica', 'estética', 'belleza'],
  hogar: ['electric', 'plomer', 'limpieza', 'climatiz', 'carpinter', 'hogar', 'pintura', 'jardin'],
  mascotas: ['mascota', 'veterinaria', 'paseador'],
  clases: ['clase', 'profesor', 'ingles', 'inglés', 'musica', 'música'],
  eventos: ['evento', 'fotograf', 'catering', 'dj'],
  bienestar: ['masaje', 'bienestar', 'yoga', 'terapia'],
};
function webCategoryFor(backendCats) {
  const cats = (backendCats || []).map(c => String(c).toLowerCase());
  for (const webId of Object.keys(WEB_CATEGORY_KEYWORDS)) {
    const kws = WEB_CATEGORY_KEYWORDS[webId];
    if (cats.some(c => kws.some(k => c.indexOf(k) >= 0))) return webId;
  }
  return null;
}

/* Categorías de tareas: id de la web -> palabra clave del backend. */
const TASK_CATEGORY_KEYWORDS = {
  plomeria: ['plomer'], electricidad: ['electric'], pintura: ['pintura'],
  limpieza: ['limpieza'], mudanza: ['mudanza', 'flete'], jardin: ['jardin'],
  otros: ['otro', 'carpinter'],
};

const DOC_LABELS = { ruc: 'RUC', habilitacion: 'Habilitación municipal', identidad: 'Cédula del titular' };
function docLabel(type) { return DOC_LABELS[type] || capitalize(type); }

function scheduleText(schedule) {
  return (schedule || []).map(s => `${s.day || ''} ${s.open || ''}–${s.close || ''}`.trim()).join(', ');
}

const NOTIF_ICONS = { reminder: '⏰', booking: '📅', referral: '🎁', review_request: '⭐', waitlist: '⏳' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const HttpAdapter = {
  _user: null,

  /* --- transporte ---------------------------------------------------- */
  async _req(method, path, body, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 0;
    const ctrl = (timeoutMs > 0 && typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const hadToken = !!OppiStore.get(TOKEN_KEY);
    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = OppiStore.get(TOKEN_KEY);
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(apiBase() + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      });
      let data = {};
      try { data = await res.json(); } catch (e) { /* cuerpo vacío */ }
      if (res.status === 401) {
        OppiStore.del(TOKEN_KEY);
        HttpAdapter._user = null;
        // Sesión vencida (había token): volver al login. Sin token es una
        // llamada anónima a un endpoint protegido, o un login fallido:
        // no se redirige y se muestra el mensaje del servidor.
        if (hadToken && typeof location !== 'undefined' && typeof window !== 'undefined') {
          const h = location.hash || '';
          if (h.indexOf('#/login') !== 0 && h.indexOf('#/registro') !== 0) location.hash = '#/login';
        }
        throw new HttpError(401, (data && data.error) || 'Tu sesión venció. Entrá de nuevo.');
      }
      if (!res.ok) throw new HttpError(res.status, (data && data.error) || ('Error ' + res.status));
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new HttpError(0, 'El servidor no responde. Probá de nuevo.');
      if (e instanceof HttpError) throw e;
      throw new HttpError(0, 'No se pudo conectar con el servidor de Oppi.');
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  /* Prueba de conectividad (rápida): la usa la selección de adaptador. */
  async probe() {
    await this._req('GET', '/api/config', undefined, { timeoutMs: 5000 });
  },

  /* Usuario logueado (cacheado). Sin token: lanza sin pegar a la red. */
  async _me() {
    if (HttpAdapter._user) return HttpAdapter._user;
    if (!OppiStore.get(TOKEN_KEY)) throw new HttpError(401, 'Sin sesión');
    const { user } = await this._req('GET', '/api/me');
    HttpAdapter._user = user;
    return user;
  },

  reset() { OppiStore.del(TOKEN_KEY); HttpAdapter._user = null; },

  /* --- catálogo (estático, igual que el mock) ------------------------- */
  getCategories() { return deepClone(SEED.categories); },
  getTaskCategories() { return deepClone(SEED.taskCategories); },
  getBarrios() { return SEED.barrios.slice(); },

  /* --- mapeos ---------------------------------------------------------- */
  _mapService(s) {
    return {
      id: String(s.id), name: s.name, price: s.price_gs, durationMin: 60,
      deposit: { type: s.deposit_type || 'none', value: Number(s.deposit_value) || 0 },
    };
  },

  _mapPro(p, services) {
    const cats = safeParse(p.categories, []);
    const m = {
      id: String(p.id), name: p.name, initials: initialsOf(p.name), color: colorOf(p.name),
      category: webCategoryFor(cats), specialty: capitalize(cats[0] || ''),
      barrio: p.barrio || '', address: '', rating: p.rating || 0,
      verified: Boolean(p.verified), about: p.bio || '',
    };
    if (services) m.services = services;
    return m;
  },

  _mapBooking(b) {
    const proName = b.pro_name || b.business_name || '';
    return {
      id: String(b.id), proId: b.pro_id != null ? String(b.pro_id) : null,
      proName, proInitials: initialsOf(proName), proColor: colorOf(proName),
      serviceId: String(b.service_id), serviceName: b.service_name || '',
      price: b.total_gs, paid: b.paid_gs != null ? b.paid_gs : (b.total_gs || 0),
      creditUsed: b.credit_applied_gs || 0,
      discount_gs: b.discount_gs || 0, coupon_code: b.coupon_code || null,
      date: b.slot_date || '', time: b.slot_time || '',
      status: b.status, createdAt: b.created_at, clientName: b.client_name || '',
      en_route_at: b.en_route_at || null,
    };
  },

  _mapTask(t, me, offersCount) {
    const m = {
      id: String(t.id), title: t.title, category: t.category || '', description: t.description || '',
      barrio: t.barrio || '', budgetMin: t.price_min_gs || 0, budgetMax: t.price_max_gs || 0,
      urgent: Boolean(t.urgent), photos: safeParse(t.photos, []).map(p => this._absUrl(p)), status: t.status,
      createdBy: me && t.client_id === me.id ? 'me' : 'other',
      createdAt: String(t.created_at || '').slice(0, 10),
      offers: undefined, offersCount: offersCount == null ? 0 : offersCount,
    };
    // Geo opcional del backend para el mapa de chambas.
    if (t.lat != null && t.lng != null) { m.lat = Number(t.lat); m.lng = Number(t.lng); }
    if (t.distance_km != null) m.distance_km = Number(t.distance_km);
    return m;
  },

  _mapOffer(o, me) {
    return {
      id: String(o.id), handymanId: o.handyman_id === (me && me.id) ? 'me' : o.handyman_id,
      handymanName: o.handyman_name || (me ? me.name : 'Handyman'),
      rating: null, jobs: null, amount: o.amount_gs, message: o.message || '', status: o.status,
    };
  },

  _mapChatMsg(m, myId) {
    const photos = safeParse(m.photos, []);
    return {
      from: m.sender_id === myId ? 'me' : 'them',
      text: m.text || '', time: relTime(m.created_at),
      photo: (photos[0] && photos[0].url) ? this._absUrl(photos[0].url) : null,
      quoteId: m.quote ? String(m.id) : undefined,
    };
  },

  async _servicesByPro() {
    const byPro = {};
    try {
      const { services } = await this._req('GET', '/api/services');
      for (const s of (services || [])) {
        if (s.professional_id == null) continue;
        (byPro[s.professional_id] = byPro[s.professional_id] || []).push(this._mapService(s));
      }
    } catch (e) { /* catálogo sin servicios */ }
    return byPro;
  },

  async _peerNameMap() {
    const map = {};
    try {
      const { professionals } = await this._req('GET', '/api/professionals');
      for (const p of (professionals || [])) map[p.user_id] = p.name;
    } catch (e) {}
    try {
      const { jobs } = await this._req('GET', '/api/jobs');
      for (const j of (jobs || [])) {
        if (j.client_id != null && j.client_name) map[j.client_id] = j.client_name;
        if (j.handyman_id != null && j.handyman_name) map[j.handyman_id] = j.handyman_name;
      }
    } catch (e) {}
    return map;
  },

  /* --- profesionales --------------------------------------------------- */
  async searchProfessionals({ q, category, barrio, minRating } = {}) {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (barrio) params.set('barrio', barrio);
      const qs = params.toString();
      const { professionals } = await this._req('GET', '/api/professionals' + (qs ? '?' + qs : ''));
      let list = professionals || [];
      if (minRating) list = list.filter(p => (p.rating || 0) >= minRating);
      const byPro = await this._servicesByPro();
      return list
        .map(p => ({ p, webCat: webCategoryFor(safeParse(p.categories, [])) }))
        .filter(({ webCat }) => !category || webCat === category)
        .map(({ p, webCat }) => {
          const m = this._mapPro(p, byPro[p.id] || []);
          m.category = webCat;
          return m;
        });
    } catch (e) { return []; }
  },

  async getProfessional(id) {
    try {
      const [pd, sd] = await Promise.all([
        this._req('GET', '/api/professionals/' + id),
        this._req('GET', '/api/services?professional_id=' + id),
      ]);
      if (!pd.professional) return null;
      const m = this._mapPro(pd.professional, (sd.services || []).map(s => this._mapService(s)));
      m.reviewsCount = (pd.reviews || []).length;
      m.reviews = (pd.reviews || []).map(r => ({
        author: r.from, rating: r.rating, date: String(r.created_at || '').slice(0, 10),
        text: r.text || '', reply: r.reply_text || null,
        photos: (r.photos || []).map(p => this._absUrl(p)),
      }));
      return m;
    } catch (e) { return null; }
  },

  /* --- pago 100% (cálculo local, igual que el mock) ---------------------- */
  /* La seña se eliminó del producto: el backend cobra el 100% al crear la
     reserva. Estos helpers quedaron obsoletos y se removieron; el mapeo de
     servicios ignora los campos deposit_* si el backend todavía los trae. */

  /* --- reservas -------------------------------------------------------- */
  async getDaySlots(proId, dateISO) {
    try {
      const { slots } = await this._req('GET', `/api/slots?professional_id=${proId}&date=${dateISO}`);
      return (slots || [])
        .map(s => ({ id: String(s.id), time: s.time, free: s.status === 'free' }))
        .sort((a, b) => (a.time < b.time ? -1 : 1));
    } catch (e) { return []; }
  },

  async createBooking({ proId, serviceId, date, time, payWithCredit, coupon_code }) {
    try {
      const [slotsRes, me] = await Promise.all([
        this._req('GET', `/api/slots?professional_id=${proId}&date=${date}`),
        this._me(),
      ]);
      const slot = (slotsRes.slots || []).find(s => s.time === time && s.status === 'free');
      if (!slot) return { ok: false, error: 'Ese turno ya no está disponible. Elegí otro.' };
      let apply = 0;
      if (payWithCredit && me.credit_gs > 0) {
        const sd = await this._req('GET', '/api/services?professional_id=' + proId);
        const svc = (sd.services || []).find(s => String(s.id) === String(serviceId));
        apply = Math.min(me.credit_gs, svc ? svc.price_gs : me.credit_gs);
      }
      const { booking } = await this._req('POST', '/api/bookings', {
        service_id: Number(serviceId), slot_id: Number(slot.id),
        ...(apply > 0 ? { apply_credit_gs: apply } : {}),
        ...(coupon_code ? { coupon_code } : {}),
      });
      return { ok: true, booking: this._mapBooking(booking) };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async getBookings() {
    try {
      const { bookings } = await this._req('GET', '/api/bookings');
      return (bookings || []).map(b => this._mapBooking(b));
    } catch (e) { return []; }
  },

  async cancelBooking(id) {
    try {
      // El backend ejecuta la cancelación y devuelve el cálculo + la reserva.
      const data = await this._req('POST', '/api/bookings/' + id + '/cancel');
      return {
        ok: true,
        booking: data.booking ? this._mapBooking(data.booking) : undefined,
        paid_gs: data.paid_gs != null ? data.paid_gs : data.deposit_gs,
        refund_gs: data.refund_gs, forfeit_gs: data.forfeit_gs, free_cancel: data.free_cancel,
      };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* --- reprogramar / vista previa de cancelación / no-show / en camino - */
  /* Contratos del backend:
     POST /api/bookings/:id/reschedule { slot_id } → { booking } (lo pagado queda intacto)
     POST /api/bookings/:id/cancel-preview → { paid_gs, refund_gs, forfeit_gs, hours_before, free_cancel, policy_text }
     POST /api/bookings/:id/no-show → según quién pide: no_show_client (el pago queda para el prestador) o no_show_pro (reembolso total)
     POST /api/bookings/:id/en-route (solo dueño, solo día del servicio); el booking trae en_route_at */
  async rescheduleBooking(bookingId, slotId) {
    try {
      const { booking } = await this._req('POST', `/api/bookings/${bookingId}/reschedule`, { slot_id: Number(slotId) });
      return { ok: true, booking: this._mapBooking(booking) };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async previewCancel(bookingId) {
    try {
      const data = await this._req('POST', `/api/bookings/${bookingId}/cancel-preview`);
      return Object.assign({ ok: true }, data);
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async markNoShow(bookingId, byPro) {
    try {
      // reporter es solo un hint; el backend decide por la sesión del que pide.
      const data = await this._req('POST', `/api/bookings/${bookingId}/no-show`,
        { reporter: byPro ? 'pro' : 'client' });
      return {
        ok: true,
        booking: data.booking ? this._mapBooking(data.booking) : undefined,
        outcome: data.outcome, amount_gs: data.amount_gs,
      };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async markEnRoute(bookingId) {
    try {
      const data = await this._req('POST', `/api/bookings/${bookingId}/en-route`);
      return { ok: true, booking: data.booking ? this._mapBooking(data.booking) : undefined };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* --- política de cancelación (contratos del backend) ----------------- */
  /* GET /api/bookings/:id/cancel-preview →
     { free_until, dentro_plazo_gratis, resolucion, comodines, policy_text, pilot_mode } */
  async cancelPolicyPreview(bookingId) {
    try {
      const data = await this._req('GET', `/api/bookings/${bookingId}/cancel-preview`);
      return Object.assign({ ok: true }, data);
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* POST /api/bookings/:id/cancel { reason, reason_detail? } */
  async executeCancel(bookingId, { reason, reason_detail } = {}) {
    try {
      const data = await this._req('POST', `/api/bookings/${bookingId}/cancel`,
        Object.assign({ reason }, reason_detail ? { reason_detail } : {}));
      return {
        ok: true,
        booking: data.booking ? this._mapBooking(data.booking) : undefined,
        resolucion: data.resolucion, comodin_usado: data.comodin_usado,
        free_cancel: data.free_cancel, refund_gs: data.refund_gs,
        forfeit_gs: data.forfeit_gs, reason: data.reason || reason || null,
      };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* POST /api/bookings/:id/report-no-show { kind, notes?, photo_url? } */
  async reportNoShow(bookingId, { kind, notes, photo_url } = {}) {
    try {
      const body = { kind };
      if (notes) body.notes = notes;
      if (photo_url) body.photo_url = photo_url;
      const data = await this._req('POST', `/api/bookings/${bookingId}/report-no-show`, body);
      return Object.assign({ ok: true }, data);
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* GET /api/me/compliance */
  async getCompliance() {
    try {
      const data = await this._req('GET', '/api/me/compliance');
      return Object.assign({ ok: true }, data);
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* GET /api/me/wildcards */
  async getWildcards() {
    try {
      const data = await this._req('GET', '/api/me/wildcards');
      return Object.assign({ ok: true }, data);
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* GET /api/businesses/:id/cancellation-history */
  async getCancellationHistory() {
    try {
      const bizId = await this._myBusinessId();
      if (!bizId) return { ok: false, error: 'Todavía no tenés un negocio.' };
      const data = await this._req('GET', `/api/businesses/${bizId}/cancellation-history`);
      return Object.assign({ ok: true }, data);
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* GET /api/businesses/:id/cancellation-history?format=csv */
  async downloadCancellationCsv() {
    try {
      const bizId = await this._myBusinessId();
      if (!bizId) return { ok: false, error: 'Todavía no tenés un negocio.' };
      if (typeof fetch === 'undefined') return { ok: false, error: 'Descarga no disponible acá.' };
      const headers = {};
      const token = OppiStore.get(TOKEN_KEY);
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(apiBase() + `/api/businesses/${bizId}/cancellation-history?format=csv`, { headers });
      if (!res.ok) throw new HttpError(res.status, 'No se pudo descargar el historial.');
      const csv = await res.text();
      return { ok: true, csv, filename: 'historial-cancelaciones.csv' };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* --- lista de espera ------------------------------------------------- */
  async joinWaitlist({ proId, serviceId, date, time }) {
    try {
      const slotDesc = `${date} ${time === 'cualquiera' ? 'cualquier hora' : time}`;
      const body = { professional_id: Number(proId), slot_desc: slotDesc };
      if (serviceId) body.service_id = Number(serviceId);
      await this._req('POST', '/api/waitlist', body);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async getWaitlist() {
    try {
      const { waitlist } = await this._req('GET', '/api/waitlist');
      return (waitlist || []).map(w => ({
        id: String(w.id), proId: String(w.professional_id), proName: w.professional_name || '',
        serviceId: w.service_id != null ? String(w.service_id) : null,
        serviceName: w.service_name || '', date: w.slot_desc || '', time: 'cualquiera',
      }));
    } catch (e) { return []; }
  },

  /* --- favoritos ------------------------------------------------------- */
  async getFavorites() {
    try {
      const { favorites } = await this._req('GET', '/api/favorites');
      const byPro = await this._servicesByPro();
      return (favorites || []).map(p => this._mapPro(p, byPro[p.id] || []));
    } catch (e) { return []; }
  },

  async isFavorite(proId) {
    try {
      const { favorites } = await this._req('GET', '/api/favorites');
      return (favorites || []).some(f => String(f.id) === String(proId));
    } catch (e) { return false; }
  },

  async toggleFavorite(proId) {
    try {
      const fav = await this.isFavorite(proId);
      if (fav) await this._req('DELETE', '/api/favorites/' + proId);
      else await this._req('POST', '/api/favorites', { professional_id: Number(proId) });
      return { ok: true, favorite: !fav };
    } catch (e) { return { ok: false, error: e.message, favorite: false }; }
  },

  /* --- chat ------------------------------------------------------------ */
  async getChatThreads() {
    try {
      const me = await this._me();
      const { conversations } = await this._req('GET', '/api/conversations');
      const names = await this._peerNameMap();
      const list = conversations || [];
      const threads = await Promise.all(list.map(async c => {
        const peerId = (c.participants || []).find(id => id !== me.id);
        const peerName = (peerId != null && names[peerId]) || 'Conversación';
        const { messages } = await this._req('GET', `/api/conversations/${c.id}/messages`).catch(() => ({ messages: [] }));
        return {
          id: String(c.id), peerName, peerInitials: initialsOf(peerName), peerColor: colorOf(peerName),
          proId: null, messages: (messages || []).map(m => this._mapChatMsg(m, me.id)),
        };
      }));
      return threads;
    } catch (e) { return []; }
  },

  async getChatThread(id) {
    try {
      const me = await this._me();
      const { conversations } = await this._req('GET', '/api/conversations');
      const c = (conversations || []).find(x => String(x.id) === String(id));
      if (!c) return null;
      const names = await this._peerNameMap();
      const peerId = (c.participants || []).find(p => p !== me.id);
      const peerName = (peerId != null && names[peerId]) || 'Conversación';
      const { messages } = await this._req('GET', `/api/conversations/${c.id}/messages`);
      return {
        id: String(c.id), peerName, peerInitials: initialsOf(peerName), peerColor: colorOf(peerName),
        proId: null, messages: (messages || []).map(m => this._mapChatMsg(m, me.id)),
      };
    } catch (e) { return null; }
  },

  async ensureChatThread(proId) {
    try {
      const me = await this._me();
      const pd = await this._req('GET', '/api/professionals/' + proId);
      if (!pd.professional) return { ok: false, error: 'Profesional no encontrado.' };
      const peerUserId = pd.professional.user_id;
      const { conversations } = await this._req('GET', '/api/conversations');
      let c = (conversations || []).find(x => {
        const ps = x.participants || [];
        return ps.length === 2 && ps.includes(me.id) && ps.includes(peerUserId);
      });
      if (!c) {
        const created = await this._req('POST', '/api/conversations', { participants: [peerUserId] });
        c = created.conversation;
      }
      const thread = await this.getChatThread(c.id);
      if (thread) thread.proId = String(proId);
      return { ok: true, thread };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async sendChatMessage(threadId, text) {
    try {
      if (!text || !text.trim()) return { ok: false, error: 'Escribí un mensaje.' };
      await this._req('POST', `/api/conversations/${threadId}/messages`, { text: text.trim() });
      // Sin respuesta simulada: del otro lado hay una persona real.
      return { ok: true, autoReply: null };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async pushChatReply(threadId, text) {
    // Solo existe para el mock (respuesta simulada). Con backend real no se
    // simula: si no hay texto, no hay nada que hacer.
    if (!text) return { ok: true };
    return { ok: true };
  },

  /* --- handyman: tareas ----------------------------------------------- */
  async getTasks({ q, category, urgentOnly, barrio, mine, lat, lng, radio_km } = {}) {
    try {
      const me = await this._me().catch(() => null);
      const params = new URLSearchParams();
      if (urgentOnly) params.set('urgent', '1');
      if (barrio) params.set('barrio', barrio);
      // Geo opcional para el mapa de chambas (el backend filtra y ordena).
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        params.set('lat', lat);
        params.set('lng', lng);
      }
      if (Number.isFinite(Number(radio_km))) params.set('radio_km', radio_km);
      const qs = params.toString();
      const { tasks } = await this._req('GET', '/api/tasks' + (qs ? '?' + qs : ''));
      let list = tasks || [];
      if (mine && me) list = list.filter(t => t.client_id === me.id);
      if (category) {
        const kws = TASK_CATEGORY_KEYWORDS[category] || [category];
        list = list.filter(t => kws.some(k => String(t.category || '').toLowerCase().indexOf(k) >= 0));
      }
      if (q && q.trim()) {
        const needle = q.toLowerCase().trim();
        list = list.filter(t => (t.title + ' ' + (t.description || '')).toLowerCase().indexOf(needle) >= 0);
      }
      const counts = await Promise.all(list.map(t =>
        this._req('GET', '/api/tasks/' + t.id).then(r => (r.offers || []).length).catch(() => 0)));
      return list.map((t, i) => this._mapTask(t, me, counts[i]));
    } catch (e) { return []; }
  },

  async getTask(id) {
    try {
      const me = await this._me().catch(() => null);
      const { task, offers } = await this._req('GET', '/api/tasks/' + id);
      if (!task) return null;
      const m = this._mapTask(task, me, (offers || []).length);
      m.offers = (offers || []).map(o => this._mapOffer(o, me));
      return m;
    } catch (e) { return null; }
  },

  async createTask({ title, category, description, barrio, budgetMin, budgetMax, urgent, photos, lat, lng }) {
    try {
      if (!title || !title.trim()) return { ok: false, error: 'Poné un título para tu tarea.' };
      if (!category) return { ok: false, error: 'Elegí una categoría.' };
      const me = await this._me();
      // Las fotos se suben a POST /api/uploads; la tarea guarda solo URLs.
      const urls = [];
      for (const p of (photos || [])) {
        const s = String(p || '');
        if (!s) continue;
        urls.push(s.startsWith('data:') ? await this._uploadPhoto(s, 'tarea.jpg') : this._absUrl(s));
      }
      const body = {
        title: title.trim(), description: (description || '').trim(), category,
        barrio: barrio || '',
        price_min_gs: Number(budgetMin) || null, price_max_gs: Number(budgetMax) || null,
        urgent: !!urgent, photos: urls,
      };
      // Ubicación opcional: solo viaja si el usuario tocó "Usar mi ubicación".
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        body.lat = Number(lat);
        body.lng = Number(lng);
      }
      const { task } = await this._req('POST', '/api/tasks', body);
      return { ok: true, task: this._mapTask(task, me, 0) };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async makeOffer({ taskId, amount, message }) {
    try {
      const me = await this._me();
      const { offer } = await this._req('POST', `/api/tasks/${taskId}/offers`, {
        amount_gs: Number(amount), message: (message || '').trim(),
      });
      return { ok: true, offer: this._mapOffer(offer, me) };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async acceptOffer({ taskId, offerId }) {
    try {
      const { job } = await this._req('POST', `/api/offers/${offerId}/accept`, { deposit_percent: 30 });
      const full = await this._enrichJob(job, false);
      return { ok: true, job: full };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* El backend no tiene endpoint para rechazar una oferta suelta: las
     pendientes se rechazan solas al aceptar otra (ver POST /offers/:id/accept). */
  async rejectOffer() {
    return { ok: false, error: 'El backend no permite rechazar ofertas sueltas: se rechazan solas cuando aceptás otra.' };
  },

  /* --- handyman: trabajos ---------------------------------------------- */
  async _jobConversation(job, create) {
    const { conversations } = await this._req('GET', '/api/conversations');
    let c = (conversations || []).find(x =>
      x.task_id === job.task_id &&
      (x.participants || []).includes(job.client_id) &&
      (x.participants || []).includes(job.handyman_id));
    if (!c && create) {
      const me = await this._me();
      const other = me.id === job.client_id ? job.handyman_id : job.client_id;
      const created = await this._req('POST', '/api/conversations', {
        participants: [other], task_id: job.task_id,
      });
      c = created.conversation;
    }
    return c || null;
  },

  /* Arma el trabajo como lo esperan las vistas: datos de la tarea +
     cotizaciones y mensajes (viven en el chat de la conversación). */
  async _enrichJob(job, withMessages) {
    const me = await this._me().catch(() => null);
    const myId = me ? me.id : null;
    const [taskRes, conv] = await Promise.all([
      this._req('GET', '/api/tasks/' + job.task_id).catch(() => null),
      this._jobConversation(job, false).catch(() => null),
    ]);
    const task = (taskRes && taskRes.task) || {};
    let messages = [], quotes = [];
    if (withMessages && conv) {
      const { messages: msgs } = await this._req('GET', `/api/conversations/${conv.id}/messages`).catch(() => ({ messages: [] }));
      const list = msgs || [];
      messages = list.map(m => this._mapChatMsg(m, myId));
      quotes = list.filter(m => m.quote).map(m => ({
        id: String(m.id), amount: m.quote.amount_gs, detail: m.quote.detail || '', status: m.quote.status,
      }));
    }
    let myRating = null, myReview = '';
    if (withMessages && job.status === 'completed' && myId != null) {
      const rRes = await this._req('GET', `/api/reviews?job_id=${job.id}`).catch(() => null);
      const mine = (rRes && rRes.reviews || []).find(r => r.from_user === myId);
      if (mine) { myRating = mine.rating; myReview = mine.text || ''; }
    }
    return {
      id: String(job.id), taskId: String(job.task_id), title: job.task_title || task.title || 'Trabajo',
      category: task.category || '', barrio: task.barrio || '', description: task.description || '',
      clientName: job.client_name || '', clientId: job.client_id === myId ? 'me' : job.client_id,
      handymanId: job.handyman_id === myId ? 'me' : job.handyman_id,
      handymanName: job.handyman_name || '',
      agreedPrice: job.agreed_price_gs, paid: job.paid_gs != null ? job.paid_gs : (job.agreed_price_gs || 0),
      status: job.status, photos: safeParse(task.photos, []).map(p => this._absUrl(p)),
      quotes, messages, myRating, myReview,
    };
  },

  async getJobs() {
    try {
      const { jobs } = await this._req('GET', '/api/jobs');
      const enriched = await Promise.all(
        (jobs || []).map(j => this._enrichJob(j, false).catch(() => null)));
      return enriched.filter(Boolean);
    } catch (e) { return []; }
  },

  async getJob(id) {
    try {
      const { job } = await this._req('GET', '/api/jobs/' + id);
      if (!job) return null;
      return await this._enrichJob(job, true);
    } catch (e) { return null; }
  },

  /* Separación de roles (validada también en el servidor): solo el handyman
     cotiza — la cotización viaja como mensaje con quote en el chat. */
  async sendQuote({ jobId, amount, detail }) {
    try {
      const me = await this._me();
      const { job } = await this._req('GET', '/api/jobs/' + jobId);
      if (job.handyman_id !== me.id)
        return { ok: false, error: 'Solo el handyman puede enviar la cotización.' };
      const conv = await this._jobConversation(job, true);
      if (!conv) return { ok: false, error: 'No se pudo abrir la conversación del trabajo.' };
      const { message } = await this._req('POST', `/api/conversations/${conv.id}/messages`, {
        text: 'Te mando mi cotización cerrada 👇',
        quote: { amount_gs: Number(amount), detail: (detail || '').trim() },
      });
      return {
        ok: true,
        quote: { id: String(message.id), amount: message.quote.amount_gs, detail: message.quote.detail || '', status: 'pending' },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async respondQuote({ jobId, quoteId, accept }) {
    try {
      const me = await this._me();
      const { job } = await this._req('GET', '/api/jobs/' + jobId);
      if (job.client_id !== me.id)
        return { ok: false, error: 'Solo el cliente puede aceptar la cotización.' };
      await this._req('PATCH', `/api/messages/${quoteId}/quote`, { status: accept ? 'accepted' : 'rejected' });
      if (accept) {
        const cur = (await this._req('GET', '/api/jobs/' + jobId)).job;
        if (cur.status === 'quoting')
          await this._req('PATCH', '/api/jobs/' + jobId, { status: 'in_progress' });
      }
      const full = await this._enrichJob((await this._req('GET', '/api/jobs/' + jobId)).job, true);
      return { ok: true, job: full };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* Fotos: el backend endurecido expone POST /api/uploads (devuelve {file:{url}}).
     Las fotos siempre se suben por ahí; la web nunca guarda data URLs en la DB.
     _absUrl: el backend devuelve urls relativas (/uploads/...) → absolutas. */
  _absUrl(u) {
    u = String(u || '');
    if (u.startsWith('/')) return apiBase() + u;
    return u;
  },

  async _uploadPhoto(dataUrl, filename) {
    const { file } = await this._req('POST', '/api/uploads', {
      filename: filename || 'foto.jpg', data_url: dataUrl,
    });
    if (!file || !file.url) throw new HttpError(0, 'No se pudo subir la foto.');
    return this._absUrl(file.url);
  },

  async sendJobMessage({ jobId, text, photoDataUrl }) {
    try {
      await this._me();
      const { job } = await this._req('GET', '/api/jobs/' + jobId);
      const conv = await this._jobConversation(job, true);
      if (!conv) return { ok: false, error: 'No se pudo abrir la conversación del trabajo.' };
      let photoUrl = null;
      if (photoDataUrl) {
        photoUrl = String(photoDataUrl).startsWith('data:')
          ? await this._uploadPhoto(photoDataUrl, 'foto.jpg')
          : this._absUrl(photoDataUrl);
      }
      await this._req('POST', `/api/conversations/${conv.id}/messages`, {
        text: text || '',
        photos: photoUrl ? [{ filename: 'foto.jpg', url: photoUrl }] : [],
      });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async completeJob({ jobId, rating, review, photos }) {
    try {
      const me = await this._me();
      const { job } = await this._req('GET', '/api/jobs/' + jobId);
      if (job.client_id !== me.id && job.handyman_id !== me.id)
        return { ok: false, error: 'Ese trabajo no es tuyo.' };
      if (job.status !== 'in_progress' && job.status !== 'quoting')
        return { ok: false, error: 'El trabajo no está en curso.' };
      if ((photos || []).length > 3) return { ok: false, error: 'Máximo 3 fotos en la reseña.' };
      if (job.status === 'quoting')
        await this._req('PATCH', '/api/jobs/' + jobId, { status: 'in_progress' });
      await this._req('PATCH', '/api/jobs/' + jobId, { status: 'completed' });
      const toUser = me.id === job.client_id ? job.handyman_id : job.client_id;
      await this._req('POST', '/api/reviews', {
        job_id: Number(jobId), to_user: toUser,
        rating: Number(rating) || 5, text: (review || '').trim(),
        photos: (photos || []).slice(0, 3), // máx 3, URLs de /api/uploads
      }).catch(() => null);
      const full = await this._enrichJob((await this._req('GET', '/api/jobs/' + jobId)).job, true);
      full.myRating = Number(rating) || 5;
      full.myReview = (review || '').trim();
      return { ok: true, job: full, paidTotal: full.agreedPrice };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* --- referidos ------------------------------------------------------- */
  async redeemReferral(code) {
    try {
      const clean = (code || '').trim().toUpperCase();
      if (!clean) return { ok: false, error: 'Ingresá un código.' };
      const r = await this._req('POST', '/api/referrals/redeem', { code: clean });
      HttpAdapter._user = null; // refrescar el crédito en la próxima lectura
      return { ok: true, credit: r.credit_gs };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async getCredit() {
    try {
      const { user } = await this._req('GET', '/api/me');
      HttpAdapter._user = user;
      return user.credit_gs || 0;
    } catch (e) { return 0; }
  },

  async myReferralCode() {
    try {
      const { referrals } = await this._req('GET', '/api/referrals');
      return (referrals && referrals[0] && referrals[0].code) || '';
    } catch (e) { return ''; }
  },

  /* --- notificaciones -------------------------------------------------- */
  async getNotifications() {
    try {
      const { notifications } = await this._req('GET', '/api/notifications');
      return (notifications || []).map(n => ({
        id: String(n.id), icon: NOTIF_ICONS[n.type] || '🔔', title: n.title,
        text: n.body || '', link: '#/reservas', time: relTime(n.created_at), read: Boolean(n.read),
      }));
    } catch (e) { return []; }
  },

  async unreadCount() {
    try {
      const { notifications } = await this._req('GET', '/api/notifications?unread=1');
      return (notifications || []).length;
    } catch (e) { return 0; }
  },

  async markAllRead() {
    try {
      const { notifications } = await this._req('GET', '/api/notifications?unread=1');
      await Promise.all((notifications || []).map(n =>
        this._req('PATCH', '/api/notifications/' + n.id, { read: true }).catch(() => null)));
    } catch (e) { /* noop */ }
    return { ok: true };
  },

  /* --- auth ------------------------------------------------------------ */
  async login({ email, password }) {
    try {
      const { user, token } = await this._req('POST', '/api/auth/login', { email, password });
      OppiStore.set(TOKEN_KEY, token);
      HttpAdapter._user = user;
      return { ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async register({ name, email, password, role, terms_accepted }) {
    try {
      const { user, token } = await this._req('POST', '/api/auth/register', { name, email, password, role, terms_accepted });
      OppiStore.set(TOKEN_KEY, token);
      HttpAdapter._user = user;
      return { ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  logout() { OppiStore.del(TOKEN_KEY); HttpAdapter._user = null; },

  /* ¿Es admin de la plataforma? (el backend lo trae en GET /api/me) */
  async isAdmin() {
    try {
      const me = await this._me();
      return me.role === 'admin';
    } catch (e) { return false; }
  },

  /* Preferencias de notificación: GET/PATCH /api/me/notification-prefs. */
  async getNotificationPrefs() {
    try {
      const data = await this._req('GET', '/api/me/notification-prefs');
      return Object.assign({ reminders: true, offers: true, messages: true, promos: true }, data.prefs || data || {});
    } catch (e) {
      return { reminders: true, offers: true, messages: true, promos: true };
    }
  },
  async updateNotificationPrefs(patch) {
    try {
      const data = await this._req('PATCH', '/api/me/notification-prefs', patch || {});
      return { ok: true, prefs: data.prefs || patch };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* Eliminar cuenta: DELETE /api/me con contraseña. Anonimiza la cuenta. */
  async deleteMe({ password } = {}) {
    try {
      await this._req('DELETE', '/api/me', { password });
      OppiStore.del(TOKEN_KEY);
      HttpAdapter._user = null;
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* ------------------------- panel admin (HTTP) ------------------------ */
  _normOverview(data) {
    const o = (data && data.overview) || data || {};
    return {
      usuarios: o.usuarios ?? o.users ?? o.total_users ?? 0,
      reservas_hoy: o.reservas_hoy ?? o.bookings_today ?? 0,
      reservas_semana: o.reservas_semana ?? o.bookings_week ?? 0,
      ingresos_brutos_gs: o.ingresos_brutos_gs ?? o.gross_revenue_gs ?? o.ingresos_brutos ?? 0,
      no_shows: o.no_shows ?? o.noShows ?? 0,
      suspendidas: o.suspendidas ?? o.suspended_users ?? o.cuentas_suspendidas ?? 0,
    };
  },
  _normVerification(v) {
    const u = v.user || v.owner || {};
    return {
      id: String(v.id), business_name: v.business_name || v.negocio || u.business_name || '—',
      owner_name: v.owner_name || u.name || v.nombre_dueno || '—',
      owner_email: v.owner_email || u.email || '',
      rubro: v.rubro || v.category || '', barrio: v.barrio || '',
      submitted_at: v.submitted_at || v.created_at || '',
      status: v.status || 'pending', reason: v.reason || '', decided_at: v.decided_at || '',
      // Equipo IA: pre-chequeo del verificador (score 0-100 + flags).
      precheck: v.precheck && typeof v.precheck.score === 'number'
        ? { score: v.precheck.score, flags: Array.isArray(v.precheck.flags) ? v.precheck.flags : [] }
        : null,
      documents: (v.documents || []).map(d => ({
        id: String(d.id), type: d.type || '',
        name: d.name || d.label || docLabel(d.type),
        photo_url: d.photo_url || d.photo || d.url || '',
      })),
    };
  },
  async getAdminOverview() {
    try {
      const data = await this._req('GET', '/api/admin/overview');
      return { ok: true, overview: this._normOverview(data) };
    } catch (e) { return { ok: false, error: e.message }; }
  },
  async getAdminVerifications() {
    try {
      const data = await this._req('GET', '/api/admin/verifications');
      const list = data.verifications || data.items || [];
      return { ok: true, verifications: list.map(v => this._normVerification(v)) };
    } catch (e) { return { ok: false, error: e.message }; }
  },
  async decideVerification(id, decision, reason) {
    try {
      const body = { decision };
      if (decision === 'rejected') body.reason = reason;
      const data = await this._req('POST', `/api/admin/verifications/${id}`, body);
      return { ok: true, verification: data.verification ? this._normVerification(data.verification) : null };
    } catch (e) { return { ok: false, error: e.message }; }
  },
  // Equipo IA: cola de moderación de reseñas.
  async getAdminModeration() {
    try {
      const data = await this._req('GET', '/api/admin/moderation');
      return { ok: true, queue: data.queue || [] };
    } catch (e) { return { ok: false, error: e.message }; }
  },
  async decideModeration(id, decision) {
    try {
      await this._req('POST', `/api/admin/moderation/${id}`, { decision });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },
  async getAdminUsers({ q } = {}) {
    try {
      const data = await this._req('GET', '/api/admin/users' + (q && q.trim() ? '?q=' + encodeURIComponent(q.trim()) : ''));
      return { ok: true, users: (data.users || []).map(u => ({ id: String(u.id), name: u.name || '—', email: u.email || '', role: u.role || 'client', suspended: !!u.suspended, created_at: u.created_at || '', reservas: u.reservas || u.bookings_count || 0 })) };
    } catch (e) {
      // Fallback: usuarios derivados de las verificaciones.
      try {
        const vr = await this.getAdminVerifications();
        const seen = {};
        (vr.verifications || []).forEach(v => {
          const key = v.owner_email || v.id;
          seen[key] = seen[key] || { id: v.id, name: v.owner_name, email: v.owner_email, role: 'business', suspended: false, created_at: v.submitted_at, reservas: 0 };
        });
        let users = Object.values(seen);
        if (q && q.trim()) {
          const t = q.trim().toLowerCase();
          users = users.filter(u => (u.name || '').toLowerCase().includes(t) || (u.email || '').toLowerCase().includes(t));
        }
        return { ok: true, users };
      } catch (e2) { return { ok: false, error: e.message }; }
    }
  },
  async suspendUser(id) {
    try {
      await this._req('POST', `/api/admin/users/${id}/suspend`);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },
  async unsuspendUser(id) {
    try {
      await this._req('POST', `/api/admin/users/${id}/unsuspend`);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async currentUser() {
    try {
      const me = await this._me();
      return { id: me.id, name: me.name, email: me.email, role: me.role };
    } catch (e) {
      return { name: 'Visitante', email: '' };
    }
  },

  /* --- Oppi Empresas --------------------------------------------------- */
  async _myBusinessId() {
    const me = await this._me();
    const { businesses } = await this._req('GET', '/api/businesses');
    const b = (businesses || []).find(x => x.user_id === me.id);
    return b ? b.id : null;
  },

  async getBusiness() {
    try {
      const bizId = await this._myBusinessId();
      if (!bizId) return null;
      const me = await this._me();
      const [detail, bookingsRes] = await Promise.all([
        this._req('GET', '/api/businesses/' + bizId),
        this._req('GET', '/api/bookings').catch(() => ({ bookings: [] })),
      ]);
      const b = detail.business;
      return {
        id: String(b.id), name: b.name, category: safeParse(b.categories, [])[0] || '',
        barrio: b.barrio || '', address: b.address || '', phone: me.phone || '',
        hours: scheduleText(safeParse(b.schedule, [])),
        verified: b.verification_status === 'verified',
        cancel_free_hours: b.cancel_free_hours != null ? Number(b.cancel_free_hours) : 24,
        services: (detail.services || []).map(s => ({
          id: String(s.id), name: s.name, price: s.price_gs, durationMin: 60,
          deposit: { type: s.deposit_type || 'none', value: Number(s.deposit_value) || 0 },
          active: true, // el backend no tiene flag de activo: siempre visibles
        })),
        team: (detail.team || []).map(m => ({
          id: String(m.id), name: m.name, email: m.email || '',
          // `role` puede ser el cargo ("Colorista") o el rol de acceso del
          // backend (admin|editor|lectura); `access_role` lo aclara.
          role: (m.role && !['admin', 'editor', 'lectura'].includes(m.role)) ? m.role : (m.job_role || m.title || ''),
          access_role: m.access_role || (['admin', 'editor', 'lectura'].includes(m.role) ? m.role : 'lectura'),
          initials: initialsOf(m.name), color: colorOf(m.name),
        })),
        reviews: (detail.reviews || []).map(r => ({
          id: String(r.id), author: r.from, rating: r.rating, date: '',
          text: r.text || '', reply: r.reply_text || null,
          photos: (r.photos || []).map(p => this._absUrl(p)),
        })),
        documents: (detail.documents || []).map(d => ({
          id: String(d.id), type: d.type, name: docLabel(d.type),
          status: d.status === 'approved' ? 'approved' : 'pending',
        })),
        bizBookings: (bookingsRes.bookings || []).map(bk => ({
          id: String(bk.id), clientName: bk.client_name || '', serviceName: bk.service_name || '',
          price: bk.total_gs, date: bk.slot_date || '', time: bk.slot_time || '', status: bk.status,
        })),
      };
    } catch (e) { return null; }
  },

  /* NOTA: el backend no guarda teléfono ni horario en texto libre del
     negocio (phone/hours del formulario se pierden). Cualquier cuenta puede
     dar de alta su negocio: al crearlo pasa a rol 'business'. */
  async createBusiness({ name, category, barrio, address, phone, services, hours }) {
    try {
      if (!name || !name.trim()) return { ok: false, error: 'Poné el nombre de tu negocio.' };
      if (!services || !services.length) return { ok: false, error: 'Agregá al menos un servicio.' };
      const { business } = await this._req('POST', '/api/businesses', {
        name: name.trim(), categories: category ? [category] : [],
        barrio: barrio || '', address: address || '', schedule: [],
        services: services.map(s => ({
          name: s.name, price_gs: Number(s.price),
          deposit_type: s.deposit.type, deposit_value: Number(s.deposit.value),
        })),
      });
      // Checklist inicial de documentos (como en el mock).
      for (const t of ['ruc', 'identidad', 'habilitacion']) {
        await this._req('POST', `/api/businesses/${business.id}/documents`, { type: t }).catch(() => null);
      }
      const full = await this.getBusiness();
      return { ok: true, business: full };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async updateBusinessService(serviceId, patch) {
    try {
      const body = {};
      if (patch.price != null) body.price_gs = Number(patch.price);
      if (patch.name != null) body.name = patch.name;
      if (patch.deposit) {
        body.deposit_type = patch.deposit.type;
        body.deposit_value = Number(patch.deposit.value);
      }
      const { service } = await this._req('PATCH', '/api/services/' + serviceId, body);
      return {
        ok: true,
        service: {
          id: String(service.id), name: service.name, price: service.price_gs, durationMin: 60,
          deposit: { type: service.deposit_type, value: Number(service.deposit_value) || 0 },
          active: patch.active !== false, // sin persistencia: el backend no tiene flag
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async addBusinessService(svc) {
    try {
      const bizId = await this._myBusinessId();
      if (!bizId) return { ok: false, error: 'Sin negocio.' };
      if (!svc.name || !svc.name.trim()) return { ok: false, error: 'Poné un nombre al servicio.' };
      const { service } = await this._req('POST', '/api/services', {
        business_id: bizId, name: svc.name.trim(), price_gs: Number(svc.price),
        deposit_type: svc.deposit.type, deposit_value: Number(svc.deposit.value),
      });
      return {
        ok: true,
        service: {
          id: String(service.id), name: service.name, price: service.price_gs, durationMin: 60,
          deposit: { type: service.deposit_type, value: Number(service.deposit_value) || 0 }, active: true,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async addTeamMember({ name, email, role, access_role }) {
    try {
      const bizId = await this._myBusinessId();
      if (!bizId) return { ok: false, error: 'Sin negocio.' };
      if (!name || !name.trim()) return { ok: false, error: 'Poné el nombre.' };
      const { member } = await this._req('POST', '/api/team', {
        business_id: bizId, name: name.trim(), email: String(email || '').trim(),
        role: role || '', access_role: access_role || 'lectura',
      });
      return {
        ok: true,
        member: {
          id: String(member.id), name: member.name, email: member.email || '',
          role: member.role || '', access_role: member.access_role || 'lectura',
          initials: initialsOf(member.name), color: colorOf(member.name),
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* Cambia el rol de acceso de un integrante (solo admin del equipo). */
  async updateTeamMemberRole(id, access_role) {
    try {
      if (!['admin', 'editor', 'lectura'].includes(access_role)) return { ok: false, error: 'Rol inválido.' };
      await this._req('PATCH', `/api/team/${id}`, { access_role });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* Rol de acceso del usuario logueado: admin de plataforma o dueño = admin;
     integrante del equipo = su access_role (el GET de equipo lo incluye). */
  async myTeamAccessRole() {
    try {
      const me = await this._me();
      if (me.role === 'admin') return 'admin';
      const { businesses } = await this._req('GET', '/api/businesses');
      const list = businesses || [];
      if (list.some(x => String(x.user_id) === String(me.id))) return 'admin';
      for (const b of list) {
        try {
          const detail = await this._req('GET', '/api/businesses/' + b.id);
          const m = (detail.team || []).find(t => String(t.email || '').toLowerCase() === String(me.email || '').toLowerCase());
          if (m) {
            const r = m.access_role || m.role;
            return ['admin', 'editor', 'lectura'].includes(r) ? r : 'lectura';
          }
        } catch (e) { /* sigue */ }
      }
      return null;
    } catch (e) { return null; }
  },

  async respondBusinessBooking(id, accept) {
    try {
      await this._req('PATCH', '/api/bookings/' + id, { status: accept ? 'confirmed' : 'cancelled' });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async replyReview(reviewId, text) {
    try {
      if (!text || !text.trim()) return { ok: false, error: 'Escribí tu respuesta.' };
      await this._req('POST', `/api/reviews/${reviewId}/reply`, { reply_text: text.trim() });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async uploadDocument(docId) {
    try {
      const b = await this.getBusiness();
      if (!b) return { ok: false, error: 'Sin negocio.' };
      const doc = (b.documents || []).find(d => String(d.id) === String(docId));
      if (!doc) return { ok: false, error: 'Documento no encontrado.' };
      // El backend simula la verificación del lado del dueño: al "subir",
      // el documento queda aprobado (en producción lo aprueba un admin).
      await this._req('PATCH', `/api/businesses/${b.id}/documents/${doc.id}`, { status: 'approved' });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* --- perfil propio (edición) ----------------------------------------- */
  async updateProfile({ name, email, barrio }) {
    try {
      const { user } = await this._req('PUT', '/api/me', { name, email, barrio });
      HttpAdapter._user = user;
      return { ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* Editar perfil — contrato exacto del backend: PATCH /api/me con
     { nombre, telefono, barrio, foto_url }. Devuelve el usuario actualizado. */
  async updateMe({ nombre, telefono, barrio, foto_url }) {
    try {
      const { user } = await this._req('PATCH', '/api/me', { nombre, telefono, barrio, foto_url });
      HttpAdapter._user = user;
      return { ok: true, user };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* Subida de foto de perfil contra POST /api/uploads (igual que las fotos
     de tareas/trabajos). Devuelve { ok, url }. */
  async uploadPhoto({ dataUrl, filename }) {
    try {
      const url = await this._uploadPhoto(dataUrl, filename || 'perfil.jpg');
      return { ok: true, url };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* Búsqueda para el mapa — contrato exacto del backend:
     GET /api/search acepta { q, rubro, lat, lng, radio_km }; con lat/lng
     ordena por distancia y cada resultado trae `distance_km`. */
  async search({ q, rubro, lat, lng, radio_km } = {}) {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (rubro) params.set('rubro', rubro);
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        params.set('lat', lat);
        params.set('lng', lng);
      }
      if (Number(radio_km) > 0) params.set('radio_km', radio_km);
      const qs = params.toString();
      const data = await this._req('GET', '/api/search' + (qs ? '?' + qs : ''));
      const list = data.results || data.professionals || [];
      const byPro = await this._servicesByPro();
      return list.map(p => {
        const m = this._mapPro(p, byPro[p.id] || []);
        m.distance_km = p.distance_km != null ? Number(p.distance_km) : null;
        if (p.lat != null) m.lat = Number(p.lat);
        if (p.lng != null) m.lng = Number(p.lng);
        return m;
      });
    } catch (e) { return []; }
  },

  /* Ganancias del negocio — contrato exacto del backend:
     GET /api/business/earnings?periodo=semana|mes →
     { periodo, ingresos_brutos, comision, neto, reservas_count,
       ticket_promedio, por_servicio: [{ servicio_id, nombre, reservas, ingresos }] } */
  async getEarnings(periodo) {
    try {
      const per = periodo === 'mes' ? 'mes' : 'semana';
      const data = await this._req('GET', '/api/business/earnings?periodo=' + per);
      return data;
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* --- cupones (Oppi Empresas) ----------------------------------------- */
  /* Contratos del backend:
     GET/POST /api/businesses/:id/coupons
     PATCH /api/coupons/:id { active }
     POST /api/coupons/validate { code, business_id, service_id } → { valid, discount_gs }
     POST /api/bookings acepta coupon_code (descuento al total; se cobra el 100% del total con descuento) */
  _mapCoupon(c) {
    return {
      id: String(c.id), business_id: c.business_id != null ? String(c.business_id) : null,
      code: c.code, type: c.discount_type || c.type || 'percent',
      value: Number(c.discount_value != null ? c.discount_value : c.value) || 0,
      max_uses: Number(c.max_uses) || 1, used_count: Number(c.used_count) || 0,
      active: c.active !== false,
      valid_from: c.valid_from || null, valid_to: c.valid_to || null,
    };
  },

  async getCoupons(bizId) {
    try {
      const id = bizId || await this._myBusinessId();
      if (!id) return [];
      const { coupons } = await this._req('GET', `/api/businesses/${id}/coupons`);
      return (coupons || []).map(c => this._mapCoupon(c));
    } catch (e) { return []; }
  },

  async createCoupon({ code, type, value, maxUses, validFrom, validTo }) {
    try {
      const bizId = await this._myBusinessId();
      if (!bizId) return { ok: false, error: 'Sin negocio.' };
      const { coupon } = await this._req('POST', `/api/businesses/${bizId}/coupons`, {
        code: String(code || '').trim().toUpperCase(),
        discount_type: type === 'fixed' ? 'fixed' : 'percent',
        discount_value: Number(value),
        max_uses: Math.max(1, Number(maxUses) || 1),
        valid_from: validFrom || null, valid_to: validTo || null,
      });
      return { ok: true, coupon: this._mapCoupon(coupon) };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async toggleCoupon(id, active) {
    try {
      const { coupon } = await this._req('PATCH', '/api/coupons/' + id, { active: active !== false });
      return { ok: true, coupon: this._mapCoupon(coupon) };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async validateCoupon({ code, business_id, service_id }) {
    try {
      const data = await this._req('POST', '/api/coupons/validate', {
        code: String(code || '').trim().toUpperCase(),
        business_id: Number(business_id), service_id: Number(service_id),
      });
      return data; // { valid, discount_gs } o { valid: false, error }
    } catch (e) { return { valid: false, error: e.message }; }
  },

  /* --- mis pagos ------------------------------------------------------- */
  /* GET /api/me/payments → { payments: [{ id, fecha, concepto, monto_gs, estado, booking_id?, tipo }] } */
  async getMyPayments() {
    try {
      const { payments } = await this._req('GET', '/api/me/payments');
      return (payments || []).map(p => ({
        id: String(p.id), fecha: p.fecha, concepto: p.concepto,
        monto_gs: p.monto_gs, estado: p.estado,
        booking_id: p.booking_id != null ? String(p.booking_id) : null, tipo: p.tipo,
      }));
    } catch (e) { return []; }
  },

  /* --- ganancias del profesional --------------------------------------- */
  /* GET /api/pro/earnings?periodo=semana|mes — misma forma que
     /api/business/earnings. */
  async getProEarnings(periodo) {
    try {
      const per = periodo === 'mes' ? 'mes' : 'semana';
      const data = await this._req('GET', '/api/pro/earnings?periodo=' + per);
      return data;
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* --- config del negocio ---------------------------------------------- */
  /* "Cancelación gratis hasta (horas)" — default 24. */
  async updateBusinessSettings({ cancel_free_hours }) {
    try {
      const bizId = await this._myBusinessId();
      if (!bizId) return { ok: false, error: 'Sin negocio.' };
      await this._req('PATCH', '/api/businesses/' + bizId, { cancel_free_hours: Number(cancel_free_hours) });
      return { ok: true, cancel_free_hours: Number(cancel_free_hours) };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* --- negocio público (perfil visible para clientes) ------------------ */
  /* INTEGRATION POINT: GET /api/businesses/:id con servicios, equipo,
     reseñas, horarios y política de cancelación del backend. */
  _mapBizPublic(b, detail) {
    const d = detail || {};
    return {
      id: String(b.id), name: b.name, category: safeParse(b.categories, [])[0] || 'Servicios',
      categories: safeParse(b.categories, []),
      barrio: b.barrio || '', address: b.address || '', phone: b.phone || '',
      verified: b.verification_status === 'verified',
      rating: b.rating || 0, reviewsCount: (d.reviews || []).length,
      cover: ['#6B5BD0', '#8B7CF0'], logoColor: '#6B5BD0',
      hoursWeek: [], openNow: true, openLabel: 'Abierto',
      cancelPolicyFull: 'Cancelación gratis hasta 24 h antes del turno: te devolvemos el 100%.',
      paymentMethods: ['Efectivo en el local'],
      services: (d.services || []).map(s => ({
        id: String(s.id), name: s.name, price: s.price_gs, durationMin: 60,
        deposit: { type: s.deposit_type || 'none', value: Number(s.deposit_value) || 0 },
        cat: 'Servicios', active: true,
      })),
      team: (d.team || []).map(m => ({
        id: String(m.id), name: m.name, role: m.role || '',
        initials: initialsOf(m.name), color: colorOf(m.name), rating: 5,
      })),
      reviews: (d.reviews || []).map(r => ({
        id: String(r.id), author: r.from, rating: r.rating, date: String(r.created_at || '').slice(0, 10),
        text: r.text || '', reply: r.reply_text || null,
        photos: (r.photos || []).map(p => this._absUrl(p)),
      })),
    };
  },

  async getPublicBusiness(id) {
    try {
      const detail = await this._req('GET', '/api/businesses/' + id);
      if (!detail.business) return null;
      return this._mapBizPublic(detail.business, detail);
    } catch (e) { return null; }
  },

  async createBusinessBooking({ bizId, serviceId, staffId, date, time, coupon_code }) {
    try {
      const { booking } = await this._req('POST', `/api/businesses/${bizId}/bookings`, {
        service_id: serviceId, staff_id: staffId || null, date, time,
        ...(coupon_code ? { coupon_code } : {}),
      });
      return {
        ok: true,
        booking: {
          id: String(booking.id), bizId: String(bizId), bizName: booking.business_name || '',
          serviceName: booking.service_name || '', staffName: booking.staff_name || 'Sin preferencia',
          price: booking.total_gs, discount_gs: booking.discount_gs || 0,
          coupon_code: booking.coupon_code || coupon_code || null,
          paid: booking.paid_gs != null ? booking.paid_gs : (booking.total_gs || 0),
          date: booking.slot_date || date, time: booking.slot_time || time, status: booking.status,
          en_route_at: booking.en_route_at || null,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async getBizBookings() {
    try {
      const { bookings } = await this._req('GET', '/api/bookings?as=business');
      return (bookings || []).map(b => this._mapBooking(b));
    } catch (e) { return []; }
  },

  /* --- soporte: bandeja de agentes (WhatsApp) -------------------------- */
  /* Contratos del backend:
     GET /api/support/conversations?status= →
       { conversations: [{ id, kind 'client'|'business', status 'bot'|'human'|'resolved',
         last_message, updated_at, user_name? }] }
     GET /api/support/conversations/:id/messages → { messages: [...] }
     POST /api/support/conversations/:id/reply { body }
     POST /api/support/conversations/:id/handoff | /bot | /resolve
     POST /api/support/agents { email } → agrega un agente
     El backend responde 403 si quien pide no es agente: los GET lanzan
     HttpError(403) para que la vista muestre "No tenés acceso". */
  _mapSupportConv(c) {
    return {
      id: String(c.id), kind: c.kind || 'client', status: c.status || 'bot',
      last_message: c.last_message || '', updated_at: c.updated_at || '',
      user_name: c.user_name || '',
      unread: Number(c.unread_count != null ? c.unread_count : (c.unread || 0)) || 0,
    };
  },

  _mapSupportMsg(m) {
    const incoming = m.from === 'user' || m.direction === 'in';
    return {
      id: String(m.id != null ? m.id : Math.random()),
      incoming,
      sender: !incoming && (m.sender === 'human' || m.agent_type === 'human') ? 'human' : null,
      text: m.body != null ? m.body : (m.text || ''),
      time: m.created_at ? relTime(m.created_at) : '',
    };
  },

  async getSupportConversations({ status } = {}) {
    const qs = status ? '?status=' + encodeURIComponent(status) : '';
    const { conversations } = await this._req('GET', '/api/support/conversations' + qs);
    return (conversations || []).map(c => this._mapSupportConv(c));
  },

  async getSupportMessages(id) {
    const { messages } = await this._req('GET', `/api/support/conversations/${id}/messages`);
    return (messages || []).map(m => this._mapSupportMsg(m));
  },

  async replySupportConversation(id, { body } = {}) {
    try {
      await this._req('POST', `/api/support/conversations/${id}/reply`, { body });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async handoffSupportConversation(id) {
    try {
      await this._req('POST', `/api/support/conversations/${id}/handoff`);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async botSupportConversation(id) {
    try {
      await this._req('POST', `/api/support/conversations/${id}/bot`);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async resolveSupportConversation(id) {
    try {
      await this._req('POST', `/api/support/conversations/${id}/resolve`);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* GET /api/support/agents → { agents: [{ id, email, added_at }] }.
     Si el backend todavía no lo expone, devuelve null y la vista muestra
     solo el formulario de alta (sin lista). */
  async getSupportAgents() {
    try {
      const { agents } = await this._req('GET', '/api/support/agents');
      return (agents || []).map(a => ({
        id: String(a.id), email: a.email || '', added_at: String(a.added_at || a.created_at || '').slice(0, 10),
      }));
    } catch (e) { return null; }
  },

  async addSupportAgent({ email } = {}) {
    try {
      const { agent } = await this._req('POST', '/api/support/agents', { email });
      return { ok: true, agent };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  /* GET /api/whatsapp/status → { mode 'mock'|'live', connected }. Si no
     existe, devuelve null y la vista omite la nota. */
  async getWhatsappStatus() {
    try {
      return await this._req('GET', '/api/whatsapp/status');
    } catch (e) { return null; }
  },

  /* --- soporte: chat integrado con bot (cliente) ----------------------- */
  /* Contratos del backend:
     POST /api/support/chat { body } → { reply, quick_replies[], status 'bot'|'human' }
     GET /api/support/chat/history → { messages: [{ id, sender 'user'|'bot'|'agent', body, created_at }] } */
  async supportChatHistory() {
    try {
      const { messages } = await this._req('GET', '/api/support/chat/history');
      return (messages || []).map(m => ({
        id: String(m.id != null ? m.id : Math.random()),
        sender: m.sender === 'user' ? 'user' : (m.sender === 'agent' ? 'agent' : 'bot'),
        body: m.body != null ? m.body : (m.text || ''),
        created_at: m.created_at || '',
      }));
    } catch (e) { return []; }
  },

  async supportChatSend({ body } = {}) {
    try {
      const { reply, quick_replies, status } = await this._req('POST', '/api/support/chat', { body });
      return {
        ok: true,
        reply: reply || '',
        quick_replies: Array.isArray(quick_replies) ? quick_replies : [],
        status: status === 'human' ? 'human' : 'bot',
      };
    } catch (e) { return { ok: false, error: e.message }; }
  },
};

/* ============ MEJORAS OPPI (8) — HttpAdapter ============ */
/* Cada método habla contra el contrato exacto del backend. Si el endpoint
   aún no existe, se degrada con gracia (la vista muestra estado amable,
   nunca un botón muerto). */
HttpAdapter.getTaxonomy = async function () {
  try {
    const d = await this._req('GET', '/api/taxonomy');
    if (d && Array.isArray(d.categories) && d.categories.length) return d;
  } catch (e) { /* fallback a la semilla local */ }
  return deepClone(TAXONOMY_SEED);
};

HttpAdapter.searchAdvanced = async function ({ q, category, barrio, minRating, min_price, max_price, disponibilidad, orden } = {}) {
  try {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (barrio) params.set('barrio', barrio);
    if (min_price != null && min_price !== '') params.set('min_price', min_price);
    if (max_price != null && max_price !== '') params.set('max_price', max_price);
    if (disponibilidad) params.set('disponibilidad', disponibilidad);
    if (orden) params.set('orden', orden);
    const qs = params.toString();
    const d = await this._req('GET', '/api/search' + (qs ? '?' + qs : ''));
    const items = d.results || d.professionals || [];
    const byPro = await this._servicesByPro();
    return items.map(p => this._mapPro(p, byPro[p.id] || []));
  } catch (e) { return []; }
};

HttpAdapter.getBranches = async function (businessId) {
  try {
    const d = await this._req('GET', `/api/businesses/${businessId}/branches`);
    return d.branches || [];
  } catch (e) { return []; }
};

HttpAdapter.createBranch = async function (businessId, data) {
  try {
    const d = await this._req('POST', `/api/businesses/${businessId}/branches`, data || {});
    return { ok: true, branch: d.branch || d };
  } catch (e) { return { ok: false, error: e.message }; }
};

HttpAdapter.updateBranch = async function (branchId, patch) {
  try {
    const d = await this._req('PATCH', `/api/branches/${branchId}`, patch || {});
    return { ok: true, branch: d.branch || d };
  } catch (e) { return { ok: false, error: e.message }; }
};

HttpAdapter.deleteBranch = async function (branchId) {
  try {
    await this._req('DELETE', `/api/branches/${branchId}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
};

HttpAdapter.getServiceDetail = async function (id) {
  try {
    const d = await this._req('GET', '/api/services/' + id);
    const s = d.service || d;
    if (!s || s.id == null) return null;
    const price = s.price_gs != null ? s.price_gs : (s.price || 0);
    return {
      id: String(s.id), name: s.name || '', price,
      durationMin: s.duration_min || s.durationMin || 45,
      deposit: s.deposit || { type: 'percent', value: 20 },
      photo_url: s.photo_url || null, description: s.description || '',
      includes: Array.isArray(s.includes) ? s.includes : [],
      owner: s.owner || (s.professional ? { type: 'pro', id: String(s.professional.id), name: s.professional.name }
        : s.business ? { type: 'business', id: String(s.business.id), name: s.business.name } : null),
    };
  } catch (e) { return null; }
};

HttpAdapter.updateServiceDetails = async function (id, patch) {
  try {
    const d = await this._req('PATCH', '/api/services/' + id, patch || {});
    return { ok: true, service: d.service || d };
  } catch (e) { return { ok: false, error: e.message }; }
};

HttpAdapter.getProClients = async function () {
  try {
    const d = await this._req('GET', '/api/pro/clients');
    return d.clients || [];
  } catch (e) { return []; }
};

HttpAdapter.getBizClients = async function (businessId) {
  try {
    const d = await this._req('GET', `/api/businesses/${businessId}/clients`);
    return d.clients || [];
  } catch (e) { return []; }
};

HttpAdapter.getClientHistory = async function (clientId) {
  try {
    const d = await this._req('GET', `/api/pro/clients/${clientId}`);
    const c = d.client || d;
    if (c && Array.isArray(c.historial)) return c.historial;
    if (c && Array.isArray(c.history)) return c.history;
  } catch (e) { /* sin endpoint: la vista muestra estado amable */ }
  return [];
};

HttpAdapter.getBookingDetail = async function (id) {
  try {
    const d = await this._req('GET', '/api/bookings/' + id);
    const b = d.booking || d;
    if (!b || b.id == null) return { ok: false, error: 'Reserva no encontrada.' };
    return { ok: true, booking: this._mapBooking(b), rol: 'cliente' };
  } catch (e) { return { ok: false, error: e.message }; }
};

HttpAdapter.getProStats = async function (periodo) {
  try {
    const per = periodo === 'mes' ? 'mes' : 'semana';
    const d = await this._req('GET', '/api/pro/stats?periodo=' + per);
    const st = d.stats || d;
    return st && typeof st === 'object' ? Object.assign({
      periodo: per, conversion_pct: null, response_time_median: null,
      recurrent_pct: 0, top_staff: null,
    }, st) : { ok: false, error: 'Sin datos.' };
  } catch (e) { return { ok: false, error: e.message }; }
};

HttpAdapter.getBizStats = async function (businessId, periodo) {
  try {
    const per = periodo === 'mes' ? 'mes' : 'semana';
    const d = await this._req('GET', `/api/businesses/${businessId}/stats?periodo=${per}`);
    const st = d.stats || d;
    return st && typeof st === 'object' ? Object.assign({
      periodo: per, conversion_pct: null, response_time_median: null,
      recurrent_pct: 0, top_staff: null,
    }, st) : { ok: false, error: 'Sin datos.' };
  } catch (e) { return { ok: false, error: e.message }; }
};

/* --- roles reales, tracking de vistas y mi resumen (contratos nuevos) --- */
/* GET /api/me → { user: { roles?: [...] } }. Si el backend aún no manda
   `roles`, se derivan del rol simple. */
HttpAdapter.myRoles = async function () {
  try {
    const me = await this._me();
    if (Array.isArray(me.roles) && me.roles.length) return me.roles;
    const roles = ['client'];
    if (me.role === 'pro' || me.role === 'handyman' || me.is_pro) roles.push('handyman');
    if (me.role === 'business' || me.has_business) roles.push('business');
    return roles;
  } catch (e) { return ['client']; }
};

/* POST de tracking: fire-and-forget (nunca rechazan: las vistas no esperan). */
HttpAdapter.trackProView = function (proId) {
  try {
    const r = this._req('POST', `/api/professionals/${proId}/view`);
    if (r && r.catch) r.catch(() => {});
  } catch (e) {}
  return { ok: true };
};
HttpAdapter.trackBizView = function (bizId) {
  try {
    const r = this._req('POST', `/api/businesses/${bizId}/view`);
    if (r && r.catch) r.catch(() => {});
  } catch (e) {}
  return { ok: true };
};

/* GET /api/me/summary → { completed_bookings, total_spent_gs, points }. */
HttpAdapter.getMySummary = async function () {
  try {
    const d = await this._req('GET', '/api/me/summary');
    return {
      ok: true,
      completed_bookings: d.completed_bookings || 0,
      total_spent_gs: d.total_spent_gs || 0,
      points: d.points || 0,
    };
  } catch (e) { return { ok: false, error: e.message }; }
};
/* ============ FIN MEJORAS OPPI (8) — HttpAdapter ============ */

/* ------------------------- Selección de adaptador -------------------------
 * ?mock=1            -> MockAdapter (forzado, sin probar el backend).
 * Sin ?mock          -> se prueba el backend una vez (GET /api/config con
 *                       timeout). Si responde: HttpAdapter. Si no: se cae a
 *                       MockAdapter y la UI muestra el badge "Modo demo
 *                       (sin conexión al servidor)". El mock sigue
 *                       funcionando 100% como antes.
 * ========================================================================== */
let ACTIVE_ADAPTER = null;
let ADAPTER_MODE = 'pending'; // 'http' | 'mock' | 'mock-fallback'

async function selectAdapter() {
  let forceMock = false;
  try {
    if (typeof location !== 'undefined') {
      forceMock = new URLSearchParams(location.search).get('mock') === '1';
    }
  } catch (e) { /* noop */ }
  if (forceMock) {
    ACTIVE_ADAPTER = MockAdapter;
    ADAPTER_MODE = 'mock';
    return;
  }
  try {
    await HttpAdapter.probe();
    ACTIVE_ADAPTER = HttpAdapter;
    ADAPTER_MODE = 'http';
  } catch (e) {
    ACTIVE_ADAPTER = MockAdapter;
    ADAPTER_MODE = 'mock-fallback';
  }
}

const OppiAPI = new Proxy({
  /* Llamar una vez al arrancar (app.js): elige el adaptador. */
  async init() {
    if (!ACTIVE_ADAPTER) await selectAdapter();
    return ADAPTER_MODE;
  },
  /* 'http' | 'mock' | 'mock-fallback' */
  adapterMode() { return ADAPTER_MODE; },
  /* URL base efectiva del backend (para mostrarla en el perfil). */
  apiUrl() { return apiBase(); },
}, {
  get(target, prop) {
    if (prop in target) {
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    }
    const fn = ACTIVE_ADAPTER ? ACTIVE_ADAPTER[prop] : undefined;
    if (typeof fn === 'function') return fn.bind(ACTIVE_ADAPTER);
    return fn;
  },
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OppiAPI, MockAdapter, HttpAdapter, fmtGs, uid };
}
