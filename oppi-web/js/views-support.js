/* ============================================================================
 * Oppi — Bandeja de soporte (agentes): conversaciones de WhatsApp.
 * Ruta: #/soporte (query: ?f=todas|bot|humano|resuelta, ?id= conversación).
 * Layout: lista a la izquierda, panel de mensajes a la derecha (se apilan
 * en pantallas chicas). El backend responde 403 si no sos agente: se muestra
 * "No tenés acceso a la bandeja de soporte".
 * ========================================================================== */
'use strict';

const ViewsSupport = {
  _timer: null,
  _cleanupOn: false,

  _stopPoll() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  /* Cuando se navega fuera de #/soporte, frenar el polling de mensajes. */
  _ensureCleanup() {
    if (this._cleanupOn) return;
    this._cleanupOn = true;
    window.addEventListener('hashchange', () => {
      if (String(location.hash || '').indexOf('#/soporte') !== 0) ViewsSupport._stopPoll();
    });
  },

  _statusBadge(status) {
    const map = {
      bot: ['🤖 Bot', 'warn'],
      human: ['🧑 Humano', 'ok'],
      resolved: ['✅ Resuelta', 'muted'],
    };
    const m = map[status] || [status, 'muted'];
    return `<span class="badge badge-${m[1]}">${m[0]}</span>`;
  },

  _kindIcon(kind) { return kind === 'business' ? '🏢' : '👤'; },

  _timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return 'ahora';
    if (mins < 60) return 'hace ' + mins + ' min';
    const hs = Math.floor(mins / 60);
    if (hs < 24) return 'hace ' + hs + ' h';
    const days = Math.floor(hs / 24);
    if (days < 7) return 'hace ' + days + ' d';
    return d.toLocaleDateString('es-PY', { day: 'numeric', month: 'short' });
  },

  _filterChips(filter, selId) {
    const opts = [
      ['all', 'Todas'], ['bot', '🤖 Bot'], ['human', '🧑 Humano'], ['resolved', '✅ Resueltas'],
    ];
    return `<div class="chips sup-filters">` + opts.map(([v, label]) => {
      const href = '#/soporte' + (v === 'all' ? '' : '?f=' + v) +
        (selId ? (v === 'all' ? '?id=' + selId : '&id=' + selId) : '');
      return `<a class="chip ${filter === v ? 'active' : ''}" href="${href}">${label}</a>`;
    }).join('') + `</div>`;
  },

  _convRow(c, selId, filter) {
    const name = c.user_name || (c.kind === 'business' ? 'Empresa' : 'Cliente');
    const href = '#/soporte' + (filter === 'all' ? '' : '?f=' + filter) +
      (filter === 'all' ? '?id=' + c.id : '&id=' + c.id);
    return `<a class="chat-row sup-conv ${String(c.id) === String(selId) ? 'active' : ''}" href="${href}">
      <div class="sup-kind" aria-hidden="true">${this._kindIcon(c.kind)}</div>
      <div class="chat-preview">
        <strong>${UI.esc(name)}</strong>
        <p class="muted small">${UI.esc(c.last_message || '')}</p>
      </div>
      <div class="sup-row-right">
        <span class="muted small">${UI.esc(this._timeAgo(c.updated_at))}</span>
        ${c.unread > 0 ? `<span class="sup-unread">${c.unread > 9 ? '9+' : c.unread}</span>` : ''}
      </div>
    </a>`;
  },

  _msgHtml(m) {
    // El mock usa { from: 'user'|'agent' }; el HttpAdapter mapea a { incoming }.
    const incoming = m.incoming != null ? m.incoming : m.from === 'user';
    const label = incoming ? '' :
      `<span class="sup-sender">${m.sender === 'human' ? '🧑 humano' : '🤖 bot'}</span>`;
    return `<div class="msg ${incoming ? 'theirs' : 'mine'}">${label}${UI.esc(m.text || '')}<span class="msg-time">${UI.esc(m.time || '')}</span></div>`;
  },

  async _renderMessages(convId) {
    const box = document.getElementById('supMsgs');
    if (!box) return;
    try {
      const msgs = await OppiAPI.getSupportMessages(convId);
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      box.innerHTML = (msgs || []).map(m => this._msgHtml(m)).join('') ||
        `<p class="muted small center">Todavía no hay mensajes.</p>`;
      if (nearBottom) box.scrollTop = box.scrollHeight;
    } catch (e) { /* el próximo poll reintenta */ }
  },

  _startPoll(convId) {
    this._stopPoll();
    const tick = () => {
      if (String(location.hash || '').indexOf('#/soporte') !== 0) return;
      if (!document.getElementById('supMsgs')) return;
      this._renderMessages(convId);
    };
    this._timer = setInterval(tick, 5000);
    // En Node (tests) el timer no debe mantener vivo el proceso.
    if (this._timer && this._timer.unref) this._timer.unref();
  },

  /* -------------------------------- INBOX ------------------------------ */
  async inbox(query) {
    this._stopPoll();
    this._ensureCleanup();
    const q = query || {};
    const filter = ['bot', 'human', 'resolved'].includes(q.f) ? q.f : 'all';
    const wantId = q.id || null;

    let convs = null, denied = false, failed = false;
    try {
      convs = await OppiAPI.getSupportConversations(filter === 'all' ? {} : { status: filter });
    } catch (e) {
      if (e && e.status === 403) denied = true;
      else failed = true;
    }

    if (denied) {
      setView(`<a class="back-link" href="#/perfil">← Mi perfil</a>` +
        UI.empty('🔒', 'No tenés acceso a la bandeja de soporte',
          'Esta sección es solo para agentes de soporte de Oppi.',
          '<a class="btn btn-primary" href="#/perfil">Volver al perfil</a>'));
      return;
    }
    if (failed || !Array.isArray(convs)) {
      setView(`<a class="back-link" href="#/perfil">← Mi perfil</a>
      <h1 class="page-title">Soporte 💬</h1>` +
        UI.empty('📡', 'No pudimos cargar la bandeja',
          'Revisá tu conexión e intentá de nuevo.',
          '<a class="btn btn-primary" href="#/soporte">Reintentar</a>'));
      return;
    }

    // Nota de vista previa si el backend está en modo mock (o no hay backend).
    let waNote = OppiAPI.adapterMode() !== 'http';
    if (!waNote) {
      try {
        const st = await OppiAPI.getWhatsappStatus();
        waNote = !!(st && st.mode === 'mock');
      } catch (e) { waNote = false; }
    }

    const sel = wantId ? convs.find(c => String(c.id) === String(wantId)) : null;
    const selId = sel ? sel.id : null;

    setView(`
    <a class="back-link" href="#/perfil">← Mi perfil</a>
    <h1 class="page-title">Soporte 💬</h1>
    ${waNote ? `<div class="card sup-wanote">📱 <strong>Vista previa</strong> — conectá tu número en WHATSAPP.md</div>` : ''}
    ${this._filterChips(filter, selId)}
    <div class="sup-layout">
      <div class="card sup-list">
        ${convs.length
          ? convs.map(c => this._convRow(c, selId, filter)).join('')
          : `<p class="muted small center" style="padding:16px">No hay conversaciones en este filtro.</p>`}
      </div>
      <div class="card sup-panel">
        ${sel ? this._panelHtml(sel) : `<div class="sup-empty"><div class="empty-icon">💬</div><p class="muted">Elegí una conversación para ver los mensajes.</p></div>`}
      </div>
    </div>
    <div class="card sup-team">
      <h3>Equipo de soporte 👥</h3>
      <div id="supAgents"><p class="muted small">Cargando equipo…</p></div>
      <form class="row gap" id="supAddAgent" style="margin-top:12px">
        <input id="supAgentEmail" type="email" placeholder="email del agente" class="grow" aria-label="Email del agente" required>
        <button class="btn btn-primary btn-sm" type="submit">Agregar</button>
      </form>
    </div>`);

    if (selId) {
      await this._renderMessages(selId);
      this._startPoll(selId);
      const box = document.getElementById('supMsgs');
      if (box) box.scrollTop = box.scrollHeight;
    }

    this._wirePanel(selId, filter);
    this._wireTeam();
  },

  _panelHtml(c) {
    const name = c.user_name || (c.kind === 'business' ? 'Empresa' : 'Cliente');
    return `
      <div class="sup-panel-head">
        <div class="sup-kind">${this._kindIcon(c.kind)}</div>
        <div class="grow"><strong>${UI.esc(name)}</strong>
          <div class="small">${this._statusBadge(c.status)}</div>
        </div>
      </div>
      <div class="chat-messages sup-msgs" id="supMsgs"><p class="muted small center">Cargando mensajes…</p></div>
      <form class="chat-input" id="supReplyForm">
        <input id="supReply" placeholder="Escribí tu respuesta…" autocomplete="off" aria-label="Respuesta" style="font-size:16px">
        <button class="btn btn-primary" type="submit">Responder como humano ➤</button>
      </form>
      <div class="row gap sup-actions">
        <button class="btn btn-outline btn-sm" id="supToBot">Devolver al bot</button>
        <button class="btn btn-outline btn-sm" id="supResolve">Marcar resuelta</button>
      </div>`;
  },

  _wirePanel(selId, filter) {
    const form = document.getElementById('supReplyForm');
    if (form && selId) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const input = document.getElementById('supReply');
        const body = input.value.trim();
        if (!body) return;
        const r = await OppiAPI.replySupportConversation(selId, { body });
        if (!r.ok) { UI.toast(r.error || 'No se pudo enviar', 'error'); return; }
        UI.toast('Respondido como humano ✅');
        input.value = '';
        this.inbox({ f: filter === 'all' ? undefined : filter, id: selId });
      });
    }
    const toBot = document.getElementById('supToBot');
    if (toBot && selId) {
      toBot.addEventListener('click', async () => {
        const r = await OppiAPI.botSupportConversation(selId);
        if (!r.ok) { UI.toast(r.error || 'No se pudo devolver al bot', 'error'); return; }
        UI.toast('La conversación vuelve al bot 🤖');
        this.inbox({ f: filter === 'all' ? undefined : filter, id: selId });
      });
    }
    const res = document.getElementById('supResolve');
    if (res && selId) {
      res.addEventListener('click', async () => {
        const r = await OppiAPI.resolveSupportConversation(selId);
        if (!r.ok) { UI.toast(r.error || 'No se pudo marcar como resuelta', 'error'); return; }
        UI.toast('Marcada como resuelta ✅');
        this.inbox({ f: filter === 'all' ? undefined : filter, id: selId });
      });
    }
  },

  async _wireTeam() {
    const box = document.getElementById('supAgents');
    const form = document.getElementById('supAddAgent');
    if (!box || !form) return;
    const paint = agents => {
      box.innerHTML = agents && agents.length
        ? `<div class="stack">` + agents.map(a =>
            `<div class="row between sup-agent"><span>👤 ${UI.esc(a.email)}</span><span class="muted small">desde ${UI.esc(a.added_at || '')}</span></div>`).join('') + `</div>`
        : `<p class="muted small">Todavía no hay agentes. Agregá el primero acá abajo 👇</p>`;
    };
    try {
      const agents = await OppiAPI.getSupportAgents();
      paint(agents || []);
    } catch (e) { paint([]); }
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('supAgentEmail');
      const r = await OppiAPI.addSupportAgent({ email: input.value });
      if (!r.ok) { UI.toast(r.error || 'No se pudo agregar', 'error'); return; }
      UI.toast('Agente agregado ✅');
      input.value = '';
      try { paint(await OppiAPI.getSupportAgents() || []); } catch (err) { /* noop */ }
    });
  },
};
