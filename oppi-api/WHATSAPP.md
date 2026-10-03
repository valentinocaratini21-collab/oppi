> 📌 **Nota (2026-10-01):** el canal oficial de soporte es el **chat integrado
> in-app** — `POST /api/support/chat` y `GET /api/support/chat/history`
> (en `src/routes/support.js`, con el mismo motor de `src/lib/supportBot.js`).
> WhatsApp queda como **canal secundario futuro**: todo lo documentado abajo
> sigue programado en modo mock y **no se borra nada del código WhatsApp**.

# Soporte por WhatsApp Business — Oppi

Bandeja de soporte con bot automático + agentes humanos, sobre la
WhatsApp Cloud API de Meta. Si no hay credenciales configuradas, todo
funciona en **modo mock** (simulado, sin salir a internet).

## Arquitectura (archivos)

| Archivo | Qué hace |
|---|---|
| `src/lib/whatsapp.js` | Providers: `CloudApiProvider` (API real) y `MockProvider` (simulado). `getProvider()` elige según env vars. `validateConfig()` dice exactamente qué falta. |
| `src/lib/supportBot.js` | El bot: menús de cliente y Oppi Empresas, estados (`bot_state`), contador de "no te entendí" (2 → handoff), reportar no-show. |
| `src/lib/no-show.js` | Lógica de no-show compartida entre `POST /api/bookings/:id/no-show` y el bot. |
| `src/routes/whatsapp.js` | `GET/POST /api/whatsapp/webhook` (verificación y recepción de Meta). |
| `src/routes/support.js` | Bandeja: `GET /api/support/conversations`, historial, `reply`, `handoff`, `bot`, `resolve`, `POST /api/support/agents`. |
| Tablas | `support_conversations`, `support_messages`, `support_agents` (en `src/db/schema.sql` y `src/db/schema.pg.sql`). |

El bot detecta el tipo de conversación por el número: si el `wa_id`
coincide con el teléfono de un usuario con negocio → `kind='business'`
(menú Oppi Empresas); si no → `kind='client'`.

## 1. Conectar el número real (paso a paso)

