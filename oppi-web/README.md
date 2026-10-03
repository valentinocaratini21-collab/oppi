# Oppi — Web completa

La website completa de **Oppi**, la plataforma paraguaya de reserva de servicios profesionales (lanzamiento enero 2027).

Sitio estático **sin build step**: HTML + CSS + JS vanilla. Se puede deployar en cualquier hosting estático (Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3…).

## Estructura

```
oppi-web/
├── index.html              # Shell de la SPA (header, vista, bottom nav)
├── css/
│   └── styles.css          # Sistema visual completo
├── js/
│   ├── data.js             # Datos semilla del mock (profesionales, tareas, etc.)
│   ├── api.js              # ⭐ Capa de datos: TODA la app habla con el backend por acá
│   ├── router.js           # Router por hash
│   ├── ui.js               # Componentes compartidos (tarjetas, modal, toast…)
│   ├── views-public.js     # Home, buscar, perfil profesional, reserva en 3 pasos
│   ├── views-client.js     # Reservas, favoritos, chat, perfil, notificaciones
│   ├── views-handyman.js   # Marketplace handyman (tareas, ofertas, trabajos)
│   ├── views-business.js   # Oppi Empresas (alta, panel, agenda, servicios…)
│   ├── views-auth.js       # Login / registro
│   ├── views-map.js        # Mapa de profesionales (Leaflet por CDN)
│   └── app.js              # Chrome de la app + registro de rutas + arranque
└── README.md
```

## Deploy

No hay compilación. Subí la carpeta tal cual:

**Netlify** — Arrastrá la carpeta a [app.netlify.com/drop](https://app.netlify.com/drop), o:
```bash
npx netlify-cli deploy --dir=. --prod
```

**Vercel**
```bash
npx vercel --prod
```

**Cualquier hosting estático** — Copiá los archivos a la raíz pública. Listo.

> La SPA usa hash routing (`#/...`), así que no necesita rewrites del servidor.

## Mapa

La vista `#/mapa` usa [Leaflet](https://leafletjs.com) por CDN (CSS+JS desde
`unpkg.com`, sin API key, tiles de OpenStreetMap). Los tags CDN **no se
inlinéan** en el build de un solo archivo: quedan como están en `index.html`.
Busca con `OppiAPI.search({ q, rubro, lat, lng, radio_km })` (distancia
haversiana en el mock; `GET /api/search` en el backend real), con filtros de
radio 1/5/10/25 km y botón "Usar mi ubicación" (geolocalización del navegador;
si se deniega, centra en Asunción -25.2635,-57.5759).

## Cómo funciona hoy (mock)

`js/api.js` expone `OppiAPI` con un `MockAdapter` que:
- Carga los datos semilla de `js/data.js` en el primer uso.
- Persiste el estado en `localStorage` (`oppi_web_state_v1`).
- **Simula los pagos**: `payDeposit()` siempre aprueba. Es el único lugar a reemplazar.

Ninguna vista toca `localStorage` ni `fetch` directamente.

## Cómo conectar el backend real

1. En `js/api.js`, implementá `RestAdapter` con **los mismos métodos** de `MockAdapter`
   (están todos documentados con `INTEGRATION POINT` en el código):
   - Catálogo: `searchProfessionals`, `getProfessional`, `getDaySlots`
   - Reservas: `createBooking`, `getBookings`, `cancelBooking`, `joinWaitlist`
   - Handyman: `getTasks`, `createTask`, `makeOffer`, `acceptOffer`, `sendQuote`, `respondQuote`, `completeJob`, …
   - Cuenta: `login`, `register`, `redeemReferral`, notificaciones, chat
   - Empresas: `createBusiness`, `updateBusinessService`, `respondBusinessBooking`, …
2. Cambiá `const ADAPTER = MockAdapter` por `RestAdapter`.
3. Pagos reales: reemplazá `payDeposit()` por la pasarela (Bancard / Stripe / MercadoPago).
   La app solo continúa si devuelve `{ ok: true }` — el flujo no cambia.
4. Auth real: `login()`/`register()` devuelven `{ user }`; guardá el token donde prefieras
   (el adaptador es el único que necesita conocerlo).
5. Borrá `js/data.js` cuando el catálogo venga de la API (o dejalo como fallback offline).

## Flujos incluidos

- **Cliente**: home → buscar con filtros → perfil (servicios, seña, calendario, reseñas) →
  reserva en 3 pasos con pago simulado de seña → mis reservas, favoritos, chat, lista de espera.
- **Handyman**: explorar tareas (filtro urgentes) → publicar (toggle "Lo necesito hoy") →
  ofertas → aceptar/rechazar → chat con fotos y cotización (roles separados) →
  completar + pago simulado + reseña mutua. Panel con ganancias y alertas.
- **Oppi Empresas**: alta progresiva en 3 pasos (badge "En verificación", documentos
  pendientes) → pantalla "Cómo ganamos" (15%) → dashboard, agenda, reservas
  (aceptar/rechazar), servicios con seña configurable validada, equipo,
  respuestas a reseñas, documentos.
- **Cuenta**: login/registro mock, editar perfil (nombre, teléfono, barrio,
  foto por URL o subida — `PATCH /api/me` en el backend), referidos
  (`OPPI-AMIGO` = Gs. 20.000), centro de notificaciones.
- **Mapa**: `#/mapa` con pins de profesionales, filtros de radio y
  geolocalización.
- **Oppi Empresas**: panel de **Ganancias** (`#/empresas/ganancias`,
  `GET /api/business/earnings?periodo=semana|mes`, comisión 15%) con toggle
  Semana/Mes y desglose por servicio.
- **Reservas**: reprogramar (selector día/hora reutilizado, la seña se
  mantiene), cancelar con vista previa del desglose exacto
  (`POST /api/bookings/:id/cancel-preview` → confirmar con
  `POST /api/bookings/:id/cancel`), no-show
  (`POST /api/bookings/:id/no-show`: "El cliente no vino" / "El profesional
  no vino", con la consecuencia económica explicada antes de confirmar) y
  "Voy en camino 🛵" (solo el día del turno; el cliente ve el banner en su
  reserva).
- **Oppi Empresas**: sección **Cupones** (`#/empresas/cupones`:
  `GET/POST /api/businesses/:id/coupons`, `PATCH /api/coupons/:id`) y campo
  "¿Tenés un cupón?" en el checkout (`POST /api/coupons/validate`), con el
  descuento y el total recalculado antes de pagar; la seña se calcula sobre
  el total con descuento. **Configuración** (`#/empresas/configuracion`):
  "Cancelación gratis hasta (horas)", default 24.
- **Handyman**: vista **Ganancias** (`#/handyman/ganancias`,
  `GET /api/pro/earnings?periodo=semana|mes`, mismo diseño que empresas).
- **Mi perfil → Mis pagos** (`#/mis-pagos`, `GET /api/me/payments`): estados
  Retenido/Cobrado/Reembolsado/Liberado/Crédito y comprobante por pago.
- **Reseñas con fotos**: el formulario de reseña permite hasta 3 fotos
  (se suben a `POST /api/uploads`, `POST /api/reviews` acepta `photos[]`);
  los perfiles muestran las fotos.

## Diseño

Fondo `#F7F7FA`, primario `#6B5BD0`, tarjetas blancas muy redondeadas, español
rioplatense con voseo, mobile-first (columna de 520px centrada en desktop).
