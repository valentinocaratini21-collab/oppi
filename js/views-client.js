/* ============================================================================
 * Oppi — Vistas del cliente: Reservas, Favoritos, Chat, Perfil, Notificaciones
 * ========================================================================== */
'use strict';

const ViewsClient = {
  /* ------------------------------ RESERVAS ----------------------------- */
  /* Próximas: Reprogramación (modal con AvailabilityPicker: la confirmación
     muestra "Tu pago de Gs. X se mantiene intacto" antes de llamar) y
     Cancelar (vista #/reservas/:id/cancelar con el preview de la política
     y los comodines). Cada reserva próxima muestra el banner violeta de la
     política. Anteriores vencidas: "El profesional no vino" (vista de
     reporte de no-show con reembolso total).
     Si el profesional marcó que va en camino, se ve el banner. */
  async bookings() {
    const bookings = await OppiAPI.getBookings();
    const waitlist = await OppiAPI.getWaitlist();
    const today = new Date().toISOString().slice(0, 10);
    const active = b => b.status === 'confirmed' || b.status === 'pending';
    const overdue = b => active(b) && b.date && b.date < today;
    const upcoming = bookings.filter(b => active(b) && !overdue(b));
    const past = bookings.filter(b => !upcoming.includes(b));
    // Banner de política por reserva (con gracia si el endpoint no existe).
    const banners = {};
    await Promise.all(upcoming.map(async b => {
      try { banners[b.id] = await ViewsCancel.bannerFor(b.id); } catch (e) { banners[b.id] = ''; }
    }));

    setView(`
    <h1 class="page-title">Mis reservas</h1>
    ${upcoming.length ? `<h2 class="sec-title">Próximas</h2><div class="stack">${upcoming.map(b => `
      <div class="card">
        <div class="row between"><a class="link svc-link" href="#/reservas/${b.id}"><strong>${UI.esc(b.serviceName)}</strong></a>${UI.statusBadge(b.status)}</div>
        <div class="muted small">${UI.esc(b.proName)} · 📅 ${b.date} · 🕐 ${b.time}</div>
        ${b.discount_gs ? `<div class="small"><span class="money-in">🎟️ Cupón ${UI.esc(b.coupon_code || '')}: −${fmtGs(b.discount_gs)}</span></div>` : ''}
        <div class="row between small"><span class="muted">Pagado: ${fmtGs(b.paid)}</span><strong>${fmtGs(b.price)}</strong></div>
        ${b.en_route_at ? `<div class="enroute-banner">🛵 ${UI.esc(b.proName)} va en camino</div>` : ''}
        ${banners[b.id] || ''}
        <div class="row gap">
          ${b.proId ? `<a class="btn btn-ghost btn-sm" href="#/chat/c_${b.proId}">💬 Chat</a>` : ''}
          ${b.proId ? `<button class="btn btn-ghost btn-sm" data-resched-bk="${b.id}">Reprogramar</button>` : ''}
          <a class="btn btn-danger-soft btn-sm" href="#/reservas/${b.id}/cancelar">Cancelar</a>
        </div>
        <p class="small muted">🔔 Te avisamos un día antes.</p>
      </div>`).join('')}</div>`
      : UI.empty('📅', 'Sin reservas próximas', 'Buscá un profesional y reservá en 3 pasos.', '<a class="btn btn-primary" href="#/buscar">Buscar profesionales</a>')}

    ${waitlist.length ? `<h2 class="sec-title">Lista de espera ⏳</h2><div class="stack">${waitlist.map(w => `
      <div class="card warn-card">
        <div class="row between"><strong>${UI.esc(w.serviceName)}</strong>${UI.statusBadge('pending')}</div>
        <div class="muted small">${UI.esc(w.proName)} · ${w.date} ${w.time !== 'cualquiera' ? '· ' + w.time : ''}</div>
        <p class="small muted">Te avisamos si se libera un turno.</p>
      </div>`).join('')}</div>` : ''}

    ${past.length ? `<h2 class="sec-title">Anteriores</h2><div class="stack">${past.map(b => `
      <div class="card muted-card">
        <div class="row between"><a class="link svc-link" href="#/reservas/${b.id}"><strong>${UI.esc(b.serviceName)}</strong></a>${UI.statusBadge(b.status)}</div>
        <div class="muted small">${UI.esc(b.proName)} · ${b.date} · ${b.time}</div>
        ${overdue(b) ? `<div class="row gap" style="margin-top:8px"><a class="btn btn-ghost btn-sm" href="#/reservas/${b.id}/reportar-no-show">El profesional no vino</a></div>` : ''}
      </div>`).join('')}</div>` : ''}`);

    document.querySelectorAll('[data-resched-bk]').forEach(btn => btn.addEventListener('click', () => {
      const bk = bookings.find(x => x.id === btn.dataset.reschedBk);
      if (bk) openRescheduleModal(bk);
    }));
  },

  /* ----------------------------- FAVORITOS ----------------------------- */
  async favorites() {
    const favs = await OppiAPI.getFavorites();
    const cards = await Promise.all(favs.map(async f => {
      if (f.kind === 'business') {
        const fav = await OppiAPI.isFavorite('b_' + f.id);
        return `<a class="card pro-card" href="#/negocio/${f.id}">
          <div class="pro-card-top">
            <div class="biz-logo" style="width:56px;height:56px;font-size:22px;background:${f.logoColor}">${UI.esc(f.name[0] || '?')}</div>
            <div class="pro-card-info">
              <div class="pro-card-name">${UI.esc(f.name)} ${f.verified ? '<span class="vcheck" title="Verificado">✓</span>' : ''}</div>
              <div class="muted small">🏪 ${UI.esc(f.category)} · ${UI.esc(f.barrio)}</div>
            </div>
            <button class="icon-btn fav-btn ${fav ? 'active' : ''}" data-fav="b_${f.id}" aria-label="Favorito">${fav ? '❤️' : '🤍'}</button>
          </div>
        </a>`;
      }
      return UI.proCard(f);
    }));
    setView(`
    <h1 class="page-title">Favoritos ❤️</h1>
    ${favs.length ? `<div class="stack">${cards.join('')}</div>`
      : UI.empty('🤍', 'Todavía no tenés favoritos', 'Tocá el corazón en el perfil de un profesional o negocio para guardarlo acá.', '<a class="btn btn-primary" href="#/buscar">Explorar</a>')}`);
  },

  /* -------------------------------- CHAT ------------------------------- */
  async chats() {
    const threads = await OppiAPI.getChatThreads();
    setView(`
    <h1 class="page-title">Chats 💬</h1>
    <div class="stack">
      ${threads.map(t => {
        const last = t.messages[t.messages.length - 1];
        return `<a class="card chat-row" href="#/chat/${t.id}">
          ${UI.avatar(t.peerInitials, t.peerColor, 48)}
          <div class="chat-preview"><strong>${UI.esc(t.peerName)}</strong>
          <p class="muted small">${UI.esc(last ? last.text : '')}</p></div>
          <span class="muted small">${last ? UI.esc(last.time) : ''}</span>
        </a>`;
      }).join('')}
    </div>`);
  },

  async chatThread(params) {
    let t = await OppiAPI.getChatThread(params.id);
    // Chat directo desde el perfil del profesional: crear hilo si no existe
    if (!t && params.id.startsWith('c_')) {
      const r = await OppiAPI.ensureChatThread(params.id.slice(2));
      if (!r.ok) { Router.go('#/chat'); return; }
      t = r.thread;
    }
    if (!t) { Router.go('#/chat'); return; }

    setView(`
    <a class="back-link" href="#/chat">← Chats</a>
    <div class="chat-head card">
      ${UI.avatar(t.peerInitials, t.peerColor, 44)}
      <div><strong>${UI.esc(t.peerName)}</strong><div class="muted small">En línea</div></div>
    </div>
    <div class="chat-messages" id="chatMsgs">
      ${t.messages.map(m => `<div class="msg ${m.from === 'me' ? 'mine' : 'theirs'}">${UI.esc(m.text)}<span class="msg-time">${UI.esc(m.time)}</span></div>`).join('')}
    </div>
    <form class="chat-input" id="chatForm">
      <input id="chatText" placeholder="Escribí un mensaje…" autocomplete="off" aria-label="Mensaje">
      <button class="btn btn-primary" type="submit">➤</button>
    </form>`);

    const scroll = () => { const el = document.getElementById('chatMsgs'); el.scrollTop = el.scrollHeight; };
    scroll();
    document.getElementById('chatForm').addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('chatText');
      const text = input.value.trim();
      if (!text) return;
      const r = await OppiAPI.sendChatMessage(t.id, text);
      if (!r.ok) { UI.toast(r.error, 'error'); return; }
      input.value = '';
      ViewsClient.chatThread(params);
      // Respuesta simulada del profesional (solo mock: el adapter real no simula)
      setTimeout(async () => {
        await OppiAPI.pushChatReply(t.id, r.autoReply);
        if (location.hash === '#/chat/' + t.id) ViewsClient.chatThread(params);
        else UI.toast('💬 Nuevo mensaje de ' + t.peerName);
      }, 2500);
    });
  },

  /* ------------------------------- PERFIL ------------------------------ */
  /* §1 — Orden vertical: 1) header (foto, nombre, barrio, miembro desde,
     ★ como cliente) 2) crédito → referidos 3) editar perfil 4) segmented
     "ver como" si ofrece servicios 5) lista 6) cerrar sesión.
     MOCK coherente: barrio (def. Asunción), miembro-desde (año de
     createdAt, def. 2026) y rating-como-cliente se derivan de los datos
     que hay; el backend los va a traer del perfil real. */
  async profile() {
    const user = await OppiAPI.currentUser();
    const credit = await OppiAPI.getCredit();
    const bookings = await OppiAPI.getBookings();
    const upcoming = bookings.filter(b => b.status === 'confirmed' || b.status === 'pending');
    const waitlist = await OppiAPI.getWaitlist();
    let roles = ['client'];
    try { roles = (await OppiAPI.myRoles()) || roles; } catch (e) { /* sin sesión */ }
    const mode = (typeof OppiMode !== 'undefined' ? OppiMode.get() : 'client');

    const memberYear = user.createdAt ? new Date(user.createdAt).getFullYear() : 2026;
    const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    // MOCK: rating como cliente fijo + base de servicios; crece con las reservas.
    const clientServices = 11 + bookings.length;
    const foto = user.foto_url || '';

    // Soporte: link solo visible para agentes (el backend responde 403 si no).
    let supportLink = false;
    try { await OppiAPI.getSupportConversations({}); supportLink = true; }
    catch (e) { supportLink = false; }

    // Admin de la plataforma: link al panel (la vista valida el permiso).
    let isAdmin = false;
    try { isAdmin = await OppiAPI.isAdmin(); } catch (e) { isAdmin = false; }

    setView(`
    <div class="profile-hero">
      <div class="profile-avatar">${foto
        ? `<img class="profile-photo" src="${UI.esc(foto)}" alt="Foto de perfil de ${UI.esc(user.name)}">`
        : UI.avatar(initials, '#6B5BD0', 84)}</div>
      <h2>${UI.esc(user.nombre || user.name)}</h2>
      <p class="muted small">📍 ${UI.esc(user.barrio || 'Asunción')}${user.telefono ? ' · 📞 ' + UI.esc(user.telefono) : ''}</p>
      <p class="muted small">Miembro desde ${memberYear}</p>
      <p class="small"><span class="stars">★</span> <strong>4.9</strong> <span class="muted">· ${clientServices} servicios como cliente</span></p>
    </div>

    ${credit > 0 ? `<a class="card credit-card-soft" href="#/referidos">
      <div class="row between"><span><strong>💰 Crédito disponible</strong><div class="credit-amount" style="color:var(--primary)">${fmtGs(credit)}</div></span><span class="menu-chev">›</span></div>
      <p class="small muted">Tocá para ir a Invitá y ganá.</p>
    </a>` : ''}

    <a class="btn btn-outline btn-block" href="#/perfil/editar">Editar perfil</a>

    ${roles.length > 1 ? `
    <p class="small muted center" style="margin:14px 0 0">Ver como:</p>
    ${UI.segmented([
      { label: 'Cliente', href: '#/perfil', active: mode === 'client', attrs: 'data-vm="client"' },
      ...(roles.includes('business') ? [{ label: 'Negocio', href: '#/empresas/panel', active: mode === 'business', attrs: 'data-vm="business"' }] : []),
      ...(roles.includes('handyman') ? [{ label: 'Handyman', href: '#/handyman/panel', active: mode === 'handyman', attrs: 'data-vm="handyman"' }] : []),
    ])}` : ''}

    <div class="card menu-list">
      ${UI.menuRow({ icon: '📊', title: 'Mi resumen', sub: 'Tus números en Oppi', href: '#/mi-resumen' })}
      ${UI.menuRow({ icon: '📅', title: 'Mis reservas', sub: `${upcoming.length} próxima${upcoming.length === 1 ? '' : 's'}`, href: '#/reservas' })}
      ${UI.menuRow({ icon: '✅', title: 'Mi cumplimiento', sub: 'Comodines y no-shows', href: '#/mi-cumplimiento' })}
      ${UI.menuRow({ icon: '❤️', title: 'Favoritos', href: '#/favoritos' })}
      ${UI.menuRow({ icon: '⏳', title: 'Lista de espera', sub: waitlist.length ? `${waitlist.length} activa${waitlist.length === 1 ? '' : 's'}` : 'Sin avisos pendientes', href: '#/reservas', badge: waitlist.length || null })}
      ${UI.menuRow({ icon: '🎁', title: 'Invitá y ganá', sub: 'Ganá Gs. 20.000 por amigo', href: '#/referidos' })}
      ${UI.menuRow({ icon: '🔔', title: 'Notificaciones', href: '#/notificaciones' })}
      ${UI.menuRow({ icon: '💳', title: 'Métodos de pago', href: '#/pagos' })}
      ${UI.menuRow({ icon: '🧾', title: 'Mis pagos', sub: 'Comprobantes y movimientos', href: '#/mis-pagos' })}
      ${supportLink ? UI.menuRow({ icon: '🎧', title: 'Soporte', sub: 'Bandeja de WhatsApp de agentes', href: '#/soporte' }) : ''}
      ${isAdmin ? UI.menuRow({ icon: '🛡️', title: 'Panel admin', sub: 'Usuarios, verificaciones y métricas', href: '#/admin' }) : ''}
      ${UI.menuRow({ icon: '💬', title: 'Ayuda y soporte', sub: 'Chat con nuestro equipo', href: '#/ayuda' })}
      ${UI.menuRow({ icon: '📜', title: 'Términos y privacidad', sub: 'Tus derechos y cómo cuidamos tus datos', href: '#/terminos' })}
    </div>

    ${user.email ? `<div class="card danger-zone">
      <h3>⚠️ Zona de peligro</h3>
      <p class="small muted">Eliminar tu cuenta borra tu nombre, email, teléfono y foto. Tus reservas pasadas quedan guardadas de forma anónima.</p>
      <button class="btn btn-danger-soft btn-block" id="delAccountBtn">Eliminar mi cuenta</button>
    </div>` : ''}

    ${user.email
      ? `<button class="btn btn-danger-soft btn-block logout-btn" id="logoutBtn">Cerrar sesión</button>`
      : `<a class="btn btn-primary btn-block" href="#/login">Iniciar sesión / Registrarme</a>`}`);

    const lo = document.getElementById('logoutBtn');
    if (lo) lo.addEventListener('click', () => { OppiAPI.logout(); Router.go('#/'); });
    const del = document.getElementById('delAccountBtn');
    if (del) del.addEventListener('click', openDeleteAccountFlow);
    // "Ver como": fija el modo de vista (nav inferior) antes de navegar.
    document.querySelectorAll('[data-vm]').forEach(a => a.addEventListener('click', () => {
      try { OppiMode.set(a.dataset.vm); } catch (e) {}
    }));
  },

  /* --------------------------- INVITÁ Y GANÁ --------------------------- */
  async referrals() {
    const credit = await OppiAPI.getCredit();
    const code = await OppiAPI.myReferralCode();
    setView(`
    <a class="back-link" href="#/perfil">← Mi perfil</a>
    <h1 class="page-title">Invitá y ganá 🎁</h1>
    ${credit > 0 ? `<div class="card credit-card"><strong>💰 Crédito disponible</strong><div class="credit-amount">${fmtGs(credit)}</div><p class="small muted">Se descuenta solo en tu próxima reserva.</p></div>` : ''}
    <div class="card">
      <h3>¿Cómo funciona?</h3>
      <p class="small">Compartí tu código con un amigo. Cuando lo canjee, <strong>los dos ganan Gs. 20.000</strong> de crédito para sus reservas.</p>
      <div class="ref-code" id="myCode">${UI.esc(code)}</div>
      <button class="btn btn-primary btn-block btn-cta" id="copyCode">Copiar mi código 📋</button>
      <hr class="sep">
      <p class="small"><strong>¿Tenés un código de invitado?</strong></p>
      <form class="row gap" id="redeemForm">
        <input id="redeemInput" placeholder="Ej: OPPI-AMIGO" class="grow" aria-label="Código de invitado">
        <button class="btn btn-primary btn-sm" type="submit">Canjear</button>
      </form>
      <p class="small muted">Probá con el código de demo: <strong>OPPI-AMIGO</strong></p>
    </div>`);

    document.getElementById('copyCode').addEventListener('click', () => {
      navigator.clipboard?.writeText(code).catch(() => {});
      UI.toast('Código copiado 📋');
    });
    document.getElementById('redeemForm').addEventListener('submit', async e => {
      e.preventDefault();
      const r = await OppiAPI.redeemReferral(document.getElementById('redeemInput').value);
      if (r.ok) { UI.toast('¡Crédito acreditado! 🎉'); ViewsClient.referrals(); }
      else UI.toast(r.error, 'error');
    });
  },

  /* ---------------------------- EDITAR PERFIL -------------------------- */  /* Guarda con OppiAPI.updateMe (contrato del backend: PATCH /api/me con
     { nombre, telefono, barrio, foto_url }). La foto puede ser una URL o
     una subida desde el teléfono (en el backend real se sube a
     /api/uploads; en modo demo queda como dataURL). */
  async editProfile() {
    const user = await OppiAPI.currentUser();
    const barrios = OppiAPI.getBarrios();
    const nombre = user.nombre || user.name || '';
    const foto = user.foto_url || '';
    const ini = nombre.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
    setView(`
    <a class="back-link" href="#/perfil">← Mi perfil</a>
    <h1 class="page-title">Editar perfil</h1>
    <form id="editForm" class="stack">
      <div class="card profile-hero">
        <div class="profile-avatar" id="fotoPrev">${foto
          ? `<img class="profile-photo" src="${UI.esc(foto)}" alt="Tu foto de perfil">`
          : UI.avatar(ini, '#6B5BD0', 84)}</div>
        ${UI.field('Foto de perfil (URL)', `<input id="eFotoUrl" type="url" value="${UI.esc(foto)}" placeholder="https://…">`)}
        ${UI.field('…o subí una foto', `<input id="eFotoFile" type="file" accept="image/*">`, 'Desde tu teléfono o computadora.')}
      </div>
      ${UI.field('Nombre *', `<input id="eName" maxlength="60" required value="${UI.esc(nombre)}" placeholder="Tu nombre">`)}
      ${UI.field('Teléfono', `<input id="ePhone" type="tel" value="${UI.esc(user.telefono || '')}" placeholder="0981 000 000">`, 'Para que los profesionales te contacten.')}
      ${UI.field('Barrio', `<select id="eBarrio">${barrios.map(b => `<option ${b === user.barrio ? 'selected' : ''}>${b}</option>`).join('')}</select>`)}
      <p class="small error" id="editErr"></p>
      <button class="btn btn-primary btn-block btn-cta" type="submit">Guardar cambios</button>
    </form>`);

    const fileInput = document.getElementById('eFotoFile');
    const urlInput = document.getElementById('eFotoUrl');
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        document.getElementById('fotoPrev').innerHTML = `<img class="profile-photo" src="${rd.result}" alt="Tu foto de perfil">`;
        urlInput.value = ''; // la subida gana sobre la URL
      };
      rd.readAsDataURL(f);
    });

    document.getElementById('editForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = document.getElementById('editErr');
      err.textContent = '';
      const btn = e.target.querySelector('[type="submit"]');
      try {
        let fotoUrl = urlInput.value.trim();
        const f = fileInput.files[0];
        if (f) {
          btn.disabled = true;
          const dataUrl = await new Promise((res, rej) => {
            const rd = new FileReader();
            rd.onload = () => res(rd.result);
            rd.onerror = rej;
            rd.readAsDataURL(f);
          });
          const up = await OppiAPI.uploadPhoto({ dataUrl, filename: f.name || 'perfil.jpg' });
          if (!up.ok) { err.textContent = up.error || 'No se pudo subir la foto.'; btn.disabled = false; return; }
          fotoUrl = up.url;
        }
        const r = await OppiAPI.updateMe({
          nombre: document.getElementById('eName').value,
          telefono: document.getElementById('ePhone').value,
          barrio: document.getElementById('eBarrio').value,
          foto_url: fotoUrl,
        });
        if (!r.ok) { err.textContent = r.error || 'No se pudo guardar. Probá de nuevo.'; btn.disabled = false; return; }
        UI.toast('Perfil actualizado ✅');
        Router.go('#/perfil');
      } catch (ex) {
        err.textContent = 'Algo falló al guardar. Revisá tu conexión y probá de nuevo.';
        btn.disabled = false;
      }
    });
  },

  /* ---------------------------- MI RESUMEN ----------------------------- */
  /* Ruta #/mi-resumen (entrada: Mi perfil) — "Mi resumen": reservas
     completadas, total gastado en Oppi, Oppi Points disponibles y link a
     "Mi cumplimiento". INTEGRATION POINT: GET /api/me/summary. */
  async summary() {
    let s = null;
    try { s = await OppiAPI.getMySummary(); } catch (e) { s = null; }
    if (!s || !s.ok) {
      setView(`
      <a class="back-link" href="#/perfil">← Mi perfil</a>
      <h1 class="page-title">Mi resumen 📊</h1>
      ${UI.empty('📊', 'No pudimos cargar tu resumen', UI.esc((s && s.error) || 'Revisá tu conexión e intentá de nuevo.'), '<a class="btn btn-primary" href="#/perfil">Volver a mi perfil</a>')}`);
      return;
    }
    const done = Number(s.completed_bookings) || 0;
    const spent = Number(s.total_spent_gs) || 0;
    const points = Number(s.points) || 0;
    setView(`
    <a class="back-link" href="#/perfil">← Mi perfil</a>
    <h1 class="page-title">Mi resumen 📊</h1>
    ${done ? `
    <div class="stats-grid">
      <div class="card stat"><strong>✅ ${done}</strong><span class="muted small">Reserva${done === 1 ? '' : 's'} completada${done === 1 ? '' : 's'}</span></div>
      <div class="card stat"><strong>💰 ${fmtGs(spent)}</strong><span class="muted small">Gastado en Oppi</span></div>
      <div class="card stat"><strong>⭐ ${points}</strong><span class="muted small">Oppi Points</span></div>
    </div>
    <div class="card">
      <p class="small"><strong>⭐ Tus Oppi Points</strong></p>
      <p class="small muted">Los ganás completando reservas y reportando no-shows. Pronto vas a poder canjearlos por descuentos.</p>
    </div>`
      : UI.empty('📊', 'Todavía no completaste reservas',
          'Cuando completes tu primera reserva, acá vas a ver tu resumen: cuántas llevás, cuánto gastaste y tus Oppi Points.',
          '<a class="btn btn-primary" href="#/buscar">Buscar profesionales</a>')}
    <a class="card" href="#/mi-cumplimiento" style="display:block">
      <div class="row between"><span><strong>✅ Mi cumplimiento</strong><div class="small muted">Comodines, no-shows y tu indicador</div></span><span class="menu-chev">›</span></div>
    </a>`);
  },

  /* --------------------------- MÉTODOS DE PAGO ------------------------- */
  async paymentMethods() {
    setView(`
    <a class="back-link" href="#/perfil">← Mi perfil</a>
    <h1 class="page-title">Métodos de pago 💳</h1>
    <div class="card">
      <strong>💳 Pago online en la app</strong>
      <p class="small muted">Pagás el 100% de la reserva al confirmar. Hoy es simulado: cuando se habilite la pasarela real vas a poder pagar con tarjeta.</p>
    </div>
    <div class="card">
      <strong>💵 Efectivo en el local</strong>
      <p class="small muted">Algunos profesionales también aceptan efectivo coordinando por chat.</p>
    </div>
    <div class="card">
      <strong>🏦 Transferencia bancaria</strong>
      <p class="small muted">Coordinás los datos por chat con el profesional.</p>
    </div>
    <p class="small muted center">El total a pagar siempre se muestra antes del botón de pagar.</p>`);
  },

  /* ---------------------------- MIS PAGOS ---------------------------- */
  /* GET /api/me/payments — lista con estados (Retenido/Cobrado/Reembolsado/
     Liberado/Crédito) y detalle por pago (comprobante: nro, fecha, concepto,
     monto, estado). */
  async payments() {
    const ps = await OppiAPI.getMyPayments();
    const label = {
      retenido: ['Retenido', 'retenido'], cobrado: ['Cobrado', 'cobrado'],
      reembolsado: ['Reembolsado', 'reembolsado'], liberado: ['Liberado', 'liberado'],
      credito: ['Crédito', 'credito'],
    };
    setView(`
    <a class="back-link" href="#/perfil">← Mi perfil</a>
    <h1 class="page-title">Mis pagos 🧾</h1>
    ${ps.length ? `<div class="stack">${ps.map(p => {
      const m = label[p.estado] || [p.estado, 'muted'];
      return `<button class="card pay-row" data-pay="${p.id}">
        <div class="row between"><strong>${UI.esc(p.concepto)}</strong><span class="badge badge-${m[1]}">${m[0]}</span></div>
        <div class="muted small">${UI.esc(prettyFecha(p.fecha))} · ${fmtGs(p.monto_gs)}</div>
      </button>`;
    }).join('')}</div>`
      : UI.empty('🧾', 'Sin movimientos todavía', 'Cuando pagues una reserva, uses crédito o te devuelvan plata, aparece acá con su comprobante.')}`);

    document.querySelectorAll('[data-pay]').forEach(btn => btn.addEventListener('click', () => {
      const p = ps.find(x => x.id === btn.dataset.pay);
      if (!p) return;
      const m = label[p.estado] || [p.estado, 'muted'];
      UI.modal(`
        <button class="modal-x" id="mX" aria-label="Cerrar">✕</button>
        <h3>Comprobante 🧾</h3>
        <div class="card muted-card">
          <div class="row between"><span class="muted small">Nro</span><strong>${UI.esc(p.id)}</strong></div>
          <hr class="sep">
          <div class="row between"><span class="muted small">Fecha</span><strong>${UI.esc(prettyFecha(p.fecha))}</strong></div>
          <hr class="sep">
          <div class="row between"><span class="muted small">Concepto</span><strong>${UI.esc(p.concepto)}</strong></div>
          <hr class="sep">
          <div class="row between"><span class="muted small">Monto</span><strong>${fmtGs(p.monto_gs)}</strong></div>
          <hr class="sep">
          <div class="row between"><span class="muted small">Estado</span><span class="badge badge-${m[1]}">${m[0]}</span></div>
        </div>
        <button class="btn btn-primary btn-block" id="mOk2">Cerrar</button>`);
      document.getElementById('mX').onclick = closeModal;
      document.getElementById('mOk2').onclick = closeModal;
    }));
  },

  /* ------------------------------- AYUDA ------------------------------ */
  /* #/ayuda: el chat de soporte a pantalla completa (misma UI del panel),
     con las preguntas frecuentes debajo. */
  async help() {
    setView(`
    <a class="back-link" href="#/perfil">← Mi perfil</a>
    <h1 class="page-title">Ayuda y soporte 💬</h1>
    <div class="card sup-page" id="supPage">${SupportChat.chatHtml(false)}</div>
    <h2 class="sec-title">Preguntas frecuentes</h2>
    <div class="stack">
      <div class="card"><strong>¿Cómo reservo?</strong><p class="small muted">Buscá un profesional, elegí el servicio, la fecha y la hora, y confirmá pagando el total.</p></div>
      <div class="card"><strong>¿Cómo pago?</strong><p class="small muted">Pagás el 100% al reservar, online y seguro. El total siempre lo ves antes de pagar.</p></div>
      <div class="card"><strong>¿Puedo cancelar?</strong><p class="small muted">Sí, gratis hasta 24 h antes y te devolvemos el 100%.</p></div>
      <div class="card"><strong>¿Qué es la lista de espera?</strong><p class="small muted">Si el día que querés está lleno, te anotás y te avisamos si se libera un turno.</p></div>
      <div class="card"><strong>¿Necesitás hablar con nosotros?</strong><p class="small muted">Escribinos a <strong>hola@oppi.com.py</strong> y te respondemos en el día 💜</p></div>
    </div>
    <div class="card">
      <h3>🔌 Conexión</h3>
      <p class="small muted">Modo: <strong>${OppiAPI.adapterMode() === 'http' ? 'Servidor Oppi' : 'Demo local'}</strong>${OppiAPI.adapterMode() === 'http' ? ' · ' + UI.esc(OppiAPI.apiUrl()) : ''}</p>
      <form class="row gap" id="srvForm">
        <input id="srvInput" class="grow" placeholder="https://tu-servidor.com" aria-label="URL del servidor" value="${OppiAPI.adapterMode() === 'http' ? UI.esc(OppiAPI.apiUrl()) : ''}">
        <button class="btn btn-ghost btn-sm" type="submit">Cambiar</button>
      </form>
      <p class="small muted">Pegá la URL del backend de producción para apuntar la app ahí (se recarga). <a class="link" href="?mock=1">Probar modo demo</a></p>
    </div>`);

    SupportChat.mountPage();

    document.getElementById('srvForm').addEventListener('submit', e => {
      e.preventDefault();
      const v = document.getElementById('srvInput').value.trim().replace(/\/+$/, '');
      if (!v) { UI.toast('Pegá la URL del servidor', 'error'); return; }
      try { localStorage.setItem('oppi_api_url', v); } catch (err) {}
      location.reload();
    });
  },

  /* --------------------------- NOTIFICACIONES -------------------------- */
  /* Actividad + preferencias (toggles que se guardan con
     PATCH /api/me/notification-prefs al instante, con toast). */
  async notifications() {
    const notifs = await OppiAPI.getNotifications();
    const prefs = await OppiAPI.getNotificationPrefs();
    const items = [
      ['reminders', '⏰', 'Recordatorios', 'Te avisamos antes de cada turno.'],
      ['offers', '🎟️', 'Ofertas', 'Promos y cupones de tus profesionales favoritos.'],
      ['messages', '💬', 'Mensajes', 'Cuando alguien te escribe en el chat.'],
      ['promos', '📣', 'Novedades de Oppi', 'Nuevas funciones y servicios cerca tuyo.'],
    ];
    setView(`
    <h1 class="page-title">Notificaciones 🔔</h1>
    <div class="card">
      <h3>Preferencias</h3>
      <p class="small muted">Elegí qué te avisamos. Se guarda al instante.</p>
      ${items.map(([k, ico, t, d]) => `
        <div class="row between pref-row">
          <div><strong>${ico} ${t}</strong><p class="small muted" style="margin:2px 0 0">${d}</p></div>
          <label class="switch"><input type="checkbox" data-pref="${k}" ${prefs[k] ? 'checked' : ''} aria-label="${t}"><span class="slider"></span></label>
        </div>`).join('')}
    </div>
    <h2 class="sec-title">Actividad</h2>
    ${notifs.length ? `<div class="stack">${notifs.map(n => `
      <a class="card notif ${n.read ? '' : 'unread'}" href="${n.link}">
        <div class="notif-ico">${n.icon}</div>
        <div><strong>${UI.esc(n.title)}</strong><p class="small muted">${UI.esc(n.text)}</p><span class="small muted">${UI.esc(n.time)}</span></div>
      </a>`).join('')}</div>`
      : UI.empty('🔔', 'Sin notificaciones', 'Acá te avisamos de tus turnos, ofertas y mensajes.')}`);
    await OppiAPI.markAllRead();
    await AppChrome.updateBell();

    document.querySelectorAll('[data-pref]').forEach(t => t.addEventListener('change', async () => {
      const key = t.dataset.pref;
      const r = await OppiAPI.updateNotificationPrefs({ [key]: t.checked });
      if (!r.ok) { UI.toast(r.error || 'No se pudo guardar', 'error'); t.checked = !t.checked; return; }
      UI.toast('Preferencia guardada ✅');
    }));
  },
};

