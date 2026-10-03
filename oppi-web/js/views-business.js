/* ============================================================================
 * Oppi — Oppi Empresas: alta progresiva, panel, agenda, reservas,
 * servicios, equipo, reseñas y documentos.
 * ========================================================================== */
'use strict';

/* ============================================================================
 * Roles de acceso del equipo (admin | editor | lectura).
 * El dueño del negocio y el admin de la plataforma son "admin".
 * Editor: agenda, reservas y servicios. Lectura: solo ver (sin acciones).
 * La UI oculta lo que el rol no puede tocar; las vistas sensibles además
 * muestran un 404 amable si se entra directo por URL.
 * ========================================================================== */
const ACCESS_ROLES = {
  admin: { label: 'Admin', desc: 'Todo: agenda, finanzas, equipo y configuración.' },
  editor: { label: 'Editor', desc: 'Agenda, reservas y servicios. Sin finanzas ni equipo.' },
  lectura: { label: 'Lectura', desc: 'Solo ver: sin editar ni publicar nada.' },
};
function accessRoleLabel(r) { return (ACCESS_ROLES[r] || {}).label || r; }

async function myAccessRole() {
  try {
    const r = await OppiAPI.myTeamAccessRole();
    return r || 'admin';
  } catch (e) { return 'admin'; }
}

/* Renderiza un aviso amable si el rol no está en `allowed`. Devuelve el rol
   o null (y en ese caso la vista debe terminar). */
async function bizGuard(allowed) {
  const role = await myAccessRole();
  if (allowed.includes(role)) return role;
  setView(UI.empty('🔒', 'Sin permiso', `Tu rol en este equipo (${accessRoleLabel(role)}) no te permite ver esta sección. Pedile a un admin que te dé más acceso.`, '<a class="btn btn-primary" href="#/empresas/panel">Volver al panel</a>'));
  return null;
}

