/* ============================================================================
 * Oppi — Política de cancelación (js/views-cancel.js)
 * Banner violeta, vista de política, cancelar reserva (con comodines),
 * Mi cumplimiento, reportar no-show e historial de cancelaciones (Empresas).
 * Si el backend aún no expone un endpoint, la vista lo maneja con gracia
 * (OppiAPI devuelve { ok: false } y se muestra un estado amable, nunca un
 * botón muerto).
 * ========================================================================== */
'use strict';

const REASONS = {
  cliente: ['Se me presentó un imprevisto', 'Problemas de salud', 'Cambio de planes', 'Problemas de transporte', 'Otro'],
  pro: ['Imprevisto personal', 'Problemas de salud', 'Inconveniente logístico', 'Sobrecarga de agenda', 'Otro'],
  empresa: ['Problema con el equipo o profesional', 'Cierre o imprevisto en la sucursal', 'Reprogramación interna', 'Otro'],
};

const ViewsCancel = {
  /* ------------------------- helpers de render ------------------------ */
  /* "jue 2 oct · 14:30" para el free_until que trae el backend. */
  fmtFreeUntil(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    const f = d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' });
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${f} · ${hh}:${mm}`;
  },

  /* 3 puntitos de comodines. */
  wildDots(balance) {
    const n = Math.max(0, Math.min(3, Number(balance) || 0));
    let s = `<span class="wc-dots" role="img" aria-label="${n} de 3 comodines">`;
    for (let i = 0; i < 3; i++) s += `<span class="wc-dot ${i < n ? 'on' : ''}"></span>`;
    return s + '</span>';
  },

  /* Banner violeta para reservas confirmadas. Si el preview falla (el
     endpoint aún no existe), muestra la versión genérica sin prometer
     datos que no tenemos. */
  bannerHtml(pv) {
    if (pv && pv.ok) {
      const n = pv.comodines ? pv.comodines.balance : 3;
      return `<div class="card highlight-card cancel-banner">
        <strong>Cancelación gratis hasta ${UI.esc(this.fmtFreeUntil(pv.free_until))}.</strong><br>
        <span>Comodines disponibles: ${n} de 3.</span>
        <div style="margin-top:8px"><a href="#/politica-cancelacion">Ver política completa →</a></div>
      </div>`;
    }
    return `<div class="card highlight-card cancel-banner">
      <strong>Cancelación gratis con anticipación.</strong><br>
      <div style="margin-top:8px"><a href="#/politica-cancelacion">Ver política completa →</a></div>
    </div>`;
  },

  /* Banner listo para incrustar: trae el preview y devuelve el HTML. */
  async bannerFor(bookingId) {
    let pv = null;
    try { const r = await OppiAPI.cancelPolicyPreview(bookingId); if (r && r.ok) pv = r; } catch (e) {}
    return this.bannerHtml(pv);
  },

  /* ---------------------- POLÍTICA DE CANCELACIÓN --------------------- */
  /* Ruta #/politica-cancelacion — los 3 niveles, comodines, no-shows y el
     badge de piloto. Texto del dueño, fuente de verdad. */
  async policy() {
    setView(`
    <a class="back-link" href="javascript:history.back()">← Volver</a>
    <h1 class="page-title">Política de cancelación ❌</h1>
    <p><span class="badge badge-ok">Piloto · Sin cargos económicos</span></p>

    <div class="card">
      <h3>¿Hasta cuándo podés cancelar gratis?</h3>
      <div>
        <div class="policy-tier">
          <div><strong>⏱️ Reservás con menos de 3 h</strong><br><span class="muted small">de anticipación</span></div>
          <div class="policy-tier-when">15 min<br>tras confirmar</div>
        </div>
        <div class="policy-tier">
          <div><strong>🕐 Entre 3 y 24 h antes</strong><br><span class="muted small">del turno</span></div>
          <div class="policy-tier-when">Hasta 3 h<br>antes</div>
        </div>
        <div class="policy-tier">
          <div><strong>📅 24 h o más antes</strong><br><span class="muted small">del turno</span></div>
          <div class="policy-tier-when">Hasta 24 h<br>antes</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>🎫 Comodines</h3>
      <p><strong>3 por trimestre.</strong> Si cancelás tarde, se usa 1 comodín en vez de que baje tu cumplimiento.</p>
      <p class="small">Recuperás 1 cada 10 reservas completadas, sin pasar de 3.</p>
      <p class="small"><strong>Sin comodines: baja tu indicador de cumplimiento.</strong></p>
    </div>

    <div class="card warn-card">
      <h3>🛵 Profesional en camino</h3>
      <p class="small"><strong>Profesional en camino:</strong> cancelar cuando ya salió cuenta como no-show.</p>
    </div>

    <div class="card">
      <h3>👻 No-shows</h3>
      <p class="small">Te contactamos desde el primero. Con 3 confirmados, la cuenta se suspende.</p>
    </div>

    <div class="card">
      <h3>⭐ Estrellas ≠ cumplimiento</h3>
      <p class="small muted">Tus estrellas miden la calidad de tu trabajo. Tu cumplimiento mide si llegás a tus turnos. Se calculan por separado: cancelar no te baja las estrellas.</p>
    </div>

    <div class="card ok-card">
      <p><strong>✓ Sin cargos durante el piloto.</strong><br><span class="small">Ninguna cancelación te cobra plata hoy.</span></p>
    </div>`);
  },

  /* -------------------------- CANCELAR RESERVA ------------------------ */
  /* Ruta #/reservas/:id/cancelar — muestra la reserva, el preview de la
     política (plazo gratis / comodín / sin comodín) y el motivo.
     ?rol=empresa|pro fuerza el rol cuando la reserva es del negocio. */
  async cancel(params, query) {
    const q = query || {};
    const id = params.id;
    const bookings = await OppiAPI.getBookings();
    let b = bookings.find(x => String(x.id) === String(id));
    let rol = 'cliente';
    if (!b) {
      let bizBookings = [];
      try { bizBookings = await OppiAPI.getBizBookings(); } catch (e) {}
      b = (bizBookings || []).find(x => String(x.id) === String(id));
      if (b) rol = 'empresa';
    }
    if (!b) {
      let biz = null;
      try { biz = await OppiAPI.getBusiness(); } catch (e) {}
      const mine = (biz && biz.bizBookings) || [];
      b = mine.find(x => String(x.id) === String(id));
      if (b) rol = 'empresa';
    }
    if (q.rol === 'empresa' || q.rol === 'pro' || q.rol === 'cliente') rol = q.rol;

    const backHref = rol === 'empresa' ? '#/empresas/reservas' : '#/reservas';
    if (!b) {
      setView(`
      <a class="back-link" href="${backHref}">← Volver</a>
      <h1 class="page-title">Cancelar reserva</h1>
      ${UI.empty('🔍', 'No encontramos esa reserva', 'Puede que ya se haya cancelado o el link esté desactualizado.', `<a class="btn btn-primary" href="${backHref}">Ver mis reservas</a>`)}
      `);
      return;
    }

    const pv = await OppiAPI.cancelPolicyPreview(b.id);
    if (!pv || !pv.ok) {
      setView(`
      <a class="back-link" href="${backHref}">← Volver</a>
      <h1 class="page-title">Cancelar reserva</h1>
      <div class="card">
        <p><strong>😕 No pudimos cargar tu política de cancelación.</strong></p>
        <p class="small muted">${UI.esc((pv && pv.error) || 'Revisá tu conexión e intentá de nuevo.')}</p>
        <div class="row gap">
          <a class="btn btn-ghost grow" href="${backHref}">Volver</a>
          <button class="btn btn-primary grow" id="pvRetry">Reintentar</button>
        </div>
      </div>`);
      document.getElementById('pvRetry').addEventListener('click', () => ViewsCancel.cancel(params, query));
      return;
    }

    const wc = pv.comodines || { balance: 3, proximo_en: 0, reset_fecha: '' };
    const balance = Number(wc.balance) || 0;
    const gratis = pv.resolucion === 'gratis';
    const sinComodin = pv.resolucion === 'sin_comodin';
    const fechaLimite = this.fmtFreeUntil(pv.free_until);
    const reasons = REASONS[rol] || REASONS.cliente;
    const motivoObligatorio = rol !== 'cliente';
    const who = rol === 'empresa' ? UI.esc(b.clientName || 'la clienta') : UI.esc(b.proName || '');

    const estadoCard = gratis ? `
      <div class="card ok-card"><p><strong>✅ Estás dentro del plazo gratis (hasta ${UI.esc(fechaLimite)}). No usa comodines.</strong></p>
      ${pv.paid_gs ? `<p class="small">Se te devuelve ${fmtGs(pv.paid_gs)} (el 100% de lo que pagaste).</p>` : ''}</div>`
      : sinComodin ? `
      <div class="card warn-card">
        <p><strong>⚠ Ya pasó tu límite gratis (hasta ${UI.esc(fechaLimite)}) y no te quedan comodines.</strong></p>
        <p class="small"><strong>Sin comodines, baja tu indicador de cumplimiento.</strong></p>
        <p class="small">✓ Sin cargos durante el piloto</p>
        ${pv.paid_gs ? `<p class="small">Los ${fmtGs(pv.paid_gs)} que pagaste quedan para el profesional.</p>` : ''}
      </div>` : `
      <div class="card warn-card">
        <p><strong>⚠ Esta cancelación usa 1 comodín.</strong></p>
        <p class="small">Ya pasó tu límite gratis (hasta ${UI.esc(fechaLimite)}).</p>
      </div>
      <div class="card">
        <p><strong>Tus comodines este trimestre</strong></p>
        ${this.wildDots(balance)}
        <p class="small">Te quedarían ${Math.max(0, balance - 1)} de 3</p>
        <p class="small"><strong>Próximo comodín:</strong> ${wc.proximo_en} de 10</p>
        <div class="earn-bar-track"><div class="earn-bar-fill" style="width:${Math.min(100, (Number(wc.proximo_en) || 0) * 10)}%"></div></div>
        <p class="small">✓ Sin cargos durante el piloto</p>
        <p class="small">Tus estrellas no cambian</p>
      </div>`;

    setView(`
    <a class="back-link" href="${backHref}">← Volver</a>
    <h1 class="page-title">Cancelar reserva</h1>
    <div class="card">
      <div class="row between"><strong>${UI.esc(b.serviceName)}</strong>${UI.statusBadge(b.status)}</div>
      <div class="muted small">${rol === 'empresa' ? 'Clienta: ' + who : who} · 📅 ${UI.esc(b.date)} · 🕐 ${UI.esc(b.time)}</div>
      ${b.paid ? `<div class="small muted">Pagado: ${fmtGs(b.paid)}</div>` : ''}
    </div>
    ${pv.en_camino ? `<div class="card warn-card"><p class="small"><strong>🛵 Profesional en camino:</strong> si cancelás cuando ya salió, cuenta como no-show.</p></div>` : ''}
    ${estadoCard}
    <div class="card">
      <h3>Motivo de cancelación ${motivoObligatorio ? '<span class="req">*</span>' : '<span class="muted small">(opcional)</span>'}</h3>
      <div class="stack radio-stack" role="radiogroup" aria-label="Motivo de cancelación">
        ${reasons.map(r => `<label class="radio-card"><input type="radio" name="cr" value="${UI.esc(r)}"><span>${UI.esc(r)}</span></label>`).join('')}
      </div>
      ${rol === 'empresa' ? UI.field('Sucursal o colaborador (opcional)', `<input id="cExtra" placeholder="Ej: Sucursal Villa Morra · Dahiana">`) : ''}
      ${UI.field('Contanos un poco más (opcional)', `<textarea id="cDetail" rows="2" placeholder="Si querés, agregá un detalle…"></textarea>`)}
      <p class="small error" id="cErr" hidden></p>
      <div class="row gap">
        <a class="btn btn-ghost grow" href="${backHref}">Volver</a>
        <button class="btn btn-danger-soft grow" id="cGo">${gratis ? 'Cancelar reserva' : 'Sí, cancelar reserva'}</button>
      </div>
    </div>`);

    document.getElementById('cGo').addEventListener('click', async () => {
      const sel = document.querySelector('input[name="cr"]:checked');
      const err = document.getElementById('cErr');
      const btn = document.getElementById('cGo');
      err.hidden = true;
      if (motivoObligatorio && !sel) {
        err.textContent = 'Elegí un motivo para continuar.';
        err.hidden = false;
        return;
      }
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'Cancelando…';
      const r = await OppiAPI.executeCancel(b.id, {
        reason: sel ? sel.value : null,
        reason_detail: (document.getElementById('cDetail').value.trim() ||
          (document.getElementById('cExtra') ? document.getElementById('cExtra').value.trim() : '') || null),
      });
      if (!r.ok) {
        err.textContent = r.error || 'No se pudo cancelar. Probá de nuevo.';
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = label;
        return;
      }
      ViewsCancel.cancelDone(b, r, rol);
    });
  },

  /* Pantalla de éxito tras cancelar. Si cancela el pro/empresa, se aclara
     qué se le ofreció a la clienta (el backend la notifica). */
  cancelDone(b, r, rol) {
    const backHref = rol === 'empresa' ? '#/empresas/reservas' : '#/reservas';
    const moneyLine = r.resolucion === 'gratis' && r.refund_gs
      ? `<p>Se te devuelve <strong>${fmtGs(r.refund_gs)}</strong> (el 100% de lo que pagaste).</p>`
      : (r.comodin_usado ? `<p>Se usó <strong>1 comodín</strong> de tu trimestre.</p>` : '');
    setView(`
    <div class="success-hero">
      <div class="success-check">✓</div>
      <h1>Reserva cancelada ✅</h1>
      <p class="muted">${UI.esc(b.serviceName)} · ${UI.esc(b.date)} ${UI.esc(b.time)}</p>
      ${rol === 'empresa' || rol === 'pro' ? `
      <div class="card" style="text-align:left">
        <p><strong>Le ofrecimos a tu clienta: reprogramar, asignar otro colaborador o elegir otro profesional.</strong></p>
        <p class="small muted">Ya fue notificada. Te avisamos qué elige 💜</p>
      </div>` : `
      <div class="card" style="text-align:left">
        ${moneyLine}
        <p class="small muted">✓ Sin cargos durante el piloto · Tus estrellas no cambian.</p>
      </div>`}
      <a class="btn btn-primary btn-block" href="${backHref}">Ver reservas</a>
      <a class="btn btn-ghost btn-block" href="#/politica-cancelacion">Ver política de cancelación</a>
    </div>`);
  },

  /* --------------------------- MI CUMPLIMIENTO ------------------------ */
  /* Ruta #/mi-cumplimiento (link desde Mi perfil). Si el endpoint aún no
     existe, estado amable en vez de pantalla rota. */
  async compliance() {
    const c = await OppiAPI.getCompliance();
    if (!c || !c.ok) {
      setView(`
      <a class="back-link" href="#/perfil">← Mi perfil</a>
      <h1 class="page-title">Mi cumplimiento ✅</h1>
      ${UI.empty('📊', 'Todavía no tenemos tu indicador', 'Cuando completes tus primeras reservas vas a ver acá tu cumplimiento, tus comodines y tus no-shows.', '<a class="btn btn-primary" href="#/reservas">Ver mis reservas</a>')}
      <p class="center"><a class="link" href="#/politica-cancelacion">Ver política de cancelación →</a></p>`);
      return;
    }
    const pct = Number(c.porcentaje) || 0;
    const wc = c.comodines || { balance: 3, proximo_en: 0, reset_fecha: '' };
    const evals = c.reservas_evaluadas != null ? c.reservas_evaluadas : (c.reservas_totales || 0);
    setView(`
    <a class="back-link" href="#/perfil">← Mi perfil</a>
    <h1 class="page-title">Mi cumplimiento ✅</h1>
    <div class="card highlight-card center">
      <div class="big-pct">${pct}%</div>
      <p>indicador de cumplimiento</p>
    </div>
    ${c.sello ? `<div class="card ok-card center">
      <p><strong>🏅 Profesional confiable</strong></p>
      <p class="small muted">${evals} de 50 reservas</p>
    </div>` : ''}
    <div class="stats-row">
      <div class="card stat"><strong>${wc.balance}</strong><span class="muted small">Comodines</span></div>
      <div class="card stat"><strong>${c.no_shows || 0}</strong><span class="muted small">No-shows</span></div>
      <div class="card stat"><strong>${c.estrellas || '—'}★</strong><span class="muted small">Estrellas</span></div>
    </div>
    <div class="card">
      <div class="row between"><strong>🎫 Tus comodines</strong>${this.wildDots(wc.balance)}</div>
      <p class="small"><strong>Próximo comodín:</strong> ${wc.proximo_en} de 10</p>
      <div class="earn-bar-track"><div class="earn-bar-fill" style="width:${Math.min(100, (Number(wc.proximo_en) || 0) * 10)}%"></div></div>
      ${wc.reset_fecha ? `<p class="small muted">vuelven a 3 el ${UI.esc(wc.reset_fecha)}</p>` : ''}
      <p class="small"><a class="link" href="#/politica-cancelacion">¿Cómo funcionan los comodines? →</a></p>
    </div>
    <p class="small muted center">Tus estrellas (${c.estrellas || '—'}) se calculan aparte y solo miden la calidad de tu trabajo.</p>`);
  },

  /* -------------------------- REPORTAR NO-SHOW ------------------------ */
  /* Ruta #/reservas/:id/reportar-no-show — kind=pro (la clienta reporta que
     el profesional no vino) o kind=cliente (el profesional/empresa reporta
     que la clienta no vino). */
  async reportNoShow(params, query) {
    const q = query || {};
    const id = params.id;
    const clientBs = await OppiAPI.getBookings();
    let b = clientBs.find(x => String(x.id) === String(id));
    let kind = b ? 'pro' : (q.kind === 'cliente' ? 'cliente' : 'pro');
    if (!b) {
      let bizBookings = [];
      try { bizBookings = await OppiAPI.getBizBookings(); } catch (e) {}
      b = (bizBookings || []).find(x => String(x.id) === String(id));
      if (b) kind = 'cliente';
    }
    if (!b) {
      let biz = null;
      try { biz = await OppiAPI.getBusiness(); } catch (e) {}
      b = ((biz && biz.bizBookings) || []).find(x => String(x.id) === String(id));
      if (b) kind = 'cliente';
    }
    if (q.kind === 'pro' || q.kind === 'cliente') kind = q.kind;
    const backHref = kind === 'cliente' ? '#/empresas/reservas' : '#/reservas';

    if (!b) {
      setView(`
      <a class="back-link" href="${backHref}">← Volver</a>
      <h1 class="page-title">Reportar no-show</h1>
      ${UI.empty('🔍', 'No encontramos esa reserva', 'El link puede estar desactualizado.', `<a class="btn btn-primary" href="${backHref}">Volver</a>`)}
      `);
      return;
    }

    const isClient = kind === 'pro';
    setView(`
    <a class="back-link" href="${backHref}">← Volver</a>
    <h1 class="page-title">${isClient ? 'El profesional no se presentó 😕' : 'El cliente no se presentó 😕'}</h1>
    <div class="card">
      <div class="row between"><strong>${UI.esc(b.serviceName)}</strong></div>
      <div class="muted small">${isClient ? UI.esc(b.proName || '') : UI.esc(b.clientName || '')} · 📅 ${UI.esc(b.date)} · 🕐 ${UI.esc(b.time)}</div>
    </div>
    <div class="card">
      ${isClient ? `
      <p><strong>Lo sentimos mucho.</strong> Contanos qué pasó y lo resolvemos:</p>
      <ul class="small promise-list">
        <li>Te escribimos por WhatsApp en menos de 1 hora hábil</li>
        <li>Te buscamos otro profesional con prioridad</li>
        <li>Te compensamos con Oppi Points si se confirma</li>
      </ul>
      ${UI.field('¿Qué pasó? (opcional)', `<textarea id="nsNotes" rows="3" placeholder="Contanos con tus palabras…"></textarea>`)}
      <p class="small error" id="nsErr" hidden></p>
      <div class="row gap">
        <a class="btn btn-ghost grow" href="${backHref}">Volver</a>
        <button class="btn btn-primary grow" id="nsGo">Reportar no-show</button>
      </div>` : `
      <p class="small"><strong>No usa tus comodines ni afecta tu cumplimiento.</strong></p>
      <p class="small">Te compensamos con puntos: perfil destacado en tu rubro por unos días.</p>
      ${UI.field('¿Qué pasó? (opcional)', `<textarea id="nsNotes" rows="2" placeholder="Opcional…"></textarea>`)}
      ${UI.field('Foto o evidencia (opcional)', `<input id="nsPhoto" type="file" accept="image/*">`, 'Una captura del chat o de tu ubicación ayuda a confirmar más rápido.')}
      <p class="small error" id="nsErr" hidden></p>
      <div class="row gap">
        <a class="btn btn-ghost grow" href="${backHref}">Volver</a>
        <button class="btn btn-primary grow" id="nsGo">Enviar reporte</button>
      </div>`}
    </div>`);

    document.getElementById('nsGo').addEventListener('click', async () => {
      const err = document.getElementById('nsErr');
      const btn = document.getElementById('nsGo');
      err.hidden = true;
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'Enviando…';
      let photoUrl = null;
      const fi = document.getElementById('nsPhoto');
      const f = fi && fi.files && fi.files[0];
      if (f) {
        try {
          photoUrl = await new Promise((res, rej) => {
            const rd = new FileReader();
            rd.onload = () => res(rd.result);
            rd.onerror = rej;
            rd.readAsDataURL(f);
          });
        } catch (e) { /* la foto es opcional: se envía igual */ }
      }
      const r = await OppiAPI.reportNoShow(b.id, {
        kind,
        notes: document.getElementById('nsNotes').value.trim() || null,
        photo_url: photoUrl,
      });
      if (!r.ok) {
        err.textContent = r.error || 'No se pudo enviar. Probá de nuevo.';
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = label;
        return;
      }
      UI.toast(r.mensaje || 'Reporte enviado ✅');
      Router.go(backHref);
    });
  },

  /* ------------------- HISTORIAL DE CANCELACIONES --------------------- */
  /* Ruta #/empresas/cancelaciones (Oppi Empresas): lista + comodines de la
     cuenta + % de cumplimiento operativo + descarga del CSV. */
  async bizHistory() {
    if (!(await bizGuard(['admin']))) return;
    const biz = await OppiAPI.getBusiness();
    if (!biz) { Router.go('#/empresas'); return; }
    const h = await OppiAPI.getCancellationHistory();
    if (!h || !h.ok) {
      setView(`
      <a class="back-link" href="#/empresas/panel">← Panel</a>
      <h1 class="page-title">Historial de cancelaciones 📋</h1>
      <div class="card"><p><strong>😕 No pudimos cargar el historial.</strong></p>
      <p class="small muted">${UI.esc((h && h.error) || 'Probá de nuevo en un rato.')}</p>
      <button class="btn btn-primary btn-block" id="hRetry">Reintentar</button></div>`);
      document.getElementById('hRetry').addEventListener('click', () => ViewsCancel.bizHistory());
      return;
    }
    const wc = h.comodines || { balance: 3 };
    const items = h.items || [];
    setView(`
    <a class="back-link" href="#/empresas/panel">← Panel</a>
    <h1 class="page-title">Historial de cancelaciones 📋</h1>
    <div class="stats-row">
      <div class="card stat"><strong>${h.cumplimiento_operativo != null ? h.cumplimiento_operativo + '%' : '—'}</strong><span class="muted small">Cumplimiento operativo</span></div>
      <div class="card stat"><strong>${wc.balance} de 3</strong><span class="muted small">Comodines</span></div>
    </div>
    <div class="card">
      <div class="row between"><strong>🎫 Comodines de la cuenta</strong>${this.wildDots(wc.balance)}</div>
      <p class="small muted">Recuperás 1 cada 10 reservas completadas, sin pasar de 3.</p>
    </div>
    <h2 class="sec-title">Movimientos</h2>
    ${items.length ? `<div class="stack">${items.map(x => `
      <div class="card">
        <div class="row between"><strong>#${UI.esc(x.nro)}</strong><span class="muted small">${UI.esc(x.fecha || '')}</span></div>
        <div class="small">${UI.esc(x.tipo)}${x.detalle ? ' · ' + UI.esc(x.detalle) : ''}</div>
      </div>`).join('')}</div>`
      : UI.empty('📋', 'Sin movimientos todavía', 'Cuando haya cancelaciones, reprogramaciones o no-shows, aparecen acá.')}
    <button class="btn btn-outline btn-block" id="dlCsv">⬇️ Descargar historial</button>
    <p class="center" style="margin-top:12px"><a class="link" href="#/politica-cancelacion">Ver política de cancelación →</a></p>`);

    document.getElementById('dlCsv').addEventListener('click', async () => {
      const btn = document.getElementById('dlCsv');
      btn.disabled = true;
      const r = await OppiAPI.downloadCancellationCsv();
      btn.disabled = false;
      if (!r.ok || !r.csv) { UI.toast(r.error || 'No se pudo descargar.', 'error'); return; }
      try {
        const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = r.filename || 'historial-cancelaciones.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 4000);
        UI.toast('Historial descargado ⬇️');
      } catch (e) {
        UI.toast('No se pudo descargar en este dispositivo.', 'error');
      }
    });
  },
};
