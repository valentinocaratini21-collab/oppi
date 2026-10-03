# Deploy del backend de Oppi en Railway

Guía paso a paso para subir la API a producción. No necesitás saber nada de
Railway: seguí los pasos en orden, sin saltearte ninguno. No se rompe nada
probando; si algo falla, el paso 11 dice qué mirar.

**Lo que vas a necesitar a mano:**
- Tu cuenta de GitHub (la que tiene el repo `valentinocaratini21-collab/oppi`).
- Tu email (para que tu cuenta nazca como admin).
- Una terminal en tu compu (para generar secretos y correr el seed al final).

**Tiempo total:** ~15 minutos (la mayor parte es esperar el deploy).

---

## Paso 1 — Entrar a Railway

1. Abrí [railway.app](https://railway.app) en el navegador.
2. Apretá **Login** y entrá con tu cuenta (podés usar "Login with GitHub",
   es lo más cómodo porque después vas a deployar desde GitHub).

## Paso 2 — Crear el proyecto desde el repo

1. Apretá el botón **New Project** (arriba a la derecha).
2. Elegí **Deploy from GitHub repo**.
3. Si es la primera vez, Railway te pide conectar GitHub: aceptá y dale
   acceso al repo `valentinocaratini21-collab/oppi` (puede ser acceso a todos
   tus repos o solo a ese).
4. En la lista de repos, hacé click en **`valentinocaratini21-collab/oppi`**.
5. Railway crea el proyecto y empieza a deployar. **Va a fallar el primer
   intento: es normal**, porque todavía no le dijimos en qué carpeta vive
   la API (paso 3). No te asustes.

## Paso 3 — Decirle a Railway dónde vive la API (CRÍTICO)

El repo tiene tres carpetas (`oppi-api`, `oppi-web`, `oppi-mobile`). La API
está en `oppi-api`, y Railway tiene que saberlo. Sin este paso, nada
funciona.

1. En el canvas del proyecto, hacé click en el servicio que se creó
   (el cuadradito con el nombre del repo).
2. Arriba, andá a la pestaña **Settings**.
3. Bajá hasta la sección **Source**.
4. En el campo **Root Directory**, escribí exactamente: `oppi-api`
5. Apretá **Save** (o Enter).
6. Railway redeploya solo usando esa carpeta. Esperá a que termine
   (~2–3 min). Todavía puede fallar por falta de variables: es lo que
   arreglamos en los pasos 4 y 5.

## Paso 4 — Agregar la base de datos Postgres

1. Volvé al canvas del proyecto (click en el nombre del proyecto, arriba
   a la izquierda, o la flecha "atrás").
2. Apretá el botón **New** (arriba a la derecha del canvas).
3. Elegí **Database** → **PostgreSQL**.
4. Aparece un nuevo cuadradito llamado **Postgres** en el canvas. Listo,
   no hay que configurarle nada más.
5. **Fijate bien cómo se llama** (normalmente es `Postgres` con mayúscula).
   Lo vas a necesitar en el paso 5.

## Paso 5 — Poner las variables de entorno

1. Hacé click en el servicio de la API (el cuadradito del repo, no el de
   Postgres).
2. Andá a la pestaña **Variables**.
3. Apretá **New Variable** y agregá estas, una por una
   (en **Name** va el nombre, en **Value** el valor):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `JWT_SECRET` | *(el que generes en el paso 6)* |
   | `CRON_SECRET` | *(otro distinto, paso 6)* |
   | `ADMIN_EMAIL` | tu email (ej. `tuemail@gmail.com`) |
   | `CANCELLATION_PILOT_MODE` | `true` |
   | `NODE_ENV` | `production` |

   - `DATABASE_URL`: escribila **exactamente** como está arriba, con las
     llaves y los signos `$`. No es un valor fijo: es una *referencia* y
     Railway la reemplaza sola por la URL real de tu base. Si tu servicio
     de Postgres se llama distinto a `Postgres`, usá ese nombre entre
     `${{...}}`.
   - `ADMIN_EMAIL`: poné **tu** email. Cuando te registres en la app con
     ese email, tu cuenta nace como administradora. Setealo **antes** de
     correr el seed (paso 9).
   - `PORT`: **no lo agregues**. Railway lo pone solo y la API lo lee
     automáticamente.

4. Cada variable se guarda sola al apretar **Add**.

## Paso 6 — Generar los dos secretos

`JWT_SECRET` y `CRON_SECRET` tienen que ser textos largos y aleatorios,
distintos entre sí. Generarlos es un comando:

1. Abrí una terminal en tu compu.
2. Corré esto **dos veces** (cada vez te da un valor distinto):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   (Si tu compu no tiene `node`, instalalo desde [nodejs.org](https://nodejs.org)
   o avisame y te paso los valores por otro medio.)
3. Copiá el primer valor en la variable `JWT_SECRET` y el segundo en
   `CRON_SECRET` (paso 5).
4. **Guardate el `CRON_SECRET` en un lugar seguro** (notas, gestor de
   contraseñas): lo vas a necesitar en el paso 10 para los crons.

## Paso 7 — Generar la URL pública

1. En el servicio de la API → pestaña **Settings**.
2. Bajá hasta **Networking**.
3. Apretá **Generate Domain**.
4. Railway te da una URL como `https://oppi-api-production-xxxx.up.railway.app`.
   **Copiala**: es la dirección pública de tu backend.

## Paso 8 — Esperar el deploy y verificar que está vivo

1. En el servicio → pestaña **Deployments**. Esperá a que el deploy actual
   diga **Success** (~2–3 min). Cada vez que cambiaste variables, Railway
   redeployó solo; lo que importa es el último.
2. Abrí en el navegador:
   `https://<tu-dominio>/api/health`
   (reemplazá `<tu-dominio>` por la URL del paso 7).
3. Tiene que responder exactamente esto:
   ```json
   {"ok":true,"service":"oppi-api","version":"1.0.0"}
   ```
4. Si responde eso, el backend está vivo. Si no levanta, mirá la pestaña
   **Logs** del servicio: la API valida su configuración al arrancar y te
   dice exactamente qué variable falta o está mal.

## Paso 9 — Correr el seed (una sola vez)

El seed crea usuarios de prueba y datos demo en la base. Se corre una sola
vez; si lo corrés de nuevo no duplica nada.

Railway no tiene terminal en la web, así que se hace desde tu compu con la
CLI de Railway (son 5 comandos, una sola vez):

1. En la terminal:
   ```bash
   npm i -g @railway/cli
   ```
2. Logueate (abre el navegador, aceptá):
   ```bash
   railway login
   ```
3. Andá a la carpeta de la API **dentro del repo** en tu compu:
   ```bash
   cd /ruta/a/tu/repo/oppi/oppi-api
   ```
   (Si todavía no clonaste el repo en tu compu:
   `git clone https://github.com/valentinocaratini21-collab/oppi.git`
   y después `cd oppi/oppi-api`.)
4. Vinculá la CLI con tu proyecto:
   ```bash
   railway link
   ```
   Elegí tu proyecto y el servicio de la API con las flechas y Enter.
5. Corré el seed:
   ```bash
   railway run npm run seed
   ```
6. Tiene que terminar con `Seed OK en (postgres)`.

Usuarios de prueba (password de todos: `oppi123`):
`ana@ejemplo.com.py`, `charly@ejemplo.com.py`, `camila@ejemplo.com.py`,
`rosa@bellavista.com.py`.

## Paso 10 — Activar los crons de notificaciones

La app manda recordatorios automáticos (ej. "tu reserva es mañana"). Eso lo
disparan dos endpoints que hay que llamar cada 5 minutos. Railway no trae
cron incluido, así que usamos [cron-job.org](https://cron-job.org) (gratis):

1. Creá una cuenta en [cron-job.org](https://cron-job.org) (es gratis).
2. Creá un job:
   - **Title**: `oppi reminders`
   - **URL**: `https://<tu-dominio>/api/notifications/generate-reminders`
   - **Método**: `POST`
   - **Schedule**: cada 5 minutos (`*/5 * * * *`)
   - **Headers**: agregá `x-cron-secret` con el valor de tu `CRON_SECRET`
     (el que guardaste en el paso 6).
3. Creá otro job igual pero con URL:
   `https://<tu-dominio>/api/notifications/send-due`
4. Para probar que funciona, en cron-job.org cada job tiene un botón para
   ejecutarlo ya: probá uno y fijate que responda sin error.

## Paso 11 — Checklist final (antes de avisar que está listo)

- [ ] `https://<tu-dominio>/api/health` responde `{"ok":true,...}`.
- [ ] `JWT_SECRET` y `CRON_SECRET` son secretos generados (no textos
      inventados cortos).
- [ ] El seed corrió una vez (`Seed OK en (postgres)`).
- [ ] Los dos crons de cron-job.org están creados y uno se probó a mano.
- [ ] Probá un login de prueba desde la terminal:
  ```bash
  curl -X POST https://<tu-dominio>/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"ana@ejemplo.com.py","password":"oppi123"}'
  ```
  Tiene que devolver un `token`.

Cuando todo esto esté en verde, **avisame**: hay que actualizar la web
(`oppi-web`) con la URL real del backend, y eso es un push que hago yo.

---

## Si algo sale mal

| Síntoma | Qué hacer |
|---|---|
| El deploy falla apenas se crea el proyecto | Normal: falta el Root Directory (paso 3). |
| En **Logs** dice `Falta la variable requerida JWT_SECRET` | Volvé al paso 5: falta esa variable o está vacía. |
| `/api/health` no responde pero el deploy dice Success | Esperá 1–2 min más (el health check tarda en pasar) y recargá. |
| El seed dice que no puede conectar a la base | Fijate que `DATABASE_URL` sea exactamente `${{Postgres.DATABASE_URL}}` y que el servicio de Postgres exista en el mismo proyecto. |
| `railway link` no muestra tu proyecto | Asegurate de haber hecho `railway login` con la misma cuenta del paso 1. |

## Notas

- **Fotos de perfil / servicios**: por ahora se guardan en el disco del
  servicio (`STORAGE_DRIVER=local`). En Railway el disco se borra en cada
  redeploy, así que si se pierden fotos no es un bug: cuando la app tenga
  usuarios reales, migramos a S3/R2 (está previsto en `.env.example`).
- **Pagos y push** están en modo simulado (`mock`) hasta tener las
  credenciales reales de Bancard/Firebase/APNs. No activar los providers
  reales sin esas credenciales (ver `PAGOS.md` y `NOTIFICACIONES.md`).
- Cada push a la rama `main` del repo redeploya solo (~2–3 min).