/* Eliminar cuenta: doble confirmación (qué se borra) + contraseña.
   DELETE /api/me → logout → home. */
function openDeleteAccountFlow() {
  confirmModal({
    title: '¿Eliminar tu cuenta? 😟',
    text: 'Se borran tu nombre, email, teléfono y foto de perfil. Tus reservas pasadas quedan guardadas de forma anónima, sin tus datos. Esta acción no se puede deshacer.',
    okLabel: 'Entiendo, seguir',
    onOk: () => {
      UI.modal(`
        <button class="modal-x" id="mX" aria-label="Cerrar">✕</button>
        <h3>Confirmá con tu contraseña</h3>
        <p class="muted small">Por seguridad, escribí tu contraseña para eliminar tu cuenta para siempre.</p>
        <form id="delForm" class="stack">
          ${UI.field('Contraseña', '<input id="delPass" type="password" required autocomplete="current-password" placeholder="Tu contraseña">')}
          <p class="small error" id="delErr"></p>
          <button class="btn btn-danger btn-block" type="submit">Eliminar mi cuenta para siempre</button>
        </form>`);
      document.getElementById('mX').onclick = closeModal;
      document.getElementById('delForm').addEventListener('submit', async e => {
        e.preventDefault();
        const err = document.getElementById('delErr');
        err.textContent = '';
        const r = await OppiAPI.deleteMe({ password: document.getElementById('delPass').value });
        if (!r.ok) { err.textContent = r.error; return; }
        closeModal();
        OppiAPI.logout();
        Router.go('#/');
        UI.toast('Tu cuenta fue eliminada. Te vamos a extrañar 💜');
      });
    },
  });
}

