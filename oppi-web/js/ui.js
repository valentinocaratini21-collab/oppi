/* ============================================================================
 * Oppi — Componentes UI compartidos (js/ui.js)
 * Helpers de render: tarjetas, estrellas, badges, modal, toast, avatares.
 * ========================================================================== */
'use strict';

const UI = {
  /* Escapa HTML para interpolar texto del usuario sin XSS */
  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  avatar(initials, color, size) {
    const px = size || 48;
    return `<div class="avatar" style="width:${px}px;height:${px}px;background:${color || '#6B5BD0'};font-size:${Math.round(px * 0.38)}px">${UI.esc(initials || '?')}</div>`;
  },

  stars(rating, count) {
    const full = Math.round(rating || 0);
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= full ? '★' : '☆';
    return `<span class="stars" aria-label="${rating} de 5">${s}</span>` +
      (count != null ? ` <span class="muted small">(${count})</span>` : '');
  },

  verifiedBadge() {
    return `<span class="badge badge-verified" title="Verificado por Oppi">✓ Verificado</span>`;
  },

  urgentBadge() {
    return `<span class="badge badge-urgent">⚡ Urgente</span>`;
  },

  statusBadge(status) {
    const map = {
      confirmed: ['Confirmada', 'ok'], pending: ['Pendiente', 'warn'],
      cancelled: ['Cancelada', 'muted'], rejected: ['Rechazada', 'muted'],
      open: ['Abierta', 'ok'], assigned: ['Asignada', 'warn'],
      in_progress: ['En curso', 'warn'], quoting: ['Cotizando', 'warn'],
      completed: ['Completada', 'ok'],
      no_show_client: ['El cliente no vino', 'muted'],
      no_show_pro: ['El profesional no vino', 'muted'],
    };
    const m = map[status] || [status, 'muted'];
    return `<span class="badge badge-${m[1]}">${m[0]}</span>`;
  },

  async proCard(p) {
    const fav = await OppiAPI.isFavorite(p.id);
    return `
    <a class="card pro-card" href="#/pro/${p.id}">
      <div class="pro-card-top">
        ${UI.avatar(p.initials, p.color, 56)}
        <div class="pro-card-info">
          <div class="pro-card-name">${UI.esc(p.name)} ${p.verified ? '<span class="vcheck" title="Verificado">✓</span>' : ''}</div>
          <div class="muted small">${UI.esc(p.specialty)} · ${UI.esc(p.barrio)}</div>
          <div class="small">${UI.stars(p.rating, p.reviewsCount)}</div>
        </div>
        <button class="icon-btn fav-btn ${fav ? 'active' : ''}" data-fav="${p.id}" aria-label="Favorito">${fav ? '❤️' : '🤍'}</button>
      </div>
      <div class="pro-card-price">Desde <strong>${fmtGs(Math.min(...p.services.map(s => s.price)))}</strong></div>
    </a>`;
  },

  categoryChips(categories, activeId, baseHref) {
    return `<div class="chips">` + categories.map(c =>
      `<a class="chip ${c.id === activeId ? 'active' : ''}" href="${baseHref}${c.id === activeId ? '' : '?cat=' + c.id}">${c.icon} ${UI.esc(c.name)}</a>`
    ).join('') + `</div>`;
  },

  empty(icon, title, text, cta) {
    return `<div class="empty">
      <div class="empty-icon">${icon}</div>
      <h3>${title}</h3>
      <p class="muted">${text}</p>
      ${cta || ''}
    </div>`;
  },

  field(label, inner, hint) {
    return `<label class="field"><span class="field-label">${label}</span>${inner}${hint ? `<span class="field-hint">${hint}</span>` : ''}</label>`;
  },

  /* Fila de menú de perfil: ícono + título + subtítulo + chevron (+ badge). */
  menuRow({ icon, title, sub, href, badge }) {
    return `<a class="menu-row2" href="${href}">
      <span class="menu-ico">${icon}</span>
      <span class="menu-txt"><strong>${UI.esc(title)}</strong>${sub ? `<span class="muted small">${UI.esc(sub)}</span>` : ''}</span>
      ${badge ? `<span class="menu-badge">${badge}</span>` : ''}
      <span class="menu-chev">›</span>
    </a>`;
  },

  /* Control segmentado ("Ver como: Cliente | Negocio | Handyman").
     Cada opción puede traer `attrs` extra (ej. data-vm para fijar el modo). */
  segmented(opts) {
    return `<div class="segmented" role="tablist" aria-label="Ver como">${
      opts.map(o => `<a class="seg ${o.active ? 'active' : ''}" href="${o.href}"${o.attrs ? ' ' + o.attrs : ''}>${UI.esc(o.label)}</a>`).join('')
    }</div>`;
  },

  /* Barras de distribución de reseñas (1–5★).
     MOCK: aproximación determinista derivada del promedio; el backend va a
     traer el histograma real. Suma 100%. */
  ratingBars(rating) {
    const r = Number(rating) || 0;
    const p5 = Math.round(Math.min(96, Math.max(40, (r - 3.2) * 55)));
    const rest = 100 - p5;
    const dist = [
      [5, p5],
      [4, Math.round(rest * 0.6)],
      [3, Math.round(rest * 0.25)],
      [2, Math.round(rest * 0.1)],
    ];
    dist.push([1, 100 - dist.reduce((a, x) => a + x[1], 0)]);
    return `<div class="rating-bars">` + dist.map(([stars, pct]) =>
      `<div class="rating-bar-row"><span class="small">${stars}★</span><div class="rating-bar"><div style="width:${pct}%"></div></div><span class="small muted">${pct}%</span></div>`
    ).join('') + `</div>`;
  },

  /* Distancia y tiempo de respuesta del profesional.
     MOCK: derivados deterministas del id (coherentes entre renders); el
     backend los va a calcular con ubicación real y métricas. */
  proMeta(p) {
    const h = String(p.id || '?').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
      distanceKm: (0.8 + (h % 38) / 10).toFixed(1).replace('.', ','),
      respondsIn: 'Responde en ~1 h',
    };
  },

  /* Reseña con la respuesta del profesional/negocio destacada.
     Si la reseña trae fotos (máx 3, URLs de /api/uploads), se muestran. */
  reviewCard(r, who) {
    const photos = (r.photos || []).slice(0, 3);
    return `<div class="card review">
      <div class="row between"><strong>${UI.esc(r.author)}</strong><span class="muted small">${UI.esc(r.date || '')}</span></div>
      <div>${UI.stars(r.rating)}</div>
      <p>${UI.esc(r.text)}</p>
      ${photos.length ? `<div class="photo-preview">${photos.map(p => `<img src="${UI.esc(p)}" alt="Foto de la reseña de ${UI.esc(r.author)}" loading="lazy">`).join('')}</div>` : ''}
      ${r.reply ? `<div class="pro-reply"><strong>Respuesta de ${UI.esc(who)} 💜</strong><p class="small">${UI.esc(r.reply)}</p></div>` : ''}
    </div>`;
  },

  /* --- modal + toast --------------------------------------------------- */
  modal(html) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.id = 'modalWrap';
    wrap.innerHTML = `<div class="modal">${html}</div>`;
    wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
  },

  toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  },
};