const ViewsBusiness = {
  /* ------------------------------- LANDING ----------------------------- */
  async landing() {
    if (await OppiAPI.getBusiness()) { Router.go('#/empresas/panel'); return; }
    setView(`
    <div class="biz-hero">
      <h1>Oppi Empresas 🏪</h1>
      <p class="muted">Recibí reservas online, llená tu agenda y olvidate del cuaderno.</p>
    </div>
    <div class="stack">
      <div class="card"><strong>📅 Agenda siempre llena</strong><p class="small muted">Tus clientes reservan solos, a cualquier hora.</p></div>
      <div class="card"><strong>💰 Cobro total anticipado</strong><p class="small muted">Chau no-shows: cobrás el 100% al reservar.</p></div>
      <div class="card"><strong>⭐ Reputación</strong><p class="small muted">Reseñas verificadas y respuestas de tu negocio.</p></div>
    </div>
    <div class="card highlight-card">
      <strong>Comisión simple: 15%</strong>
      <p class="small">Solo cuando la reserva se concreta. Sin costos fijos, sin letra chica.</p>
    </div>
    <a class="btn btn-primary btn-block" href="#/empresas/alta">Registrar mi negocio</a>`);
  },

  /* ------------------------ PERFIL PÚBLICO (§3) ------------------------ */
  /* Portada + logo; atrás/favorito/compartir; nombre + badge, categorías,
     ★, dirección · abierto/cerrado; [Reservar] + [Llamar] [Cómo llegar];
     tabs Servicios | Equipo | Reseñas | Info (política completa visible). */
  async public(params, query) {
    const biz = await OppiAPI.getPublicBusiness(params.id);
    if (!biz) { setView(UI.empty('😕', 'No encontramos ese negocio', 'Volvé al inicio y probá de nuevo.', '<a class="btn btn-primary" href="#/">Ir al inicio</a>')); return; }
    // Tracking de visita (fire-and-forget: no bloquea el render).
    try { const r = OppiAPI.trackBizView(biz.id); if (r && r.catch) r.catch(() => {}); } catch (e) {}
    const fav = await OppiAPI.isFavorite('b_' + biz.id);
    const branches = await OppiAPI.getBranches(biz.id);
    const initials = biz.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const activeTab = (query && query.tab) || 'servicios';
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${biz.address} ${biz.barrio} Asunción`);

    const groups = [];
    biz.services.filter(s => s.active !== false).forEach(s => {
      let g = groups.find(x => x.cat === s.cat);
      if (!g) { g = { cat: s.cat, items: [] }; groups.push(g); }
      g.items.push(s);
    });

    setView(`
    <div class="biz-cover" style="background:linear-gradient(135deg, ${biz.cover[0]}, ${biz.cover[1]})">
      <div class="biz-cover-top">
        <button class="icon-btn" onclick="history.back()" aria-label="Atrás">←</button>
        <div style="display:flex;gap:8px">
          <button class="icon-btn fav-btn ${fav ? 'active' : ''}" data-fav="b_${biz.id}" aria-label="Favorito">${fav ? '❤️' : '🤍'}</button>
          <button class="icon-btn" onclick="sharePage()" aria-label="Compartir">↗</button>
        </div>
      </div>
    </div>
    <div class="biz-logo-row">
      <div class="biz-logo" style="background:${biz.logoColor}">${UI.esc(initials)}</div>
      <div>
        <h1 style="margin:0;font-size:22px">${UI.esc(biz.name)}</h1>
        <p class="muted small" style="margin:2px 0">${UI.esc(biz.categories.join(' · ') || biz.category)}</p>
      </div>
      ${biz.verified ? UI.verifiedBadge() : '<span class="badge badge-warn">En verificación</span>'}
    </div>
    <p><span class="stars">★</span> <strong>${biz.rating}</strong> <span class="muted small">(${biz.reviewsCount} reseñas)</span></p>
    <p class="small">📍 ${UI.esc(biz.address)}${biz.barrio ? ' · ' + UI.esc(biz.barrio) : ''}<br>
      <span class="open-dot ${biz.openNow ? '' : 'closed'}"></span><strong>${UI.esc(biz.openLabel)}</strong></p>

    <div class="biz-actions">
      <a class="btn btn-primary btn-cta grow" href="#/negocio/${biz.id}/reservar">Reservar</a>
    </div>
    <div class="row gap">
      ${biz.phone ? `<a class="btn btn-outline grow" href="tel:${UI.esc(biz.phone.replace(/\s/g, ''))}">📞 Llamar</a>` : ''}
      <a class="btn btn-outline grow" href="${mapsUrl}" target="_blank" rel="noopener">📍 Cómo llegar</a>
    </div>

    <div class="pro-tabs" role="tablist">
      <button class="pro-tab ${activeTab === 'servicios' ? 'active' : ''}" data-biztab="servicios">Servicios</button>
      <button class="pro-tab ${activeTab === 'equipo' ? 'active' : ''}" data-biztab="equipo">Equipo</button>
      <button class="pro-tab ${activeTab === 'resenas' ? 'active' : ''}" data-biztab="resenas">Reseñas</button>
      <button class="pro-tab ${activeTab === 'info' ? 'active' : ''}" data-biztab="info">Info</button>
    </div>

    <div class="pro-tabpane" id="biztab-servicios" ${activeTab === 'servicios' ? '' : 'hidden'}>
      ${groups.map(g => `
        <h2 class="sec-title">${UI.esc(g.cat)}</h2>
        <div class="stack">
          ${g.items.map(s => {
            return `<div class="card service-row">
              <div>
                <a class="link svc-link" href="#/servicio/${s.id}"><strong>${UI.esc(s.name)}</strong></a>
                <div class="muted small">⏱ ${s.durationMin} min</div>
              </div>
              <div class="service-cta">
                <span class="service-price">${fmtGs(s.price)}</span>
                <a class="btn btn-primary btn-sm" href="#/negocio/${biz.id}/reservar?servicio=${s.id}">Reservar</a>
              </div>
            </div>`;
          }).join('')}
        </div>`).join('') || '<p class="muted">Sin servicios publicados todavía.</p>'}
    </div>

    <div class="pro-tabpane" id="biztab-equipo" ${activeTab === 'equipo' ? '' : 'hidden'}>
      <div class="stack">
        ${biz.team.map(m => `
          <div class="card service-row">
            <div class="row gap">${UI.avatar(m.initials, m.color, 48)}
              <div><strong>${UI.esc(m.name)}</strong><div class="muted small">${UI.esc(m.role)}</div><div class="small">${UI.stars(m.rating)}</div></div>
            </div>
            <a class="btn btn-outline btn-sm" href="#/negocio/${biz.id}/reservar?staff=${m.id}">Elegir</a>
          </div>`).join('') || '<p class="muted">Todavía no cargaron el equipo.</p>'}
      </div>
    </div>

    <div class="pro-tabpane" id="biztab-resenas" ${activeTab === 'resenas' ? '' : 'hidden'}>
      <div class="card">
        <div class="row between">
          <div><span class="service-price">${biz.rating}</span> <span class="muted">/ 5</span></div>
          <span class="muted small">${biz.reviewsCount} reseñas</span>
        </div>
        ${UI.ratingBars(biz.rating)}
      </div>
      <div class="stack">
        ${biz.reviews.map(r => UI.reviewCard(r, biz.name)).join('') || '<p class="muted">Todavía no tiene reseñas.</p>'}
      </div>
    </div>

    <div class="pro-tabpane" id="biztab-info" ${activeTab === 'info' ? '' : 'hidden'}>
      <div class="card"><h3>🕐 Horarios</h3>
        <table class="hours-table">${biz.hoursWeek.map(h => `<tr><td>${UI.esc(h.d)}</td><td style="text-align:right"><strong>${UI.esc(h.h)}</strong></td></tr>`).join('')}</table>
      </div>
      <div class="card"><h3>❌ Política de cancelación</h3>
        <div class="policy-box">${UI.esc(biz.cancelPolicyFull)}</div>
      </div>
      <div class="card"><h3>💳 Métodos de pago</h3>
        <p class="small">${biz.paymentMethods.map(UI.esc).join(' · ')}</p>
        <p class="small muted">El 100% se paga online al reservar (hoy simulado).</p>
      </div>
      <div class="card"><h3>📍 Dirección</h3>
        <p class="small">${UI.esc(biz.address)}${biz.barrio ? '<br><span class="muted">' + UI.esc(biz.barrio) + '</span>' : ''}</p>
        ${biz.phone ? `<p class="small">📞 ${UI.esc(biz.phone)}</p>` : ''}
      </div>
      ${branches.length ? `<div class="card"><h3>🏪 Sucursales</h3>
        ${branches.map(br => `<p class="small"><strong>${UI.esc(br.nombre)}</strong><br><span class="muted">${UI.esc(br.direccion || '')}${br.horario ? ' · 🕐 ' + UI.esc(br.horario) : ''}${br.telefono ? ' · 📞 ' + UI.esc(br.telefono) : ''}</span></p>`).join('')}
      </div>` : ''}
    </div>`);

    document.querySelectorAll('[data-biztab]').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('[data-biztab]').forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.pro-tabpane').forEach(x => { x.hidden = x.id !== 'biztab-' + t.dataset.biztab; });
    }));
  },

  /* --------------------- ALTA PROGRESIVA (3 pasos) --------------------- */
  signup: { data: { services: [] } },

  async signupStep1() {
    const d = this.signup.data;
    if (!Array.isArray(d.branches)) d.branches = [];
    const cascade = await ViewsPlus.cascadeHtml({ catId: 'bCatSel', profId: 'bProfSel', selectedCat: d.categoryId, selectedProf: d.profession, labelCat: 'Categoría *', labelProf: 'Tu profesión *' });

    const renderBranches = () => {
      const box = document.getElementById('brList');
      if (!box) return;
      box.innerHTML = d.branches.map((br, i) => `
        <div class="card service-row">
          <div><strong>${UI.esc(br.nombre)}</strong><div class="muted small">${UI.esc(br.direccion || 'Sin dirección')}</div></div>
          <button class="icon-btn" data-del-br="${i}" aria-label="Quitar">✕</button>
        </div>`).join('') || '<p class="muted small">Si atendés en un solo lugar, no hace falta agregar nada.</p>';
      box.querySelectorAll('[data-del-br]').forEach(x => x.addEventListener('click', () => {
        d.branches.splice(Number(x.dataset.delBr), 1);
        renderBranches();
      }));
    };

    setView(`
    <div class="steps"><span class="step active">1</span><span class="step">2</span><span class="step">3</span></div>
    <h1 class="page-title">Tu negocio</h1>
    <p class="muted small">Paso 1 de 3 · Lo básico para publicar ya mismo.</p>
    <form id="bizS1" class="stack">
      ${UI.field('Nombre del negocio *', `<input id="bName" required maxlength="60" value="${UI.esc(d.name || '')}" placeholder="Ej: Pelo & Arte">`)}
      ${cascade}
      ${UI.field('Barrio', `<select id="bBarrio">${OppiAPI.getBarrios().map(b => `<option ${b === d.barrio ? 'selected' : ''}>${b}</option>`).join('')}</select>`)}
      ${UI.field('Dirección', `<input id="bAddr" value="${UI.esc(d.address || '')}" placeholder="Av. Mariscal López 2024">`)}
      ${UI.field('WhatsApp', `<input id="bPhone" value="${UI.esc(d.phone || '')}" placeholder="0981 000 000">`)}
      <div class="card">
        <h3>🏪 Sucursales <span class="muted small">(opcional)</span></h3>
        <div class="stack" id="brList"></div>
        <div class="row gap">
          <input id="brName" placeholder="Nombre · Ej: Sucursal Centro" maxlength="60" style="flex:2">
          <input id="brAddr" placeholder="Dirección" style="flex:3">
          <button class="btn btn-ghost" type="button" id="brAdd">＋</button>
        </div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Continuar →</button>
    </form>`);
    ViewsPlus.bindCascade({ catId: 'bCatSel', profId: 'bProfSel', selectedProf: d.profession });
    renderBranches();
    document.getElementById('brAdd').addEventListener('click', () => {
      const nombre = document.getElementById('brName').value.trim();
      if (!nombre) { UI.toast('Poné el nombre de la sucursal', 'error'); return; }
      d.branches.push({ nombre, direccion: document.getElementById('brAddr').value.trim() });
      document.getElementById('brName').value = '';
      document.getElementById('brAddr').value = '';
      renderBranches();
    });
    document.getElementById('bizS1').addEventListener('submit', e => {
      e.preventDefault();
      const name = document.getElementById('bName').value.trim();
      if (!name) { UI.toast('Poné el nombre de tu negocio', 'error'); return; }
      const catSel = document.getElementById('bCatSel');
      const profSel = document.getElementById('bProfSel');
      Object.assign(d, {
        name,
        categoryId: catSel ? catSel.value : '',
        category: catSel && catSel.value ? ViewsPlus.catName(catSel.value) : '',
        profession: profSel ? profSel.value : '',
        barrio: document.getElementById('bBarrio').value,
        address: document.getElementById('bAddr').value.trim(),
        phone: document.getElementById('bPhone').value.trim(),
      });
      Router.go('#/empresas/alta/paso2');
    });
  },

  async signupStep2() {
    const d = this.signup.data;
    const renderList = () => {
      document.getElementById('svcList').innerHTML = d.services.map((s, i) => `
        <div class="card service-row">
          <div><strong>${UI.esc(s.name)}</strong><div class="muted small">${fmtGs(s.price)} · ⏱ ${s.durationMin} min</div></div>
          <button class="icon-btn" data-del-svc="${i}" aria-label="Quitar">✕</button>
        </div>`).join('') || '<p class="muted small">Agregá tu primer servicio 👇</p>';
      document.querySelectorAll('[data-del-svc]').forEach(b => b.addEventListener('click', () => {
        d.services.splice(Number(b.dataset.delSvc), 1);
        renderList();
      }));
      document.getElementById('toStep3').disabled = !d.services.length;
    };

    setView(`
    <div class="steps"><span class="step done">✓</span><span class="step active">2</span><span class="step">3</span></div>
    <h1 class="page-title">Tus servicios</h1>
    <p class="muted small">Paso 2 de 3 · Con uno solo ya podés publicar.</p>
    <div class="stack" id="svcList"></div>
    <div class="card">
      <h3>Agregar servicio</h3>
      <form id="svcForm" class="stack">
        ${UI.field('Nombre *', `<input id="sName" required placeholder="Ej: Corte mujer">`)}
        <div class="row gap">
          ${UI.field('Precio (Gs.) *', `<input id="sPrice" type="number" min="1" required placeholder="85000">`)}
          ${UI.field('Duración (min)', `<input id="sDur" type="number" min="5" value="45">`)}
        </div>
        <p class="small muted">Tus clientes pagan el 100% al reservar, sin vueltas.</p>
        <p class="small error" id="svcErr"></p>
        <button class="btn btn-ghost btn-block" type="submit">＋ Agregar servicio</button>
      </form>
    </div>
    ${UI.field('Horario de atención', `<input id="bHours" value="${UI.esc(d.hours || 'Lun a Sáb 9:00–18:00')}">`)}
    <button class="btn btn-primary btn-block" id="toStep3" disabled>Continuar →</button>`);

    renderList();
    document.getElementById('svcForm').addEventListener('submit', e => {
      e.preventDefault();
      const price = Number(document.getElementById('sPrice').value);
      const name = document.getElementById('sName').value.trim();
      if (!name) { document.getElementById('svcErr').textContent = 'Poné un nombre al servicio.'; return; }
      if (!price || price <= 0) { document.getElementById('svcErr').textContent = 'Poné un precio mayor a cero.'; return; }
      document.getElementById('svcErr').textContent = '';
      d.services.push({
        name,
        price, durationMin: Number(document.getElementById('sDur').value) || 45,
      });
      e.target.reset();
      document.getElementById('sDur').value = 45;
      renderList();
      UI.toast('Servicio agregado ✅');
    });
    document.getElementById('toStep3').addEventListener('click', () => {
      d.hours = document.getElementById('bHours').value.trim();
      Router.go('#/empresas/alta/paso3');
    });
  },

  async signupStep3() {
    const d = this.signup.data;
    if (!d.services.length) { Router.go('#/empresas/alta/paso2'); return; }
    const example = d.services[0];
    const commission = Math.round(example.price * 0.15);
    setView(`
    <div class="steps"><span class="step done">✓</span><span class="step done">✓</span><span class="step active">3</span></div>
    <h1 class="page-title">Cómo ganamos</h1>
    <p class="muted small">Paso 3 de 3 · Transparente desde el día uno.</p>
    <div class="card highlight-card">
      <h2>Oppi cobra 15%</h2>
      <p>Solo cuando la reserva se concreta. Sin costos fijos, sin suscripción, sin letra chica.</p>
      <hr class="sep">
      <p class="small">Ejemplo: <strong>${UI.esc(example.name)}</strong> a ${fmtGs(example.price)}<br>
      Comisión Oppi (15%): <strong>${fmtGs(commission)}</strong> · Vos recibís: <strong>${fmtGs(example.price - commission)}</strong></p>
    </div>
    <p class="small muted">Tus documentos (RUC, cédula, habilitación) los podés subir después desde el panel, sin bloquear tu publicación.</p>
    <button class="btn btn-primary btn-block" id="publishBiz">Publicar mi negocio 🚀</button>`);

    document.getElementById('publishBiz').addEventListener('click', async () => {
      const r = await OppiAPI.createBusiness(d);
      if (!r.ok) { UI.toast(r.error, 'error'); return; }
      // Sucursales capturadas en el paso 1 (si el negocio tiene más de una).
      for (const br of (d.branches || [])) {
        try { await OppiAPI.createBranch(r.business.id, br); } catch (e) { /* no bloquea el alta */ }
      }
      this.signup.data = { services: [] };
      UI.toast('¡Tu negocio ya está en Oppi! 🎉');
      Router.go('#/empresas/panel');
    });
  },

  /* ------------------------------ PANEL -------------------------------- */
  async panel() {
    const b = await OppiAPI.getBusiness();
    if (!b) { Router.go('#/empresas'); return; }
    const access = await myAccessRole();
    const pending = b.bizBookings.filter(x => x.status === 'pending');
    const confirmed = b.bizBookings.filter(x => x.status === 'confirmed');
    const pendingDocs = b.documents.filter(d => d.status === 'pending').length;

    // Tiles visibles según el rol de acceso del equipo.
    const tiles = [
      { href: '#/empresas/agenda', icon: '📅', label: 'Agenda', roles: ['admin', 'editor', 'lectura'] },
      { href: '#/empresas/reservas', icon: '📝', label: 'Reservas', roles: ['admin', 'editor', 'lectura'] },
      { href: '#/empresas/ganancias', icon: '💰', label: 'Ganancias', roles: ['admin'] },
      { href: '#/empresas/cupones', icon: '🎟️', label: 'Cupones', roles: ['admin'] },
      { href: '#/empresas/cancelaciones', icon: '📋', label: 'Cancelaciones', roles: ['admin'] },
      { href: '#/empresas/servicios', icon: '💈', label: 'Servicios', roles: ['admin', 'editor'] },
      { href: '#/empresas/sucursales', icon: '🏪', label: 'Sucursales', roles: ['admin'] },
      { href: '#/empresas/clientes', icon: '👥', label: 'Clientes', roles: ['admin'] },
      { href: '#/empresas/reportes', icon: '📊', label: 'Reportes', roles: ['admin'] },
      { href: '#/empresas/equipo', icon: '👥', label: 'Equipo', roles: ['admin'] },
      { href: '#/empresas/resenas', icon: '⭐', label: 'Reseñas', roles: ['admin'] },
      { href: '#/empresas/configuracion', icon: '⚙️', label: 'Configuración', roles: ['admin'] },
      { href: '#/empresas/documentos', icon: '📄', label: 'Documentos', roles: ['admin'] },
      { href: '#/ayuda', icon: '💬', label: 'Ayuda y soporte', roles: ['admin', 'editor', 'lectura'] },
    ];

    setView(`
    <div class="biz-head card">
      <div>
        <h1>${UI.esc(b.name)}</h1>
        <p class="muted small">${UI.esc(b.category)} · 📍 ${UI.esc(b.barrio)}</p>
      </div>
      ${b.verified ? UI.verifiedBadge() : '<span class="badge badge-warn">En verificación</span>'}
    </div>
    <p><a class="link" href="#/negocio/${b.id}">👁️ Ver mi perfil público</a> <span class="muted small">· así te ven los clientes</span></p>

    ${pendingDocs ? `<a class="card warn-card" href="#/empresas/documentos"><strong>📄 Te faltan ${pendingDocs} documentos</strong><p class="small muted">Subilos cuando quieras para obtener el badge de verificado.</p></a>` : ''}
    ${access !== 'admin' ? `<p class="small muted">Entrás como <strong>${accessRoleLabel(access)}</strong> — ves lo que tu rol permite.</p>` : ''}

    <h2 class="sec-title">Hoy</h2>
    <div class="stats-row">
      <div class="card stat"><strong>${confirmed.length}</strong><span class="muted small">Turnos</span></div>
      <div class="card stat"><strong>${pending.length}</strong><span class="muted small">Pendientes</span></div>
      <div class="card stat"><strong>${fmtGs(confirmed.reduce((a, x) => a + x.price, 0))}</strong><span class="muted small">Ingresos</span></div>
    </div>

    <h2 class="sec-title">Reservas pendientes</h2>
    <div class="stack">
      ${pending.length ? pending.map(x => `
        <div class="card">
          <div class="row between"><strong>${UI.esc(x.clientName)}</strong>${UI.statusBadge(x.status)}</div>
          <div class="muted small">${UI.esc(x.serviceName)} · 📅 ${x.date} · 🕐 ${x.time} · ${fmtGs(x.price)}</div>
          ${access === 'lectura' ? '' : `
          <div class="row gap">
            <button class="btn btn-primary btn-sm" data-biz-ok="${x.id}">Aceptar</button>
            <button class="btn btn-ghost btn-sm" data-biz-no="${x.id}">Rechazar</button>
          </div>`}
        </div>`).join('') : '<p class="muted small">Sin pendientes. 👌</p>'}
    </div>

    <h2 class="sec-title">Gestión</h2>
    <div class="menu-grid">
      ${tiles.filter(t => t.roles.includes(access)).map(t =>
        `<a class="card menu-tile" href="${t.href}">${t.icon}<span>${t.label}</span></a>`).join('')}
    </div>`);

    document.querySelectorAll('[data-biz-ok],[data-biz-no]').forEach(btn => btn.addEventListener('click', async () => {
      const accept = btn.hasAttribute('data-biz-ok');
      const br = await OppiAPI.respondBusinessBooking(btn.dataset.bizOk || btn.dataset.bizNo, accept);
      if (!br.ok) { UI.toast(br.error, 'error'); return; }
      UI.toast(accept ? 'Reserva aceptada ✅' : 'Reserva rechazada');
      ViewsBusiness.panel();
    }));
  },

  /* ------------------------------ AGENDA ------------------------------- */
  async agenda() {
    const b = await OppiAPI.getBusiness();
    if (!b) { Router.go('#/empresas'); return; }
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      days.push({ iso, label: d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric' }), bookings: b.bizBookings.filter(x => x.date === iso) });
    }
    setView(`
    <a class="back-link" href="#/empresas/panel">← Panel</a>
    <h1 class="page-title">Agenda 📅</h1>
    <div class="stack">
      ${days.map(d => `
        <div class="card">
          <strong>${d.label}</strong>
          ${d.bookings.length ? d.bookings.map(x => `
            <div class="row between small"><span>🕐 ${x.time} · ${UI.esc(x.clientName)} · ${UI.esc(x.serviceName)}</span>${UI.statusBadge(x.status)}</div>`).join('')
            : '<p class="muted small">Sin turnos</p>'}
        </div>`).join('')}
    </div>`);
  },

  /* ----------------------------- RESERVAS ------------------------------ */
  /* Reserva próxima: "Voy en camino 🛵" solo si el turno es hoy.
     Reservas pasadas vencidas: "El cliente no vino" (el pago queda para
     el negocio). */
  async bookings() {
    const b = await OppiAPI.getBusiness();
    if (!b) { Router.go('#/empresas'); return; }
    const access = await myAccessRole();
    const today = new Date().toISOString().slice(0, 10);
    const live = x => x.status === 'confirmed' || x.status === 'pending';
    const overdue = x => live(x) && x.date && x.date < today;
    const upcoming = b.bizBookings.filter(x => live(x) && !overdue(x));
    const history = b.bizBookings.filter(x => !upcoming.includes(x));
    // Lectura: solo ve, no toca.
    const canAct = access !== 'lectura';

    const card = x => `
      <div class="card">
        <div class="row between"><a class="link svc-link" href="#/reservas/${x.id}"><strong>${UI.esc(x.clientName)}</strong></a>${UI.statusBadge(x.status)}</div>
        <div class="muted small">${UI.esc(x.serviceName)} · 📅 ${x.date} · 🕐 ${x.time}</div>
        <div class="row between"><span class="muted small">Comisión Oppi (15%): ${fmtGs(Math.round(x.price * 0.15))}</span><strong>${fmtGs(x.price)}</strong></div>
        ${canAct && x.status === 'confirmed' && x.date === today ? (x.en_route_at
          ? `<div class="enroute-banner">🛵 Vas en camino</div>`
          : `<button class="btn btn-primary btn-sm" data-enroute="${x.id}">Voy en camino 🛵</button>`) : ''}
        ${live(x) && !overdue(x) ? `<p class="small muted" style="margin:8px 0 0">🛵 Tocá Voy en camino al salir. Si la clienta cancela después, cuenta como no-show y te respaldamos.</p>` : ''}
        ${canAct && x.status === 'confirmed' && !overdue(x) ? `<div class="row gap" style="margin-top:8px"><a class="btn btn-ghost btn-sm" href="#/reservas/${x.id}/cancelar?rol=empresa">Cancelar turno</a></div>` : ''}
        ${canAct && x.status === 'pending' ? `<div class="row gap" style="margin-top:8px">
          <button class="btn btn-primary btn-sm" data-biz-ok="${x.id}">Aceptar</button>
          <button class="btn btn-ghost btn-sm" data-biz-no="${x.id}">Rechazar</button>
        </div>` : ''}
        ${canAct && overdue(x) ? `<div class="row gap" style="margin-top:8px">
          <a class="btn btn-ghost btn-sm" href="#/reservas/${x.id}/reportar-no-show?kind=cliente">El cliente no vino</a>
        </div>` : ''}
      </div>`;

    setView(`
    <a class="back-link" href="#/empresas/panel">← Panel</a>
    <h1 class="page-title">Reservas 📝</h1>
    ${upcoming.length ? `<h2 class="sec-title">Próximas</h2><div class="stack">${upcoming.map(card).join('')}</div>`
      : '<p class="muted">Sin reservas próximas.</p>'}
    ${history.length ? `<h2 class="sec-title">Historial</h2><div class="stack">${history.map(card).join('')}</div>` : ''}`);

    document.querySelectorAll('[data-biz-ok],[data-biz-no]').forEach(btn => btn.addEventListener('click', async () => {
      const accept = btn.hasAttribute('data-biz-ok');
      const br = await OppiAPI.respondBusinessBooking(btn.dataset.bizOk || btn.dataset.bizNo, accept);
      if (!br.ok) { UI.toast(br.error, 'error'); return; }
      UI.toast(accept ? 'Reserva aceptada ✅' : 'Reserva rechazada');
      ViewsBusiness.bookings();
    }));

    document.querySelectorAll('[data-enroute]').forEach(btn => btn.addEventListener('click', async () => {
      const r = await OppiAPI.markEnRoute(btn.dataset.enroute);
      if (!r.ok) { UI.toast(r.error, 'error'); return; }
      UI.toast('¡Buen viaje! 🛵 El cliente ya lo ve en su reserva.');
      ViewsBusiness.bookings();
    }));
  },
  /* ----------------------------- GANANCIAS ----------------------------- */
  /* GET /api/business/earnings?periodo=semana|mes (solo reservas
     completed; comisión del 15%). Toggle Semana/Mes + tarjetas +
     gráfico de barras en CSS puro por servicio. */
  async earnings(query) {
    if (!(await bizGuard(['admin']))) return;
    const b = await OppiAPI.getBusiness();
    if (!b) { Router.go('#/empresas'); return; }
    const periodo = (query && query.periodo === 'mes') ? 'mes' : 'semana';
    const e = await OppiAPI.getEarnings(periodo);

    const perLink = p => `#/empresas/ganancias?periodo=${p}`;
    setView(`
    <a class="back-link" href="#/empresas/panel">← Panel</a>
    <h1 class="page-title">Ganancias 💰</h1>
    <div class="segmented" role="tablist" aria-label="Período">
      <a class="seg ${periodo === 'semana' ? 'active' : ''}" href="${perLink('semana')}">Semana</a>
      <a class="seg ${periodo === 'mes' ? 'active' : ''}" href="${perLink('mes')}">Mes</a>
    </div>` + (e.ok === false ? `
    <div class="card warn-card"><strong>😕 No pudimos cargar tus ganancias</strong><p class="small muted">${UI.esc(e.error || 'Probá de nuevo en un rato.')}</p></div>`
      : e.reservas_count === 0 ? `
    <div class="card">${UI.empty('💰', 'Todavía no tenés reservas completadas', 'Cuando se completen reservas, acá vas a ver tus ganancias, la comisión de Oppi y el desglose por servicio.')}</div>`
      : `
    <div class="stats-row">
      <div class="card stat"><strong>${fmtGs(e.ingresos_brutos)}</strong><span class="muted small">Ingresos brutos</span></div>
      <div class="card stat"><strong>${fmtGs(e.comision)}</strong><span class="muted small">Comisión Oppi (15%)</span></div>
      <div class="card stat highlight-stat"><strong>${fmtGs(e.neto)}</strong><span class="muted small">Neto para vos</span></div>
    </div>
    <div class="stats-row">
      <div class="card stat"><strong>${e.reservas_count}</strong><span class="muted small">Reservas</span></div>
      <div class="card stat"><strong>${fmtGs(e.ticket_promedio)}</strong><span class="muted small">Ticket promedio</span></div>
    </div>

    <h2 class="sec-title">Por servicio</h2>
    <div class="card">
      <div class="earn-bars">
        ${e.por_servicio.slice().sort((a, x) => x.ingresos - a.ingresos).map(s => {
          const pct = e.ingresos_brutos ? Math.round(s.ingresos / e.ingresos_brutos * 100) : 0;
          return `<div class="earn-bar-row">
            <div class="earn-bar-head"><span><strong>${UI.esc(s.nombre)}</strong> <span class="muted small">· ${s.reservas} reserva${s.reservas === 1 ? '' : 's'}</span></span><strong>${fmtGs(s.ingresos)}</strong></div>
            <div class="earn-bar-track"><div class="earn-bar-fill" style="width:${pct}%"></div></div>
          </div>`;
        }).join('')}
      </div>
      <p class="small muted">Solo cuentan las reservas completadas. La comisión del 15% ya está descontada del neto.</p>
    </div>`));
  },
};

