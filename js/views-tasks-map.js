/* ============================================================================
 * Oppi — Vista Mapa de chambas (handyman): tareas cercanas con Leaflet
 * (CDN, sin API key). Replica el patrón de views-map.js: mismos controles
 * (radios 1/5/10/25 km + "Usar mi ubicación"), mismo fallback sin Leaflet.
 * Pins: ⚡ destacado para urgentes, violeta #6B5BD0 para el resto.
 * ========================================================================== */
'use strict';

const ViewsTasksMap = {
  state: { lat: ASUNCION.lat, lng: ASUNCION.lng, radio: 5, located: false },
  _map: null,

  /* Tabs compartidos con el explorar de handyman: 1 toque entre lista/mapa. */
  tabsHtml(active) {
    return `<div class="segmented" role="tablist" aria-label="Vista de tareas">
      <a class="seg ${active === 'list' ? 'active' : ''}" href="#/handyman">🔨 Lista</a>
      <a class="seg ${active === 'map' ? 'active' : ''}" href="#/chambas-mapa">🗺️ Mapa</a>
    </div>`;
  },

  async index() {
    const st = this.state;
    setView(`
    <h1 class="page-title">Chambas cerca 🗺️</h1>
    ${this.tabsHtml('map')}
    <div class="map-controls">
      <div class="chips" id="taskMapRadios" role="group" aria-label="Radio de búsqueda">
        ${MAP_RADIOS.map(r => `<button class="chip ${r === st.radio ? 'active' : ''}" data-radio="${r}">${r} km</button>`).join('')}
      </div>
      <button class="btn btn-outline btn-sm" id="taskLocateBtn">📍 Usar mi ubicación</button>
    </div>
    <div id="mapDiv" class="map-box" role="img" aria-label="Mapa de chambas cercanas"></div>
    <p class="muted small center" id="taskMapNote"></p>
    <h2 class="sec-title">Chambas cerca tuyo</h2>
    <div class="stack" id="tasksMapResults"><p class="muted">Buscando chambas…</p></div>`);

    document.querySelectorAll('#taskMapRadios [data-radio]').forEach(b => b.addEventListener('click', () => {
      this.state.radio = Number(b.dataset.radio);
      document.querySelectorAll('#taskMapRadios .chip').forEach(x => x.classList.toggle('active', x === b));
      this._load();
    }));
    document.getElementById('taskLocateBtn').addEventListener('click', () => this._locate());
    await this._load();
  },

  _catName(id) {
    const c = (this._cats || (this._cats = OppiAPI.getTaskCategories())).find(x => x.id === id);
    return c ? `${c.icon} ${c.name}` : '';
  },

  _price(t) {
    return t.budgetMin ? `${fmtGs(t.budgetMin)} – ${fmtGs(t.budgetMax)}` : 'A convenir';
  },

  _dist(t) {
    return t.distance_km != null ? `a ${fmtKm(t.distance_km)} km` : 'distancia n/d';
  },

  /* Carga tareas (api.getTasks con lat/lng/radio_km) y dibuja lista + mapa. */
  async _load() {
    const { lat, lng, radio } = this.state;
    let tasks = [];
    try {
      tasks = await OppiAPI.getTasks({ lat, lng, radio_km: radio });
    } catch (e) { tasks = []; }

    document.getElementById('tasksMapResults').innerHTML = tasks.length ? tasks.map(t => `
      <a class="card task-card" href="#/handyman/tarea/${t.id}">
        <div class="row between"><strong>${UI.esc(t.title)}</strong>${t.urgent ? UI.urgentBadge() : ''}</div>
        <div class="muted small">${UI.esc(this._catName(t.category))} · 📍 ${UI.esc(t.barrio)} · 💰 ${this._price(t)}</div>
        <div class="row between small"><span>💬 ${t.offersCount} oferta${t.offersCount === 1 ? '' : 's'}</span><span class="dist-pill" title="Distancia">${this._dist(t)}</span></div>
      </a>`).join('')
      : UI.empty('🗺️', 'No hay chambas por acá (todavía)', 'Probá ampliando el radio de búsqueda con los botones de arriba.');
    this._drawMap(tasks);
  },

  _pinIcon(t) {
    return L.divIcon({
      className: 'task-pin-wrap',
      html: `<div class="task-pin${t.urgent ? ' urgent' : ''}">${t.urgent ? '⚡' : '🔨'}</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -38],
    });
  },

  /* Tarjeta resumen del pin: título, rubro, precio, distancia, badge y
     botón [Ver detalle] al detalle de la tarea. */
  _popupHtml(t) {
    return `<div class="task-pop">
      <div class="task-pop-title">${UI.esc(t.title)}</div>
      <div class="task-pop-meta">${UI.esc(this._catName(t.category))} · 💰 ${this._price(t)}</div>
      <div class="task-pop-meta">📍 ${this._dist(t)} ${t.urgent ? UI.urgentBadge() : ''}</div>
      <a class="btn btn-primary btn-sm task-pop-btn" href="#/handyman/tarea/${t.id}">Ver detalle →</a>
    </div>`;
  },

  _drawMap(tasks) {
    const el = document.getElementById('mapDiv');
    const note = document.getElementById('taskMapNote');
    if (!el) return;
    if (typeof L === 'undefined') {
      el.innerHTML = '<div class="map-fallback">🗺️ El mapa no se pudo cargar (revisá tu conexión). La lista de chambas funciona igual.</div>';
      if (note) note.textContent = '';
      return;
    }
    if (this._map) { try { this._map.remove(); } catch (e) {} this._map = null; }
    const { lat, lng } = this.state;
    const map = L.map('mapDiv').setView([lat, lng], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    if (this.state.located) {
      L.circleMarker([lat, lng], { radius: 8, color: '#6B5BD0', fillColor: '#6B5BD0', fillOpacity: 0.9 })
        .addTo(map).bindPopup('<strong>📍 Vos estás acá</strong>');
    }
    tasks.forEach(t => {
      if (t.lat == null || t.lng == null) return;
      L.marker([t.lat, t.lng], { icon: this._pinIcon(t) }).addTo(map).bindPopup(this._popupHtml(t));
    });
    this._map = map;
    if (note) note.textContent = this.state.located
      ? '📍 Usando tu ubicación'
      : '📍 Centro: Asunción · tocá "Usar mi ubicación" para buscar cerca tuyo';
  },

  /* Geolocalización del navegador. Si se deniega o falla: mensaje claro y
     se vuelve al centro de Asunción. */
  _locate() {
    if (!navigator.geolocation) {
      UI.toast('Tu navegador no soporta geolocalización', 'error');
      return;
    }
    UI.toast('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        this.state.lat = pos.coords.latitude;
        this.state.lng = pos.coords.longitude;
        this.state.located = true;
        UI.toast('Ubicación lista 📍');
        this._load();
      },
      () => {
        this.state.lat = ASUNCION.lat;
        this.state.lng = ASUNCION.lng;
        this.state.located = false;
        UI.toast('No pudimos obtener tu ubicación: revisá los permisos del navegador. Mostramos Asunción.', 'error');
        this._load();
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  },
};
