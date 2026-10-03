# Oppi — Plataforma completa

Plataforma paraguaya de reserva de servicios profesionales (lanzamiento enero 2027).
Código production-ready REAL: backend, web y mobile consumiendo la misma API.

Tres pilares: **profesionales** (reserva con precios visibles) · **handyman marketplace**
(publicás una tarea, te ofertan en guaraníes) · **Oppi Empresas** (negocios administran
reservas, servicios, equipo y reseñas).

Todo en español rioplatense con voseo, precios en Gs., barrios de Asunción.
Diseño: fondo `#F7F7FA`, primario `#6B5BD0`, tarjetas blancas redondeadas.

## Arquitectura

```
~/workspace/oppi/
├── README.md            # este archivo
├── oppi-api/            # FASE 1 — Backend: Node 24 + Express + SQLite/Postgres, auth JWT, REST /api
└── oppi-mobile/         # FASE 3 — App móvil: Expo React Native contra la misma API
~/workspace/oppi-web/    # FASE 2 — Web completa (SPA sin build step)
                         #   js/api.js trae HttpAdapter (backend real) + MockAdapter (fallback)
```

La web y la app móvil no se hablan entre sí: ambas son clientes de `oppi-api`.
La capa de datos de la web (`oppi-web/js/api.js`) y el cliente de mobile
(`oppi-mobile/src/api/client.js`) mapean al mismo contrato REST.

## Cómo correr todo (desarrollo)

```bash
# 1) Backend (terminal 1)
cd ~/workspace/oppi/oppi-api
npm install
npm run seed     # datos paraguayos de prueba
npm start        # http://localhost:3000

# 2) Web (terminal 2) — sin build step, cualquier servidor estático sirve
cd ~/workspace/oppi-web
npx serve . -l 8080        # o: python3 -m http.server 8080
# Abrí http://localhost:8080
#  · Con el backend arriba: usa HttpAdapter (badge sin badge, modo real).
#  · Sin backend o con ?mock=1: cae a MockAdapter ("Modo demo").
#  · En el Perfil podés cambiar la URL del backend (para producción).

# 3) Mobile (terminal 3)
cd ~/workspace/oppi/oppi-mobile
npm install
npx expo start             # escaneá el QR con Expo Go (misma Wi-Fi)
```

Cuentas de prueba (password `oppi123`): `ana@ejemplo.com.py` (clienta),
`charly@ejemplo.com.py` (handyman), `camila@ejemplo.com.py` (profesional),
`rosa@bellavista.com.py` (negocio), `amigo@oppi.com.py` (dueño del código **OPPI-AMIGO**).

> En teléfono físico, `localhost` es el teléfono: pasá la IP de tu máquina con
> `EXPO_PUBLIC_API_URL=http://TU_IP:3000` (ver README de oppi-mobile).

## API (resumen)

Base: `http://localhost:3000/api` — documentación completa y lista de endpoints
en [`oppi-api/README.md`](oppi-api/README.md).

| Recurso | Qué cubre |
|---|---|
| `/api/auth/*`, `/api/me` | registro, login JWT (7 días), roles `client\|pro\|handyman\|business` |
| `/api/professionals`, `/api/services`, `/api/slots` | catálogo, filtros por categoría/barrio |
| `/api/bookings` | reservas con seña validada y crédito aplicable |
| `/api/tasks`, `/api/offers`, `/api/jobs` | marketplace handyman + trabajos |
| `/api/conversations`, `/api/messages` | chat con fotos y **quotes con roles separados** |
| `/api/reviews` (+ `/:id/reply`) | reseñas y respuestas del negocio |
| `/api/businesses`, `/api/team` | alta progresiva (3 pasos), documentos, equipo |
| `/api/waitlist` | lista de espera sin duplicados |
| `/api/referrals` | canje de códigos (sin auto-canje ni doble uso) |
| `/api/notifications`, `/api/config` | notificaciones y comisión 15% visible |