/* ------------------------------ CUPONES -------------------------------- */
/* Oppi Empresas → "Cupones": crear (código, % o monto fijo, tope de usos,
   vigencia), listar, pausar/activar.
   INTEGRATION POINT: GET/POST /api/businesses/:id/coupons,
   PATCH /api/coupons/:id { active }. */
ViewsBusiness.coupons = async function () {
  if (!(await bizGuard(['admin']))) return;
  const b = await OppiAPI.getBusiness();
  if (!b) { Router.go('#/empresas'); return; }
  const list = await OppiAPI.getCoupons();

  const vigLabel = c => {
    if (!c.valid_from && !c.valid_to) return '';
    const f = c.valid_from || '…', t = c.valid_to || '…';
    return ` · Vigencia: ${f} → ${t}`;
  };

  setView(`
  <a class="back-link" href="#/empresas/panel">← Panel</a>
  <h1 class="page-title">Cupones 🎟️</h1>
  <p class="muted small">Creá códigos de descuento para tus clientes. Se aplican en el checkout, antes de pagar.</p>
  <div class="stack">
    ${list.map(c => `
      <div class="card ${c.active ? '' : 'muted-card'}">
        <div class="row between"><strong class="coupon-code">${UI.esc(c.code)}</strong><span class="badge badge-${c.active ? 'ok' : 'muted'}">${c.active ? 'Activo' : 'Pausado'}</span></div>
        <div class="muted small">${c.type === 'percent' ? c.value + '% de descuento' : fmtGs(c.value) + ' de descuento'} · Usos: ${c.used_count}/${c.max_uses}${vigLabel(c)}</div>
        <div class="row gap" style="margin-top:8px">
          <button class="btn btn-ghost btn-sm" data-coupon-toggle="${c.id}">${c.active ? 'Pausar' : 'Activar'}</button>
        </div>
      </div>`).join('') || '<p class="muted">Todavía no creaste cupones. Creá el primero acá abajo 👇</p>'}
  </div>
  <div class="card">
    <h3>Crear cupón</h3>
    <form id="couponForm" class="stack">
      ${UI.field('Código *', `<input id="cCode" required maxlength="20" placeholder="Ej: AMIGA20" style="text-transform:uppercase" autocomplete="off">`, 'Tus clientes lo escriben en el checkout.')}
      <div class="row gap">
        ${UI.field('Tipo', `<select id="cType"><option value="percent">% de descuento</option><option value="fixed">Monto fijo (Gs.)</option></select>`)}
        ${UI.field('Valor *', `<input id="cValue" type="number" min="1" required placeholder="20">`, 'Si es %, entre 1 y 100.')}
      </div>
      ${UI.field('Tope de usos', `<input id="cMax" type="number" min="1" value="50">`, 'Cuántas veces se puede usar en total.')}
      <div class="row gap">
        ${UI.field('Vigente desde', `<input id="cFrom" type="date">`)}
        ${UI.field('Vigente hasta', `<input id="cTo" type="date">`)}
      </div>
      <p class="small error" id="cErr"></p>
      <button class="btn btn-primary btn-block" type="submit">Crear cupón</button>
    </form>
  </div>`);

  document.querySelectorAll('[data-coupon-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const c = list.find(x => x.id === btn.dataset.couponToggle);
    const r = await OppiAPI.toggleCoupon(btn.dataset.couponToggle, !(c && c.active));
    if (!r.ok) { UI.toast(r.error, 'error'); return; }
    UI.toast(r.coupon.active ? 'Cupón activado ✅' : 'Cupón pausado ⏸️');
    ViewsBusiness.coupons();
  }));

  document.getElementById('couponForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('cErr');
    err.textContent = '';
    const r = await OppiAPI.createCoupon({
      code: document.getElementById('cCode').value,
      type: document.getElementById('cType').value,
      value: document.getElementById('cValue').value,
      maxUses: document.getElementById('cMax').value,
      validFrom: document.getElementById('cFrom').value || null,
      validTo: document.getElementById('cTo').value || null,
    });
    if (!r.ok) { err.textContent = r.error; return; }
    UI.toast(`Cupón ${r.coupon.code} creado 🎟️`);
    ViewsBusiness.coupons();
  });
};

