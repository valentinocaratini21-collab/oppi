# Oppi API

Backend REAL de **Oppi** — plataforma paraguaya de reserva de servicios profesionales
(lanzamiento enero 2027). Tres pilares:

1. **Reserva de profesionales** independientes (peluquería, barbería, electricista, etc.)
2. **Marketplace handyman**: cualquiera publica una tarea, los handymans ofertan en guaraníes
3. **Oppi Empresas**: negocios que administran reservas, servicios, equipo y documentos

Todo en español rioplatense con voseo, precios en Gs., barrios de Asunción.

## Stack

- **Node 24 + Express** — `npm start` levanta en `:3000`
- **Base de datos**: `node:sqlite` por defecto; **Postgres** con `DATABASE_URL` (verificado contra PostgreSQL 16 real)
- **Auth**: JWT (`jsonwebtoken`) + passwords con **scrypt** de `node:crypto` (sin bcrypt)
- **Tests**: `node:test` (built-in) + `fetch` nativo contra servidor en puerto efímero
- Deps: `express`, `jsonwebtoken`, `pg` (solo se usa si hay `DATABASE_URL`)

## Cómo correr

```bash
npm install
npm run seed   # datos paraguayos de demo (SQLite en ./data/oppi.db, o Postgres si hay DATABASE_URL)
npm test       # 68 tests en sqlite; con DATABASE_URL corren contra Postgres
npm start      # http://localhost:3000
```

Variables de entorno: ver **`.env.example`** (completo y comentado). Las principales:

| Var | Default | Para qué |
|---|---|---|
| `PORT` | `3000` | puerto |
| `DB_PATH` | `./data/oppi.db` | archivo SQLite (si no hay `DATABASE_URL`) |
| `DATABASE_URL` | — | `postgres://user:pass@host:5432/oppi` → usa Postgres |
| `JWT_SECRET` | `oppi-dev-secret` | ⚠️ **cambiar en producción** |
| `REFERRAL_BONUS_GS` | `20000` | crédito por canjear referido |
| `PAYMENT_PROVIDER` | `mock` | `mock` \| `bancard` |
| `PUSH_PROVIDER` | `mock` | `mock` \| `fcm` \| `apns` |
| `STORAGE_DRIVER` | `local` | `local` \| `s3` |
| `STORAGE_LOCAL_DIR` | `./data/uploads` | carpeta de fotos (driver local) |

## Credenciales de prueba (password: `oppi123`)

| Email | Rol | Nota |
|---|---|---|
| `ana@ejemplo.com.py` | client | clienta de ejemplo |
| `jorge@ejemplo.com.py` | client | |
| `paola@ejemplo.com.py` | client | |
| `charly@ejemplo.com.py` | handyman | Carlos "Charly" Duarte |
| `miguel@ejemplo.com.py` | handyman | Miguel Ángel Rojas |
| `fatima@ejemplo.com.py` | handyman | Fátima Cabrera |
| `camila@ejemplo.com.py` | pro | peluquera, Villa Morra (+ 9 profesionales más) |
| `rosa@bellavista.com.py` | business | dueña de **Salón Bella Vista** |
| `amigo@oppi.com.py` | client | dueño del código de referido **`OPPI-AMIGO`** |

El seed crea además: 10 profesionales con servicios y turnos, 6 tareas handyman con
ofertas (una aceptada → job en curso), 1 negocio con equipo/servicios/documentos,
conversaciones con cotizaciones y fotos, y reseñas con respuesta del profesional.

## Endpoints (`/api`)

Auth: `POST /auth/register` · `POST /auth/login` · `GET /me`
(Bearer token en `Authorization`; sin token → 401)

