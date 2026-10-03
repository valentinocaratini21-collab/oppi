/* ============================================================================
 * Oppi — Handyman: explorar, publicar, ofertas, trabajos, panel
 * ========================================================================== */
'use strict';

const ViewsHandyman = {
  /* ------------------------------ EXPLORAR ----------------------------- */
  async explore(params, query) {
    const cats = OppiAPI.getTaskCategories();
    const filters = {
      q: query.q || '', category: query.cat || '',
      urgentOnly: query.urgent === '1',
    };
    const tasks = await OppiAPI.getTasks(filters);

    setView(`
    <h1 class="page-title">Tareas cerca tuyo 🔨</h1>
    ${typeof OppiConfig !== 'undefined' && OppiConfig.FEATURE_MAP ? ViewsTasksMap.tabsHtml('list') : ''}
    <form class="searchbar" id="taskSearch">
      <span>🔍</span>
      <input id="taskQ" type="search" placeholder="¿Qué sabés hacer?" value="${UI.esc(filters.q)}" aria-label="Buscar tareas">
    </form>
    <div class="chips">
      <a class="chip ${filters.urgentOnly ? 'active' : ''}" href="#/handyman${filters.urgentOnly ? '' : '?urgent=1'}">⚡ Urgentes</a>
      ${cats.map(c => `<a class="chip ${c.id === filters.category ? 'active' : ''}" href="#/handyman${c.id === filters.category ? '' : '?cat=' + c.id}">${c.icon} ${c.name}</a>`).join('')}
    </div>
    <p class="muted small">${tasks.length} tarea${tasks.length === 1 ? '' : 's'} ${filters.urgentOnly ? 'urgentes' : ''}</p>
    <div class="stack">
      ${tasks.length ? tasks.map(t => `
        <a class="card task-card" href="#/handyman/tarea/${t.id}">
          <div class="row between"><strong>${UI.esc(t.title)}</strong>${t.urgent ? UI.urgentBadge() : ''}</div>
          <div class="muted small">📍 ${UI.esc(t.barrio)} · 💰 ${t.budgetMin ? fmtGs(t.budgetMin) + ' – ' + fmtGs(t.budgetMax) : 'A convenir'}</div>
          <div class="small">💬 ${t.offersCount} oferta${t.offersCount === 1 ? '' : 's'}</div>
        </a>`).join('')
        : UI.empty('🔨', 'No hay tareas con esos filtros', 'Probá sacando filtros o publicá la primera.', '<a class="btn btn-primary" href="#/handyman/publicar">Publicar tarea</a>')}
    </div>
    <a class="fab" href="#/handyman/publicar" aria-label="Publicar tarea">＋</a>`);

    document.getElementById('taskSearch').addEventListener('submit', e => {
      e.preventDefault();
      const q = document.getElementById('taskQ').value.trim();
      Router.go('#/handyman' + (q ? '?q=' + encodeURIComponent(q) : ''));
    });
  },

  /* ------------------------------ PUBLICAR ----------------------------- */
  async publish() {
    const cats = OppiAPI.getTaskCategories();
    const barrios = OppiAPI.getBarrios();
    setView(`
    <h1 class="page-title">Publicá tu tarea</h1>
    <p class="muted small">Describí lo que necesitás y recibí ofertas de handymans verificados.</p>
    <form id="publishForm" class="stack">
      ${UI.field('Título *', `<input id="tTitle" required maxlength="80" placeholder="Ej: Se me rompió la canilla de la cocina">`)}
      ${UI.field('Categoría *', `<select id="tCat" required><option value="">Elegí…</option>${cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}</select>`)}
      ${UI.field('Descripción', `<textarea id="tDesc" rows="3" placeholder="Contá los detalles: medidas, materiales, qué incluye…"></textarea>`)}
      <div class="row gap">
        ${UI.field('Barrio', `<select id="tBarrio">${barrios.map(b => `<option>${b}</option>`).join('')}</select>`)}
      </div>
      ${typeof OppiConfig !== 'undefined' && OppiConfig.FEATURE_MAP ? `
      <div>
        <button type="button" class="btn btn-outline btn-block" id="tLocBtn">📍 Usar mi ubicación</button>
        <p class="small muted center" id="tLocNote" hidden>📍 Ubicación guardada: tu tarea aparece en el mapa de chambas.</p>
      </div>` : ''}
      <div class="row gap">
        ${UI.field('Presupuesto mín. (Gs.)', `<input id="tMin" type="number" min="0" placeholder="80000">`)}
        ${UI.field('Presupuesto máx. (Gs.)', `<input id="tMax" type="number" min="0" placeholder="150000">`)}
      </div>
      <label class="card check-card urgent-toggle">
        <input type="checkbox" id="tUrgent">
        <span><strong>⚡ Lo necesito hoy</strong><br><span class="small muted">Tu tarea sube primero y sugiere un precio mayor.</span></span>
      </label>
      ${UI.field('Fotos (opcional)', `<input id="tPhotos" type="file" accept="image/*" multiple>`, 'Mostrá el problema: cotizan mejor con fotos.')}
      <div class="photo-preview" id="photoPreview"></div>
      <button class="btn btn-primary btn-block" type="submit">Publicar tarea</button>
    </form>`);

    const photos = [];
    // Ubicación opcional para el mapa de chambas: se guarda lat/lng con la
    // tarea. Si no hay ubicación (o el mapa está en pausa), se publica
    // igual que antes (sin coords).
    let taskLoc = null;
    const locBtn = document.getElementById('tLocBtn');
    const locNote = document.getElementById('tLocNote');
    if (locBtn) locBtn.addEventListener('click', () => {
      if (!navigator.geolocation) { UI.toast('Tu navegador no soporta geolocalización', 'error'); return; }
      UI.toast('Buscando tu ubicación…');
      navigator.geolocation.getCurrentPosition(
        pos => {
          taskLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (locNote) locNote.hidden = false;
          locBtn.textContent = '📍 Ubicación lista · tocar para actualizar';
          UI.toast('Ubicación guardada 📍');
        },
        () => UI.toast('No pudimos obtener tu ubicación: revisá los permisos del navegador. Se publica sin mapa igual.', 'error'),
        { timeout: 10000, maximumAge: 60000 }
      );
    });
    document.getElementById('tPhotos').addEventListener('change', e => {
      photos.length = 0;
      const prev = document.getElementById('photoPreview');
      prev.innerHTML = '';
      Array.from(e.target.files).slice(0, 4).forEach(f => {
        const rd = new FileReader();
        rd.onload = () => {
          photos.push(rd.result);
          const img = document.createElement('img');
          img.src = rd.result; img.alt = 'Foto de la tarea';
          prev.appendChild(img);
        };
        rd.readAsDataURL(f);
      });
    });

    document.getElementById('publishForm').addEventListener('submit', async e => {
      e.preventDefault();
      const r = await OppiAPI.createTask({
        title: document.getElementById('tTitle').value,
        category: document.getElementById('tCat').value,
        description: document.getElementById('tDesc').value,
        barrio: document.getElementById('tBarrio').value,
        budgetMin: document.getElementById('tMin').value,
        budgetMax: document.getElementById('tMax').value,
        urgent: document.getElementById('tUrgent').checked,
        photos,
        lat: taskLoc ? taskLoc.lat : null,
        lng: taskLoc ? taskLoc.lng : null,
      });
      if (!r.ok) { UI.toast(r.error, 'error'); return; }
      UI.toast('¡Tarea publicada! 🎉');
      Router.go('#/handyman/tarea/' + r.task.id);
    });
  },

  /* --------------------------- DETALLE DE TAREA ------------------------ */
  async taskDetail(params) {
    const t = await OppiAPI.getTask(params.id);
    if (!t) { Router.go('#/handyman'); return; }
    const cat = OppiAPI.getTaskCategories().find(c => c.id === t.category);
    const mine = t.createdBy === 'me';

    setView(`
    <a class="back-link" href="#/handyman">← Tareas</a>
    <div class="card">
      <div class="row between"><h1 class="task-title">${UI.esc(t.title)}</h1>${t.urgent ? UI.urgentBadge() : ''}</div>
      <p class="muted small">${cat ? cat.icon + ' ' + cat.name : ''} · 📍 ${UI.esc(t.barrio)} · ${UI.esc(t.createdAt)}</p>
      <p>${UI.esc(t.description)}</p>
      ${t.photos && t.photos.length ? `<div class="photo-preview">${t.photos.map(p => `<img src="${p}" alt="Foto de la tarea">`).join('')}</div>` : ''}
      <p><strong>💰 Presupuesto:</strong> ${t.budgetMin ? fmtGs(t.budgetMin) + ' – ' + fmtGs(t.budgetMax) : 'A convenir'}</p>
      ${UI.statusBadge(t.status)}
    </div>

    <h2 class="sec-title">Ofertas (${t.offers.length})</h2>
    <div class="stack">
      ${t.offers.map(o => `
        <div class="card">
          <div class="row between">
            <div class="row gap">${UI.avatar(o.handymanName.split(' ').map(w => w[0]).join('').slice(0, 2), '#F59E0B', 40)}
            <div><strong>${UI.esc(o.handymanName)}</strong>${o.rating ? `<div class="small">${UI.stars(o.rating)} · ${o.jobs} trabajos</div>` : ''}</div></div>
            <strong>${fmtGs(o.amount)}</strong>
          </div>
          ${o.message ? `<p class="small">${UI.esc(o.message)}</p>` : ''}
          ${o.status === 'pending' && mine && t.status === 'open' ? `
            <div class="row gap">
              <button class="btn btn-primary btn-sm" data-accept="${o.id}">Aceptar</button>
              <button class="btn btn-ghost btn-sm" data-reject="${o.id}">Rechazar</button>
            </div>` : UI.statusBadge(o.status)}
        </div>`).join('') || '<p class="muted">Todavía no hay ofertas. ¡Sé el primero! 👇</p>'}
    </div>

    ${!mine && t.status === 'open' ? `
    <div class="card">
      <h3>Hacé tu oferta 💰</h3>
      <form id="offerForm" class="stack">
        ${UI.field('Tu precio (Gs.) *', `<input id="oAmount" type="number" min="1" required placeholder="120000">`)}
        ${UI.field('Mensaje', `<textarea id="oMsg" rows="2" placeholder="Contá cuándo podés ir y qué incluye…"></textarea>`)}
        <button class="btn btn-primary btn-block" type="submit">Enviar oferta</button>
      </form>
    </div>` : ''}
    `);

    document.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => {
      confirmModal({
        title: '¿Aceptar esta oferta?',
        text: `Pagás el 100% (${fmtGs(t.offers.find(o => o.id === b.dataset.accept).amount)}) como pago simulado y el trabajo pasa a "en curso".`,
        okLabel: 'Aceptar oferta',
        onOk: async () => {
          const r = await OppiAPI.acceptOffer({ taskId: t.id, offerId: b.dataset.accept });
          if (!r.ok) { UI.toast(r.error, 'error'); return; }
          UI.toast('¡Oferta aceptada! 🤝');
          Router.go('#/handyman/trabajo/' + r.job.id);
        },
      });
    }));
    document.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => {
      const rr = await OppiAPI.rejectOffer({ taskId: t.id, offerId: b.dataset.reject });
      if (!rr.ok) { UI.toast(rr.error, 'error'); return; }
      UI.toast('Oferta rechazada');
      ViewsHandyman.taskDetail(params);
    }));
    const form = document.getElementById('offerForm');
    if (form) form.addEventListener('submit', async e => {
      e.preventDefault();
      const r = await OppiAPI.makeOffer({
        taskId: t.id,
        amount: document.getElementById('oAmount').value,
        message: document.getElementById('oMsg').value,
      });
      if (!r.ok) { UI.toast(r.error, 'error'); return; }
      UI.toast('¡Oferta enviada! 💰');
      ViewsHandyman.taskDetail(params);
    });
  },
};