/* ---------------------------- CONFIGURACIÓN ---------------------------- */
/* "Cancelación gratis hasta (horas)" — default 24. Define hasta cuándo el
   cliente puede cancelar con reembolso total de lo pagado. */
ViewsBusiness.settings = async function () {
  if (!(await bizGuard(['admin']))) return;
  const b = await OppiAPI.getBusiness();
  if (!b) { Router.go('#/empresas'); return; }
  const hours = b.cancel_free_hours != null ? b.cancel_free_hours : 24;
  setView(`
  <a class="back-link" href="#/empresas/panel">← Panel</a>
  <h1 class="page-title">Configuración ⚙️</h1>
  <form id="bizCfgForm" class="stack">
    <div class="card">
      <h3>❌ Cancelaciones</h3>
      ${UI.field('Cancelación gratis hasta (horas)', `<input id="cfgCancelHours" type="number" min="0" max="720" value="${hours}">`, 'Si el cliente cancela con más anticipación que esto, se le devuelve el 100%. Si cancela después, el pago queda para vos.')}
      <p class="small error" id="cfgErr"></p>
      <button class="btn btn-primary btn-block" type="submit">Guardar</button>
    </div>
  </form>`);

  document.getElementById('bizCfgForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('cfgErr');
    err.textContent = '';
    const r = await OppiAPI.updateBusinessSettings({
      cancel_free_hours: document.getElementById('cfgCancelHours').value,
    });
    if (!r.ok) { err.textContent = r.error; return; }
    UI.toast('Configuración guardada ✅');
  });
};

