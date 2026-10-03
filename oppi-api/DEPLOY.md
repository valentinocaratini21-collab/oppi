# Deploy de Oppi API

Guía mínima e infalible para poner la API en producción. La API levanta en
cualquier lado con `node src/server.js` (Node 24+) y valida su configuración
al arrancar: **si falta una variable requerida, no levanta y dice exactamente
cuál** (ver `src/lib/config.js`).

> ⚠️ **MONOREPO — paso que no te podés saltear.** El repo `oppi` tiene tres
> carpetas en la raíz: `oppi-api/`, `oppi-web/` y `oppi-mobile/`. La API vive
> en `oppi-api/`, así que en el hosting el servicio tiene que apuntar a esa
> carpeta como **Root Directory = `oppi-api`**. Sin esto, el build falla
> porque no encuentra `package.json` ni el `Dockerfile`. (`railway.json` no
> puede declarar el Root Directory: se setea a mano en el dashboard, ver
> Opción B paso 2. En Render, el `render.yaml` también vive dentro de
> `oppi-api/`; si el Blueprint no lo detecta, seteá el Root Directory del
> servicio a `oppi-api`.)

> ⚠️ **Tiempos de deploy:** Render tarda ~3 min y Railway ~2–3 min por cada
> cambio. Después de cada deploy, esperá a que el dashboard diga "Live" /
> "Success" antes de probar.

## Opción A — Render (recomendada, blueprint listo)

El repo trae `render.yaml` (Blueprint): crea el servicio web + la base
Postgres de una sola vez.

### Paso a paso