Reglas validadas **en el servidor**: seña (% 1–100 o monto fijo >0 y ≤ precio),
solo el handyman crea quotes / solo el cliente acepta-rechaza, waitlist única por
(cliente, profesional, turno), referido sin auto-canje.

## Tests y verificación

```bash
cd ~/workspace/oppi/oppi-api && npm test     # 68/68 node:test (endpoints: feliz + errores)
# Contra Postgres real:
DATABASE_URL=postgres://oppi:pass@host:5432/oppi npm test   # 68/68 verificados en PG 16
```

Además se verificó la **web contra el backend real** (script `/tmp/verify-web.js`,
23/23): login, búsqueda, reserva con seña, publicar tarea → oferta → aceptar →
job con seña retenida, cotización con roles (403 si el cliente intenta cotizar),
canje OPPI-AMIGO (+Gs. 20.000; duplicado/inválido/auto-canje rechazados) y que
el MockAdapter sigue intacto.

Mobile: verificación **estática** solamente (parseo JSX, imports, rutas de
navegación 16/16, llamadas `api.*` ⊆ cliente). No se ejecutó en Expo acá.

## Guía de deploy (15 minutos)

**API** (`oppi-api/` trae `Dockerfile`, `render.yaml`, `railway.json`, `.env.example`):

- **Render** (recomendado): New → Blueprint con el repo → se crean `oppi-api` (web)
  y `oppi-db` (Postgres) con env seteadas (`JWT_SECRET` se genera solo) →
  correr `npm run seed` una vez desde el Shell → verificar
  `https://oppi-api.onrender.com/api/health`.
- **Railway**: Deploy from Repo (usa el `Dockerfile`) + plugin Postgres +
  pegar las env de `.env.example`.
- **VPS/Docker**: `docker build -t oppi-api . && docker run -d -p 3000:3000 --env-file .env -v oppi-data:/app/data oppi-api`.

Detalle paso a paso en [`oppi-api/README.md`](oppi-api/README.md) (sección Deploy).

- **Web**: hosting estático (Netlify, Vercel, Cloudflare Pages…): subir
  `oppi-web/` tal cual y setear la URL del backend (o `window.OPPI_API_URL`).
- **Mobile**: `eas build` para los binarios de App Store / Play Store.

## Qué falta para producción (honesto)

- [x] **Pagos**: interfaz `PaymentProvider` real + `MockProvider` funcional
      (retiene/captura/libera/reembolsa señas, registro contable en `payments`).
      Falta: credenciales de **Bancard** (`PAYMENT_BANCARD_*`) e implementar el
      driver (TODOs concretos en `src/lib/payments.js`).
- [x] **Push**: `NotificationService` + `PushDriver` (`mock`/`fcm`/`apns`); eventos
      encolados (reserva, oferta, cotización, job, reseña, waitlist, referido).
      Falta: credenciales **FCM** (`PUSH_FCM_*`) o **APNs** (`PUSH_APNS_*`).
- [x] **Fotos**: `StorageProvider` + `LocalDriver` (funciona punta a punta hoy:
      subir → URL → descargar) y esqueleto **S3** (R2/MinIO).
      Falta: credenciales del bucket (`STORAGE_S3_*`) si se quiere S3.
- [x] **Postgres**: soporte real verificado (seed + 68/68 tests en PG 16).
      En producción usar `DATABASE_URL` (Render/Railway lo dan).
- [ ] **Secretos y entorno**: setear `JWT_SECRET` en producción (hoy hay default
      de desarrollo), HTTPS (lo da el PaaS), CORS restringido, rate limiting.
- [ ] **Cuentas de stores**: Apple Developer / Google Play para publicar la app
      (el binario se genera con EAS Build, no se puede generar en este entorno).
- [ ] **Dominio + TLS** para web y API.
- [ ] **QA con clicks reales** en web y en Expo Go antes de mostrar como final.