/* ----------------------------- SERVICIOS ------------------------------- */
ViewsBusiness.services = async function () {
  if (!(await bizGuard(['admin', 'editor']))) return;
  const b = await OppiAPI.getBusiness();
  if (!b) { Router.go('#/empresas'); return; }

  const addCascade = await ViewsPlus.cascadeHtml({ catId: 'nsCat', profId: 'nsProf', labelCat: 'Categoría', labelProf: 'Profesión' });

  setView(`
  <a class="back-link" href="#/empresas/panel">← Panel</a>
  <h1 class="page-title">Mis servicios 💈</h1>
  <p class="small muted">Tocá un servicio para editar precio, foto y descripción. Tus clientes pagan el 100% al reservar.</p>
  <div class="stack" id="bizSvcList">
    ${b.services.map(s => `
      <div class="card ${s.active ? '' : 'muted-card'}">
        <div class="row between svc-head" data-expand="${s.id}" role="button" tabindex="0" aria-label="Editar ${UI.esc(s.name)}">
          <div><strong>${UI.esc(s.name)}</strong>
            <div class="muted small">${fmtGs(s.price)} · ⏱ ${s.durationMin} min</div>
          </div>
          <button class="chip ${s.active ? 'active' : ''}" data-toggle-svc="${s.id}">${s.active ? 'Activo' : 'Pausado'}</button>
        </div>
        <form class="stack svc-edit" data-svc-form="${s.id}" hidden>
          <div class="row gap">
            ${UI.field('Precio (Gs.)', `<input type="number" min="1" data-f="price" value="${s.price}">`)}
            ${UI.field('Duración (min)', `<input type="number" min="5" data-f="durationMin" value="${s.durationMin}">`)}
          </div>
          ${ViewsPlus.photoField('se_' + s.id + '_', s.photo_url)}
          ${UI.field('Descripción', `<textarea data-f="description" rows="2" maxlength="500" placeholder="Contá en qué consiste el servicio…">${UI.esc(s.description || '')}</textarea>`)}
          ${UI.field('Incluye (uno por línea)', `<textarea data-f="includes" rows="3" placeholder="Corte personalizado&#10;Productos profesionales">${UI.esc((s.includes || []).join('\n'))}</textarea>`)}
          <p class="small error" data-err></p>
          <button class="btn btn-primary btn-sm" type="submit">Guardar cambios</button>
        </form>
      </div>`).join('')}
  </div>
  <div class="card">
    <h3>Agregar servicio</h3>
    <form id="addSvcForm" class="stack">
      ${UI.field('Nombre *', `<input id="nsName" required placeholder="Ej: Corte hombre">`)}
      ${addCascade}
      <div class="row gap">
        ${UI.field('Precio (Gs.) *', `<input id="nsPrice" type="number" min="1" required placeholder="70000">`)}
        ${UI.field('Duración (min)', `<input id="nsDur" type="number" min="5" value="45">`)}
      </div>
      ${ViewsPlus.photoField('ns_', null)}
      ${UI.field('Descripción', `<textarea id="nsDesc" rows="2" maxlength="500" placeholder="Contá en qué consiste el servicio…"></textarea>`)}
      ${UI.field('Incluye (uno por línea)', `<textarea id="nsInc" rows="3" placeholder="Corte personalizado&#10;Productos profesionales"></textarea>`)}
      <p class="small error" id="nsErr"></p>
      <button class="btn btn-ghost btn-block" type="submit">＋ Agregar</button>
    </form>
  </div>`);

  document.querySelectorAll('[data-expand]').forEach(head => {
    const toggle = e => {
      if (e.target.closest('[data-toggle-svc]')) return; // el chip no expande
      const form = head.parentElement.querySelector('[data-svc-form]');
      form.hidden = !form.hidden;
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
    });
  });

  document.querySelectorAll('[data-svc-form]').forEach(form => form.addEventListener('submit', async e => {
    e.preventDefault();
    const id = form.dataset.svcForm;
    const price = Number(form.querySelector('[data-f="price"]').value);
    const err = form.querySelector('[data-err]');
    if (!price || price <= 0) { err.textContent = 'El precio tiene que ser mayor a cero.'; return; }
    err.textContent = '';
    const ur = await OppiAPI.updateBusinessService(id, {
      price, durationMin: Number(form.querySelector('[data-f="durationMin"]').value) || 45,
    });
    if (!ur.ok) { err.textContent = ur.error; return; }
    const dr = await OppiAPI.updateServiceDetails(id, {
      photo_url: (document.getElementById('se_' + id + '_FotoUrl') || {}).value || '',
      description: form.querySelector('[data-f="description"]').value,
      includes: form.querySelector('[data-f="includes"]').value,
    });
    if (!dr.ok) { err.textContent = dr.error; return; }
    UI.toast('Servicio actualizado ✅');
    ViewsBusiness.services();
  }));

  document.querySelectorAll('[data-toggle-svc]').forEach(btn => btn.addEventListener('click', async () => {
    const svc = (await OppiAPI.getBusiness()).services.find(x => x.id === btn.dataset.toggleSvc);
    await OppiAPI.updateBusinessService(svc.id, { active: !svc.active });
    ViewsBusiness.services();
  }));

  document.getElementById('addSvcForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await OppiAPI.addBusinessService({
      name: document.getElementById('nsName').value.trim(),
      cat: document.getElementById('nsCat') ? document.getElementById('nsCat').value : '',
      price: Number(document.getElementById('nsPrice').value),
      durationMin: Number(document.getElementById('nsDur').value) || 45,
      photo_url: document.getElementById('ns_FotoUrl').value.trim() || null,
      description: document.getElementById('nsDesc').value,
      includes: document.getElementById('nsInc').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 12),
    });
    if (!r.ok) { document.getElementById('nsErr').textContent = r.error; return; }
    UI.toast('Servicio agregado ✅');
    ViewsBusiness.services();
  });

  // Campos de foto (URL o subida) en cada form de edición + el de alta.
  b.services.forEach(s => ViewsPlus.bindPhotoField('se_' + s.id + '_'));
  ViewsPlus.bindPhotoField('ns_');
  ViewsPlus.bindCascade({ catId: 'nsCat', profId: 'nsProf' });
};