function closeModal() {
  const m = document.getElementById('modalWrap');
  if (m) m.remove();
  document.body.style.overflow = '';
}

/* Confirma con modal. onOk se ejecuta si acepta. */
function confirmModal({ title, text, okLabel, onOk }) {
  UI.modal(`
    <button class="modal-x" id="mX" aria-label="Cerrar">✕</button>
    <h3>${title}</h3>
    <p class="muted">${text}</p>
    <div class="row gap">
      <button class="btn btn-ghost" id="mCancel">Cancelar</button>
      <button class="btn btn-primary" id="mOk">${okLabel || 'Confirmar'}</button>
    </div>`);
  document.getElementById('mX').onclick = closeModal;
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mOk').onclick = () => { closeModal(); onOk && onOk(); };
}

/* Compartir la página actual: Web Share API o copiar link. */
function sharePage() {
  const url = location.href;
  const title = document.title || 'Oppi';
  if (navigator.share) { navigator.share({ title, url }).catch(() => {}); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => UI.toast('Link copiado 📋')).catch(() => {});
    return;
  }
  UI.toast('Copiá el link de la barra del navegador 📋');
}

/* Delegación global: botones de favorito */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-fav]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const r = await OppiAPI.toggleFavorite(b.dataset.fav);
  if (!r.ok) { UI.toast(r.error || 'No se pudo actualizar', 'error'); return; }
  b.classList.toggle('active', r.favorite);
  b.textContent = r.favorite ? '❤️' : '🤍';
  UI.toast(r.favorite ? 'Agregado a favoritos' : 'Quitado de favoritos');
});