1. **Subí el código a GitHub** (repo privado o público, como prefieras).
2. En [dashboard.render.com](https://dashboard.render.com) → **New** →
   **Blueprint** → conectá tu cuenta de GitHub y elegí el repo de Oppi API.
   Render detecta `render.yaml` solo.
3. Render te muestra los recursos a crear: servicio web `oppi-api` + base
   `oppi-db` (Postgres). Apretá **Apply**.
4. **Te va a pedir dos valores** (marcados como requeridos en el blueprint):
   - `JWT_SECRET` → generá uno así y pegalo:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `CRON_SECRET` → generá otro distinto con el mismo comando y pegalo.
     Es el secreto que usará el scheduler para llamar a los crons
     (`x-cron-secret: <valor>`). Guardalo: lo vas a necesitar en el paso 8.
   - `DATABASE_URL` se conecta sola desde la base `oppi-db`. No tocar.
5. Esperá el primer deploy (~3–5 min). Cuando el servicio diga **Live**,
   abrí en el navegador:
   `https://<tu-servicio>.onrender.com/api/health`
   Tiene que responder `{"ok":true,"service":"oppi-api","version":"1.0.0"}`.
   Si responde otra cosa o no levanta, mirá **Logs**: la validación de config
   te dice exactamente qué variable falta.
6. **Correr el seed (una sola vez)** — crea usuarios de prueba y datos demo:
   en el dashboard del servicio → pestaña **Shell** → ejecutá:
   ```bash
   npm run seed
   ```
   Tiene que terminar con `Seed OK en (postgres)`. Es idempotente: correrlo
   dos veces no duplica nada (vacía las tablas en orden antes de cargar).
   Usuarios de prueba (password `oppi123`): `ana@ejemplo.com.py`,
   `charly@ejemplo.com.py`, `camila@ejemplo.com.py`, `rosa@bellavista.com.py`.
7. Verificá el login de prueba:
   ```bash
   curl -X POST https://<tu-servicio>.onrender.com/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"ana@ejemplo.com.py","password":"oppi123"}'
   ```
   Tiene que devolver un `token`.
8. **Crons de notificaciones** (recordatorios + despacho de push):
   en Render → **New** → **Cron Job** → mismo repo, comando:
   ```bash
   curl -s -X POST "https://<tu-servicio>.onrender.com/api/notifications/generate-reminders" -H "x-cron-secret: <CRON_SECRET>" && curl -s -X POST "https://<tu-servicio>.onrender.com/api/notifications/send-due" -H "x-cron-secret: <CRON_SECRET>"
   ```
   Schedule: cada 5 minutos (`*/5 * * * *`). Reemplazá `<CRON_SECRET>` por el
   valor del paso 4.
9. **Fotos**: el blueprint usa disco persistente (`/data`) con
   `STORAGE_DRIVER=local`. Para producción real con varias instancias,
   migrá a S3/R2 (`STORAGE_DRIVER=s3` + credenciales en `.env.example`).

### Variables que ya vienen con default en el blueprint

`NODE_ENV=production`, `PAYMENT_PROVIDER=mock`, `PUSH_PROVIDER=mock`,
`STORAGE_DRIVER=local`, `REFERRAL_BONUS_GS=20000`, `JOB_DEPOSIT_PERCENT=30`.
Para activar Bancard/FCM/APNs reales, agregalas a mano en **Environment**
(ver `PAGOS.md` y `NOTIFICACIONES.md`) y hacé **Manual Deploy**.

## Opción B — Railway (resumen)

`railway.json` ya trae builder Dockerfile, `startCommand: node src/server.js`
y health check en `/api/health`. **Ojo monorepo:** el Root Directory se
setea a mano en el dashboard (el `railway.json` no puede declararlo).

1. En [railway.app](https://railway.app) → **New Project** →
   **Deploy from GitHub repo** → elegí `valentinocaratini21-collab/oppi`.
2. **Root Directory (CRÍTICO):** en el servicio recién creado → pestaña
   **Settings** → sección **Source** → **Root Directory** → escribí
   `oppi-api` → **Save**. Railway va a redeployar usando esa carpeta como
   base (ahí están el `Dockerfile`, el `package.json` y el `railway.json`).
3. Agregá **Postgres** en el mismo proyecto: botón **New** (arriba a la
   derecha del canvas) → **Database** → **PostgreSQL**.
4. En el servicio de la API → pestaña **Variables** → **New Variable**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (referencia a la base;
     si tu servicio de Postgres se llama distinto, usá ese nombre).
   - `JWT_SECRET` → generá uno así y pegalo:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `CRON_SECRET` → generá otro distinto con el mismo comando. Guardalo:
     lo vas a necesitar para los crons (paso 8).
   - `ADMIN_EMAIL` → tu email (la cuenta que te registres con ese email
     nace admin; setealo ANTES de correr el seed o registrarte).
   - `CANCELLATION_PILOT_MODE` = `true` (es el default, pero que quede
     explícito).
   - `NODE_ENV` = `production` (Railway a veces lo pone solo; si no está,
     agregalo).
   - `PORT` lo inyecta Railway solo: **no lo setees a mano**.
5. Generá el dominio público: en el servicio → **Settings** →
   **Networking** → **Generate Domain**. Te da algo como
   `https://oppi-api-production-xxxx.up.railway.app`.
6. Deploy → esperá ~2–3 min a que diga **Success** y el health check pase.
   Verificá en el navegador: `https://<tu-dominio>/api/health` → tiene que
   responder `{"ok":true,"service":"oppi-api","version":"1.0.0"}`.
7. **Seed una vez** (crea usuarios de prueba y datos demo; es idempotente).
   Railway no tiene terminal web en el servicio, así que se hace con la CLI
   desde tu compu, parado en la carpeta `oppi-api` del repo:
   ```bash
   npm i -g @railway/cli
   railway login          # abre el navegador, aceptá
   cd oppi-api            # la carpeta de la API dentro del repo
   railway link           # elegí el proyecto y el servicio de la API
   railway run npm run seed
   ```
   Tiene que terminar con `Seed OK en (postgres)`. Usuarios de prueba
   (password `oppi123`): `ana@ejemplo.com.py`, `charly@ejemplo.com.py`,
   `camila@ejemplo.com.py`, `rosa@bellavista.com.py`.
8. **Crons de notificaciones** (`/generate-reminders` y `/send-due` cada 5
   min, con el header `x-cron-secret: <CRON_SECRET>`). Railway no trae cron
   nativo: lo más simple es [cron-job.org](https://cron-job.org) (gratis):
   creá dos jobs `POST` a
   `https://<tu-dominio>/api/notifications/generate-reminders` y
   `https://<tu-dominio>/api/notifications/send-due`, cada 5 minutos, con
   el header `x-cron-secret` = tu `CRON_SECRET`.
9. **Fotos**: con Postgres, los uploads siguen en disco local
   (`STORAGE_DRIVER=local`, `/app/data/uploads`). En Railway el disco se
   pierde en cada redeploy: para producción real, migrá a S3/R2
   (`STORAGE_DRIVER=s3` + credenciales en `.env.example`).

## Antes de compartir con humanos (checklist)

- [ ] `GET /api/health` responde `{"ok":true}` en la URL pública.
- [ ] `JWT_SECRET` es un secreto real generado (no `oppi-dev-secret`).
- [ ] `CRON_SECRET` seteado y el cron de `/send-due` + `/generate-reminders`
      corriendo cada 5 minutos (probar a mano una vez con curl).
- [ ] Seed corrido una vez (`Seed OK`); login de prueba funciona.
- [ ] `PAYMENT_PROVIDER` sigue en `mock` hasta tener las credenciales de
      Bancard (ver `PAGOS.md`); **no** activar `bancard` sin certificar.
- [ ] `PUSH_PROVIDER` sigue en `mock` hasta tener Firebase/APNs
      (ver `NOTIFICACIONES.md`).
- [ ] Probar el flujo feliz en un teléfono real: registro → buscar
      profesional → reservar → confirmar → que llegue la notificación en
      `GET /api/notifications`.
- [ ] Revisar que `/uploads/*` sirva las fotos del seed.
- [ ] Backups: activar los backups automáticos de Postgres en el dashboard
      (Render/Railway los ofrecen en el addon de la base).