/* Fecha corta para el historial de pagos (la API trae ISO). */
function prettyFecha(iso) {
  const d = new Date(String(iso || '').slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString('es-PY', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* Modal de reprogramación: reutiliza el selector de día/hora de la reserva
   (AvailabilityPicker). La confirmación muestra "Tu pago de Gs. X se
   mantiene intacto" ANTES de llamar a reschedule. */
async function openRescheduleModal(booking) {
  UI.modal(`
    <button class="modal-x" id="mX" aria-label="Cerrar">✕</button>
    <h3>Reprogramar turno</h3>
    <p class="muted small">${UI.esc(booking.serviceName)} con ${UI.esc(booking.proName)} · hoy: ${booking.date} ${booking.time}</p>
    ${AvailabilityPicker.html('rs')}
    <div id="rsConfirm" hidden>
      <hr class="sep">
      <p><strong>Nuevo turno:</strong> <span id="rsNewWhen"></span></p>
      <p class="small">✅ <strong>Tu pago de ${fmtGs(booking.paid)} se mantiene intacto</strong> — no pagás nada de más.</p>
      <button class="btn btn-primary btn-block" id="rsGo">Confirmar reprogramación</button>
    </div>`);
  document.getElementById('mX').onclick = closeModal;
  let sel = null;
  AvailabilityPicker.bind({
    prefix: 'rs',
    proId: booking.proId,
    getServiceId: () => booking.serviceId,
    onSlot: s => {
      sel = s;
      const box = document.getElementById('rsConfirm');
      box.hidden = !s;
      if (s) document.getElementById('rsNewWhen').textContent = `${s.date} · ${s.time}`;
    },
  });
  document.getElementById('rsGo').addEventListener('click', async () => {
    if (!sel || !sel.slotId) return;
    const btn = document.getElementById('rsGo');
    btn.disabled = true;
    const r = await OppiAPI.rescheduleBooking(booking.id, sel.slotId);
    btn.disabled = false;
    if (!r.ok) { UI.toast(r.error, 'error'); return; }
    closeModal();
    UI.toast(`Turno reprogramado ✅ Tu pago de ${fmtGs(booking.paid)} sigue intacto.`);
    ViewsClient.bookings();
  });
}