/* ------------------------------- EQUIPO -------------------------------- */
/* Al agregar/editar: cargo profesional (texto) + Rol de acceso (selector
   con descripción). Solo el admin del equipo puede gestionar integrantes. */
ViewsBusiness.team = async function () {
  const role = await bizGuard(['admin']);
  if (!role) return;
  const b = await OppiAPI.getBusiness();
  if (!b) { Router.go('#/empresas'); return; }

  const accessBadge = a => a === 'admin'
    ? '<span class="badge badge-verified">Admin</span>'
    : a === 'editor' ? '<span class="badge badge-ok">Editor</span>'
    : '<span class="badge badge-muted">Lectura</span>';

  setView(`
  <a class="back-link" href="#/empresas/panel">← Panel</a>
  <h1 class="page-title">Equipo 👥</h1>
  <p class="small muted">El <strong>cargo</strong> es lo que hace (ej: Colorista). El <strong>rol de acceso</strong> es lo que puede tocar en el panel.</p>
  <div class="stack">
    ${(b.team || []).map(m => `
      <div class="card">
        <div class="row gap">${UI.avatar(m.initials, m.color, 44)}
          <div class="grow"><strong>${UI.esc(m.name)}</strong>
            <div class="muted small">${UI.esc(m.role || '')}${m.email ? ' · ' + UI.esc(m.email) : ''}</div>
          </div>
          ${accessBadge(m.access_role || 'lectura')}
        </div>
        <div class="row gap" style="margin-top:8px">
          <button class="btn btn-ghost btn-sm" data-tm-edit="${UI.esc(m.id)}">Cambiar rol</button>
        </div>
      </div>`).join('') || '<p class="muted">Todavía no cargaste a tu equipo.</p>'}
  </div>
  <div class="card">
    <h3>Agregar integrante</h3>
    <form id="teamForm" class="stack">
      ${UI.field('Nombre *', `<input id="tmName" required placeholder="Ej: Ana Gómez">`)}
      ${UI.field('Email', `<input id="tmEmail" type="email" placeholder="ana@email.com">`, 'Con su email entra a ver el panel según su rol.')}
      ${UI.field('Cargo', `<input id="tmRole" placeholder="Ej: Colorista">`)}
      ${UI.field('Rol de acceso', `
        <select id="tmAccess">
          <option value="lectura">Lectura — Solo ver: sin editar ni publicar nada</option>
          <option value="editor">Editor — Agenda, reservas y servicios</option>
          <option value="admin">Admin — Todo: finanzas, equipo y configuración</option>
        </select>`, 'Qué puede tocar en el panel de tu negocio.')}
      <button class="btn btn-primary btn-block" type="submit">Agregar</button>
    </form>
  </div>`);

  document.getElementById('teamForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await OppiAPI.addTeamMember({
      name: document.getElementById('tmName').value,
      email: document.getElementById('tmEmail').value,
      role: document.getElementById('tmRole').value,
      access_role: document.getElementById('tmAccess').value,
    });
    if (!r.ok) { UI.toast(r.error, 'error'); return; }
    UI.toast('Integrante agregado ✅');
    ViewsBusiness.team();
  });

  document.querySelectorAll('[data-tm-edit]').forEach(btn => btn.addEventListener('click', () => {
    const m = (b.team || []).find(x => x.id === btn.dataset.tmEdit);
    if (!m) return;
    UI.modal(`
      <button class="modal-x" id="mX" aria-label="Cerrar">✕</button>
      <h3>Rol de ${UI.esc(m.name)}</h3>
      <p class="muted small">${UI.esc(m.role || '')}</p>
      ${UI.field('Rol de acceso', `
        <select id="tmAccessEdit">
          ${Object.entries(ACCESS_ROLES).map(([v, d]) => `<option value="${v}" ${(m.access_role || 'lectura') === v ? 'selected' : ''}>${d.label} — ${d.desc}</option>`).join('')}
        </select>`)}
      <p class="small error" id="tmErr"></p>
      <div class="row gap">
        <button class="btn btn-ghost" id="tmCancel">Cancelar</button>
        <button class="btn btn-primary" id="tmSave">Guardar rol</button>
      </div>`);
    document.getElementById('mX').onclick = closeModal;
    document.getElementById('tmCancel').onclick = closeModal;
    document.getElementById('tmSave').addEventListener('click', async () => {
      const r = await OppiAPI.updateTeamMemberRole(m.id, document.getElementById('tmAccessEdit').value);
      if (!r.ok) { document.getElementById('tmErr').textContent = r.error; return; }
      closeModal();
      UI.toast('Rol actualizado ✅');
      ViewsBusiness.team();
    });
  }));
};

