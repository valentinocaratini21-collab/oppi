/* ============================================================================
 * Oppi — Vistas públicas: Home, Buscar, Perfil profesional, Reserva
 * ========================================================================== */
'use strict';

function setView(html) {
  document.getElementById('view').innerHTML = html;
}

const ViewsPublic = {
  /* ------------------------------- HOME -------------------------------- */
  async home() {
    const cats = OppiAPI.getCategories();
    const recommended = (await OppiAPI.searchProfessionals({})).slice(0, 4);
    const recommendedCards = await Promise.all(recommended.map(p => UI.proCard(p)));
    setView(`
    <section class="home-hero">
      <p class="greeting">Hola, ¿qué necesitás hoy? 👋</p>
      <button class="location-pill" onclick="UI.toast('Ubicación: Asunción 📍')">📍 Asunción, Paraguay ▾</button>
      <form class="searchbar" id="homeSearch">
        <span>🔍</span>
        <input id="homeQ" type="search" placeholder="Buscá peluquería, plomero, masajes…" aria-label="Buscar">
      </form>
    </section>

    <section>
      <h2 class="sec-title">Categorías</h2>
      <div class="cat-grid">
        ${cats.map(c => `<a class="cat-tile" href="#/buscar?cat=${c.id}"><span class="cat-ico">${c.icon}</span><span>${c.name}</span></a>`).join('')}
      </div>
    </section>

    <a class="earn-card" href="#/handyman">
      <div>
        <strong>¿Querés ganar plata? 🔨</strong>
        <p>Ofertá en tareas cerca tuyo y cobrá en guaraníes.</p>
      </div>
      <span class="earn-arrow">→</span>
    </a>

    <section>
      <div class="sec-head"><h2 class="sec-title">Recomendados para vos</h2><a class="link" href="#/buscar">Ver todos</a></div>
      <div class="stack">${recommendedCards.join('')}</div>
    </section>

    <section>
      <h2 class="sec-title">Soy negocio</h2>
      <a class="card biz-cta" href="#/empresas">
        <div><strong>Registrá tu negocio en Oppi 🏪</strong>
        <p class="muted small">Recibí reservas online y llená tu agenda. Comisión solo si concretás.</p></div>
        <span>→</span>
      </a>
    </section>`);

    document.getElementById('homeSearch').addEventListener('submit', e => {
      e.preventDefault();
      const q = document.getElementById('homeQ').value.trim();
      Router.go('#/buscar' + (q ? '?q=' + encodeURIComponent(q) : ''));
    });
  },

  /* ------------------------------ BUSCAR ------------------------------- */
  /* Filtros: slider de precio mín/máx (Gs.), chips Hoy/Mañana/Esta semana y
     "Ordenar por". Llama a GET /api/search (OppiAPI.searchAdvanced).
     [Aplicar filtros] navega con los params; [Limpiar] resetea todo. */
  async search(params, query) {
    const cats = OppiAPI.getCategories();
    const barrios = OppiAPI.getBarrios();
    const PRICE_MAX = 500000;
    const filters = {
      q: query.q || '', category: query.cat || '', barrio: query.barrio || '',
      minRating: query.minRating ? Number(query.minRating) : 0,
      minPrice: query.min_price ? Number(query.min_price) : 0,
      maxPrice: query.max_price ? Number(query.max_price) : PRICE_MAX,
      disp: query.disponibilidad || '',
      orden: query.orden || 'relevancia',
    };
    const results = await OppiAPI.searchAdvanced({
      q: filters.q, category: filters.category, barrio: filters.barrio,
      minRating: filters.minRating,
      min_price: filters.minPrice > 0 ? filters.minPrice : undefined,
      max_price: filters.maxPrice < PRICE_MAX ? filters.maxPrice : undefined,
      disponibilidad: filters.disp || undefined,
      orden: filters.orden !== 'relevancia' ? filters.orden : undefined,
    });
    const resultCards = await Promise.all(results.map(p => UI.proCard(p)));

    const dispChips = [['', 'Todos'], ['hoy', 'Hoy'], ['manana', 'Mañana'], ['semana', 'Esta semana']];
    const ordenOpts = [
      ['relevancia', 'Relevancia'], ['precio_asc', 'Menor precio'], ['precio_desc', 'Mayor precio'],
      ['rating', 'Mejor rating'], ['distancia', 'Distancia'],
    ];

    setView(`
    <h1 class="page-title">Buscar profesionales</h1>
    <form class="searchbar" id="searchForm">
      <span>🔍</span>
      <input id="searchQ" type="search" placeholder="¿Qué necesitás?" value="${UI.esc(filters.q)}" aria-label="Buscar">
    </form>
    ${UI.categoryChips(cats, filters.category || null, '#/buscar')}
    <p class="small"><a class="link" href="#/categorias">Ver las 8 categorías →</a></p>

    <div class="card filters-card">
      <h3>🎚️ Filtros</h3>
      <div class="filter-row">
        <select id="fBarrio" aria-label="Barrio">
          <option value="">Todos los barrios</option>
          ${barrios.map(b => `<option ${b === filters.barrio ? 'selected' : ''}>${b}</option>`).join('')}
        </select>
        <select id="fRating" aria-label="Calificación mínima">
          <option value="0">Cualquier ⭐</option>
          <option value="4.5" ${filters.minRating === 4.5 ? 'selected' : ''}>4.5+ ⭐</option>
          <option value="4.8" ${filters.minRating === 4.8 ? 'selected' : ''}>4.8+ ⭐</option>
        </select>
      </div>
      <div class="price-slider">
        <div class="row between"><span class="small"><strong>Precio (Gs.)</strong></span><span class="small" id="priceLbl"></span></div>
        <input type="range" id="fMinPrice" min="0" max="${PRICE_MAX}" step="10000" value="${filters.minPrice}" aria-label="Precio mínimo">
        <input type="range" id="fMaxPrice" min="0" max="${PRICE_MAX}" step="10000" value="${filters.maxPrice}" aria-label="Precio máximo">
      </div>
      <div class="small"><strong>Disponibilidad</strong></div>
      <div class="chips" id="dispChips">
        ${dispChips.map(([v, l]) => `<button type="button" class="chip ${filters.disp === v ? 'active' : ''}" data-disp="${v}">${l}</button>`).join('')}
      </div>
      ${UI.field('Ordenar por', `<select id="fOrden">${ordenOpts.map(([v, l]) => `<option value="${v}" ${filters.orden === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      <div class="row gap">
        <button class="btn btn-ghost grow" id="fClear" type="button">Limpiar</button>
        <button class="btn btn-primary grow" id="fApply" type="button">Aplicar filtros</button>
      </div>
    </div>

    <p class="muted small">${results.length} resultado${results.length === 1 ? '' : 's'}</p>
    <div class="stack" id="results">
      ${results.length ? resultCards.join('') : UI.empty('🔍', 'Sin resultados', 'Probá con otra palabra o sacá algún filtro.')}
    </div>`);

    const minInp = document.getElementById('fMinPrice');
    const maxInp = document.getElementById('fMaxPrice');
    const lbl = document.getElementById('priceLbl');
    const paint = () => {
      let a = Number(minInp.value), b = Number(maxInp.value);
      if (a > b) { const t = a; a = b; b = t; }
      lbl.textContent = fmtGs(a) + ' – ' + (b >= PRICE_MAX ? fmtGs(b) + '+' : fmtGs(b));
    };
    minInp.addEventListener('input', paint);
    maxInp.addEventListener('input', paint);
    paint();

    let disp = filters.disp;
    document.getElementById('dispChips').addEventListener('click', e => {
      const c = e.target.closest('[data-disp]');
      if (!c) return;
      disp = c.dataset.disp;
      document.querySelectorAll('#dispChips .chip').forEach(x => x.classList.toggle('active', x === c));
    });

    const apply = () => {
      let a = Number(minInp.value), b = Number(maxInp.value);
      if (a > b) { const t = a; a = b; b = t; }
      const s = new URLSearchParams();
      const q = document.getElementById('searchQ').value.trim();
      if (q) s.set('q', q);
      if (filters.category) s.set('cat', filters.category);
      const barrio = document.getElementById('fBarrio').value;
      if (barrio) s.set('barrio', barrio);
      const mr = Number(document.getElementById('fRating').value);
      if (mr) s.set('minRating', mr);
      if (a > 0) s.set('min_price', a);
      if (b < PRICE_MAX) s.set('max_price', b);
      if (disp) s.set('disponibilidad', disp);
      const orden = document.getElementById('fOrden').value;
      if (orden && orden !== 'relevancia') s.set('orden', orden);
      const str = s.toString();
      Router.go('#/buscar' + (str ? '?' + str : ''));
    };
    document.getElementById('searchForm').addEventListener('submit', e => { e.preventDefault(); apply(); });
    document.getElementById('fApply').addEventListener('click', apply);
    document.getElementById('fClear').addEventListener('click', () => Router.go('#/buscar'));
  },

  /* --------------------------- PERFIL PROFESIONAL ---------------------- */
  /* §2 — Header con atrás/favorito/compartir; foto, nombre + ✓, rubro,
     ★ que salta a reseñas, barrio · distancia (MOCK derivada), "Responde
     en ~1 h" (MOCK); [Reservar] + [Enviar mensaje]; tabs Servicios |
     Reseñas | Info; disponibilidad con carrusel de 14 días + chips
     (mismo componente que el booking); sticky bottom bar. */
  async pro(params) {
    const p = await OppiAPI.getProfessional(params.id);
    if (!p) { setView(UI.empty('😕', 'No encontramos ese perfil', 'Volvé al inicio y probá de nuevo.', '<a class="btn btn-primary" href="#/">Ir al inicio</a>')); return; }
    // Tracking de visita (fire-and-forget: no bloquea el render).
    try { const r = OppiAPI.trackProView(p.id); if (r && r.catch) r.catch(() => {}); } catch (e) {}
    const fav = await OppiAPI.isFavorite(p.id);
    const meta = UI.proMeta(p);
    const minPrice = Math.min(...p.services.map(s => s.price));
    const firstSvc = p.services[0];

    setView(`
    <div class="pro-topbar">
      <button class="icon-btn" onclick="history.back()" aria-label="Atrás">←</button>
      <div class="tb-group">
        <button class="icon-btn fav-btn ${fav ? 'active' : ''}" data-fav="${p.id}" aria-label="Favorito">${fav ? '❤️' : '🤍'}</button>
        <button class="icon-btn" onclick="sharePage()" aria-label="Compartir">↗</button>
      </div>
    </div>

    <div class="card">
      <div class="pro-hero-top" style="display:flex;justify-content:center">${UI.avatar(p.initials, p.color, 84)}</div>
      <h1 class="center">${UI.esc(p.name)} ${p.verified ? UI.verifiedBadge() : ''}</h1>
      <p class="muted center">${UI.esc(p.specialty)}</p>
      <p class="center"><button class="stars-btn" data-goto-tab="resenas" aria-label="Ver reseñas">${UI.stars(p.rating, p.reviewsCount)}</button></p>
      <p class="muted small center">📍 ${UI.esc(p.barrio)} · a ${meta.distanceKm} km de vos</p>
      <p class="small center">⚡ ${meta.respondsIn}</p>
    </div>

    ${firstSvc ? `<a class="btn btn-primary btn-block btn-cta" href="#/reservar/${p.id}/${firstSvc.id}">Reservar</a>` : ''}
    <a class="btn btn-outline btn-block" href="#/chat/c_${p.id}">💬 Enviar mensaje</a>

    <div class="pro-tabs" role="tablist">
      <button class="pro-tab active" data-protab="servicios">Servicios</button>
      <button class="pro-tab" data-protab="resenas">Reseñas</button>
      <button class="pro-tab" data-protab="info">Info</button>
    </div>

    <div class="pro-tabpane" id="protab-servicios">
      <div class="stack">
        ${p.services.map(s => {
          return `<div class="card service-row">
            <div>
              <a class="link svc-link" href="#/servicio/${s.id}"><strong>${UI.esc(s.name)}</strong></a>
              <div class="muted small">⏱ ${s.durationMin} min</div>
            </div>
            <div class="service-cta">
              <span class="service-price">${fmtGs(s.price)}</span>
              <a class="btn btn-primary btn-sm" href="#/reservar/${p.id}/${s.id}">Elegir</a>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        ${UI.field('Disponibilidad para', `<select id="proSvcSel">${p.services.map(s => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('')}</select>`)}
        ${AvailabilityPicker.html('pro')}
        <button class="btn btn-primary btn-block btn-cta" id="proContinue" disabled>Continuar →</button>
      </div>
    </div>

    <div class="pro-tabpane" id="protab-resenas" hidden>
      <div class="card">
        <div class="row between">
          <div><span class="service-price">${p.rating}</span> <span class="muted">/ 5</span></div>
          <span class="muted small">${p.reviewsCount} reseñas</span>
        </div>
        ${UI.ratingBars(p.rating)}
      </div>
      <div class="stack">
        ${p.reviews.map(r => UI.reviewCard(r, p.name)).join('') || '<p class="muted">Todavía no tiene reseñas.</p>'}
      </div>
    </div>

    <div class="pro-tabpane" id="protab-info" hidden>
      <div class="card"><h3>Sobre ${UI.esc(p.name.split(' ')[0])}</h3><p class="small">${UI.esc(p.about)}</p></div>
      <div class="card"><h3>📍 Ubicación</h3><p class="small">${UI.esc(p.address)}<br><span class="muted">${UI.esc(p.barrio)} · a ${meta.distanceKm} km de vos</span></p></div>
      <div class="card"><h3>🕐 Horario</h3><p class="small">Lun a Sáb · 9:00 – 18:00</p><p class="small muted">Horario aproximado: se confirma al reservar.</p></div>
      <div class="card"><h3>❌ Cancelación</h3><p class="small">Gratis hasta 24 h antes del turno, con devolución del 100%.</p></div>
      <div class="card"><h3>💳 Pagos</h3><p class="small">Pagás el 100% online al reservar (hoy simulado). Sin vueltas ni pagos en el local.</p></div>
    </div>

    ${firstSvc ? `<div class="sticky-bookbar" id="stickyBar">
      <div><span class="muted small">Desde</span><br><strong class="service-price">${fmtGs(minPrice)}</strong></div>
      <a class="btn btn-primary btn-cta" href="#/reservar/${p.id}/${firstSvc.id}">Reservar</a>
    </div>` : ''}`);

    // Sticky bar: aparece al scrollear pasando el hero
    const bar = document.getElementById('stickyBar');
    if (bar) {
      const onScroll = () => {
        if (!document.body.contains(bar)) { window.removeEventListener('scroll', onScroll); return; }
        bar.classList.toggle('show', window.scrollY > 480);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    // Tabs
    const showTab = name => {
      document.querySelectorAll('[data-protab]').forEach(x => x.classList.toggle('active', x.dataset.protab === name));
      document.querySelectorAll('.pro-tabpane').forEach(x => { x.hidden = x.id !== 'protab-' + name; });
    };
    document.querySelectorAll('[data-protab]').forEach(t => t.addEventListener('click', () => showTab(t.dataset.protab)));
    document.querySelectorAll('[data-goto-tab]').forEach(b => b.addEventListener('click', () => {
      showTab(b.dataset.gotoTab);
      document.getElementById('protab-resenas').scrollIntoView();
    }));

    // Disponibilidad: mismo componente que el flujo de reserva
    let picked = null;
    AvailabilityPicker.bind({
      prefix: 'pro',
      proId: p.id,
      getServiceId: () => document.getElementById('proSvcSel').value,
      onSlot: sel => {
        picked = sel;
        document.getElementById('proContinue').disabled = false;
      },
    });
    document.getElementById('proContinue').addEventListener('click', () => {
      if (!picked) return;
      Router.go(`#/reservar/${p.id}/${picked.serviceId}?date=${picked.date}&time=${picked.time}`);
    });
  },
};

/* ----------------- PICKER DE DISPONIBILIDAD (compartido) ----------------- */
/* Carrusel de 14 días + chips de horario. Se usa en el perfil del
   profesional (§2) y en el paso 1 de la reserva. Si el día está lleno,
   ofrece la lista de espera. */
const AvailabilityPicker = {
  html(prefix) {
    const days = [];
    for (let i = 0; i < 14; i++) {
      const iso = todayPlus(i);
      const d = new Date(iso + 'T12:00:00');
      days.push({
        iso,
        dow: d.toLocaleDateString('es-PY', { weekday: 'short' }),
        num: d.getDate(),
        mon: d.toLocaleDateString('es-PY', { month: 'short' }),
      });
    }
    return `
    <h2 class="sec-title">Fecha</h2>
    <div class="day-strip" id="${prefix}Days">
      ${days.map(d => `<button class="day" data-date="${d.iso}"><span>${d.dow}</span><strong>${d.num}</strong><span class="small muted">${d.mon}</span></button>`).join('')}
    </div>
    <h2 class="sec-title">Hora</h2>
    <div id="${prefix}Slots" class="slot-grid"><p class="muted">Elegí un día primero 👆</p></div>
    <div id="${prefix}Waitlist"></div>`;
  },

  bind({ prefix, proId, getServiceId, onSlot, initial }) {
    const strip = document.getElementById(prefix + 'Days');
    const slotsBox = document.getElementById(prefix + 'Slots');
    const wlBox = document.getElementById(prefix + 'Waitlist');
    let date = null;

    const renderSlots = async iso => {
      date = iso;
      const serviceId = getServiceId();
      const slots = await OppiAPI.getDaySlots(proId, iso);
      const free = slots.filter(s => s.free);
      slotsBox.innerHTML = slots.map(s =>
        `<button class="slot ${s.free ? '' : 'busy'}" data-time="${s.time}" data-slot="${s.id || ''}" ${s.free ? '' : 'disabled'}>${s.time}</button>`
      ).join('');
      if (!free.length) {
        wlBox.innerHTML = `<div class="card warn-card">
          <strong>😕 Ese día está lleno</strong>
          <p class="small muted">Sumate a la lista de espera y te avisamos si se libera un turno.</p>
          <button class="btn btn-primary btn-sm" id="${prefix}JoinWl">Avisame si se libera 🔔</button>
        </div>`;
        document.getElementById(prefix + 'JoinWl').onclick = async () => {
          const r = await OppiAPI.joinWaitlist({ proId, serviceId, date: iso, time: 'cualquiera' });
          if (r.ok) UI.toast('Listo, te avisamos 🔔'); else UI.toast(r.error, 'error');
        };
        if (onSlot) onSlot(null);
        return;
      }
      wlBox.innerHTML = '';
      slotsBox.querySelectorAll('.slot:not(.busy)').forEach(b => b.addEventListener('click', () => {
        slotsBox.querySelectorAll('.slot').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        if (onSlot) onSlot({ date: iso, time: b.dataset.time, serviceId, slotId: b.dataset.slot || null });
      }));
      // Preselección (vengo del perfil con fecha/hora elegidas)
      if (initial && initial.date === iso && initial.time) {
        const b = Array.from(slotsBox.querySelectorAll('.slot:not(.busy)')).find(x => x.dataset.time === initial.time);
        if (b) b.click();
      }
    };

    strip.addEventListener('click', async e => {
      const b = e.target.closest('[data-date]');
      if (!b) return;
      strip.querySelectorAll('.day').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      await renderSlots(b.dataset.date);
    });

    // Cambio de servicio: limpia la selección
    const svcSel = document.getElementById(prefix + 'SvcSel');
    if (svcSel) svcSel.addEventListener('change', () => {
      if (onSlot) onSlot(null);
      if (date) renderSlots(date);
    });

    if (initial && initial.date) {
      const b = strip.querySelector(`[data-date="${initial.date}"]`);
      if (b) { b.classList.add('active'); renderSlots(initial.date); }
    }
  },
};

/* ------------------------- RESERVA EN 3 PASOS ---------------------------- */
const BookingFlow = {
  state: {},

  /* Paso 1: fecha y hora (usa el picker compartido con el perfil) */
  async step1(params, query) {
    const p = await OppiAPI.getProfessional(params.proId);
    if (!p || !p.services.length) { Router.go('#/buscar'); return; }
    const svc0 = p.services.find(s => s.id === params.serviceId) || p.services[0];
    this.state = { proId: p.id, serviceId: svc0.id, date: null, time: null };
    const q = query || {};

    setView(`
    <a class="back-link" href="#/pro/${p.id}">← ${UI.esc(p.name)}</a>
    <div class="steps"><span class="step active">1</span><span class="step">2</span><span class="step">3</span></div>
    <h1 class="page-title">Elegí fecha y hora</h1>
    <div class="card">
      ${UI.field('Servicio', `<select id="bkSvcSel">${p.services.map(s => `<option value="${s.id}" ${s.id === svc0.id ? 'selected' : ''}>${UI.esc(s.name)} · ${fmtGs(s.price)}</option>`).join('')}</select>`)}
      <div id="bkSvcCard"></div>
    </div>
    <div class="card">
      ${AvailabilityPicker.html('bk')}
    </div>
    <button class="btn btn-primary btn-block btn-cta" id="toStep2" disabled>Continuar →</button>
    <button class="btn btn-ghost btn-block" onclick="history.back()">← Volver</button>`);

    const paintSvc = () => {
      const svc = p.services.find(s => s.id === BookingFlow.state.serviceId);
      document.getElementById('bkSvcCard').innerHTML =
        `<strong>${UI.esc(svc.name)}</strong> con ${UI.esc(p.name)}<br><span class="muted">${fmtGs(svc.price)} · ⏱ ${svc.durationMin} min</span>`;
    };
    paintSvc();

    document.getElementById('bkSvcSel').addEventListener('change', e => {
      BookingFlow.state.serviceId = e.target.value;
      BookingFlow.state.date = null;
      BookingFlow.state.time = null;
      document.getElementById('toStep2').disabled = true;
      paintSvc();
    });

    AvailabilityPicker.bind({
      prefix: 'bk',
      proId: p.id,
      getServiceId: () => BookingFlow.state.serviceId,
      initial: q.date && q.time ? { date: q.date, time: q.time } : null,
      onSlot: sel => {
        if (!sel) {
          BookingFlow.state.date = null;
          BookingFlow.state.time = null;
          document.getElementById('toStep2').disabled = true;
          return;
        }
        BookingFlow.state.date = sel.date;
        BookingFlow.state.time = sel.time;
        BookingFlow.state.serviceId = sel.serviceId;
        document.getElementById('toStep2').disabled = false;
      },
    });

    document.getElementById('toStep2').addEventListener('click', async () => {
      if (BookingFlow.state.date && BookingFlow.state.time) await BookingFlow.step2();
    });
  },

  /* Paso 2: confirmar + pago 100% */
  async step2() {
    const { proId, serviceId, date, time } = this.state;
    const p = await OppiAPI.getProfessional(proId);
    const svc = p.services.find(s => s.id === serviceId);
    const credit = await OppiAPI.getCredit();
    const d = new Date(date + 'T12:00:00');
    const total = svc.price;

    setView(`
    <div class="steps"><span class="step done">✓</span><span class="step active">2</span><span class="step">3</span></div>
    <h1 class="page-title">Confirmá tu reserva</h1>
    <div class="card">
      <div class="row between"><span><strong>${UI.esc(svc.name)}</strong><br><span class="muted small">${UI.esc(p.name)}</span></span><strong>${fmtGs(total)}</strong></div>
      <hr class="sep">
      <div class="row between"><span>📅 ${d.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long' })}</span><span>🕐 ${time}</span></div>
    </div>
    ${credit > 0 ? `<label class="card check-card"><input type="checkbox" id="useCredit" checked> <span>Usar mi crédito de <strong>${fmtGs(credit)}</strong></span></label>` : ''}
    <div class="card deposit-card">
      <div id="payTotals">
        <div class="row between"><span>Total a pagar</span><strong>${fmtGs(total)}</strong></div>
      </div>
      <p class="small">💳 Pago simulado — acá iría la pasarela real.</p>
    </div>
    <p class="small muted center">Cancelación gratis hasta 24 h antes, con devolución del 100%.</p>
    <button class="btn btn-primary btn-block btn-cta" id="payBtn">Pagar ${fmtGs(total)} · pago simulado</button>
    <button class="btn btn-ghost btn-block" onclick="history.back()">← Volver</button>`);

    const paintPay = () => {
      const useCredit = document.getElementById('useCredit')?.checked;
      const cUsed = useCredit ? Math.min(credit, total) : 0;
      const toPay = Math.max(0, total - cUsed);
      document.getElementById('payTotals').innerHTML = `
        ${cUsed ? `<div class="row between"><span>Crédito aplicado</span><strong class="money-in">−${fmtGs(cUsed)}</strong></div>` : ''}
        <div class="row between"><span>Total a pagar</span><strong>${fmtGs(toPay)}</strong></div>`;
      document.getElementById('payBtn').textContent = `Pagar ${fmtGs(toPay)} · pago simulado`;
    };
    const useCreditEl = document.getElementById('useCredit');
    if (useCreditEl) { useCreditEl.addEventListener('change', paintPay); paintPay(); }

    document.getElementById('payBtn').addEventListener('click', async () => {
      const useCredit = document.getElementById('useCredit')?.checked;
      const r = await OppiAPI.createBooking({ proId, serviceId, date, time, payWithCredit: useCredit });
      if (!r.ok) { UI.toast(r.error, 'error'); return; }
      BookingFlow.step3(r.booking);
    });
  },

  /* Paso 3: éxito */
  async step3(booking) {
    // Con el backend real la reserva nace "pending" (la confirma el
    // profesional); con el mock nace "confirmed". El copete lo refleja.
    const pending = booking.status === 'pending';
    const banner = await ViewsCancel.bannerFor(booking.id);
    setView(`
    <div class="steps"><span class="step done">✓</span><span class="step done">✓</span><span class="step active">3</span></div>
    <div class="success-hero">
      <div class="success-check">✓</div>
      <h1>${pending ? '¡Reserva creada! 🎉' : '¡Reserva confirmada! 🎉'}</h1>
      <p class="muted">${UI.esc(booking.serviceName)} con ${UI.esc(booking.proName)}</p>
      <div class="card">
        <div class="row between"><span>📅 Fecha</span><strong>${new Date(booking.date + 'T12:00:00').toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' })} · ${booking.time}</strong></div>
        <hr class="sep">
        <div class="row between"><span>${pending ? 'A pagar al confirmar' : 'Pagado'}</span><strong>${fmtGs(booking.paid)}</strong></div>
        ${booking.creditUsed ? `<div class="row between"><span>Crédito usado</span><strong>−${fmtGs(booking.creditUsed)}</strong></div>` : ''}
      </div>
      ${banner}
      <p class="small muted">${pending
        ? 'El profesional la confirma en breve. Te avisamos cuando esté lista 💜'
        : 'Te vamos a avisar un día antes. ¡Nos vemos! 💜'}</p>
      <a class="btn btn-primary btn-block" href="#/reservas">Ver mis reservas</a>
      <a class="btn btn-ghost btn-block" href="#/">Volver al inicio</a>
    </div>`);
  },
};

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