- **Profesionales**: `GET /professionals` (público, filtros `?category=&barrio=&q=`) · `POST /professionals` · `GET /professionals/:id` (público, con reseñas y respuestas) · `PATCH /professionals/:id`
- **Servicios**: `GET /services` (público) · `POST /services` · `PATCH /services/:id` · `DELETE /services/:id`
- **Turnos**: `GET /slots` (público) · `POST /slots` · `DELETE /slots/:id`
- **Reservas**: `GET /bookings` · `GET /bookings/:id` · `POST /bookings` (crea + aplica crédito + avisa al profesional) · `PATCH /bookings/:id` (estados: solo el profesional/negocio confirma o completa; cliente o prestador cancelan; confirmar cobra el 100% del total vía pasarela, cancelar sin cargo lo reembolsa y avisa a la lista de espera si se liberó un turno)
- **Favoritos**: `GET /favorites` · `POST /favorites` · `DELETE /favorites/:professional_id`
- **Chat**: `POST /conversations` · `GET /conversations` · `GET /conversations/:id/messages` · `POST /conversations/:id/messages` (texto, `photos[]`, `quote`; la cotización avisa al otro participante) · `PATCH /messages/:id/quote` (aceptar/rechazar; avisa al handyman)
- **Tareas**: `GET /tasks` (público, `?urgent=1&category=&barrio=`) · `POST /tasks` · `GET /tasks/:id` · `PATCH /tasks/:id` (cancelar reembolsa el cobro del job en curso)
- **Ofertas**: `POST /tasks/:id/offers` (solo handyman; avisa al cliente) · `GET /tasks/:id/offers` · `POST /offers/:id/accept` (el cliente acepta → crea el job, cobra el 100% del precio vía pasarela, avisa al elegido y a los rechazados)
- **Jobs**: `GET /jobs` · `GET /jobs/:id` · `PATCH /jobs/:id` (`quoting → in_progress → completed`; avisa al cliente al completar)
- **Reseñas**: `GET /reviews` (público) · `POST /reviews` (rating 1–5; avisa al reseñado) · `POST /reviews/:id/reply` (el profesional/negocio responde **una vez**; avisa al autor)
- **Negocios**: `GET /businesses` (público) · `POST /businesses` (alta en 3 pasos: datos + servicios + horario → `verification_status: pending`) · `GET /businesses/:id` (público, con servicios/equipo/documentos/reseñas) · `PATCH /businesses/:id`
- **Documentos**: `GET /businesses/:id/documents` · `POST /businesses/:id/documents` · `PATCH /businesses/:id/documents/:docId` (checklist de onboarding)
- **Equipo**: `GET /team?business_id=` · `POST /team` · `PATCH /team/:id` · `DELETE /team/:id`
- **Lista de espera**: `GET /waitlist` · `POST /waitlist` (duplicado → 409) · `DELETE /waitlist/:id`
- **Referidos**: `GET /referrals` · `POST /referrals/redeem` (inexistente/auto-canje/doble canje → 400; canje feliz suma Gs. 20.000 y avisa al dueño del código)
- **Notificaciones**: `GET /notifications` · `PATCH /notifications/:id` · `POST /notifications/generate-reminders` (recordatorios de turnos próximos) · `POST /notifications/send-due` (despacha push vencidas) · `POST /api/push-tokens` · `DELETE /api/push-tokens`
- **Uploads**: `POST /api/uploads` (foto binaria o `{filename, data_url}` → `{file: {url, key, ...}}`; la `url` se sirve en `/uploads/*`)
- **Config**: `GET /config` (público: comisión 15% + textos "Cómo ganamos")

## Reglas de negocio validadas en la API

