/* ============================================================================
 * Oppi — 8 mejoras: Sucursales, Detalle de servicio, Filtros de búsqueda,
 * Clientes, Detalle de reserva, Reportes, Taxonomía y Onboarding.
 * ========================================================================== */
'use strict';

/* ------------------------------ ONBOARDING ----------------------------- */
/* Carrusel de 3 pantallas, solo la primera vez (flag en localStorage
   `oppi_onboarding_done`). app.js lo muestra antes de arrancar el router. */
const Onboarding = {
  KEY: 'oppi_onboarding_done',
  SLIDES: [
    { emoji: '🗺️', title: 'Todos los servicios que necesitás, en un solo lugar', text: 'Peluquería, hogar, mascotas, clases y más. Cerca tuyo y en guaraníes.' },
    { emoji: '⭐', title: 'Elegí el mejor profesional', text: 'Reseñas reales, precios claros y perfiles verificados. Sin sorpresas.' },
    { emoji: '📅', title: 'Reservá fácil y rápido', text: 'Elegí día y hora, pagá el total y listo. Te avisamos antes del turno.' },
  ],

  done() {
    try { return !!OppiStore.get(this.KEY); } catch (e) { return false; }
  },
  markDone() {
    try { OppiStore.set(this.KEY, true); } catch (e) { /* noop */ }
  },

  show(onDone) {
    let i = 0;
    const overlay = document.createElement('div');
    overlay.className = 'onb-overlay';
    overlay.id = 'onbOverlay';
    const renderSlide = () => {
      const s = this.SLIDES[i];
      const last = i === this.SLIDES.length - 1;
      overlay.innerHTML = `
        <div class="onb-card">
          <button class="onb-skip" id="onbSkip">Omitir</button>
          <div class="onb-emoji" role="img" aria-hidden="true">${s.emoji}</div>
          <h1>${s.title}</h1>
          <p>${s.text}</p>
          <div class="onb-dots">${this.SLIDES.map((_, k) => `<span class="onb-dot ${k === i ? 'on' : ''}"></span>`).join('')}</div>
          ${last
            ? '<button class="btn btn-light btn-block btn-cta" id="onbNext">Comenzar 🎉</button>'
            : '<button class="btn btn-light btn-block btn-cta" id="onbNext">Siguiente →</button>'}
        </div>`;
      document.getElementById('onbNext').addEventListener('click', () => {
        if (last) finish(); else { i++; renderSlide(); }
      });
      document.getElementById('onbSkip').addEventListener('click', finish);
    };
    const finish = () => {
      this.markDone();
      overlay.remove();
      if (onDone) onDone();
    };
    document.body.appendChild(overlay);
    renderSlide();
  },
};

