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
y health check en `/api/health`.

1. En [railway.app](https://railway.app) → **New Project** → **Deploy from
   GitHub repo** → elegí el repo.
2. Agregá **Postgres**: New → Database → PostgreSQL. En el servicio de la API,
   agregá la variable `DATABASE_URL` referenciando la base
   (`${{Postgres.DATABASE_URL}}`).
3. En **Variables** del servicio API, pegá como mínimo:
   `JWT_SECRET` y `CRON_SECRET` (generadas como en el paso 4 de Render).
   `PORT` lo setea Railway solo; no hace falta.
4. Si usás SQLite en vez de Postgres (no recomendado en producción),
   agregá un **Volume** montado en `/app/data`.
5. Deploy → verificá `https://<tu-app>.up.railway.app/api/health`.
6. Seed una vez: Railway CLI (`railway run npm run seed`) o la pestaña
   de terminal del servicio.
7. Crons: igual que en Render (servicio Cron aparte o scheduler externo)
   pegando a `/api/notifications/generate-reminders` y `/send-due` con el
   header `x-cron-secret`.

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
