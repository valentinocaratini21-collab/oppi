/* ============================================================================
 * Oppi — Chat de soporte integrado (cliente): botón flotante, panel y
 * vista #/ayuda a pantalla completa.
 * El soporte vive DENTRO de la app: el usuario habla con el bot y, si hace
 * falta, un asesor humano toma la conversación (status 'human' del backend).
 * Polling cada 5 s mientras el chat está abierto: trae los mensajes nuevos
 * del agente sin recargar la vista.
 * Rutas: #/ayuda (página). Panel: drawer lateral en desktop, bottom sheet
 * en mobile (<768px). La bandeja de agentes #/soporte no cambia.
 * ========================================================================== */
'use strict';

const SupportChat = {
  _inst: null,   // { root, mode 'panel'|'page', shown:Set, lastStatus, humanAnnounced, timer }
  _hashHook: false,

  /* ------------------------- botón flotante --------------------------- */
  /* Visible solo en las vistas del cliente con bottom nav: ni en login/
     registro/empresas/reservar (sin nav), ni en #/soporte (bandeja de
     agentes), ni en #/ayuda (ahí el chat ya está a pantalla completa). */
  _fabVisible(path) {
    return !(path.startsWith('/login') || path.startsWith('/registro') ||
      path.startsWith('/empresas') || path.includes('/reservar') ||
      path.startsWith('/soporte') || path.startsWith('/ayuda'));
  },

  /* AppChrome.render() lo llama en cada cambio de ruta: monta el botón una
     sola vez y lo muestra/oculta según la vista. */
  mountFab() {
    let path = '/';
    try { path = Router.parse().path || '/'; } catch (e) { /* tests sin Router */ }
    let wrap = null;
    try { wrap = document.getElementById('supFab'); } catch (e) { return; }
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'supFab';
      wrap.className = 'sup-fab-wrap';
      wrap.innerHTML = `<span class="sup-fab-tip" id="supFabTip">¿Necesitás ayuda?</span>` +
        `<button class="sup-fab" id="supFabBtn" aria-label="¿Necesitás ayuda? Abrir chat de soporte">💬</button>`;
      document.body.appendChild(wrap);
      const open = () => SupportChat.open();
      const btn = document.getElementById('supFabBtn');
      if (btn) btn.addEventListener('click', open);
      const tip = document.getElementById('supFabTip');
      if (tip) {
        tip.addEventListener('click', open);
        let seen = false;
        try { seen = localStorage.getItem('oppi_sup_seen') === '1'; } catch (err) {}
        if (seen) tip.style.display = 'none';
      }
    }
    wrap.style.display = this._fabVisible(path) ? '' : 'none';
  },

  /* ------------------------- abrir / cerrar --------------------------- */
  open() {
    if (this._inst && this._inst.mode === 'panel') return; // ya abierto
    this.close();
    try { localStorage.setItem('oppi_sup_seen', '1'); } catch (e) {}
    const tip = document.getElementById('supFabTip');
    if (tip) tip.style.display = 'none';
    let wrap = null;
    try { wrap = document.createElement('div'); } catch (e) { return; }
    wrap.id = 'supSheet';
    wrap.className = 'sup-sheet-wrap';
    wrap.innerHTML = `<div class="sup-sheet" role="dialog" aria-label="Chat de soporte">${this.chatHtml(true)}</div>`;
    wrap.addEventListener('click', e => { if (e.target === wrap) SupportChat.close(); });
    document.body.appendChild(wrap);
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
    this._boot(wrap, 'panel');
  },

  close() {
    this._stopPoll();
    this._inst = null;
    let w = null;
    try { w = document.getElementById('supSheet'); } catch (e) {}
    if (w && w.remove) w.remove();
    try { document.body.style.overflow = ''; } catch (e) {}
  },

  /* Vista #/ayuda: el mismo chat, a pantalla completa dentro de #view. */
  mountPage() {
    this.close();
    let root = null;
    try { root = document.getElementById('supPage'); } catch (e) {}
    if (!root) return;
    this._boot(root, 'page');
  },

  _ensureHashHook() {
    if (this._hashHook) return;
    this._hashHook = true;
    try {
      window.addEventListener('hashchange', () => {
        const inst = SupportChat._inst;
        if (!inst) return;
        if (inst.mode === 'panel') { SupportChat.close(); return; }
        // página: si el nodo salió del DOM, frenar el polling
        if (inst.root && inst.root.isConnected === false) SupportChat._stopPoll();
      });
    } catch (e) {}
  },

  _stopPoll() {
    const inst = this._inst;
    if (inst && inst.timer) {
      clearInterval(inst.timer);
      inst.timer = null;
    }
  },

  /* Shell del chat (header + mensajes + chips + input). Se reutiliza en el
     panel flotante y en la página #/ayuda. */
  chatHtml(withClose) {
    return `
      <div class="sup-head">
        <div class="sup-head-ava" aria-hidden="true">💬</div>
        <div class="grow">
          <strong>Soporte Oppi</strong>
          <div class="small sup-online"><span class="sup-dot"></span>En línea · respondemos en el día</div>
        </div>
        ${withClose ? `<button class="icon-btn" data-sup-close aria-label="Cerrar chat">✕</button>` : ''}
      </div>
      <div class="sup-msgs" data-sup-msgs aria-live="polite"></div>
      <div class="sup-chips" data-sup-chips></div>
      <form class="sup-form" data-sup-form>
        <input data-sup-input placeholder="Escribí tu mensaje…" autocomplete="off"
               aria-label="Escribí tu mensaje" style="font-size:16px">
        <button class="btn btn-primary sup-send" type="submit" aria-label="Enviar mensaje">➤</button>
      </form>`;
  },

  _boot(root, mode) {
    if (!root) return;
    this._stopPoll();
    this._ensureHashHook();
    const inst = { root, mode, shown: new Set(), lastStatus: 'bot', humanAnnounced: false, timer: null };
    this._inst = inst;
    const q = sel => { try { return root.querySelector(sel); } catch (e) { return null; } };
    inst._q = q;
    const form = q('[data-sup-form]');
    const input = q('[data-sup-input]');
    const closeBtn = q('[data-sup-close]');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (form && input) {
      form.addEventListener('submit', e => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) return;
        input.value = '';
        this.send(v);
      });
    }
    this._loadHistory();
    // Polling cada 5 s: solo mientras el chat está abierto.
    inst.timer = setInterval(() => SupportChat._poll(), 5000);
    if (inst.timer && inst.timer.unref) inst.timer.unref();
  },

  /* ------------------------- mensajes --------------------------------- */
  _msgKey(m) {
    return m && m.id != null ? 'id:' + m.id : 'c:' + (m.sender || '') + '|' + (m.body || '');
  },

  _timeShort(iso) {
    try {
      const d = new Date(String(iso).replace(' ', 'T'));
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  },

  _msgHtml(m) {
    const mine = m.sender === 'user';
    const agent = m.sender === 'agent';
    const label = agent ? `<span class="sup-sender-tag">Soporte Oppi</span>` : '';
    const time = this._timeShort(m.created_at);
    return `<div class="msg ${mine ? 'mine' : 'theirs'}">${label}${UI.esc(m.body || '')}` +
      (time ? `<span class="msg-time">${UI.esc(time)}</span>` : '') + `</div>`;
  },

  _appendMsg(inst, m) {
    if (!m || !m.body) return;
    const key = this._msgKey(m);
    if (inst.shown.has(key)) return;
    inst.shown.add(key);
    const box = inst._q('[data-sup-msgs]');
    if (!box) return;
    if (m.sender === 'agent' && !inst.humanAnnounced) this._humanNotice(inst);
    const div = document.createElement('div');
    div.innerHTML = this._msgHtml(m);
    const node = div.firstChild;
    if (node) box.appendChild(node);
    this._scrollBottom(inst);
  },

  _humanNotice(inst) {
    inst.humanAnnounced = true;
    inst.lastStatus = 'human';
    const box = inst._q('[data-sup-msgs]');
    if (!box) return;
    const div = document.createElement('div');
    div.innerHTML = `<div class="sup-notice">Te paso con un asesor 👌</div>`;
    const node = div.firstChild;
    if (node) box.appendChild(node);
    this._scrollBottom(inst);
  },

  _scrollBottom(inst) {
    const box = inst._q('[data-sup-msgs]');
    if (box) { try { box.scrollTop = box.scrollHeight; } catch (e) {} }
  },

  _renderChips(inst, replies) {
    const box = inst._q('[data-sup-chips]');
    if (!box) return;
    const list = (replies || []).filter(Boolean);
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = list.map(r =>
      `<button type="button" class="sup-chip" data-sup-chip="${UI.esc(r)}">${UI.esc(r)}</button>`).join('');
    box.querySelectorAll('[data-sup-chip]').forEach(b =>
      b.addEventListener('click', () => SupportChat.send(b.getAttribute('data-sup-chip'))));
  },

  _clearChips(inst) {
    const box = inst._q('[data-sup-chips]');
    if (box) box.innerHTML = '';
  },

  _typing(inst, on) {
    const box = inst._q('[data-sup-msgs]');
    if (!box) return;
    let t = null;
    try { t = box.querySelector('[data-sup-typing]'); } catch (e) {}
    if (on && !t) {
      const div = document.createElement('div');
      div.innerHTML = `<div class="msg theirs sup-typing" data-sup-typing><span class="sup-typing-dots"><i></i><i></i><i></i></span> escribiendo…</div>`;
      const node = div.firstChild;
      if (node) box.appendChild(node);
      this._scrollBottom(inst);
    } else if (!on && t && t.remove) {
      t.remove();
    }
  },

  async _loadHistory() {
    const inst = this._inst;
    if (!inst) return;
    let msgs = [];
    try { msgs = await OppiAPI.supportChatHistory() || []; } catch (e) { /* offline: queda vacío */ }
    if (!this._inst || this._inst !== inst) return;
    (msgs || []).forEach(m => this._appendMsg(inst, m));
    if (inst.shown.size === 0) {
      // Primera vez: saludo del bot con chips (cero fricción: tocar en vez de escribir).
      this._appendMsg(inst, { id: 'sup-hello', sender: 'bot', body: '¡Hola! 👋 Soy el asistente de Oppi. ¿En qué te puedo ayudar?', created_at: new Date().toISOString() });
      this._renderChips(inst, ['Cómo reservo', 'Cómo pago', 'Cancelar un turno', 'Hablar con un asesor']);
    }
    this._scrollBottom(inst);
  },

  /* Trae el historial y pinta solo los mensajes nuevos (ids no vistos).
     Se llama cada 5 s y después de enviar: así la respuesta del bot/agente
     entra con su id real del backend y nunca se duplica. */
  async _poll() {
    const inst = this._inst;
    if (!inst) return;
    if (inst.root && inst.root.isConnected === false) { this._stopPoll(); return; }
    let msgs = [];
    try { msgs = await OppiAPI.supportChatHistory() || []; } catch (e) { return; }
    if (!this._inst || this._inst !== inst) return;
    (msgs || []).forEach(m => this._appendMsg(inst, m));
  },

  async send(text) {
    const inst = this._inst;
    const body = String(text || '').trim();
    if (!inst || !body) return;
    this._clearChips(inst);
    this._typing(inst, true);
    let r;
    try { r = await OppiAPI.supportChatSend({ body }); }
    catch (e) { r = { ok: false, error: 'No se pudo enviar. Revisá tu conexión.' }; }
    if (!this._inst || this._inst !== inst) return;
    this._typing(inst, false);
    if (!r || !r.ok) { UI.toast((r && r.error) || 'No se pudo enviar', 'error'); return; }
    if (r.status === 'human' && !inst.humanAnnounced) this._humanNotice(inst);
    if (r.status) inst.lastStatus = r.status;
    // El historial ya trae el mensaje del usuario + la respuesta con sus
    // ids reales: un poll inmediato los pinta sin duplicar.
    await this._poll();
    if (r.quick_replies && r.quick_replies.length) this._renderChips(inst, r.quick_replies);
    this._scrollBottom(inst);
  },
};
