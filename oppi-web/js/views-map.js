/* ============================================================================
 * Oppi — Vista Mapa: profesionales cercanos con Leaflet (CDN, sin API key).
 * Los tags CDN de Leaflet viven en index.html y el build final de un solo
 * archivo los preserva (solo el CSS/JS local se inlinéa). Si Leaflet no
 * carga (sin conexión), la lista de resultados funciona igual.
 * ========================================================================== */
'use strict';

const ASUNCION = { lat: -25.2635, lng: -57.5759 };
const MAP_RADIOS = [1, 5, 10, 25];

function fmtKm(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return '–';
  return n.toFixed(1).replace('.', ',');
}

const ViewsMap = {
  state: { lat: ASUNCION.lat, lng: ASUNCION.lng, radio: 5, located: false },
  _map: null,

  async index() {
    const st = this.state;
    setView(`
    <h1 class="page-title">Mapa 🗺️</h1>
    <div class="map-controls">
      <div class="chips" id="mapRadios" role="group" aria-label="Radio de búsqueda">
        ${MAP_RADIOS.map(r => `<button class="chip ${r === st.radio ? 'active' : ''}" data-radio="${r}">${r} km</button>`).join('')}
      </div>
      <button class="btn btn-outline btn-sm" id="locateBtn">📍 Usar mi ubicación</button>
    </div>
    <div id="mapDiv" class="map-box" role="img" aria-label="Mapa de profesionales cercanos"></div>
    <p class="muted small center" id="mapNote"></p>
    <h2 class="sec-title">Cerca tuyo</h2>
    <div class="stack" id="mapResults"><p class="muted">Buscando profesionales…</p></div>`);

    document.querySelectorAll('#mapRadios [data-radio]').forEach(b => b.addEventListener('click', () => {
      this.state.radio = Number(b.dataset.radio);
      document.querySelectorAll('#mapRadios .chip').forEach(x => x.classList.toggle('active', x === b));
      this._load();
    }));
    document.getElementById('locateBtn').addEventListener('click', () => this._locate());
    await this._load();
  },

  /* Carga resultados (api.search con lat/lng/radio) y dibuja lista + mapa. */
  async _load() {
    const { lat, lng, radio } = this.state;
    let results = [];
    try {
      results = await OppiAPI.search({ lat, lng, radio_km: radio });
    } catch (e) { results = []; }

    document.getElementById('mapResults').innerHTML = results.length ? results.map(p => `
      <a class="card pro-card" href="#/pro/${p.id}">
        <div class="pro-card-top">
          ${UI.avatar(p.initials, p.color, 56)}
          <div class="pro-card-info">
            <div class="pro-card-name">${UI.esc(p.name)} ${p.verified ? '<span class="vcheck" title="Verificado">✓</span>' : ''}</div>
            <div class="muted small">${UI.esc(p.specialty)} · ${UI.esc(p.barrio)}</div>
            <div class="small">${UI.stars(p.rating, p.reviewsCount)}</div>
          </div>
          <span class="dist-pill" title="Distancia">a ${fmtKm(p.distance_km)} km</span>
        </div>
      </a>`).join('')
      : UI.empty('🗺️', 'Nada por acá (todavía)', 'Probá ampliando el radio de búsqueda con los botones de arriba.');
    this._drawMap(results);
  },

  _drawMap(results) {
    const el = document.getElementById('mapDiv');
    const note = document.getElementById('mapNote');
    if (!el) return;
    if (typeof L === 'undefined') {
      el.innerHTML = '<div class="map-fallback">🗺️ El mapa no se pudo cargar (revisá tu conexión). La lista de profesionales funciona igual.</div>';
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
    results.forEach(p => {
      if (p.lat == null || p.lng == null) return;
      L.marker([p.lat, p.lng]).addTo(map).bindPopup(
        `<strong>${UI.esc(p.name)}</strong><br>` +
        `<span>${UI.esc(p.specialty)} · a ${fmtKm(p.distance_km)} km</span><br>` +
        `<a href="#/pro/${p.id}">Ver perfil →</a>`);
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