/* ------------------------------ MIS TRABAJOS --------------------------- */
ViewsHandyman.myJobs = async function () {
  const jobs = await OppiAPI.getJobs();
  const asClient = jobs.filter(j => j.clientId === 'me');
  const asHandyman = jobs.filter(j => j.handymanId === 'me');

  const jobCard = j => `
    <a class="card" href="#/handyman/trabajo/${j.id}">
      <div class="row between"><strong>${UI.esc(j.title)}</strong>${UI.statusBadge(j.status)}</div>
      <div class="muted small">${j.handymanId === 'me' ? 'Cliente: ' + UI.esc(j.clientName) : 'Handyman: ' + UI.esc(j.handymanName)} · 📍 ${UI.esc(j.barrio)}</div>
      <div class="small">${j.agreedPrice ? 'Precio acordado: <strong>' + fmtGs(j.agreedPrice) + '</strong>' : 'Esperando cotización…'}</div>
    </a>`;

  setView(`
  <h1 class="page-title">Mis trabajos 🔨</h1>
  <h2 class="sec-title">Como cliente</h2>
  <div class="stack">${asClient.length ? asClient.map(jobCard).join('') : '<p class="muted small">Todavía no aceptaste ninguna oferta.</p>'}</div>
  <h2 class="sec-title">Como handyman</h2>
  <div class="stack">${asHandyman.length ? asHandyman.map(jobCard).join('') : '<p class="muted small">Todavía no tenés trabajos asignados.</p>'}</div>
  <a class="btn btn-primary btn-block" href="#/handyman">Explorar tareas</a>`);
};