const ViewsPlus = {
  /* ------------------------------ helpers ------------------------------ */
  /* "jue 2 oct" */
  fmtFecha(iso) {
    if (!iso) return '';
    const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' });
  },

  /* Selectores en cascada categoría → profesión (nada de texto libre).
     Devuelve el HTML; bindCascade() conecta los selects. */
  async cascadeHtml({ catId, profId, selectedCat, selectedProf, labelCat, labelProf } = {}) {
    const tax = await OppiAPI.getTaxonomy();
    const cats = (tax && tax.categories) || [];
    if (!cats.length) {
      return UI.field(labelCat || 'Categoría', `<input id="${catId}" value="${UI.esc(selectedCat || '')}" placeholder="Ej: Peluquería">`);
    }
    return `
      ${UI.field(labelCat || 'Categoría *', `<select id="${catId}">
        <option value="">Elegí una categoría…</option>
        ${cats.map(c => `<option value="${c.id}" ${c.id === selectedCat ? 'selected' : ''}>${c.icono || ''} ${UI.esc(c.nombre)}</option>`).join('')}
      </select>`)}
      ${UI.field(labelProf || 'Profesión *', `<select id="${profId}" disabled>
        <option value="">Primero elegí la categoría…</option>
      </select>`)}`;
  },

  async bindCascade({ catId, profId, selectedProf }) {
    const catSel = document.getElementById(catId);
    const profSel = document.getElementById(profId);
    if (!catSel || !profSel) return;
    const tax = await OppiAPI.getTaxonomy();
    const cats = (tax && tax.categories) || [];
    const fill = () => {
      const cat = cats.find(c => c.id === catSel.value);
      const profs = (cat && cat.professions) || [];
      profSel.disabled = !profs.length;
      profSel.innerHTML = profs.length
        ? `<option value="">Elegí tu profesión…</option>` + profs.map(p =>
            `<option value="${UI.esc(p.nombre)}" ${p.nombre === selectedProf ? 'selected' : ''}>${UI.esc(p.nombre)}</option>`).join('')
        : `<option value="">Primero elegí la categoría…</option>`;
    };
    catSel.addEventListener('change', () => { selectedProf = null; fill(); });
    fill();
  },

  catName(catId) {
    const tax = typeof TAXONOMY_SEED !== 'undefined' ? TAXONOMY_SEED : null;
    const c = tax && tax.categories.find(x => x.id === catId);
    return c ? c.nombre : catId;
  },

  /* Campo de foto: URL o subida a /api/uploads (OppiAPI.uploadPhoto). */
  photoField(prefix, currentUrl) {
    return `
      ${currentUrl ? `<div class="photo-preview"><img src="${UI.esc(currentUrl)}" alt="Foto del servicio" loading="lazy"></div>` : ''}
      ${UI.field('Foto (URL)', `<input id="${prefix}FotoUrl" type="url" inputmode="url" placeholder="https://…" value="${UI.esc(currentUrl || '')}">`)}
      ${UI.field('O subí una foto', `<input id="${prefix}FotoFile" type="file" accept="image/*">`)}
      <p class="small error" id="${prefix}FotoErr"></p>`;
  },

  bindPhotoField(prefix) {
    const file = document.getElementById(prefix + 'FotoFile');
    const urlInp = document.getElementById(prefix + 'FotoUrl');
    const err = document.getElementById(prefix + 'FotoErr');
    if (!file || !urlInp) return;
    file.addEventListener('change', async () => {
      if (!file.files.length) return;
      const f = file.files[0];
      if (!f.type.startsWith('image/')) { if (err) err.textContent = 'Tiene que ser una imagen.'; return; }
      if (err) err.textContent = '';
      const dataUrl = await new Promise(res => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => res(null);
        r.readAsDataURL(f);
      });
      if (!dataUrl) { if (err) err.textContent = 'No se pudo leer la imagen.'; return; }
      UI.toast('Subiendo foto…');
      const up = await OppiAPI.uploadPhoto({ dataUrl, filename: f.name });
      if (!up.ok) { if (err) err.textContent = up.error || 'No se pudo subir.'; return; }
      urlInp.value = up.url;
      UI.toast('Foto lista ✅');
    });
  },

  /* ------------------------- 2. DETALLE DE SERVICIO -------------------- */
  /* Ruta #/servicio/:id — foto, descripción, "Incluye" ✓, duración,
     precio total y [Reservar]. */
  async serviceDetail(params) {
    const d = await OppiAPI.getServiceDetail(params.id);
    if (!d) {
      setView(`
      <a class="back-link" href="javascript:history.back()">← Volver</a>
      ${UI.empty('🔍', 'No encontramos ese servicio', 'Puede que ya no esté disponible.', '<a class="btn btn-primary" href="#/buscar">Buscar servicios</a>')}`);
      return;
    }
    const backHref = d.owner && d.owner.type === 'business' ? '#/negocio/' + d.owner.id : '#/pro/' + (d.owner ? d.owner.id : '');
    const reservarHref = d.owner && d.owner.type === 'business'
      ? `#/negocio/${d.owner.id}/reservar?servicio=${d.id}`
      : `#/reservar/${d.owner ? d.owner.id : ''}/${d.id}`;
    setView(`
    <a class="back-link" href="${backHref}">← ${UI.esc(d.owner ? d.owner.name : 'Volver')}</a>
    <div class="card svc-photo-card">
      ${d.photo_url
        ? `<img class="svc-photo" src="${UI.esc(d.photo_url)}" alt="${UI.esc(d.name)}">`
        : `<div class="svc-photo svc-photo-ph" role="img" aria-label="Sin foto">💈</div>`}
    </div>
    <div class="card">
      <div class="row between"><h1 class="svc-title">${UI.esc(d.name)}</h1>${UI.stars(d.owner ? d.owner.rating : 0)}</div>
      <p class="muted small">por <a class="link" href="${backHref}">${UI.esc(d.owner ? d.owner.name : '')}</a></p>
      ${d.description ? `<p>${UI.esc(d.description)}</p>` : '<p class="muted small">El profesional todavía no escribió una descripción de este servicio.</p>'}
      <h3 class="sec-title">Incluye ✓</h3>
      <ul class="includes">
        ${(d.includes || []).map(x => `<li><span class="inc-check">✓</span> ${UI.esc(x)}</li>`).join('') || '<li class="muted">Sin detalle todavía.</li>'}
      </ul>
      <div class="row gap">
        <div class="card stat grow"><strong>⏱ ${d.durationMin} min</strong><span class="muted small">Duración</span></div>
        <div class="card stat grow"><strong>${fmtGs(d.price)}</strong><span class="muted small">Precio total</span></div>
      </div>
      <a class="btn btn-primary btn-block btn-cta" href="${reservarHref}">Reservar · ${fmtGs(d.price)}</a>
      <p class="small muted center">Pagás el total ahora · pago simulado · cancelación gratis hasta 24 h antes.</p>
      ${d.owner && d.owner.type === 'pro' ? `<a class="btn btn-outline btn-block" href="#/chat/c_${d.owner.id}">💬 Enviar mensaje</a>` : ''}
    </div>`);
  },

  /* ------------------ 7. TAXONOMÍA: CATEGORÍAS ------------------------- */
  /* Ruta #/categorias — grilla con las 8 → subcategorías. */
  async categories() {
    const tax = await OppiAPI.getTaxonomy();
    const cats = (tax && tax.categories) || [];
    setView(`
    <h1 class="page-title">Categorías</h1>
    <p class="muted small">¿Qué necesitás hoy? Elegí una categoría 👇</p>
    ${cats.length ? `<div class="cat-grid">
      ${cats.map(c => `<a class="cat-tile" href="#/categorias/${c.id}">
        <span class="cat-ico">${c.icono || '🛠️'}</span><span>${UI.esc(c.nombre)}</span>
        <span class="muted small">${(c.subcategories || []).length} rubros</span>
      </a>`).join('')}
    </div>` : UI.empty('🗂️', 'No pudimos cargar las categorías', 'Revisá tu conexión e intentá de nuevo.', '<a class="btn btn-primary" href="#/">Ir al inicio</a>')}`);
  },

  async categoryDetail(params) {
    const tax = await OppiAPI.getTaxonomy();
    const cat = (tax && tax.categories || []).find(c => c.id === params.id);
    if (!cat) {
      setView(`<a class="back-link" href="#/categorias">← Categorías</a>${UI.empty('🔍', 'No encontramos esa categoría', 'Probá con otra.', '<a class="btn btn-primary" href="#/categorias">Ver categorías</a>')}`);
      return;
    }
    setView(`
    <a class="back-link" href="#/categorias">← Categorías</a>
    <h1 class="page-title">${cat.icono || ''} ${UI.esc(cat.nombre)}</h1>
    <p class="muted small">Elegí el rubro que buscás 👇</p>
    <div class="stack">
      ${(cat.subcategories || []).map(s => `
        <a class="card service-row" href="#/buscar?q=${encodeURIComponent(s.nombre)}">
          <div><strong>${UI.esc(s.nombre)}</strong></div>
          <span>→</span>
        </a>`).join('') || '<p class="muted">Sin rubros todavía.</p>'}
    </div>`);
  },

  /* ------------------------- 1. SUCURSALES ----------------------------- */
  /* Ruta #/empresas/sucursales — listar, agregar, editar, eliminar (con
     confirmación). */
  async branches() {
    if (!(await bizGuard(['admin']))) return;
    const b = await OppiAPI.getBusiness();
    if (!b) { Router.go('#/empresas'); return; }
    const list = await OppiAPI.getBranches(b.id);

    setView(`
    <a class="back-link" href="#/empresas/panel">← Panel</a>
    <h1 class="page-title">Sucursales 🏪</h1>
    <p class="muted small">Si tenés más de un local, los clientes eligen la sucursal al reservar.</p>
    <div class="stack" id="brList">
      ${list.length ? list.map(br => `
        <div class="card">
          <div class="row between"><strong>${UI.esc(br.nombre)}</strong>
            <div class="row gap">
              <button class="btn btn-ghost btn-sm" data-br-edit="${br.id}">Editar</button>
              <button class="btn btn-danger-soft btn-sm" data-br-del="${br.id}">Eliminar</button>
            </div>
          </div>
          ${br.direccion ? `<div class="muted small">📍 ${UI.esc(br.direccion)}</div>` : ''}
          <div class="muted small">${br.horario ? '🕐 ' + UI.esc(br.horario) : ''} ${br.telefono ? ' · 📞 ' + UI.esc(br.telefono) : ''}</div>
        </div>`).join('')
        : UI.empty('🏪', 'Todavía no cargaste sucursales', 'Si atendés en un solo lugar no hace falta: tu dirección principal ya está publicada. Cuando abras otra sucursal, agregala acá.', '')}
    </div>
    <div class="card">
      <h3>Agregar sucursal</h3>
      <form id="brForm" class="stack">
        ${UI.field('Nombre *', `<input id="brNombre" required maxlength="60" placeholder="Ej: Sucursal Villa Morra">`)}
        ${UI.field('Dirección', `<input id="brDir" placeholder="Av. Mariscal López 2024">`)}
        <div class="row gap">
          ${UI.field('Teléfono', `<input id="brTel" placeholder="0981 000 000">`)}
          ${UI.field('Horario', `<input id="brHor" placeholder="Lun a Sáb 9:00–18:00">`)}
        </div>
        <p class="small error" id="brErr"></p>
        <button class="btn btn-primary btn-block" type="submit">＋ Agregar sucursal</button>
      </form>
    </div>`);

    document.getElementById('brForm').addEventListener('submit', async e => {
      e.preventDefault();
      const r = await OppiAPI.createBranch(b.id, {
        nombre: document.getElementById('brNombre').value,
        direccion: document.getElementById('brDir').value.trim(),
        telefono: document.getElementById('brTel').value.trim(),
        horario: document.getElementById('brHor').value.trim(),
      });
      if (!r.ok) { document.getElementById('brErr').textContent = r.error; return; }
      UI.toast('Sucursal agregada ✅');
      ViewsPlus.branches();
    });

    document.querySelectorAll('[data-br-edit]').forEach(btn => btn.addEventListener('click', () => {
      const br = list.find(x => x.id === btn.dataset.brEdit);
      if (!br) return;
      UI.modal(`
        <button class="modal-x" id="mX" aria-label="Cerrar">✕</button>
        <h3>Editar sucursal</h3>
        <div class="stack">
          ${UI.field('Nombre *', `<input id="beNombre" maxlength="60" value="${UI.esc(br.nombre)}">`)}
          ${UI.field('Dirección', `<input id="beDir" value="${UI.esc(br.direccion || '')}">`)}
          <div class="row gap">
            ${UI.field('Teléfono', `<input id="beTel" value="${UI.esc(br.telefono || '')}">`)}
            ${UI.field('Horario', `<input id="beHor" value="${UI.esc(br.horario || '')}">`)}
          </div>
          <p class="small error" id="beErr"></p>
          <button class="btn btn-primary btn-block" id="beSave">Guardar cambios</button>
        </div>`);
      document.getElementById('mX').onclick = closeModal;
      document.getElementById('beSave').addEventListener('click', async () => {
        const r = await OppiAPI.updateBranch(br.id, {
          nombre: document.getElementById('beNombre').value,
          direccion: document.getElementById('beDir').value.trim(),
          telefono: document.getElementById('beTel').value.trim(),
          horario: document.getElementById('beHor').value.trim(),
        });
        if (!r.ok) { document.getElementById('beErr').textContent = r.error; return; }
        closeModal();
        UI.toast('Sucursal actualizada ✅');
        ViewsPlus.branches();
      });
    }));

    document.querySelectorAll('[data-br-del]').forEach(btn => btn.addEventListener('click', () => {
      const br = list.find(x => x.id === btn.dataset.brDel);
      confirmModal({
        title: 'Eliminar sucursal',
        text: `¿Seguro que querés eliminar "${br ? br.nombre : ''}"? Esta acción no se puede deshacer.`,
        okLabel: 'Sí, eliminar',
        onOk: async () => {
          const r = await OppiAPI.deleteBranch(btn.dataset.brDel);
          if (!r.ok) { UI.toast(r.error, 'error'); return; }
          UI.toast('Sucursal eliminada');
          ViewsPlus.branches();
        },
      });
    }));
  },

  /* --------------------------- 4. CLIENTES ----------------------------- */
  _clientCard(c, href) {
    return `<a class="card" href="${href}">
      <div class="row between">
        <div class="row gap">${UI.avatar((c.nombre || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), '#6B5BD0', 44)}
          <div><strong>${UI.esc(c.nombre)}</strong>
            <div class="muted small">${c.barrio ? '📍 ' + UI.esc(c.barrio) + ' · ' : ''}${c.reservas_count} reserva${c.reservas_count === 1 ? '' : 's'}</div>
          </div>
        </div>
        <span>→</span>
      </div>
      <div class="row between small" style="margin-top:8px">
        <span class="muted">Gastó: <strong>${fmtGs(c.gasto_total)}</strong></span>
        ${c.ultima_visita ? `<span class="muted">Última visita: ${UI.esc(c.ultima_visita)}</span>` : ''}
        ${c.rating_promedio_dado != null ? `<span>⭐ ${c.rating_promedio_dado}</span>` : ''}
      </div>
    </a>`;
  },

  async _clientsView({ title, backHref, detailBase, fetch }) {
    const all = await fetch();
    const renderList = filter => {
      const q = (filter || '').toLowerCase().trim();
      const list = q ? all.filter(c => (c.nombre || '').toLowerCase().includes(q)) : all;
      document.getElementById('cliList').innerHTML = list.length
        ? list.map(c => this._clientCard(c, detailBase + '/' + c.id)).join('')
        : UI.empty('🔍', q ? 'Sin coincidencias' : 'Todavía no tenés clientes', q
            ? 'Probá con otro nombre.'
            : 'Cuando alguien reserve con vos, aparece acá con su historial y lo que gastó.', '');
    };
    setView(`
    <a class="back-link" href="${backHref}">← Volver</a>
    <h1 class="page-title">${title} 👥</h1>
    ${all.length ? `
    <form class="searchbar" id="cliSearch">
      <span>🔍</span>
      <input id="cliQ" type="search" placeholder="Buscar por nombre…" aria-label="Buscar cliente">
    </form>
    <p class="muted small">${all.length} cliente${all.length === 1 ? '' : 's'}</p>
    <div class="stack" id="cliList"></div>`
      : `<div id="cliList">${UI.empty('👥', 'Todavía no tenés clientes', 'Cuando alguien reserve con vos, aparece acá con su historial y lo que gastó.', '')}</div>`}
    `);
    if (!all.length) return;
    renderList('');
    let t = null;
    document.getElementById('cliQ').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => renderList(e.target.value), 150);
    });
    document.getElementById('cliSearch').addEventListener('submit', e => {
      e.preventDefault();
      renderList(document.getElementById('cliQ').value);
    });
  },

  async proClients() {
    return this._clientsView({
      title: 'Clientes', backHref: '#/handyman/panel', detailBase: '#/panel/clientes',
      fetch: () => OppiAPI.getProClients(),
    });
  },

  async bizClients() {
    if (!(await bizGuard(['admin']))) return;
    const b = await OppiAPI.getBusiness();
    if (!b) { Router.go('#/empresas'); return; }
    return this._clientsView({
      title: 'Clientes', backHref: '#/empresas/panel', detailBase: '#/empresas/clientes',
      fetch: () => OppiAPI.getBizClients(b.id),
    });
  },

  async _clientDetail({ id, scope, backHref, fetchOne, fetchHistory }) {
    const all = await fetchOne();
    const c = (all || []).find(x => String(x.id) === String(id));
    if (!c) {
      setView(`<a class="back-link" href="${backHref}">← Volver</a>${UI.empty('🔍', 'No encontramos ese cliente', 'Puede que el link esté desactualizado.', `<a class="btn btn-primary" href="${backHref}">Ver clientes</a>`)}`);
      return;
    }
    const hist = await fetchHistory(id, scope);
    setView(`
    <a class="back-link" href="${backHref}">← Clientes</a>
    <div class="card">
      <div class="row gap">${UI.avatar((c.nombre || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), '#6B5BD0', 60)}
        <div><h1 style="margin:0">${UI.esc(c.nombre)}</h1>
        <p class="muted small" style="margin:2px 0">${c.barrio ? '📍 ' + UI.esc(c.barrio) : 'Cliente Oppi'}</p></div>
      </div>
      <div class="stats-row" style="margin-top:12px">
        <div class="card stat"><strong>${c.reservas_count}</strong><span class="muted small">Reservas</span></div>
        <div class="card stat"><strong>${fmtGs(c.gasto_total)}</strong><span class="muted small">Gasto total</span></div>
        <div class="card stat"><strong>${c.rating_promedio_dado != null ? '⭐ ' + c.rating_promedio_dado : '—'}</strong><span class="muted small">Rating dado</span></div>
      </div>
      ${c.ultima_visita ? `<p class="muted small">Última visita: ${UI.esc(c.ultima_visita)}</p>` : ''}
    </div>
    <h2 class="sec-title">Historial</h2>
    <div class="stack">
      ${hist.length ? hist.map(h => `
        <div class="card">
          <div class="row between"><strong>${UI.esc(h.titulo || '')}</strong>${UI.statusBadge(h.estado)}</div>
          <div class="muted small">📅 ${UI.esc(h.fecha || '—')}</div>
          <div class="row between small"><span class="muted">${fmtGs(h.monto)}</span>${h.rating != null ? `<span>⭐ ${h.rating}</span>` : ''}</div>
        </div>`).join('')
        : UI.empty('📋', 'Sin historial todavía', 'Las reservas de este cliente van a aparecer acá.', '')}
    </div>`);
  },

  async proClientDetail(params) {
    return this._clientDetail({
      id: params.id, scope: 'pro', backHref: '#/panel/clientes',
      fetchOne: () => OppiAPI.getProClients(),
      fetchHistory: (id, scope) => OppiAPI.getClientHistory(id, scope),
    });
  },

  async bizClientDetail(params) {
    if (!(await bizGuard(['admin']))) return;
    return this._clientDetail({
      id: params.id, scope: 'empresa', backHref: '#/empresas/clientes',
      fetchOne: async () => { const b = await OppiAPI.getBusiness(); return b ? OppiAPI.getBizClients(b.id) : []; },
      fetchHistory: (id, scope) => OppiAPI.getClientHistory(id, scope),
    });
  },

  /* ---------------------- 5. DETALLE DE RESERVA ------------------------ */
  /* Ruta #/reservas/:id — estado, servicio, fecha/hora, profesional/
     negocio (+ sucursal), precio pagado, banner de cancelación y botones
     según estado y rol. */
  async bookingDetail(params) {
    const r = await OppiAPI.getBookingDetail(params.id);
    if (!r || !r.ok || !r.booking) {
      setView(`
      <a class="back-link" href="#/reservas">← Mis reservas</a>
      ${UI.empty('🔍', 'No encontramos esa reserva', 'Puede que ya se haya cancelado o el link esté desactualizado.', '<a class="btn btn-primary" href="#/reservas">Ver mis reservas</a>')}`);
      return;
    }
    const b = r.booking;
    const rol = r.rol || 'cliente';
    const backHref = rol === 'empresa' ? '#/empresas/reservas' : '#/reservas';
    const today = new Date().toISOString().slice(0, 10);
    const active = b.status === 'confirmed' || b.status === 'pending';
    const overdue = active && b.date && b.date < today;
    const paid = b.paid || 0;
    const price = b.price || 0;

    let banner = '';
    if (rol === 'cliente' && active) {
      try { banner = await ViewsCancel.bannerFor(b.id); } catch (e) { banner = ''; }
    }

    const who = rol === 'empresa'
      ? `<div class="row gap">${UI.avatar((b.clientName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), '#8B5CF6', 52)}
          <div><strong>${UI.esc(b.clientName || 'Cliente')}</strong><div class="muted small">Cliente</div></div></div>`
      : `<div class="row gap">${UI.avatar(b.proInitials, b.proColor, 52)}
          <div><strong>${UI.esc(b.proName || '')}</strong><div class="muted small">${b.bizId ? 'Negocio' : 'Profesional'}</div></div></div>`;

    let actions = '';
    if (rol === 'cliente') {
      if (active && !overdue) {
        actions = `<div class="row gap">
          ${b.proId ? `<a class="btn btn-ghost grow" href="#/chat/c_${b.proId}">💬 Chat</a>` : ''}
          ${b.proId ? `<button class="btn btn-ghost grow" id="bdResched">Reprogramar</button>` : ''}
          <a class="btn btn-danger-soft grow" href="#/reservas/${b.id}/cancelar">Cancelar reserva</a>
        </div>`;
      } else if (overdue) {
        actions = `<a class="btn btn-ghost btn-block" href="#/reservas/${b.id}/reportar-no-show">El profesional no vino</a>`;
      }
    } else {
      const btns = [];
      if (b.status === 'pending') {
        btns.push(`<button class="btn btn-primary grow" data-biz-ok="${b.id}">Aceptar</button>`);
        btns.push(`<button class="btn btn-ghost grow" data-biz-no="${b.id}">Rechazar</button>`);
      }
      if (b.status === 'confirmed' && b.date === today && !b.en_route_at) {
        btns.push(`<button class="btn btn-primary grow" id="bdEnRoute">Voy en camino 🛵</button>`);
      }
      if (b.en_route_at) btns.push(`<div class="enroute-banner grow">🛵 Vas en camino</div>`);
      if (overdue) btns.push(`<a class="btn btn-ghost grow" href="#/reservas/${b.id}/reportar-no-show?kind=cliente">Reportar no-show</a>`);
      if (active && !overdue) btns.push(`<a class="btn btn-danger-soft grow" href="#/reservas/${b.id}/cancelar?rol=empresa">Cancelar turno</a>`);
      if (btns.length) actions = `<div class="row gap">${btns.join('')}</div>`;
    }

    setView(`
    <a class="back-link" href="${backHref}">← Volver</a>
    <div class="card">
      <div class="row between"><h1 class="svc-title">${UI.esc(b.serviceName || '')}</h1>${UI.statusBadge(b.status)}</div>
      <p class="muted">📅 ${this.fmtFecha(b.date)} · 🕐 ${UI.esc(b.time || '')}</p>
      ${who}
      ${b.branchName ? `<p class="small">🏪 Sucursal: <strong>${UI.esc(b.branchName)}</strong></p>` : ''}
      ${b.staffName ? `<p class="small muted">Con ${UI.esc(b.staffName)}</p>` : ''}
    </div>
    <div class="card">
      <h3 class="sec-title">Precio</h3>
      <div class="row between"><span class="muted">Total del servicio</span><strong>${fmtGs(price)}</strong></div>
      ${b.discount_gs ? `<div class="row between small"><span class="money-in">🎟️ Cupón ${UI.esc(b.coupon_code || '')}</span><span class="money-in">−${fmtGs(b.discount_gs)}</span></div>` : ''}
      <div class="row between"><span class="muted">Pagado ✓</span><strong>${fmtGs(paid)}</strong></div>
    </div>
    ${banner}
    ${actions}
    <p class="small muted">🔔 Te avisamos un día antes del turno.</p>`);

    const rsBtn = document.getElementById('bdResched');
    if (rsBtn) rsBtn.addEventListener('click', () => openRescheduleModal(b));
    const erBtn = document.getElementById('bdEnRoute');
    if (erBtn) erBtn.addEventListener('click', async () => {
      const er = await OppiAPI.markEnRoute(b.id);
      if (!er.ok) { UI.toast(er.error, 'error'); return; }
      UI.toast('¡Buen viaje! 🛵');
      ViewsPlus.bookingDetail(params);
    });
    document.querySelectorAll('[data-biz-ok],[data-biz-no]').forEach(btn => btn.addEventListener('click', async () => {
      const accept = btn.hasAttribute('data-biz-ok');
      const br = await OppiAPI.respondBusinessBooking(btn.dataset.bizOk || btn.dataset.bizNo, accept);
      if (!br.ok) { UI.toast(br.error, 'error'); return; }
      UI.toast(accept ? 'Reserva aceptada ✅' : 'Reserva rechazada');
      ViewsPlus.bookingDetail(params);
    }));
  },

  /* --------------------------- 6. REPORTES ----------------------------- */
  /* Formato de % con 1 decimal ("12,5%"); null → '—' (nunca "null"). */
  _fmtPct(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return Number(v).toFixed(1).replace('.', ',') + '%';
  },
  /* Minutos en lenguaje humano ("~25 min"); null → '—'. */
  _fmtResp(min) {
    if (min == null || !Number.isFinite(Number(min))) return '—';
    const m = Number(min);
    if (m < 1) return 'menos de 1 min';
    if (m < 60) return `~${Math.round(m)} min`;
    const h = Math.floor(m / 60), r = Math.round(m % 60);
    return r ? `~${h} h ${r} min` : `~${h} h`;
  },
  _periodSeg(baseHref, per) {
    return `<div class="segmented" role="tablist" aria-label="Período">
      <a class="seg ${per === 'semana' ? 'active' : ''}" href="${baseHref}?periodo=semana">Semana</a>
      <a class="seg ${per === 'mes' ? 'active' : ''}" href="${baseHref}?periodo=mes">Mes</a>
    </div>`;
  },
  _topBars(top) {
    const maxIng = (top || []).reduce((a, x) => Math.max(a, x.ingresos), 0) || 1;
    return `<div class="card">${(top || []).map(t => `
      <div class="earn-bar-row">
        <div class="earn-bar-head"><span><strong>${UI.esc(t.nombre)}</strong> <span class="muted small">· ${t.reservas} reserva${t.reservas === 1 ? '' : 's'}</span></span><strong>${fmtGs(t.ingresos)}</strong></div>
        <div class="earn-bar-track"><div class="earn-bar-fill" style="width:${Math.round(t.ingresos / maxIng * 100)}%"></div></div>
      </div>`).join('')}</div>`;
  },

  /* PROFESIONAL — "Estadísticas" (entrada: su panel): ingresos, reservas
     (semana/mes), conversión visitas→reservas, tiempo de respuesta mediano
     y clientes recurrentes (nº y %). */
  _proStatsHtml({ backHref, baseHref, stats }) {
    if (!stats || stats.ok === false) {
      return `<a class="back-link" href="${backHref}">← Volver</a>
      <h1 class="page-title">Estadísticas 📊</h1>
      ${UI.empty('📊', 'No pudimos cargar tus estadísticas', UI.esc((stats && stats.error) || 'Revisá tu conexión e intentá de nuevo.'), `<a class="btn btn-primary" href="${backHref}">Volver</a>`)}`;
    }
    const per = stats.periodo === 'mes' ? 'mes' : 'semana';
    const emptyTitle = per === 'semana' ? 'Todavía no hay datos de esta semana' : 'Todavía no hay datos de este mes';
    const conv = stats.conversion_pct;
    const resp = stats.response_time_median;
    const recN = stats.clientes_recurrentes || 0;
    const recPct = stats.recurrent_pct;
    return `
    <a class="back-link" href="${backHref}">← Volver</a>
    <h1 class="page-title">Estadísticas 📊</h1>
    ${this._periodSeg(baseHref, per)}
    ${stats.reservas_count ? `
    <div class="stats-grid">
      <div class="card stat"><strong>💰 ${fmtGs(stats.ingresos)}</strong><span class="muted small">Ingresos</span></div>
      <div class="card stat"><strong>📅 ${stats.reservas_count}</strong><span class="muted small">Reservas</span></div>
      <div class="card stat"><strong>⏱️ ${this._fmtResp(resp)}</strong><span class="muted small">Respondés en (mediana)</span></div>
      <div class="card stat"><strong>🔁 ${recN}</strong><span class="muted small">Recurrentes (${this._fmtPct(recPct)})</span></div>
    </div>
    <div class="card">
      <div class="row between"><strong>📈 Conversión visitas → reservas</strong><strong>${this._fmtPct(conv)}</strong></div>
      ${conv == null
        ? '<p class="small muted">Todavía no hay datos — compartí tu perfil para empezar a medir.</p>'
        : '<p class="small muted">De cada 100 personas que miran tu perfil, reservan ' + this._fmtPct(conv) + '.</p>'}
    </div>
    <h2 class="sec-title">Top servicios</h2>
    ${this._topBars(stats.top_servicios)}`
      : UI.empty('📊', emptyTitle,
          'Cuando concretes trabajos, acá vas a ver tus ingresos, tu conversión y cuántos clientes vuelven por más.', '')}`;
  },

  /* NEGOCIO — "Reportes" (entrada: su panel): ingresos, reservas
     (semana/mes), servicios más vendidos, top colaborador y clientes
     recurrentes (nº y %). */
  _bizStatsHtml({ backHref, baseHref, stats }) {
    if (!stats || stats.ok === false) {
      return `<a class="back-link" href="${backHref}">← Volver</a>
      <h1 class="page-title">Reportes 📊</h1>
      ${UI.empty('📊', 'No pudimos cargar los reportes', UI.esc((stats && stats.error) || 'Revisá tu conexión e intentá de nuevo.'), `<a class="btn btn-primary" href="${backHref}">Volver</a>`)}`;
    }
    const per = stats.periodo === 'mes' ? 'mes' : 'semana';
    const emptyTitle = per === 'semana' ? 'Todavía no hay datos de esta semana' : 'Todavía no hay datos de este mes';
    const conv = stats.conversion_pct;
    const recN = stats.clientes_recurrentes || 0;
    const recPct = stats.recurrent_pct;
    const top = stats.top_staff;
    return `
    <a class="back-link" href="${backHref}">← Volver</a>
    <h1 class="page-title">Reportes 📊</h1>
    ${this._periodSeg(baseHref, per)}
    ${stats.reservas_count ? `
    <div class="stats-grid">
      <div class="card stat"><strong>💰 ${fmtGs(stats.ingresos)}</strong><span class="muted small">Ingresos</span></div>
      <div class="card stat"><strong>📅 ${stats.reservas_count}</strong><span class="muted small">Reservas</span></div>
      <div class="card stat"><strong>📈 ${this._fmtPct(conv)}</strong><span class="muted small">Conversión</span></div>
      <div class="card stat"><strong>🔁 ${recN}</strong><span class="muted small">Recurrentes (${this._fmtPct(recPct)})</span></div>
    </div>
    ${conv == null ? `<div class="card"><p class="small muted">📈 <strong>Conversión:</strong> todavía no hay datos — compartí el perfil del negocio para empezar a medir.</p></div>` : ''}
    <div class="card">
      <div class="row between"><strong>🏅 Top colaborador</strong></div>
      ${top && top.nombre
        ? `<p><strong>${UI.esc(top.nombre)}</strong> <span class="muted small">· ${top.reservas} reserva${top.reservas === 1 ? '' : 's'} en el período</span></p>`
        : '<p class="small muted">Todavía no hay datos — cuando tu equipo tome reservas con su nombre, acá vas a ver quién la rompe.</p>'}
    </div>
    <h2 class="sec-title">Servicios más vendidos</h2>
    ${this._topBars(stats.top_servicios)}`
      : UI.empty('📊', emptyTitle,
          'Cuando se concreten reservas, acá vas a ver ingresos, servicios más vendidos, tu top colaborador y clientes recurrentes.', '')}`;
  },

  async proStats(params, query) {
    const per = (query && query.periodo) === 'mes' ? 'mes' : 'semana';
    const stats = await OppiAPI.getProStats(per);
    setView(this._proStatsHtml({ backHref: '#/handyman/panel', baseHref: '#/panel/estadisticas', stats }));
  },

  async bizStats(params, query) {
    if (!(await bizGuard(['admin']))) return;
    const b = await OppiAPI.getBusiness();
    if (!b) { Router.go('#/empresas'); return; }
    const per = (query && query.periodo) === 'mes' ? 'mes' : 'semana';
    const stats = await OppiAPI.getBizStats(b.id, per);
    setView(this._bizStatsHtml({ backHref: '#/empresas/panel', baseHref: '#/empresas/reportes', stats }));
  },
};