/* ------------------------------- RESEÑAS ------------------------------- */
ViewsBusiness.reviews = async function () {
  if (!(await bizGuard(['admin']))) return;
  const b = await OppiAPI.getBusiness();
  if (!b) { Router.go('#/empresas'); return; }
  setView(`
  <a class="back-link" href="#/empresas/panel">← Panel</a>
  <h1 class="page-title">Reseñas ⭐</h1>
  <p class="muted small">Respondé las reseñas: se muestran en tu perfil público.</p>
  <div class="stack">
    ${b.reviews.map(r => `
      <div class="card">
        <div class="row between"><strong>${UI.esc(r.author)}</strong><span class="muted small">${UI.esc(r.date)}</span></div>
        <div>${UI.stars(r.rating)}</div>
        <p>${UI.esc(r.text)}</p>
        ${(r.photos || []).length ? `<div class="photo-preview">${r.photos.slice(0, 3).map(p => `<img src="${UI.esc(p)}" alt="Foto de la reseña de ${UI.esc(r.author)}" loading="lazy">`).join('')}</div>` : ''}
        ${r.reply ? `<div class="biz-reply"><strong>Tu respuesta:</strong><p class="small">${UI.esc(r.reply)}</p></div>` : `
          <form class="stack" data-reply="${r.id}">
            ${UI.field('Responder como ' + UI.esc(b.name), `<textarea rows="2" placeholder="Gracias por tu visita…"></textarea>`)}
            <button class="btn btn-ghost btn-sm" type="submit">Responder</button>
          </form>`}
      </div>`).join('')}
  </div>`);
  document.querySelectorAll('[data-reply]').forEach(form => form.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await OppiAPI.replyReview(form.dataset.reply, form.querySelector('textarea').value);
    if (!r.ok) { UI.toast(r.error, 'error'); return; }
    UI.toast('Respuesta publicada ✅');
    ViewsBusiness.reviews();
  }));
};

/* ----------------------------- DOCUMENTOS ------------------------------ */
ViewsBusiness.documents = async function () {
  if (!(await bizGuard(['admin']))) return;
  const b = await OppiAPI.getBusiness();
  if (!b) { Router.go('#/empresas'); return; }
  const statusLabel = { pending: ['Pendiente', 'warn'], review: ['En revisión', 'ok'], approved: ['Aprobado', 'ok'] };
  const slOf = s => statusLabel[s] || statusLabel.pending;
  setView(`
  <a class="back-link" href="#/empresas/panel">← Panel</a>
  <h1 class="page-title">Documentos 📄</h1>
  <p class="muted small">Subilos cuando quieras: tu negocio ya está publicado con el badge "En verificación".</p>
  <div class="stack">
    ${b.documents.map(d => `
      <div class="card">
        <div class="row between"><strong>${UI.esc(d.name)}</strong><span class="badge badge-${slOf(d.status)[1]}">${slOf(d.status)[0]}</span></div>
        ${d.status === 'pending' ? `<label class="btn btn-ghost btn-sm file-btn">Subir<input type="file" data-doc="${d.id}" hidden></label>` : '<p class="small muted">Lo estamos revisando. Te avisamos cuando esté.</p>'}
      </div>`).join('')}
  </div>`);
  document.querySelectorAll('[data-doc]').forEach(inp => inp.addEventListener('change', async () => {
    if (!inp.files.length) return;
    const dr = await OppiAPI.uploadDocument(inp.dataset.doc);
    if (!dr.ok) { UI.toast(dr.error, 'error'); return; }
    UI.toast('Documento enviado 📄');
    ViewsBusiness.documents();
  }));
};

/* ----------------- RESERVA EN NEGOCIO (3 pasos, §3) ---------------------- */
/* Paso 1: servicio (+ staff "Sin preferencia" o miembro del equipo).
   Paso 2: fecha/hora (filtrada por staff en el backend real; en el mock
   los horarios son del negocio — ver INTEGRATION POINT en api.js).
   Paso 3: confirmación con el total + [Confirmar y pagar]. */