/* --------------------------- DETALLE DE TRABAJO ------------------------ */
/* Roles: el cliente adjunta fotos y acepta/rechaza; el handyman cotiza. */
ViewsHandyman.jobDetail = async function (params) {
  const j = await OppiAPI.getJob(params.id);
  if (!j) { Router.go('#/handyman'); return; }
  const iAmClient = j.clientId === 'me';
  const iAmHandyman = j.handymanId === 'me';

  const quotesHtml = j.quotes.map(q => `
    <div class="card quote-card">
      <div class="row between"><strong>💰 Cotización: ${fmtGs(q.amount)}</strong>${UI.statusBadge(q.status)}</div>
      ${q.detail ? `<p class="small">${UI.esc(q.detail)}</p>` : ''}
      ${q.status === 'pending' && iAmClient ? `
        <div class="row gap">
          <button class="btn btn-primary btn-sm" data-qaccept="${q.id}">Aceptar</button>
          <button class="btn btn-ghost btn-sm" data-qreject="${q.id}">Rechazar</button>
        </div>` : ''}
      ${q.status === 'pending' && iAmHandyman ? `<p class="small muted">Esperando la respuesta del cliente…</p>` : ''}
    </div>`).join('');

  setView(`
  <a class="back-link" href="#/handyman/trabajos">← Mis trabajos</a>
  <div class="card">
    <div class="row between"><h1 class="task-title">${UI.esc(j.title)}</h1>${UI.statusBadge(j.status)}</div>
    <p class="muted small">${iAmClient ? 'Handyman: ' + UI.esc(j.handymanName) : 'Cliente: ' + UI.esc(j.clientName)} · 📍 ${UI.esc(j.barrio)}</p>
    <p class="small">${UI.esc(j.description)}</p>
    ${j.agreedPrice ? `<p><strong>Precio acordado:</strong> ${fmtGs(j.agreedPrice)} <span class="muted small">(pagado: ${fmtGs(j.paid)})</span></p>` : ''}
  </div>

  ${quotesHtml ? `<h2 class="sec-title">Cotizaciones</h2><div class="stack">${quotesHtml}</div>` : ''}

  ${iAmHandyman && (j.status === 'quoting' || j.status === 'in_progress') ? `
  <div class="card">
    <h3>Enviar cotización</h3>
    <form id="quoteForm" class="stack">
      ${UI.field('Monto cerrado (Gs.) *', `<input id="qAmount" type="number" min="1" required placeholder="150000">`)}
      ${UI.field('Detalle', `<textarea id="qDetail" rows="2" placeholder="Qué incluye el precio…"></textarea>`)}
      <button class="btn btn-primary btn-block" type="submit">Enviar cotización</button>
    </form>
  </div>` : ''}

  <h2 class="sec-title">Coordinación 💬</h2>
  ${j.photos && j.photos.length ? `<div class="photo-preview">${j.photos.map(p => `<img src="${p}" alt="Foto del trabajo">`).join('')}</div>` : ''}
  <div class="chat-messages" id="jobMsgs">
    ${j.messages.map(m => `
      <div class="msg ${m.from === 'me' ? 'mine' : 'theirs'}">
        ${m.photo ? `<img src="${m.photo}" class="msg-photo" alt="Foto adjunta">` : ''}
        ${m.text ? UI.esc(m.text) : ''}
        <span class="msg-time">${UI.esc(m.time)}</span>
      </div>`).join('')}
  </div>
  <form class="chat-input" id="jobForm">
    <label class="icon-btn" title="Adjuntar foto">📷<input type="file" id="jobPhoto" accept="image/*" hidden></label>
    <input id="jobText" placeholder="Escribí…" autocomplete="off" aria-label="Mensaje">
    <button class="btn btn-primary" type="submit">➤</button>
  </form>

  ${iAmClient && j.status === 'in_progress' ? `
  <div class="card">
    <h3>¿Terminó el trabajo?</h3>
    <p class="small muted">Ya pagaste el 100% al aceptar. Al completar cerramos el trabajo.</p>
    <form id="completeForm" class="stack">
      ${UI.field('Tu calificación', `<select id="cRating"><option value="5">★★★★★ — Excelente</option><option value="4">★★★★ — Muy bueno</option><option value="3">★★★ — Bien</option><option value="2">★★ — Regular</option><option value="1">★ — Malo</option></select>`)}
      ${UI.field('Reseña', `<textarea id="cReview" rows="2" placeholder="Contá cómo te fue…"></textarea>`)}
      ${UI.field('Agregar fotos (máx. 3, opcional)', `<input id="cPhotos" type="file" accept="image/*" multiple>`, 'Mostrá el resultado: ayuda a otros a elegir.')}
      <div class="photo-preview" id="cPhotoPrev"></div>
      <button class="btn btn-primary btn-block" type="submit">Completar trabajo · pago simulado</button>
    </form>
  </div>` : ''}

  ${j.status === 'completed' ? `
  <div class="card ok-card">
    <h3>✅ Trabajo completado</h3>
    <p>Pagado total: <strong>${fmtGs(j.agreedPrice)}</strong></p>
    ${j.myRating ? `<p>Tu reseña: ${UI.stars(j.myRating)}</p><p class="small">${UI.esc(j.myReview || '')}</p>` : ''}
    ${(j.myReviewPhotos || []).length ? `<div class="photo-preview">${j.myReviewPhotos.map(p => `<img src="${UI.esc(p)}" alt="Foto de tu reseña">`).join('')}</div>` : ''}
  </div>` : ''}`);

  const scroll = () => { const el = document.getElementById('jobMsgs'); if (el) el.scrollTop = el.scrollHeight; };
  scroll();

  let pendingPhoto = null;
  const photoInput = document.getElementById('jobPhoto');
  if (photoInput) photoInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { pendingPhoto = rd.result; UI.toast('📷 Foto lista para enviar'); };
    rd.readAsDataURL(f);
  });

  document.getElementById('jobForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = document.getElementById('jobText').value.trim();
    if (!text && !pendingPhoto) return;
    const sr = await OppiAPI.sendJobMessage({ jobId: j.id, text, photoDataUrl: pendingPhoto });
    if (!sr.ok) { UI.toast(sr.error, 'error'); return; }
    pendingPhoto = null;
    ViewsHandyman.jobDetail(params);
  });

  document.querySelectorAll('[data-qaccept],[data-qreject]').forEach(b => b.addEventListener('click', async () => {
    const accept = b.hasAttribute('data-qaccept');
    const qid = b.dataset.qaccept || b.dataset.qreject;
    if (accept) {
      confirmModal({
        title: '¿Aceptar cotización?',
        text: `Pagás el 100% (${fmtGs(j.quotes.find(q => q.id === qid).amount)}) como pago simulado y el trabajo pasa a "en curso".`,
        okLabel: 'Aceptar',
        onOk: async () => {
          const r = await OppiAPI.respondQuote({ jobId: j.id, quoteId: qid, accept: true });
          if (!r.ok) { UI.toast(r.error, 'error'); return; }
          UI.toast('¡Cotización aceptada! 🤝');
          ViewsHandyman.jobDetail(params);
        },
      });
    } else {
      const rj = await OppiAPI.respondQuote({ jobId: j.id, quoteId: qid, accept: false });
      if (!rj.ok) { UI.toast(rj.error, 'error'); return; }
      UI.toast('Cotización rechazada');
      ViewsHandyman.jobDetail(params);
    }
  }));

  const qf = document.getElementById('quoteForm');
  if (qf) qf.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await OppiAPI.sendQuote({
      jobId: j.id,
      amount: document.getElementById('qAmount').value,
      detail: document.getElementById('qDetail').value,
    });
    if (!r.ok) { UI.toast(r.error, 'error'); return; }
    UI.toast('Cotización enviada 💰');
    ViewsHandyman.jobDetail(params);
  });

  const cf = document.getElementById('completeForm');
  if (cf) {
    // Fotos de la reseña (máx 3): preview local; al confirmar se suben a
    // /api/uploads y la reseña guarda solo las URLs.
    const photoInput = document.getElementById('cPhotos');
    const photoPrev = document.getElementById('cPhotoPrev');
    let reviewDataUrls = [];
    if (photoInput) photoInput.addEventListener('change', () => {
      reviewDataUrls = [];
      photoPrev.innerHTML = '';
      Array.from(photoInput.files || []).slice(0, 3).forEach(f => {
        const rd = new FileReader();
        rd.onload = () => {
          reviewDataUrls.push(rd.result);
          const img = document.createElement('img');
          img.src = rd.result; img.alt = 'Foto de tu reseña';
          photoPrev.appendChild(img);
        };
        rd.readAsDataURL(f);
      });
    });
    cf.addEventListener('submit', e => {
      e.preventDefault();
      const rating = document.getElementById('cRating').value;
      const review = document.getElementById('cReview').value;
      confirmModal({
        title: '¿Completar el trabajo?',
        text: `Cerramos el trabajo. Ya pagaste el 100% (${fmtGs(j.agreedPrice)}) al aceptar.`,
        okLabel: 'Completar trabajo',
        onOk: async () => {
          const urls = [];
          for (const du of reviewDataUrls.slice(0, 3)) {
            const up = await OppiAPI.uploadPhoto({ dataUrl: du, filename: 'resena.jpg' });
            if (!up.ok) { UI.toast(up.error || 'No se pudieron subir las fotos', 'error'); return; }
            urls.push(up.url);
          }
          const r = await OppiAPI.completeJob({ jobId: j.id, rating, review, photos: urls });
          if (!r.ok) { UI.toast(r.error, 'error'); return; }
          UI.toast('¡Pago liberado! Gracias por usar Oppi 💜');
          ViewsHandyman.jobDetail(params);
        },
      });
    });
  }
};

