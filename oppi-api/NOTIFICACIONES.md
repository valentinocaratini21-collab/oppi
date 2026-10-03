# Notificaciones push — Oppi API

Estado: el flujo está completo de punta a punta y testeado.
`PUSH_PROVIDER=mock` es el default (no envía nada afuera; las notificaciones
quedan en la DB y se ven en el centro de notificaciones). Los drivers `fcm`
y `apns` están **implementados** en `src/lib/notifications.js`
(sin dependencias externas: solo `node:crypto`, `node:fs`, `node:http2` y
`fetch`). **Solo faltan las credenciales del dueño** (checklist abajo).

## Arquitectura

1. **Encolar** — las rutas llaman `notify(db, { userId, type, title, body })`
   en cada evento de negocio. Eso inserta en la tabla `notifications`
   (visible en la app por polling en `GET /api/notifications`). Nunca rompe
   el flujo principal si falla.
2. **Registrar el dispositivo** — la app hace
   `POST /api/push-tokens { token, platform }` (`platform`: `android` | `ios` | `web`).
   Idempotente (re-registrar no falla). `DELETE /api/push-tokens { token }`
   da de baja el dispositivo (logout / desinstalar).
3. **Despachar** — un cron/worker llama
   `POST /api/notifications/send-due` (protegido por `CRON_SECRET` o JWT).
   `NotificationService.sendDue()` toma las notificaciones con `scheduled_for`
   vencido y `push_sent = 0`, las envía vía el `PushDriver` y las marca
   `push_sent = 1`. Devuelve `{ sent, failed }`.
   - Un usuario con varios tokens recibe **1 push por notificación**.
   - Sin token registrado: se marca como enviada (sigue visible en el centro
     de notificaciones, no se reintenta eternamente).
   - Si el envío falla: `failed` cuenta, se loguea y se reintenta en la
     próxima pasada.

## FCM (Android / web) — `PUSH_PROVIDER=fcm`

- API **FCM HTTP v1**: `POST https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send`
- Auth: la service account firma un JWT RS256
  (`iss` = client_email, `scope` = firebase.messaging, `aud` = oauth2 token endpoint)
  → `POST https://oauth2.googleapis.com/token` → `access_token` (cacheado hasta expirar).
- El mensaje lleva `notification { title, body }` + `data` (todo stringificado);
  en Android se marca `priority: high`.
- `PUSH_FCM_SERVICE_ACCOUNT_JSON` acepta el **contenido del JSON** o la **ruta**
  al archivo (nunca commitearlo).

## APNs (iOS) — `PUSH_PROVIDER=apns`

- Provider API por **HTTP/2** (`node:http2`, cargado de forma perezosa):
  `POST https://api.push.apple.com/3/device/{deviceToken}` (prod) o
  `https://api.sandbox.push.apple.com` (sandbox).
- Auth: **JWT ES256** firmado con la clave `.p8`
  (header `{ alg: 'ES256', kid }`, payload `{ iss: teamId, iat }`),
  renovado cada 50 minutos.
- Headers: `apns-topic: <bundleId>`, `apns-push-type: alert`, `apns-priority: 10`.
- Errores tipificados: `APNS_BAD_TOKEN` (token inválido → darlo de baja),
  `APNS_REJECTED`. En FCM: `FCM_BAD_TOKEN` (404 → token muerto).

## Checklist de credenciales (pedirle al dueño)

### Firebase (FCM — Android/web)

| Variable | Qué es | Dónde se consigue |
|---|---|---|
| `PUSH_FCM_PROJECT_ID` | Id del proyecto Firebase | [console.firebase.google.com](https://console.firebase.google.com) → crear proyecto → Configuración del proyecto → Id del proyecto |
| `PUSH_FCM_SERVICE_ACCOUNT_JSON` | JSON de la clave privada de la cuenta de servicio (o ruta al archivo) | Firebase → Configuración del proyecto → **Cuentas de servicio** → *Generar nueva clave privada* → descargar el `.json` |

Pasos: crear el proyecto → generar la clave → pegarla como variable de entorno
(contenido o ruta). En la app Android, agregar el `google-services.json` del
proyecto y pedir el token con Firebase Messaging.

### Apple (APNs — iOS)

| Variable | Qué es | Dónde se consigue |
|---|---|---|
| `PUSH_APNS_KEY_ID` | Key ID (10 caracteres) | [developer.apple.com/account](https://developer.apple.com/account) → Certificates, Identifiers & Profiles → **Keys** → crear key con servicio *Apple Push Notifications (APNs)* → anotar el Key ID |
| `PUSH_APNS_TEAM_ID` | Team ID (10 caracteres) | developer.apple.com → **Membership** (arriba a la derecha) |
| `PUSH_APNS_KEY_FILE` | Ruta al archivo `.p8` descargado al crear la key (**se descarga una sola vez**) | Al crear la key → *Download*. Guardarlo como secreto (nunca en el repo) |
| `PUSH_APNS_BUNDLE_ID` | Bundle ID de la app Oppi (ej. `com.oppi.app`) | El que se use al crear el App ID en Apple Developer |
| `PUSH_APNS_ENV` | `sandbox` o `prod` | `sandbox` para builds de desarrollo/TestFlight; `prod` **solo** con build de App Store |

Pasos: crear la APNs Key → descargar el `.p8` (una sola oportunidad) →
anotar Key ID + Team ID → subir el `.p8` al hosting como archivo secreto y
apuntar `PUSH_APNS_KEY_FILE` a su ruta.

### Cron de despacho (ambos providers)

| Variable | Qué es | Dónde se consigue |
|---|---|---|
| `CRON_SECRET` | Secreto que el scheduler manda como header `x-cron-secret` | Generarlo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

El cron tiene que pegar cada 1–5 minutos a:
`POST https://<api>/api/notifications/send-due`
con header `x-cron-secret: <valor>`. (En Render: Cron Job apuntando a la URL;
o un `setInterval` interno — hoy es externo.)

## Probar (sin credenciales reales)

Con `PUSH_PROVIDER=mock` (default) el flujo end-to-end se prueba así:

```bash
# 1. Registrar token (con JWT de un usuario)
curl -X POST http://localhost:3000/api/push-tokens \
  -H "Authorization: Bearer <jwt>" -H 'Content-Type: application/json' \
  -d '{"token":"tok-de-prueba","platform":"android"}'

# 2. Encolar una notificación vencida (o disparar un evento de negocio real)
# 3. Drenar
curl -X POST http://localhost:3000/api/notifications/send-due \
  -H "x-cron-secret: <CRON_SECRET>"
# → {"ok":true,"sent":1,"failed":0}
```

Los tests (`test/push.test.js`, `test/push-drivers.test.js`) cubren: registro
idempotente, encolado, drenado, `push_sent`, 1 push por notificación con
varios tokens, errores de config que nombran la variable faltante, firma
JWT RS256/ES256 y construcción de requests FCM/APNs con red simulada.

## Pasar a FCM/APNs reales

1. Conseguir las credenciales (checklist de arriba).
2. Setear `PUSH_PROVIDER=fcm` (o `apns`) + sus variables en el hosting.
3. Al arrancar, `src/lib/config.js` valida que estén todas; si falta alguna,
   la API no levanta y dice exactamente cuál.
4. Registrar un token real desde la app y disparar una notificación de prueba;
   verificar `sent: 1` en `/send-due` y la llegada al dispositivo.
5. Ante `FCM_BAD_TOKEN`/`APNS_BAD_TOKEN`, dar de baja el token
   (`DELETE /api/push-tokens`) para no reintentarlo.