const BizBooking = {
  state: {},

  /* Paso 1: servicio + staff */
  async step1(params, query) {
    const biz = await OppiAPI.getPublicBusiness(params.id);
    if (!biz) { Router.go('#/'); return; }
    const q = query || {};
    const services = biz.services.filter(s => s.active !== false);
    if (!services.length) { Router.go('#/negocio/' + biz.id); return; }
    const svc0 = services.find(s => s.id === q.servicio) || services[0];
    const branches = await OppiAPI.getBranches(biz.id);
    this.state = {
      bizId: biz.id, serviceId: svc0.id,
      staffId: (biz.team || []).some(m => m.id === q.staff) ? q.staff : null,
      date: null, time: null,
      branchId: branches.length ? branches[0].id : null,
      branchName: branches.length ? branches[0].nombre : null,
    };

    const groups = [];
    services.forEach(s => {
      let g = groups.find(x => x.cat === s.cat);
      if (!g) { g = { cat: s.cat, items: [] }; groups.push(g); }
      g.items.push(s);
    });

    setView(`
    <a class="back-link" href="#/negocio/${biz.id}">← ${UI.esc(biz.name)}</a>
    <div class="steps"><span class="step active">1</span><span class="step">2</span><span class="step">3</span></div>
    <h1 class="page-title">Elegí servicio</h1>
    ${groups.map(g => `
      <h2 class="sec-title">${UI.esc(g.cat)}</h2>
      <div class="stack">
        ${g.items.map(s => `
          <button class="card service-row pick-row ${s.id === svc0.id ? 'active' : ''}" data-bb-svc="${s.id}">
            <div>
              <strong>${UI.esc(s.name)}</strong>
              <div class="muted small">⏱ ${s.durationMin} min</div>
            </div>
            <strong class="service-price">${fmtGs(s.price)}</strong>
          </button>`).join('')}
      </div>`).join('')}
    <h2 class="sec-title">¿Con quién?</h2>
    <div class="card">
      ${UI.field('Profesional', `<select id="bbStaff">
        <option value="">Sin preferencia</option>
        ${biz.team.map(m => `<option value="${m.id}" ${m.id === this.state.staffId ? 'selected' : ''}>${UI.esc(m.name)} · ${UI.esc(m.role)}</option>`).join('')}
      </select>`)}
    </div>
    ${branches.length > 1 ? `
    <h2 class="sec-title">¿En qué sucursal?</h2>
    <div class="card">
      ${UI.field('Sucursal', `<select id="bbBranch">
        ${branches.map(br => `<option value="${br.id}">${UI.esc(br.nombre)}${br.direccion ? ' · ' + UI.esc(br.direccion) : ''}</option>`).join('')}
      </select>`)}
    </div>` : ''}
    <button class="btn btn-primary btn-block btn-cta" id="bbTo2">Continuar →</button>
    <button class="btn btn-ghost btn-block" onclick="history.back()">← Volver</button>`);

    document.querySelectorAll('[data-bb-svc]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('[data-bb-svc]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      BizBooking.state.serviceId = b.dataset.bbSvc;
    }));
    document.getElementById('bbStaff').addEventListener('change', e => {
      BizBooking.state.staffId = e.target.value || null;
    });
    const bbBranch = document.getElementById('bbBranch');
    if (bbBranch) bbBranch.addEventListener('change', e => {
      const br = branches.find(x => x.id === e.target.value);
      BizBooking.state.branchId = e.target.value || null;
      BizBooking.state.branchName = br ? br.nombre : null;
    });
    document.getElementById('bbTo2').addEventListener('click', () => BizBooking.step2());
  },

  /* Paso 2: fecha y hora */
  async step2() {
    const { bizId } = this.state;
    const biz = await OppiAPI.getPublicBusiness(bizId);
    if (!biz) { Router.go('#/'); return; }
    const svc = biz.services.find(s => s.id === this.state.serviceId);
    const staff = (biz.team || []).find(m => m.id === this.state.staffId);

    setView(`
    <a class="back-link" href="#/negocio/${biz.id}/reservar">← Cambiar servicio</a>
    <div class="steps"><span class="step done">✓</span><span class="step active">2</span><span class="step">3</span></div>
    <h1 class="page-title">Elegí fecha y hora</h1>
    <div class="card">
      <strong>${UI.esc(svc.name)}</strong> en ${UI.esc(biz.name)}<br>
      <span class="muted small">${staff ? 'Con ' + UI.esc(staff.name) : 'Sin preferencia de profesional'} · ${fmtGs(svc.price)}</span>
      ${BizBooking.state.branchName ? `<br><span class="small">🏪 Sucursal: <strong>${UI.esc(BizBooking.state.branchName)}</strong></span>` : ''}
    </div>
    <div class="card">
      ${AvailabilityPicker.html('bb')}
    </div>
    <button class="btn btn-primary btn-block btn-cta" id="bbTo3" disabled>Continuar →</button>
    <button class="btn btn-ghost btn-block" onclick="history.back()">← Volver</button>`);

    AvailabilityPicker.bind({
      prefix: 'bb',
      proId: biz.id,
      getServiceId: () => BizBooking.state.serviceId,
      onSlot: sel => {
        if (!sel) {
          BizBooking.state.date = null; BizBooking.state.time = null;
          document.getElementById('bbTo3').disabled = true;
          return;
        }
        BizBooking.state.date = sel.date;
        BizBooking.state.time = sel.time;
        document.getElementById('bbTo3').disabled = false;
      },
    });
    document.getElementById('bbTo3').addEventListener('click', () => {
      if (BizBooking.state.date && BizBooking.state.time) BizBooking.step3();
    });
  },

  /* Paso 3: confirmación con el total antes del botón de pagar.
     Cupón opcional: se valida antes de pagar y el total se recalcula
     sobre el precio con descuento. */
  async step3() {
    const { bizId, serviceId, staffId, date, time } = this.state;
    this.coupon = null;
    const biz = await OppiAPI.getPublicBusiness(bizId);
    if (!biz) { Router.go('#/'); return; }
    const svc = biz.services.find(s => s.id === serviceId);
    const staff = (biz.team || []).find(m => m.id === staffId);
    const d = new Date(date + 'T12:00:00');

    // Totales recalculables (con o sin cupón): el monto exacto siempre
    // visible antes del botón de pagar.
    const paintTotals = () => {
      const discount = BizBooking.coupon ? BizBooking.coupon.discount_gs : 0;
      const total = Math.max(0, svc.price - discount);
      document.getElementById('bbTotals').innerHTML = `
        <div class="row between"><span>Servicio</span>${discount
          ? `<span><s class="muted">${fmtGs(svc.price)}</s> <strong>${fmtGs(total)}</strong></span>`
          : `<strong>${fmtGs(svc.price)}</strong>`}</div>
        ${discount ? `<div class="row between"><span>🎟️ Descuento</span><strong class="money-in">−${fmtGs(discount)}</strong></div>` : ''}
        <div class="row between"><span><strong>Total a pagar</strong></span><strong>${fmtGs(total)}</strong></div>
        <p class="small">💳 Pago simulado — acá iría la pasarela real.</p>`;
      document.getElementById('bbPay').textContent = `Confirmar y pagar ${fmtGs(total)} · pago simulado`;
    };

    setView(`
    <button class="back-link" onclick="history.back()" style="border:none;background:none;cursor:pointer;font:inherit">← Volver</button>
    <div class="steps"><span class="step done">✓</span><span class="step done">✓</span><span class="step active">3</span></div>
    <h1 class="page-title">Confirmá tu reserva</h1>
    <div class="card">
      <div class="row between"><span><strong>${UI.esc(svc.name)}</strong><br><span class="muted small">${UI.esc(biz.name)}${staff ? ' · con ' + UI.esc(staff.name) : ''}</span></span></div>
      <hr class="sep">
      <div class="row between"><span>📅 ${d.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long' })}</span><span>🕐 ${time}</span></div>
    </div>
    <div class="card">
      <strong>🎟️ ¿Tenés un cupón?</strong>
      <div class="row gap" style="margin-top:8px">
        <input id="bbCoupon" class="grow" placeholder="Ej: AMIGA20" style="text-transform:uppercase" aria-label="Código de cupón" autocomplete="off">
        <button class="btn btn-ghost btn-sm" id="bbCouponBtn" type="button">Aplicar</button>
      </div>
      <div id="bbCouponMsg" style="margin-top:8px"></div>
    </div>
    <div class="card deposit-card" id="bbTotals">
      <div class="row between"><span>Servicio</span><strong>${fmtGs(svc.price)}</strong></div>
      <div class="row between"><span><strong>Total a pagar</strong></span><strong>${fmtGs(svc.price)}</strong></div>
      <p class="small">💳 Pago simulado — acá iría la pasarela real.</p>
    </div>
    <p class="small muted center">Cancelación gratis hasta 24 h antes, con devolución del 100%. <a class="link" href="#/negocio/${biz.id}?tab=info">Ver política completa</a></p>
    <button class="btn btn-primary btn-block btn-cta" id="bbPay">Confirmar y pagar ${fmtGs(svc.price)} · pago simulado</button>
    <button class="btn btn-ghost btn-block" onclick="history.back()">← Volver</button>`);

    document.getElementById('bbCouponBtn').addEventListener('click', async () => {
      const code = document.getElementById('bbCoupon').value.trim();
      const msg = document.getElementById('bbCouponMsg');
      if (!code) { msg.innerHTML = '<p class="small error">Escribí el código del cupón.</p>'; return; }
      msg.innerHTML = '<p class="small muted">Validando…</p>';
      const v = await OppiAPI.validateCoupon({ code, business_id: bizId, service_id: serviceId });
      if (!v.valid) {
        BizBooking.coupon = null;
        msg.innerHTML = `<p class="small error">${UI.esc(v.error || 'Cupón inválido.')}</p>`;
      } else {
        BizBooking.coupon = { code: code.toUpperCase(), discount_gs: v.discount_gs };
        msg.innerHTML = `<p class="money-in small">🎟️ Cupón aplicado · Descuento: −${fmtGs(v.discount_gs)}</p>`;
        UI.toast('Cupón aplicado 🎟️');
      }
      paintTotals();
    });

    document.getElementById('bbPay').addEventListener('click', async () => {
      const r = await OppiAPI.createBusinessBooking({
        bizId, serviceId, staffId, date, time,
        coupon_code: BizBooking.coupon ? BizBooking.coupon.code : null,
      });
      if (!r.ok) { UI.toast(r.error, 'error'); return; }
      BizBooking.step4(r.booking);
    });
  },

  /* Paso 4: éxito */
  async step4(booking) {
    const banner = await ViewsCancel.bannerFor(booking.id);
    setView(`
    <div class="steps"><span class="step done">✓</span><span class="step done">✓</span><span class="step done">✓</span></div>
    <div class="success-hero">
      <div class="success-check">✓</div>
      <h1>¡Reserva creada! 🎉</h1>
      <p class="muted">${UI.esc(booking.serviceName)} en ${UI.esc(booking.bizName)}</p>
      <div class="card">
        <div class="row between"><span>📅 Fecha</span><strong>${new Date(booking.date + 'T12:00:00').toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' })} · ${booking.time}</strong></div>
        <hr class="sep">
        <div class="row between"><span>Profesional</span><strong>${UI.esc(booking.staffName)}</strong></div>
        <hr class="sep">
        <div class="row between"><span>Pagado</span><strong>${fmtGs(booking.paid)}</strong></div>
      </div>
      ${banner}
      <p class="small muted">El negocio la confirma en breve. Te avisamos cuando esté lista 💜</p>
      <button class="btn btn-outline btn-block" id="bbCal">📅 Agregar a calendario</button>
      <a class="btn btn-primary btn-block btn-cta" href="#/reservas">Ver mis reservas</a>
      <a class="btn btn-ghost btn-block" href="#/">Volver al inicio</a>
    </div>`);

    document.getElementById('bbCal').addEventListener('click', () => downloadICS(booking));
  },
};

/* Descarga un .ics para agregar la reserva al calendario del teléfono. */
function downloadICS(booking) {
  const dt = String(booking.date).replace(/-/g, '') + 'T' + String(booking.time).replace(':', '') + '00';
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Oppi//Reserva//ES',
    'BEGIN:VEVENT',
    'UID:' + booking.id + '@oppi.com.py',
    'DTSTART:' + dt,
    'SUMMARY:' + booking.serviceName + ' en ' + booking.bizName,
    'DESCRIPTION:Pagado: ' + booking.paid,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  a.download = 'oppi-reserva.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  UI.toast('Calendario descargado 📅');
}