- **Señas** (`src/lib/deposit.js`): `percent` → entero 1–100; `fixed` → > 0 y ≤ precio; inválida → 400 con mensaje claro. Se valida al crear/editar servicios **y se recalcula al crear y al confirmar** cada reserva.
- **Pagos** (`src/lib/payments.js`): al confirmar una reserva o aceptar una oferta se cobra el 100% del total con el `PaymentProvider` (`PAYMENT_PROVIDER`; default `mock`); cada movimiento queda en la tabla `payments`. Cancelar sin cargo lo reembolsa.
- **Quotes del chat**: solo `handyman` puede crearlas; solo `client` puede aceptar/rechazarlas; otro intento → 403.
- **Reservas**: solo el profesional/negocio dueño del servicio confirma; solo involucrados cancelan; el turno se marca `booked` y se libera al cancelar (avisando a la lista de espera).
- **Ofertas handyman**: aceptar crea el job, cobra el 100% del precio acordado, marca la tarea `assigned` y rechaza las demás ofertas.
- **Reseñas**: el reseñado responde una sola vez; la respuesta se expone en el perfil público.
- **Referidos**: código único por usuario; sin auto-canje; sin doble canje; tope de usos.

## Pagos, push y fotos: interfaces reales + drivers

Ya no hay simulaciones sueltas: cada integración tiene interfaz, driver mock
(funcional hoy) y driver real documentado con TODOs concretos.

- **Pagos** (`src/lib/payments.js`, `PAYMENT_PROVIDER`):
  `PaymentProvider` con `createDepositHold` / `captureHold` / `releaseHold` / `refund`.
  `MockProvider` = comportamiento actual (retención simulada + registro en `payments`).
  `BancardProvider` = integración real con Bancard vPOS (single_buy con
  preautorización, captura, reversa, confirmación y validación del webhook).
  Solo faltan las credenciales del comercio (`PAYMENT_BANCARD_PUBLIC_KEY`,
  `PAYMENT_BANCARD_PRIVATE_KEY`, `PAYMENT_BANCARD_ENV`): ver `PAGOS.md`.
- **Push** (`src/lib/notifications.js`, `PUSH_PROVIDER`):
  `NotificationService.enqueue()` guarda en la DB (visible en el centro de
  notificaciones); `sendDue()` despacha las vencidas vía el `PushDriver`.
  `MockDriver` no envía nada afuera. `FcmDriver`/`ApnsDriver` están implementados
  de punta a punta (FCM HTTP v1 con OAuth2, APNs por HTTP/2 con JWT ES256);
  solo faltan las credenciales (`PUSH_FCM_PROJECT_ID`, `PUSH_FCM_SERVICE_ACCOUNT_JSON`,
  `PUSH_APNS_KEY_ID`, `PUSH_APNS_TEAM_ID`, `PUSH_APNS_KEY_FILE`, `PUSH_APNS_BUNDLE_ID`):
  ver `NOTIFICACIONES.md`.
  Los eventos encolan automáticamente: reserva creada/confirmada/cancelada,
  recordatorio "tu turno es pronto", oferta recibida/aceptada/rechazada,
  cotización recibida/aceptada/rechazada, trabajo completado, reseña recibida,
  lugar liberado en lista de espera, referido canjeado.
- **Fotos** (`src/lib/storage.js`, `STORAGE_DRIVER`):
  `StorageProvider.save(buffer, meta) → {url, key}`. `LocalDriver` guarda en
  `STORAGE_LOCAL_DIR` (default `data/uploads/`) y Express lo sirve en `/uploads/*`
  — funciona de punta a punta hoy. `S3Driver` es esqueleto compatible S3
  (AWS S3 / Cloudflare R2 / MinIO) con TODOs (`STORAGE_S3_ENDPOINT/BUCKET/REGION/KEY/SECRET`).

## Postgres

La capa `src/db/` soporta los dos drivers con el mismo contrato (`queryAll`,
`queryOne`, `run` async, placeholders `?`):

- Sin `DATABASE_URL` → `node:sqlite` (dev/tests).
- Con `DATABASE_URL=postgres://...` → `pg` (Pool). El DDL está en
  `src/db/schema.pg.sql` (se aplica solo con `migrate()`).