/* --------------------------- PANEL HANDYMAN ---------------------------- */
ViewsHandyman.panel = async function () {
  const jobs = (await OppiAPI.getJobs()).filter(j => j.handymanId === 'me');
  const active = jobs.filter(j => j.status !== 'completed');
  const done = jobs.filter(j => j.status === 'completed');
  const earned = done.reduce((a, j) => a + (j.agreedPrice || 0), 0);

  setView(`
  <h1 class="page-title">Modo handyman 🔨</h1>
  <div class="stats-row">
    <div class="card stat"><strong>${fmtGs(earned)}</strong><span class="muted small">Ganado</span></div>
    <div class="card stat"><strong>${active.length}</strong><span class="muted small">Activos</span></div>
    <div class="card stat"><strong>${done.length}</strong><span class="muted small">Completados</span></div>
  </div>
  <a class="btn btn-outline btn-block" href="#/handyman/ganancias">💰 Ver ganancias</a>
  <div class="row gap">
    <a class="btn btn-outline grow" href="#/panel/estadisticas">📊 Estadísticas</a>
    <a class="btn btn-outline grow" href="#/panel/clientes">👥 Clientes</a>
  </div>
  <label class="card check-card"><input type="checkbox" id="availToggle" checked> <span><strong>Disponible para urgencias ⚡</strong><br><span class="small muted">Te avisamos primero de las tareas urgentes cerca tuyo.</span></span></label>
  <h2 class="sec-title">Alertas por rubro</h2>
  <div class="chips" id="alertChips">
    ${OppiAPI.getTaskCategories().map(c => `<button class="chip" data-alert="${c.id}">${c.icon} ${c.name}</button>`).join('')}
  </div>
  <h2 class="sec-title">Mis trabajos</h2>
  <div class="stack">
    ${jobs.length ? jobs.map(j => `<a class="card" href="#/handyman/trabajo/${j.id}"><div class="row between"><strong>${UI.esc(j.title)}</strong>${UI.statusBadge(j.status)}</div><div class="small muted">${j.agreedPrice ? fmtGs(j.agreedPrice) : 'Sin precio acordado'}</div></a>`).join('')
      : UI.empty('🔨', 'Sin trabajos todavía', 'Explorá tareas y hacé tu primera oferta.', '<a class="btn btn-primary" href="#/handyman">Explorar tareas</a>')}
  </div>`);

  document.getElementById('availToggle').addEventListener('change', e => {
    UI.toast(e.target.checked ? 'Disponible para urgencias ⚡' : 'Pausaste las alertas');
  });
  document.getElementById('alertChips').addEventListener('click', e => {
    const b = e.target.closest('[data-alert]');
    if (!b) return;
    b.classList.toggle('active');
    UI.toast(b.classList.contains('active') ? 'Alerta activada 🔔' : 'Alerta desactivada');
  });
};

