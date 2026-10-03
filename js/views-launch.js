/* ============================================================================
 * Oppi — Lanzamiento: panel admin, Términos, Privacidad y landing pública.
 * ========================================================================== */
'use strict';

const ViewsLaunch = {
  /* ------------------------------ ADMIN -------------------------------- */
  async admin(params, query) {
    let isAdmin = false;
    try { isAdmin = await OppiAPI.isAdmin(); } catch (e) { isAdmin = false; }
    if (!isAdmin) {
      // 404 amable: no se revela que la sección existe.
      setView(UI.empty('😕', 'Página no encontrada', 'Esta dirección no existe.', '<a class="btn btn-primary" href="#/">Ir al inicio</a>'));
      return;
    }
    const tab = (query.tab || 'resumen');
    const tabs = [
      ['resumen', '📊 Resumen'],
      ['verificaciones', '✅ Verificaciones'],
      ['moderacion', '🛡️ Moderación'],
      ['usuarios', '👥 Usuarios'],
    ];
    setView(`
    <h1 class="page-title">Panel admin 🛡️</h1>
    <div class="pro-tabs" role="tablist">
      ${tabs.map(([id, label]) => `<button class="pro-tab ${tab === id ? 'active' : ''}" data-adm-tab="${id}" role="tab">${label}</button>`).join('')}
    </div>
    <div id="adminBody"><p class="muted">Cargando…</p></div>`);

    document.querySelectorAll('[data-adm-tab]').forEach(b => b.addEventListener('click', () => {
      Router.go('#/admin' + (b.dataset.admTab === 'resumen' ? '' : '?tab=' + b.dataset.admTab));
    }));

    const body = document.getElementById('adminBody');
    if (tab === 'verificaciones') await this._adminVerifications(body);
    else if (tab === 'moderacion') await this._adminModeration(body);
    else if (tab === 'usuarios') await this._adminUsers(body, query.q || '');
    else await this._adminOverview(body);
  },

  async _adminOverview(body) {
    const r = await OppiAPI.getAdminOverview();
    if (!r.ok) { body.innerHTML = UI.empty('⚠️', 'No se pudo cargar', UI.esc(r.error || 'Probá de nuevo.'), ''); return; }
    const o = r.overview;
    const cards = [
      ['👥', o.usuarios, 'Usuarios'],
      ['📅', o.reservas_hoy, 'Reservas hoy'],
      ['🗓️', o.reservas_semana, 'Reservas esta semana'],
      ['💰', fmtGs(o.ingresos_brutos_gs), 'Ingresos brutos'],
      ['🚫', o.no_shows, 'No-shows'],
      ['⏸️', o.suspendidas, 'Cuentas suspendidas'],
    ];
    body.innerHTML = `
    <div class="admin-grid">
      ${cards.map(([icon, num, label]) => `
        <div class="card admin-stat"><span class="admin-ico">${icon}</span>
          <span class="admin-num">${UI.esc(String(num))}</span>
          <span class="muted small">${label}</span></div>`).join('')}
    </div>
    <p class="small muted center">Los ingresos brutos incluyen la comisión de Oppi (15%).</p>`;
  },

  async _adminVerifications(body) {
    const r = await OppiAPI.getAdminVerifications();
    if (!r.ok) { body.innerHTML = UI.empty('⚠️', 'No se pudo cargar', UI.esc(r.error || 'Probá de nuevo.'), ''); return; }
    const list = (r.verifications || []).slice().sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));
    if (!list.length) { body.innerHTML = UI.empty('🎉', 'Sin verificaciones', 'No hay solicitudes pendientes de revisión.'); return; }
    const badge = s => s === 'pending' ? '<span class="badge badge-warn">Pendiente</span>'
      : s === 'approved' ? '<span class="badge badge-ok">Aprobada</span>'
      : '<span class="badge badge-muted">Rechazada</span>';
    body.innerHTML = `<div class="stack">${list.map(v => `
      <div class="card">
        <div class="row between"><strong>${UI.esc(v.business_name)}</strong>${badge(v.status)}</div>
        <div class="muted small">${UI.esc(v.owner_name)}${v.owner_email ? ' · ' + UI.esc(v.owner_email) : ''}</div>
        <div class="muted small">${UI.esc(v.rubro)}${v.barrio ? ' · 📍 ' + UI.esc(v.barrio) : ''} · enviada ${UI.esc(v.submitted_at)}</div>
        ${v.status === 'rejected' && v.reason ? `<p class="small"><strong>Motivo:</strong> ${UI.esc(v.reason)}</p>` : ''}
        ${v.documents && v.documents.length ? `
          <p class="small" style="margin:8px 0 4px"><strong>Documentos</strong> <span class="muted">(tocá para ampliar)</span></p>
          <div class="doc-photos">
            ${v.documents.map(d => d.photo_url ? `
              <a class="doc-photo" href="${UI.esc(d.photo_url)}" target="_blank" rel="noopener">
                <img src="${UI.esc(d.photo_url)}" alt="${UI.esc(d.name)}" loading="lazy">
                <span>${UI.esc(d.name)}</span>
              </a>` : '').join('')}
          </div>` : '<p class="small muted">Sin documentos adjuntos.</p>'}
        ${ViewsLaunch._precheckHtml(v.precheck)}
        ${v.status === 'pending' ? `
          <div class="row gap" style="margin-top:8px">
            <button class="btn btn-primary btn-sm" data-adm-ok="${UI.esc(v.id)}">Aprobar</button>
            <button class="btn btn-danger-soft btn-sm" data-adm-no="${UI.esc(v.id)}">Rechazar</button>
          </div>` : ''}
      </div>`).join('')}</div>`;

    body.querySelectorAll('[data-adm-ok]').forEach(b => b.addEventListener('click', () => {
      confirmModal({
        title: '¿Aprobar verificación?',
        text: 'El negocio queda verificado y recibe el badge ✓ en su perfil público.',
        okLabel: 'Aprobar',
        onOk: async () => {
          const rr = await OppiAPI.decideVerification(b.dataset.admOk, 'approved');
          if (!rr.ok) { UI.toast(rr.error, 'error'); return; }
          UI.toast('Verificación aprobada ✅');
          ViewsLaunch.admin({}, { tab: 'verificaciones' });
        },
      });
    }));
    body.querySelectorAll('[data-adm-no]').forEach(b => b.addEventListener('click', () => {
      UI.modal(`
        <button class="modal-x" id="mX" aria-label="Cerrar">✕</button>
        <h3>Rechazar verificación</h3>
        <p class="muted small">El negocio va a ver este motivo. Sé claro y amable.</p>
        ${UI.field('Motivo del rechazo *', '<textarea id="rejReason" rows="3" placeholder="Ej: la foto del RUC está borrosa, subila de nuevo"></textarea>')}
        <p class="small error" id="rejErr"></p>
        <div class="row gap">
          <button class="btn btn-ghost" id="rejCancel">Cancelar</button>
          <button class="btn btn-danger" id="rejGo">Rechazar</button>
        </div>`);
      document.getElementById('mX').onclick = closeModal;
      document.getElementById('rejCancel').onclick = closeModal;
      document.getElementById('rejGo').addEventListener('click', async () => {
        const reason = document.getElementById('rejReason').value.trim();
        if (!reason) { document.getElementById('rejErr').textContent = 'Escribí el motivo del rechazo.'; return; }
        const rr = await OppiAPI.decideVerification(b.dataset.admNo, 'rejected', reason);
        if (!rr.ok) { document.getElementById('rejErr').textContent = rr.error; return; }
        closeModal();
        UI.toast('Verificación rechazada');
        ViewsLaunch.admin({}, { tab: 'verificaciones' });
      });
    }));
  },

  /* Pre-chequeo del Verificador (equipo IA): score + flags en la tarjeta. */
  _precheckHtml(pre) {
    if (!pre || typeof pre.score !== 'number') return '';
    const cls = pre.score >= 80 ? 'badge-ok' : pre.score >= 50 ? 'badge-warn' : 'badge-danger';
    const sevIcon = s => s === 'alta' ? '🔴' : s === 'media' ? '🟡' : '🔵';
    return `
      <div class="precheck" style="margin-top:8px;padding:10px;border-radius:12px;background:#F4F3FD">
        <div class="row between">
          <strong class="small">🤖 Pre-chequeo automático</strong>
          <span class="badge ${cls}">${pre.score}/100</span>
        </div>
        ${(pre.flags || []).length
          ? `<ul class="small" style="margin:6px 0 0;padding-left:18px">
              ${pre.flags.map(f => `<li>${sevIcon(f.severity)} ${UI.esc(f.message || f.code || '')}</li>`).join('')}
            </ul>`
          : '<p class="small muted" style="margin:6px 0 0">Sin observaciones. Nada se aprueba solo: la decisión es tuya.</p>'}
      </div>`;
  },

  /* Cola de moderación de reseñas (equipo IA: Moderador). */
  async _adminModeration(body) {
    const r = await OppiAPI.getAdminModeration();
    if (!r.ok) { body.innerHTML = UI.empty('⚠️', 'No se pudo cargar', UI.esc(r.error || 'Probá de nuevo.'), ''); return; }
    const q = r.queue || [];
    if (!q.length) { body.innerHTML = UI.empty('🎉', 'Nada retenido', 'El moderador no retuvo ninguna reseña.'); return; }
    const stars = n => '⭐'.repeat(n) + '☆'.repeat(5 - n);
    body.innerHTML = `<div class="stack">${q.map(m => `
      <div class="card">
        <div class="row between"><strong>${stars(m.rating || 0)}</strong>
          <span class="muted small">${UI.esc(m.created_at || '')}</span></div>
        <p style="margin:6px 0">${UI.esc(m.text || '(sin texto)')}</p>
        <div class="muted small">De: ${UI.esc(m.from_name || '—')}${m.from_email ? ' · ' + UI.esc(m.from_email) : ''}</div>
        <div class="muted small">Para: ${UI.esc(m.to_name || '—')}</div>
        ${m.moderation_reason ? `<p class="small" style="margin-top:6px"><strong>🤖 Motivo de retención:</strong> ${UI.esc(m.moderation_reason)}</p>` : ''}
        <div class="row gap" style="margin-top:8px">
          <button class="btn btn-primary btn-sm" data-mod-ok="${m.id}">Publicar</button>
          <button class="btn btn-danger-soft btn-sm" data-mod-no="${m.id}">Rechazar</button>
        </div>
      </div>`).join('')}</div>`;
    body.querySelectorAll('[data-mod-ok]').forEach(b => b.addEventListener('click', async () => {
      const rr = await OppiAPI.decideModeration(b.dataset.modOk, 'approve');
      if (!rr.ok) { UI.toast(rr.error, 'error'); return; }
      UI.toast('Reseña publicada ✅');
      ViewsLaunch.admin({}, { tab: 'moderacion' });
    }));
    body.querySelectorAll('[data-mod-no]').forEach(b => b.addEventListener('click', async () => {
      const rr = await OppiAPI.decideModeration(b.dataset.modNo, 'reject');
      if (!rr.ok) { UI.toast(rr.error, 'error'); return; }
      UI.toast('Reseña rechazada');
      ViewsLaunch.admin({}, { tab: 'moderacion' });
    }));
  },

  async _adminUsers(body, q) {
    const r = await OppiAPI.getAdminUsers({ q });
    if (!r.ok) { body.innerHTML = UI.empty('⚠️', 'No se pudo cargar', UI.esc(r.error || 'Probá de nuevo.'), ''); return; }
    const users = r.users || [];
    const roleLabel = x => x === 'admin' ? 'Admin' : x === 'business' ? 'Negocio' : x === 'pro' ? 'Profesional' : 'Cliente';
    body.innerHTML = `
    <form class="searchbar" id="adminSearch" style="margin-bottom:12px">
      <span>🔍</span>
      <input id="adminQ" type="search" placeholder="Buscar por nombre o email…" value="${UI.esc(q)}" aria-label="Buscar usuario">
    </form>
    ${users.length ? `<div class="stack">${users.map(u => `
      <div class="card">
        <div class="row between">
          <div><strong>${UI.esc(u.name)}</strong>
            <div class="muted small">${UI.esc(u.email)} · ${roleLabel(u.role)}${u.reservas ? ' · ' + u.reservas + ' reservas' : ''}</div>
          </div>
          ${u.suspended ? '<span class="badge badge-muted">Suspendido</span>' : ''}
        </div>
        <div class="row gap" style="margin-top:8px">
          ${u.suspended
            ? `<button class="btn btn-primary btn-sm" data-adm-unsusp="${UI.esc(u.id)}">Reactivar</button>`
            : `<button class="btn btn-danger-soft btn-sm" data-adm-susp="${UI.esc(u.id)}">Suspender</button>`}
        </div>
      </div>`).join('')}</div>`
      : UI.empty('👥', 'Sin resultados', q ? 'Ningún usuario coincide con esa búsqueda.' : 'Todavía no hay usuarios registrados.')}`;

    document.getElementById('adminSearch').addEventListener('submit', e => {
      e.preventDefault();
      const v = document.getElementById('adminQ').value.trim();
      Router.go('#/admin?tab=usuarios' + (v ? '&q=' + encodeURIComponent(v) : ''));
    });
    body.querySelectorAll('[data-adm-susp]').forEach(b => b.addEventListener('click', () => {
      confirmModal({
        title: '¿Suspender esta cuenta?',
        text: 'El usuario no va a poder entrar ni reservar hasta que lo reactives.',
        okLabel: 'Suspender',
        onOk: async () => {
          const rr = await OppiAPI.suspendUser(b.dataset.admSusp);
          if (!rr.ok) { UI.toast(rr.error, 'error'); return; }
          UI.toast('Cuenta suspendida');
          ViewsLaunch.admin({}, { tab: 'usuarios', q });
        },
      });
    }));
    body.querySelectorAll('[data-adm-unsusp]').forEach(b => b.addEventListener('click', () => {
      confirmModal({
        title: '¿Reactivar esta cuenta?',
        text: 'El usuario vuelve a poder entrar y reservar.',
        okLabel: 'Reactivar',
        onOk: async () => {
          const rr = await OppiAPI.unsuspendUser(b.dataset.admUnsusp);
          if (!rr.ok) { UI.toast(rr.error, 'error'); return; }
          UI.toast('Cuenta reactivada ✅');
          ViewsLaunch.admin({}, { tab: 'usuarios', q });
        },
      });
    }));
  },

  /* ----------------------------- TÉRMINOS ------------------------------ */
  async terms() {
    setView(`
    <a class="back-link" href="#/">← Inicio</a>
    <h1 class="page-title">Términos de servicio 📜</h1>
    <div class="card legal">
      <p class="muted small">Última actualización: octubre de 2026 · Oppi, Asunción, Paraguay</p>
      <p>Bienvenido/a a <strong>Oppi</strong>. Estos Términos regulan tu uso de la plataforma. Al crear una cuenta, aceptás estos Términos y nuestra <a class="link" href="#/privacidad">Política de privacidad</a>.</p>

      <h2>1. Qué es Oppi</h2>
      <p>Oppi es una plataforma que conecta clientes con profesionales y negocios de servicios en Paraguay. Oppi tiene tres pilares: <strong>Profesionales</strong> (peluquería, belleza, bienestar y más), <strong>Chamba</strong> (tareas y trabajos de handymans: plomería, electricidad, pintura, limpieza, mudanzas) y <strong>Oppi Empresas</strong> (negocios que gestionan su agenda, reservas y equipo).</p>

      <h2>2. Intermediación</h2>
      <p>Oppi actúa como <strong>intermediaria tecnológica</strong>: facilita el encuentro, la reserva y la comunicación entre clientes y prestadores. El servicio en sí (el corte, la reparación, la tarea) lo presta el profesional o el negocio, que es responsable de su calidad, puntualidad y cumplimiento. Oppi no es empleadora de los profesionales ni de los handymans: cada uno trabaja por cuenta propia.</p>

      <h2>3. Registro y cuenta</h2>
      <p>Para reservar necesitás una cuenta con tus datos reales. Sos responsable de mantener tu contraseña en secreto. No podés crear cuentas falsas, suplantar a otra persona ni usar la plataforma para fines ilícitos. Oppi puede suspender cuentas que violen estos Términos.</p>

      <h2>4. Reservas y pago</h2>
      <p>Al reservar, pagás el <strong>100% del servicio</strong> por adelantado para asegurar tu turno. El total a pagar siempre se muestra <strong>antes</strong> del botón de pagar. Durante el <strong>piloto</strong>, los pagos dentro de la app son simulados: ninguna plata real se mueve hasta que se habilite la pasarela.</p>

      <h2>5. Comisiones</h2>
      <p>Oppi cobra a los prestadores una <strong>comisión del 15%</strong> sobre cada reserva concretada. No hay costos fijos, suscripciones ni cargos por publicar servicios. La comisión se calcula de forma transparente y se muestra en cada reserva.</p>

      <h2>6. Cancelaciones y comodines</h2>
      <p>Podés <strong>cancelar gratis</strong> hasta el plazo que cada negocio define (por defecto, 24 horas antes del turno): se te devuelve el 100% de lo pagado. Si cancelás después, el monto queda para el prestador, salvo que uses uno de tus <strong>comodines</strong> trimestrales, que te cubren la cancelación tardía sin costo. Los comodines no son acumulables más allá del trimestre.</p>

      <h2>7. No-shows</h2>
      <p>Si el cliente no se presenta sin avisar, lo pagado queda para el prestador. Si el prestador no se presenta, el cliente recibe el <strong>reembolso total</strong> de lo pagado. Los no-shows reiterados pueden llevar a la suspensión de la cuenta.</p>

      <h2>8. Reseñas y contenido</h2>
      <p>Las reseñas tienen que ser veraces y referirse a servicios reales. Está prohibido publicar contenido ofensivo, discriminatorio, falso o con datos personales de terceros. Oppi puede moderar o eliminar contenido que viole estas reglas.</p>

      <h2>9. Responsabilidad</h2>
      <p>Oppi hace su mejor esfuerzo para que la plataforma funcione bien, pero no garantiza disponibilidad ininterrumpida. En ningún caso Oppi responde por daños derivados del servicio prestado por terceros (profesionales, handymans o negocios). Los reclamos sobre el servicio se gestionan primero con el prestador; nuestro equipo de soporte te ayuda a mediar: escribinos a <strong>hola@oppi.com.py</strong>.</p>

      <h2>10. Modificaciones</h2>
      <p>Podemos actualizar estos Términos para mejorar el servicio o adaptarnos a la ley. Los cambios importantes se avisan en la app antes de que entren en vigencia. Si seguís usando Oppi después del aviso, aceptás los nuevos Términos.</p>

      <h2>11. Contacto</h2>
      <p>Para cualquier duda sobre estos Términos: <strong>hola@oppi.com.py</strong>.</p>
    </div>`);
  },

  /* ---------------------------- PRIVACIDAD ----------------------------- */
  async privacy() {
    setView(`
    <a class="back-link" href="#/">← Inicio</a>
    <h1 class="page-title">Política de privacidad 🔒</h1>
    <div class="card legal">
      <p class="muted small">Última actualización: octubre de 2026 · Oppi, Asunción, Paraguay</p>
      <p>En Oppi cuidamos tus datos como cuidamos tu turno: con seriedad. Esta política explica qué datos juntamos, para qué los usamos y qué derechos tenés. Al usar Oppi aceptás esta política junto con los <a class="link" href="#/terminos">Términos de servicio</a>.</p>

      <h2>1. Datos que recolectamos</h2>
      <ul>
        <li><strong>Datos de cuenta:</strong> nombre, email, teléfono, barrio y foto de perfil.</li>
        <li><strong>Datos de uso:</strong> reservas, búsquedas, favoritos, mensajes del chat y reseñas.</li>
        <li><strong>Datos de verificación (prestadores):</strong> documentos como RUC, cédula y habilitación municipal, que revisa nuestro equipo.</li>
        <li><strong>Datos técnicos:</strong> tipo de dispositivo y registros básicos de funcionamiento para mantener la app estable.</li>
      </ul>

      <h2>2. Para qué los usamos</h2>
      <ul>
        <li>Crear y mantener tu cuenta, y mostrarte tu historial.</li>
        <li>Procesar reservas, pagos, cancelaciones y reembolsos.</li>
        <li>Enviarte <strong>recordatorios de turnos</strong>, avisos de mensajes y —solo si los activás— ofertas y novedades.</li>
        <li>Verificar la identidad de profesionales y negocios para tu seguridad.</li>
        <li>Prevenir fraudes y mejorar la plataforma.</li>
      </ul>
      <p>No vendemos tus datos personales. Nunca.</p>

      <h2>3. Con quién los compartimos</h2>
      <p>Solo con quienes necesitan recibirlos para que el servicio funcione: el profesional o negocio con el que reservás (tu nombre y los datos necesarios para el turno), y proveedores técnicos (alojamiento, envío de emails). Todos están obligados a protegerlos.</p>

      <h2>4. Tus notificaciones, tus reglas</h2>
      <p>Desde <strong>Mi perfil → Notificaciones</strong> podés prender o apagar por separado los recordatorios, las ofertas, los avisos de mensajes y las novedades de Oppi. Los cambios se guardan al instante.</p>

      <h2>5. Seguridad y retención</h2>
      <p>Guardamos tus datos con medidas de seguridad razonables y solo el tiempo necesario: mientras tu cuenta esté activa y el período que exija la ley para comprobantes y registros.</p>

      <h2>6. Tus derechos</h2>
      <p>Podés pedirnos en cualquier momento acceder a tus datos, corregirlos o eliminar tu cuenta. Desde la app: <strong>Mi perfil → Zona de peligro → Eliminar mi cuenta</strong>. Al eliminarla, borramos tu nombre y tus datos personales; tus reservas pasadas quedan guardadas de forma <strong>anónima</strong> (sin vincularse a vos), solo con fines estadísticos y legales.</p>

      <h2>7. Contacto</h2>
      <p>Para ejercer tus derechos o cualquier consulta de privacidad: <strong>hola@oppi.com.py</strong>. Respondemos en el día.</p>
    </div>`);
  },

  /* ----------------------------- LANDING ------------------------------- */
  async launch() {
    setView(`
    <section class="launch-hero">
      <span class="launch-badge">🇵🇾 Piloto en Paraguay · Sin cargos</span>
      <h1>Oppi</h1>
      <p class="launch-sub">Todos los servicios que necesitás, en un solo lugar.</p>
      <p class="muted">Reservá peluquería, handymans y negocios cerca tuyo en 3 pasos. Pagás el 100% por adelantado: sin sorpresas.</p>
      <div class="row gap center" style="justify-content:center;flex-wrap:wrap">
        <a class="btn btn-primary btn-cta" href="#/registro">Crear cuenta</a>
        <a class="btn btn-ghost" href="#/handyman">Soy profesional 🔨</a>
        <a class="btn btn-ghost" href="#/empresas">Soy empresa 🏪</a>
      </div>
    </section>

    <h2 class="sec-title center">Los 3 pilares de Oppi</h2>
    <div class="stack">
      <div class="card launch-pilar">
        <div class="launch-pilar-ico">💇</div>
        <div><strong>Profesionales</strong>
        <p class="small muted">Peluquería, belleza, bienestar y más. Perfiles verificados, reseñas reales y turnos en tiempo real.</p></div>
      </div>
      <div class="card launch-pilar">
        <div class="launch-pilar-ico">🔨</div>
        <div><strong>Chamba</strong>
        <p class="small muted">Handymans para lo que tu casa necesita: plomería, electricidad, pintura, limpieza y mudanzas. Publicás la tarea y recibís ofertas.</p></div>
      </div>
      <div class="card launch-pilar">
        <div class="launch-pilar-ico">🏪</div>
        <div><strong>Oppi Empresas</strong>
        <p class="small muted">Tu negocio con agenda online, reservas, equipo, cupones y reportes. Comisión solo si concretás.</p></div>
      </div>
    </div>

    <h2 class="sec-title center">¿Cómo funciona?</h2>
    <div class="stack">
      <div class="card"><strong>1️⃣ Buscá</strong><p class="small muted">Encontrá el servicio que necesitás por rubro, barrio o en el mapa.</p></div>
      <div class="card"><strong>2️⃣ Reservá en un toque</strong><p class="small muted">Elegí día y hora, y asegurá tu turno pagando el total en la app.</p></div>
      <div class="card"><strong>3️⃣ Disfrutá</strong><p class="small muted">Te avisamos antes del turno. Pagás el resto directo al prestador.</p></div>
    </div>

    <div class="card highlight-card">
      <h2>Comisión 15% transparente, sin costos fijos</h2>
      <p>Para profesionales y negocios: Oppi cobra solo cuando la reserva se concreta. Sin suscripción, sin cargos por publicar, sin letra chica.</p>
      <hr class="sep">
      <p><strong>🚀 Piloto sin cargos:</strong> durante el piloto, reservar y publicar es gratis para todos. Probalo, usalo, contanos qué mejorar.</p>
    </div>

    <h2 class="sec-title center">Preguntas frecuentes</h2>
    <div class="stack launch-faq">
      <details class="card"><summary><strong>¿Cuánto cuesta usar Oppi?</strong></summary><p class="small muted">Para clientes es gratis. Los profesionales y negocios pagan 15% de comisión solo sobre reservas concretadas, sin costos fijos. Durante el piloto no hay cargos.</p></details>
      <details class="card"><summary><strong>¿Cómo pago?</strong></summary><p class="small muted">Pagás el 100% del servicio al reservar, en la app. El total siempre lo ves antes de pagar.</p></details>
      <details class="card"><summary><strong>¿Puedo cancelar mi reserva?</strong></summary><p class="small muted">Sí: gratis hasta 24 horas antes (o el plazo que defina el negocio), con devolución del 100%. Después, el monto queda para el prestador, salvo que uses un comodín.</p></details>
      <details class="card"><summary><strong>¿Cómo me entero de mis turnos?</strong></summary><p class="small muted">Te avisamos antes de cada turno y cuando te escriben por chat. Podés configurar cada tipo de aviso desde tu perfil.</p></details>
      <details class="card"><summary><strong>¿Cómo publico mi negocio o mis servicios?</strong></summary><p class="small muted">Tocá "Soy empresa" o "Soy profesional", completá tus datos y empezá a recibir reservas. Sin costos fijos.</p></details>
    </div>

    <div class="center" style="margin:24px 0">
      <a class="btn btn-primary btn-cta" href="#/registro">Crear mi cuenta gratis</a>
      <p class="small muted" style="margin-top:8px">Te toma menos de un minuto.</p>
    </div>

    <footer class="launch-footer">
      <div class="row gap center" style="justify-content:center;flex-wrap:wrap">
        <a class="link" href="#/terminos">Términos de servicio</a>
        <span class="muted">·</span>
        <a class="link" href="#/privacidad">Política de privacidad</a>
        <span class="muted">·</span>
        <a class="link" href="#/ayuda">Ayuda</a>
      </div>
      <p class="small muted center">Oppi · Asunción, Paraguay · hola@oppi.com.py</p>
    </footer>`);
  },
};