- Decisiones de compatibilidad (documentadas en `schema.pg.sql`): columnas JSON
  como TEXT (mismo `JSON.stringify/parse`), booleanos 0/1, `created_at` como
  texto `AAAA-MM-DD HH:MM:SS`, `RETURNING id` automático en INSERTs.

Verificado: `npm run seed` + suite completa (68 tests) corren contra
PostgreSQL 16 real:

```bash
DATABASE_URL=postgres://oppi:pass@host:5432/oppi npm run seed
DATABASE_URL=postgres://oppi:pass@host:5432/oppi npm test
```

## Deploy (15 minutos)

Archivos listos: `Dockerfile` (node:24, multi-stage, usuario no-root,
`npm ci --omit=dev`, healthcheck en `/api/health`), `.dockerignore`,
`render.yaml` (web + Postgres + disco para uploads), `railway.json`,
`.env.example` completo.

**Render** (recomendado para arrancar):
1. Subí el repo a GitHub.
2. Render → New → Blueprint → elegí el repo (lee `render.yaml`).
3. Se crean `oppi-api` (web) y `oppi-db` (Postgres) con las env ya seteadas
   (`JWT_SECRET` se genera solo).
4. Cuando termine el deploy, corré el seed una vez:
   `Render → oppi-api → Shell → npm run seed`
   (usa el `DATABASE_URL` interno; también podés correrlo local apuntando
   `DATABASE_URL` a la External URL).
5. Verificá: `https://oppi-api.onrender.com/api/health` → `{"ok":true,...}`.

**Railway**: New Project → Deploy from Repo (usa `Dockerfile` vía `railway.json`)
→ agregá el plugin Postgres → seteá las env de `.env.example` →
`npm run seed` una vez desde la consola.

**Crons** (recordatorios + push; en Render: Dashboard → Cron Jobs, o cualquier
scheduler externo):
```bash
# Recordatorios "tu turno es pronto" (una vez por día, ej. 08:00)
curl -X POST https://TU-API/api/notifications/generate-reminders \
  -H "x-cron-secret: $CRON_SECRET"
# Despacho push de notificaciones vencidas (cada 15 min)
curl -X POST https://TU-API/api/notifications/send-due \
  -H "x-cron-secret: $CRON_SECRET"
```
(Sin `CRON_SECRET` seteado, esos endpoints exigen JWT de usuario.)

**Docker** (cualquier VPS):
```bash
docker build -t oppi-api .
docker run -d -p 3000:3000 --env-file .env -v oppi-data:/app/data --name oppi oppi-api
curl localhost:3000/api/health
```

⚠️ En producción: `JWT_SECRET` largo y único, `DATABASE_URL` de Postgres
administrado (no SQLite en disco efímero), HTTPS (lo da el PaaS), y
`STORAGE_DRIVER=s3` cuando las fotos crezcan (el disco local no escala).

## Estructura

```
src/
  server.js            # npm start → :3000
  app.js               # factory async de la app (los tests la usan con :memory: o Postgres)
  db/
    index.js           # dual driver: node:sqlite | pg (mismo contrato async)
    schema.sql         # DDL SQLite (19 tablas + payments + push_tokens)
    schema.pg.sql      # DDL Postgres
  lib/
    auth.js            # scrypt, JWT, requireAuth, requireRole
    deposit.js         # (deprecado) validación vieja de señas — el booking ya no la usa
    payments.js        # PaymentProvider + MockProvider + esqueleto Bancard
    notifications.js   # NotificationService + PushDriver (mock/fcm/apns)
    storage.js         # StorageProvider + LocalDriver + esqueleto S3
  routes/              # auth, catalog, bookings, chat, market, reviews,
                       # business, waitlist, referrals, notifications, uploads, config
  seed.js              # npm run seed — datos paraguayos de demo (sqlite y pg)
test/                  # 68 tests con node:test (feliz + 401/400/403/409)
Dockerfile / .dockerignore / render.yaml / railway.json / .env.example
```