/* ------------------------ GANANCIAS DEL PROFESIONAL -------------------- */
/* GET /api/pro/earnings?periodo=semana|mes — mismo diseño que la vista de
   empresas: toggle Semana/Mes, tarjetas y barras CSS por rubro. */
ViewsHandyman.earnings = async function (query) {
  const periodo = (query && query.periodo === 'mes') ? 'mes' : 'semana';
  const e = await OppiAPI.getProEarnings(periodo);

  const perLink = p => `#/handyman/ganancias?periodo=${p}`;
  setView(`
  <a class="back-link" href="#/handyman/panel">← Modo handyman</a>
  <h1 class="page-title">Ganancias 💰</h1>
  <div class="segmented" role="tablist" aria-label="Período">
    <a class="seg ${periodo === 'semana' ? 'active' : ''}" href="${perLink('semana')}">Semana</a>
    <a class="seg ${periodo === 'mes' ? 'active' : ''}" href="${perLink('mes')}">Mes</a>
  </div>` + (e.ok === false ? `
  <div class="card warn-card"><strong>😕 No pudimos cargar tus ganancias</strong><p class="small muted">${UI.esc(e.error || 'Probá de nuevo en un rato.')}</p></div>`
    : e.reservas_count === 0 ? `
  <div class="card">${UI.empty('💰', 'Todavía no tenés trabajos completados', 'Cuando completes trabajos, acá vas a ver tus ganancias, la comisión de Oppi y el desglose por rubro.')}</div>`
    : `
  <div class="stats-row">
    <div class="card stat"><strong>${fmtGs(e.ingresos_brutos)}</strong><span class="muted small">Ingresos brutos</span></div>
    <div class="card stat"><strong>${fmtGs(e.comision)}</strong><span class="muted small">Comisión Oppi (15%)</span></div>
    <div class="card stat highlight-stat"><strong>${fmtGs(e.neto)}</strong><span class="muted small">Neto para vos</span></div>
  </div>
  <div class="stats-row">
    <div class="card stat"><strong>${e.reservas_count}</strong><span class="muted small">Trabajos</span></div>
    <div class="card stat"><strong>${fmtGs(e.ticket_promedio)}</strong><span class="muted small">Ticket promedio</span></div>
  </div>

  <h2 class="sec-title">Por rubro</h2>
  <div class="card">
    <div class="earn-bars">
      ${e.por_servicio.slice().sort((a, x) => x.ingresos - a.ingresos).map(s => {
        const pct = e.ingresos_brutos ? Math.round(s.ingresos / e.ingresos_brutos * 100) : 0;
        return `<div class="earn-bar-row">
          <div class="earn-bar-head"><span><strong>${UI.esc(s.nombre)}</strong> <span class="muted small">· ${s.reservas} trabajo${s.reservas === 1 ? '' : 's'}</span></span><strong>${fmtGs(s.ingresos)}</strong></div>
          <div class="earn-bar-track"><div class="earn-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
      }).join('')}
    </div>
    <p class="small muted">Solo cuentan los trabajos completados. La comisión del 15% ya está descontada del neto.</p>
  </div>`));
};