1. Entrá a [developers.facebook.com](https://developers.facebook.com) → **Mis apps** → **Crear app** (tipo *Empresa*).
2. En el panel de la app: **Agregar producto** → **WhatsApp** → te crea la
   cuenta de WhatsApp Business (WABA) de prueba.
3. En **WhatsApp → Configuración de la API**: agregá el **número de
   teléfono** real (el de Oppi). Meta te pide verificarlo con un código
   por SMS/llamada.
4. En la misma pantalla generá el **token permanente de acceso**
   (System User con permiso `whatsapp_business_messaging`): es el
   `WHATSAPP_ACCESS_TOKEN`. Guardalo: no se vuelve a mostrar.
5. Copiá el **ID del número de teléfono** (*Phone number ID*):
   es el `WHATSAPP_PHONE_NUMBER_ID` (¡no es el número con 595, es un
   ID numérico largo!).
6. Inventá una palabra secreta para el webhook, ej. `oppi-webhook-2026`:
   es el `WHATSAPP_VERIFY_TOKEN`.
7. En **WhatsApp → Configuración → Webhook**: poné
   - URL de devolución: `https://TU-DOMINIO/api/whatsapp/webhook`
   - Token de verificación: el mismo `WHATSAPP_VERIFY_TOKEN` del paso 6
   - Suscribite al campo **`messages`**.
   - Meta hace un `GET` de verificación: si el token coincide, el webhook
     queda en verde ✅ (ese `GET` lo atiende `GET /api/whatsapp/webhook`).
8. Probá: mandá un mensaje de WhatsApp al número de Oppi desde tu
   celular. Tenés que recibir el menú del bot ("¡Hola! 👋 Gracias por
   escribir a Oppi…"). Revisá los logs del servidor si no llega.
9. Recién cuando el paso 8 funcione, publicá el número como canal de
   soporte (web, perfil de IG, etc.).

> ⚠️ El número que conectes a la Cloud API **no puede estar en uso en la
> app WhatsApp Business del celular al mismo tiempo** como número
> personal: Meta lo migra a la API. Para el equipo humano se usan
> **dispositivos vinculados** (ver sección 3), no el número principal.

## 2. Checklist de variables de entorno

En el servidor (Railway/Render o `.env` local) tienen que estar las 3:

| Variable | Qué es | Dónde se consigue |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número (no el número en sí) | developers.facebook.com → app → WhatsApp → Configuración de la API |
| `WHATSAPP_ACCESS_TOKEN` | Token permanente (System User) | Misma pantalla → generar token |
| `WHATSAPP_VERIFY_TOKEN` | Palabra secreta que inventás vos | La elegís vos; va igual en Meta y acá |

Si falta **cualquiera** de las 3, el servidor usa `MockProvider`
(loguea `[whatsapp-mock]` en consola y no sale a internet). Podés ver
qué falta llamando a `validateConfig()` — devuelve mensajes como:

- `Falta WHATSAPP_ACCESS_TOKEN: es el token permanente de acceso a la API …`

Variable opcional:

| Variable | Para qué |
|---|---|
| `PUBLIC_WEB_URL` | URL pública de la web de Oppi (el bot la usa en "Buscar otro profesional" y en el link de la política de cancelación). Si no está, el bot dice "la web de Oppi" en texto. |

## 3. Sumar a las 3 personas del equipo

Cada persona necesita dos cosas: **ver los chats** y **poder responder**.

**A. Vincular dispositivos (para ver WhatsApp en la compu/celular)**

1. En el celular con el número de Oppi: WhatsApp → ⋮ → **Dispositivos vinculados** → **Vincular dispositivo**.
2. Escaneá el QR desde [web.whatsapp.com](https://web.whatsapp.com) en la compu de cada persona (o desde la app WhatsApp Business en su celular: *Dispositivos vinculados*).
3. Listo: ven los chats en tiempo real. (Esto es solo lectura/WhatsApp;
   para **responder desde la bandeja de Oppi** necesitan el paso B.)

**B. Darlos de alta como agentes (para responder desde la bandeja)**

Cada persona necesita primero una **cuenta de usuario en Oppi**
(registrada normal, con su email). Después, con tu sesión de agente:

```bash
# El primero se auto-registra (si todavía no hay ningún agente):
curl -X POST https://TU-DOMINIO/api/support/agents \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"persona1@oppi.com.py","role":"admin"}'

# Los siguientes (ya hay agentes: solo un agente puede sumar a otro):
curl -X POST https://TU-DOMINIO/api/support/agents \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"persona2@oppi.com.py"}'        # role "agent" por defecto
curl -X POST https://TU-DOMINIO/api/support/agents \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"persona3@oppi.com.py"}'
```

Roles: `admin` (puede sumar más agentes) o `agent` (atiende la bandeja).

**C. Cómo atienden (bandeja)**

- `GET /api/support/conversations?status=human` → chats esperando humano.
- `GET /api/support/conversations/:id/messages` → historial.
- `POST /api/support/conversations/:id/reply {"body":"..."}` → responde
  por WhatsApp como humano (la conversación pasa a `human`).
- `POST /api/support/conversations/:id/handoff` → saca al bot, avisa a
  los agentes con notificación in-app.
- `POST /api/support/conversations/:id/bot` → devuelve al bot (reenvía el menú).
- `POST /api/support/conversations/:id/resolve` → cierra (`resolved`).
  Si el contacto escribe de nuevo, se reabre sola en el bot.

## 4. Probar en modo mock (sin credenciales)

1. Asegurate de **no** tener seteadas `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_ACCESS_TOKEN` ni `WHATSAPP_VERIFY_TOKEN`.
2. Levantá la API (`npm start`) y registrá un usuario + hacelo agente
   (`POST /api/support/agents` — el primero entra directo).
3. Simulá un mensaje entrante (payload estilo Meta):

```bash
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "contacts": [{"profile": {"name": "Prueba"}, "wa_id": "595981000001"}],
          "messages": [{
            "from": "595981000001", "id": "wamid.test1",
            "type": "text", "text": {"body": "Hola"}
          }]
        }
      }]
    }]
  }'
```

4. En la consola del servidor vas a ver `[whatsapp-mock] → 595981000001 …`
   con el menú del bot. El envío quedó guardado en `support_messages`
   (sender `bot`) — verificalo con `GET /api/support/conversations`.
5. Probá el flujo: mandá `cancelar` (política en 3 líneas), `reprogramar`
   → te pide el nro → derivación a humano con contexto; dos mensajes sin
   sentido seguidos → handoff automático ("Te paso con un asesor 👌").
6. Tests automatizados: `npm test` (archivo `test/whatsapp.test.js`,
   22 tests: webhook, bot, no-show, bandeja, config).

## Notas de comportamiento

- El bot solo habla si la conversación está en `bot`. En `human` los
  mensajes quedan en la bandeja; en `resolved` un mensaje nuevo la reabre.
- La Cloud API permite **máximo 3 botones interactivos**: los menús del
  bot tienen 4 opciones, así que `sendButtons` los manda como lista
  numerada en texto cuando hay más de 3 (con 3 o menos usa botones
  interactivos de verdad).
- Las respuestas a botones llegan como `interactive.button_reply` con el
  `id` que mandó el bot; el bot también entiende texto libre
  ("quiero cancelar", "reportar un no-show", etc.).
- "Reportar un no-show" (Oppi Empresas) ejecuta **la misma lógica** que
  `POST /api/bookings/:id/no-show`: valida turno pasado, mueve la seña y
  notifica. Si el WhatsApp no está vinculado a una cuenta, deriva a humano.
