# Oppi — App móvil (Expo)

Scaffold **funcional** de la app móvil de Oppi, plataforma paraguaya de reserva de
servicios profesionales (lanzamiento enero 2027). Tres pilares:

1. Reserva de profesionales independientes
2. Marketplace handyman ("Chamba")
3. Oppi Empresas (vía backend; el panel de negocio web vive en `oppi-web`)

Consume el backend **REAL** en `~/workspace/oppi/oppi-api` — auth, reservas,
ofertas, chat, referidos y favoritos van contra la API. Los **pagos son
simulados** (etiquetados "(simulado)" en la UI) hasta que se conecte la
pasarela real.

## Stack

- Expo (managed workflow) + React Native
- React Navigation: bottom tabs + native stack
- `@react-native-async-storage/async-storage` para el JWT (2.1.0: la versión que
  Expo SDK 52 trae en el cliente nativo — no bajar a 1.x, el JS y el módulo
  nativo tienen que estar alineados)
- `expo-location` (~18.0.10, el de SDK 52): botón "📍 Cerca de mí" en Buscar.
  Funciona en Expo Go sin config nativa extra.
- Español rioplatense con voseo · precios en Gs. · barrios de Asunción
- Diseño: fondo `#F7F7FA`, primario `#6B5BD0`, tarjetas blancas redondeadas

## Cómo correr

```bash
cd ~/workspace/oppi/oppi-mobile
npm install
# Nota de sandbox: en ESTE entorno la instalación necesitó
# `npm install --no-bin-links` (permisos del sandbox); en tu máquina
# `npm install` normal alcanza.

# 1) Levantá el backend (otra terminal):
cd ~/workspace/oppi/oppi-api && npm install && npm run seed && npm start

# 2) Corré la app:
npx expo start
# → escaneá el QR con Expo Go (misma Wi-Fi)
```

### Apuntar al backend desde tu teléfono 📱

El default es `http://localhost:3000` (sirve en emulador Android y simulador iOS).
**En dispositivo físico, `localhost` es el teléfono**, así que pasá la IP local de tu
máquina (ambos en la misma Wi-Fi):

```bash
# Ej: tu máquina está en 192.168.1.50
EXPO_PUBLIC_API_URL=http://192.168.1.50:3000 npx expo start
```

O creá un `.env` en esta carpeta:

```
EXPO_PUBLIC_API_URL=http://192.168.1.50:3000
```

El backend tiene que escuchar en esa IP (por default Express escucha en todas las
interfaces, alcanza con que el firewall no lo bloquee).

### Cuentas de prueba (password: `oppi123`)

| Email | Rol |
|---|---|
| `ana@ejemplo.com.py` | client |
| `charly@ejemplo.com.py` | handyman (Carlos "Charly" Duarte) |
| `camila@ejemplo.com.py` | pro (peluquera, Villa Morra) |
| `amigo@oppi.com.py` | client — dueño del código de referido `OPPI-AMIGO` |

## Mapa de pantallas

- **Auth**: `Login` → `POST /api/auth/login` · `Register` → `POST /api/auth/register`
  (roles client / pro / handyman / business). Al registrarse, `RoleGate` (pantalla
  puente, invisible) redirige **una sola vez** según el rol: business →
  `BusinessOnboarding`, pro → `MyServices`, handyman → `HandymanHome`,
  client → tabs. En un login normal siempre va a las tabs.
- **Tabs**: `Inicio` (con ubicación visible 📍 y campana 🔔 global) · `Buscar`
  (botón **"📍 Cerca de mí"** con `expo-location`: pasa `{lat, lng, radio_km}` a
  `GET /api/search` y muestra badge "a X km" por resultado) · `Chamba` ·
  `Reservas` (pestañas Próximas | Pasadas) · `Perfil`
- **Stack cliente**: `ProDetail` (servicios con seña, reseñas con respuestas,
  turno preseleccionado al reservar) → `BookingFlow` (3 pasos: servicio/día/hora →
  confirmación con *"Seña a pagar hoy: Gs. X"* → éxito; modo negocio con horario
  preferido; botones de pago mock etiquetados **"(simulado)"**) · `TaskDetail` (ofertas: ofertar como handyman / aceptar como cliente
  → crea el job) · `PublishTask` (toggle **"Lo necesito hoy"**) · `Chat`
  (mensajes + cotización por chat) · `Favorites` · `Referrals` (código propio +
  canjear, ej. `OPPI-AMIGO` → +Gs. 20.000) · `Notifications` · `Conversations`
- **Stack handyman**: `HandymanHome` (stats, disponibilidad para urgencias,
  alertas por rubro, mis trabajos) → `JobDetail` (seña retenida siempre antes
  del botón de pagar, bottom bar sticky con safe-area)
- **Stack empresas** (11 rutas): `BusinessOnboarding` (4 pasos: datos →
  servicios → horarios → comisión 15% visible) · `MyBusiness` (hub: badge de
  verificación, stats, pendientes con aceptar/rechazar, sección **"Ganancias"**
  con toggle Semana/Mes → `GET /api/business/earnings`) · `BusinessProfile`
  (perfil público con tabs Servicios | Equipo | Reseñas | Info, bottom bar
  sticky) · `MyServices` (perfil profesional + servicios con seña) ·
  `BusinessAgenda` · `BusinessBookings` · `BusinessServices` ·
  `BusinessTeam` · `BusinessReviews` (responder reseñas) · `BusinessDocuments`
  (RUC, habilitación, cédula) · `BusinessNotifications`

## ⚠️ Nota honesta: estado real de la app

- **Sin runtime en Expo Go/emulador**: este entorno no tiene emulador, Expo Go
  ni live browser. Todo el código se verificó **estáticamente** (ver abajo),
  pero ninguna pantalla se abrió en un teléfono ni se probó contra el backend
  corriendo. Antes de dársela a un humano: `npx expo start` + abrir en Expo Go
  en la misma red, probar login/registro por rol, una reserva completa y el
  onboarding de negocio.
- **Sin binario EAS**: no se generó APK/AAB/IPA (ver la sección EAS Build).

## Qué está verificado y cómo (2026-10-01)

Verificación **estática**, sin ejecución en runtime. Script reproducible:
`node /tmp/verify-final.js` (usa `babel-preset-expo`, el mismo preset que Metro).

| Bloque | Verificación |
|---|---|
| **API** (`src/api/client.js`) | 64 métodos 1:1 con el contrato del backend (los 61 originales + `updateMe`, `getEarnings`, `search`), ningún llamado apunta a un endpoint inexistente |
| **Cliente** (8/8) | 8 chequeos: pantallas parsean, imports resuelven, rutas navegadas existen, seña antes de pagar, modales con ✕, CTA 52px/16px |
| **Handyman** (6/6) | 6 chequeos: `HandymanHome` + `JobDetail` parsean, rutas montadas, acciones por rol/estado, pago simulado con seña primero |
| **Empresas** (16/16) | 16 chequeos: las 11 rutas montadas, onboarding 4 pasos, hub, documentos, validación de seña en rojo |
| **Bloque 5 — navegación** | `verify-mobile.js` → 46 archivos parsean sin errores · 0 imports relativos rotos (archivo + nombre exportado) · 21 nombres navegados, 0 sin registrar (de 31 rutas registradas) · los 3 fragmentos (`clientRoutes`, `handymanRoutes`, `BUSINESS_ROUTES`) montados en el stack principal · pantallas anidadas (`navigate('MainTabs', { screen: 'Reservas' })`) verificadas contra las tabs |
| **Botones** | Chequeo estático: 0 `TouchableOpacity`/`Pressable`/`Button` sin `onPress` (o deshabilitado). Se eliminó 1 callejón sin salida: el corazón "Muy pronto" en `BusinessProfile` (no hay endpoint de favoritos para negocios) |
| **Fricción** | `BookingFlow` acepta `preselectSlot {date, time}`: al tocar una hora libre en el perfil del profesional se salta directo a la confirmación (verificado por inspección: los branches de modo profesional y modo negocio intactos) |
| **Reglas del dueño** | CTA base violeta `#6B5BD0` / texto blanco / 52px / bordes 16 · destructivo rojo suave (`#FDECEC` + texto `#E5484D`) con confirmación + consecuencia (ej. cancelar reserva: "Perdés la seña de Gs. X") · seña siempre visible antes de cualquier botón de pagar · todo modal con ✕ · todo flujo con atrás (incluido el caso borde del recién registrado, que vuelve a las tabs) · bottom bar sticky con safe-area en `ProDetail`, `JobDetail`, `BusinessProfile` |

### EAS Build — el camino al binario de producción 🚀

En Expo managed workflow, el APK/AAB/IPA no se compila a mano: lo genera el
servicio de build de Expo (EAS) en la nube. Pasos, en orden:

```bash
cd ~/workspace/oppi/oppi-mobile

# 0) Prerrequisitos: Node 18+ y este proyecto con npm install hecho.
#    `npm install` y resolución de dependencias YA verificados (882 paquetes,
#    sin conflictos de peers). Nota de sandbox: la primera instalación acá
#    necesitó `npm install --no-bin-links` por permisos del entorno; en tu
#    máquina `npm install` normal alcanza. El workaround NO hace falta para
#    EAS (el build corre en la nube de Expo).

# 1) Instalá la CLI de EAS
npm i -g eas-cli

# 2) Logueate con tu cuenta de Expo (creala gratis en https://expo.dev/signup)
eas login

# 3) Configurá el proyecto (una sola vez): genera eas.json y asocia el
#    projectId a tu cuenta de Expo. app.json ya trae package/bundleIdentifier:
#    py.com.oppi.app
eas build:configure

# 4a) Android: genera el AAB listo para subir a Google Play
eas build --platform android

# 4b) iOS: genera el IPA firmado (requiere Apple Developer, ver abajo)
eas build --platform ios
```

**Perfiles útiles** (se generan en `eas.json`):

| Perfil | Para qué |
|---|---|
| `development` | Build de desarrollo con expo-dev-client (para probar código nativo) |
| `preview` | **APK de Android** para probar en un teléfono sin pasar por Play |
| `production` | AAB (Android) / IPA (iOS) para las tiendas |

```bash
# Ej: APK instalable para probar en un Android físico
eas build --platform android --profile preview
```

**Qué cuentas necesitás (y cuánto salen):**

- **Cuenta de Expo** (gratis): para `eas login` y los builds en la nube. El plan
  gratuito tiene cuota limitada de builds por mes; si compilás seguido, el plan
  de pago te rinde más.
- **Apple Developer Program** (USD 99/año, renovación anual): **obligatorio**
  para firmar el IPA y subirlo a TestFlight o App Store. Sin esto no hay build
  de iOS distribuible.
- **Google Play Console** (USD 25, pago único): para subir el AAB a Play Store.
  Ojo con las cuentas nuevas: Google exige una **prueba cerrada de 14 días con
  al menos 20 testers** antes de publicar en producción. El APK del perfil
  `preview` sirve para probar sin Play.

**Qué NO se puede hacer en este entorno** (y por qué):

- **Compilar el binario acá**: EAS Build corre en la nube de Expo o en una
  máquina con Xcode/Android SDK. Este sandbox no tiene macOS/Xcode (imposible
  para iOS), ni emulador, ni Expo Go, ni tus credenciales de Apple/Google.
  El paso 4 se hace desde tu máquina o CI con tu sesión de Expo.
- **Probar en Expo Go desde acá**: `npx expo start` levanta el dev server, pero
  necesitás un teléfono con Expo Go en la misma red para abrirlo — acá no hay.
- **Subir a las tiendas**: requiere tus cuentas (Apple Developer / Play Console)
  y decisiones tuyas (nombre, capturas, descripción). Eso es manual y tuyo.

**Orden recomendado**: `preview` APK en Android primero (más barato y rápido de
iterar) → prueba cerrada en Play → iOS con Apple Developer → TestFlight →
producción. Recién ahí tiene sentido el presupuesto de marketing.

## Qué se agregó (2026-10-01) — batch de 5

1. **Editar perfil real** — `ProfileScreen` → "Editar perfil" abre formulario
   (nombre, teléfono, barrio, foto con picker + subida a `/api/uploads`) que
   guarda contra `PATCH /api/me` vía `client.updateMe(data)` y
   `AuthContext.updateProfile()`. Actualiza la sesión en AsyncStorage y la UI
   al instante; errores con mensaje claro ("No pudimos guardar tu perfil…").
   El header muestra la foto (`foto_url`) si existe. Se lee `nombre ?? name`
   por compatibilidad con respuestas viejas.
2. **Ganancias (Mi negocio)** — `MyBusinessScreen` → sección "Ganancias" con
   toggle Semana/Mes → `client.getEarnings(periodo)` →
   `GET /api/business/earnings?periodo=semana|mes`. Tarjetas: brutos, comisión
   Oppi (15%), neto para vos, reservas, ticket promedio. Gráfico de barras
   **por servicio** hecho con Views (sin dependencias nuevas). Estado vacío
   ("Todavía no hay ganancias…") si `reservas_count` es 0; la tarjeta de error
   permite reintentar tocándola.
3. **Cercanía** — `SearchScreen` → botón **"📍 Cerca de mí"** con
   `expo-location` (~18.0.10, funciona en Expo Go). Pide permiso con
   `requestForegroundPermissionsAsync()` dentro de try/catch: si se deniega o
   falla el GPS, mensaje claro ("No nos diste permiso… / Revisá que el GPS
   esté activado") y **se sigue buscando sin ubicación**. Con ubicación,
   pasa `{q, rubro, lat, lng, radio_km}` a `client.search()` →
   `GET /api/search`; cada resultado trae badge "📍 a X km" (`distance_km`).
   Radio elegible: 5 / 10 / 25 km. **No se simula ningún mapa**: el mapa
   nativo queda declarado como pendiente (ver abajo).
4. **"Pago simulado" visible** — donde el pago es mock, el botón lo dice:
   `BookingFlow` modo negocio → **"Confirmar y pagar seña (simulado)"** +
   aclaración debajo; modo profesional → hint "Pago simulado: hoy no se cobra
   nada de verdad." bajo "Confirmar reserva"; `JobDetail` →
   **"Pagar Gs. X (simulado)"** en bottom bar y modal + nota "Pago simulado ·
   la integración real con la pasarela está en camino." Regla: jamás hacer
   pasar un pago mock por real.
5. **Nuevos métodos en `src/api/client.js`**: `updateMe(data)` (PATCH /api/me),
   `getEarnings(periodo)` (GET /api/business/earnings), `search(filters)`
   (GET /api/search). Nueva dependencia: `expo-location@~18.0.10` (`npm
   install` limpio, sin conflictos de peers).

### Cómo probar (en Expo Go, contra el backend corriendo)

```bash
cd ~/workspace/oppi-api && npm run seed && npm start
cd ~/workspace/oppi/oppi-mobile && EXPO_PUBLIC_API_URL=http://TU_IP:3000 npx expo start
```

- **Editar perfil**: Perfil → Editar perfil → cambiá nombre/teléfono/barrio/foto → Guardar. Tiene que persistir al cerrar y reabrir la app (se guarda en el backend, no solo local). Probá con nombre vacío → error claro.
- **Ganancias**: entrá como negocio (ej. registrando uno) → Mi negocio → Ganancias → alterná Semana/Mes. Sin reservas confirmadas → estado vacío. Con datos → brutos/comisión/neto/reservas/ticket + barras por servicio.
- **Cercanía**: Buscar → 📍 Cerca de mí → aceptá el permiso → los resultados muestran "📍 a X km" ordenados por cercanía. Negá el permiso → mensaje claro y la búsqueda normal sigue andando. Cambiá el radio (5/10/25 km).
- **Pagos simulados**: reservá un servicio con seña (modo negocio) → el botón dice "(simulado)"; completá un trabajo de Chamba como cliente → "Pagar Gs. X (simulado)". Ningún botón de pago puede leerse como un cobro real.
- **Verificación estática**: `node verify-mobile.js` → tiene que salir en verde.

## Pendientes honestos (2026-10-01)

- **Mapa nativo**: declarado como pendiente. La cercanía muestra distancia en
  texto ("a X km"); no hay mapa (react-native-maps no está instalado a
  propósito: es dependencia nativa y hoy no hay runtime para probarlo).
- **EAS Build**: no se generó APK/AAB/IPA (ver sección EAS Build arriba).
- **Teléfono real**: ninguna pantalla se abrió en Expo Go ni se probó contra
  el backend corriendo en este entorno — antes de dársela a un humano hay que
  recorrer los flujos de "Cómo probar" arriba.
- **Pasarela de pago real**: todos los pagos siguen siendo simulados
  (etiquetados como tal). La integración real (`PAYMENT_DRIVER` del backend)
  espera credenciales.
- Manejo fino de errores de red (reintentos/offline), paginación de listas.
- Subida real de fotos (hoy el chat acepta metadata de fotos, el archivo real va
  a un storage).
- Las reseñas con respuesta del profesional se muestran, y el cliente ya expone
  `api.replyReview(id, reply_text)` (`POST /api/reviews/:id/reply` verificado en
  la API) — falta solo la pantalla para responder desde el móvil.

### Follow-ups que necesitan backend (NO implementar en el mobile hasta que existan)

- Columna `active` en `services`: los toggles activo/pausado de `MyServices` y
  `BusinessServices` son locales y no persisten al recargar.
- Campo `slot_id`/`staff_id` en bookings: la reserva de negocio guarda el staff
  y el horario como *preferencia* visible; el negocio lo confirma al aceptar.
- Badges de no leídos en conversaciones: el backend no expone leídos/no leídos
  de mensajes (la lista de `Conversations` no muestra badges).
- Las integraciones marcadas `INTEGRATION POINT:` en el backend (pasarela de
  pago real, push FCM/APNs).

## Estructura

```
oppi-mobile/
  index.js                 # entry (registerRootComponent)
  app.json                 # config Expo (package py.com.oppi.app)
  src/
    App.js                 # SafeAreaProvider + AuthProvider + RootNavigator
    theme.js               # colores, radios, tipografía
    utils.js               # gs(), calcDeposit(), shortDate(), label()
    api/client.js          # HTTP + JWT + 64 métodos 1:1 con la API
    store/AuthContext.js   # sesión global, logout automático en 401,
                           # pendingRole one-shot para el redirect post-registro
    navigation/AppNavigator.js  # RoleGate + MainTabs (con 🔔 global) + stack con
                                # los 3 fragmentos: clientRoutes, handymanRoutes, BUSINESS_ROUTES
    components/            # PrimaryButton, Card, ScreenHeader, Rating
    screens/
      auth/                # LoginScreen, RegisterScreen
      HomeScreen.js        # saludo, buscador, categorías, recomendados, "¿Querés ganar plata? 🔨"
      SearchScreen.js      # filtros: q, categoría, barrio
      ProDetailScreen.js   # servicios con seña, reseñas con respuestas, favorito, chat
      BookingFlowScreen.js # reserva en 3 pasos
      HandymanScreen.js    # explorar tareas, filtro urgentes
      PublishTaskScreen.js # publicar tarea con toggle "Lo necesito hoy"
      TaskDetailScreen.js  # ofertas: ofertar / aceptar → job
      ChatScreen.js        # chat + cotización por chat
      BookingsScreen.js    # mis reservas (Próximas | Pasadas) + mis trabajos
      FavoritesScreen.js
      ProfileScreen.js     # crédito, accesos, salir · editar perfil REAL (PATCH /api/me)
      ReferralsScreen.js   # mi código + canjear
      NotificationsScreen.js  # centro de notificaciones
      ConversationsScreen.js  # lista de chats
      HandymanHomeScreen.js   # modo handyman: stats, urgencias, alertas, trabajos
      JobDetailScreen.js      # detalle del trabajo con pago y reseña mutua
      BusinessOnboardingScreen.js  # alta progresiva del negocio (4 pasos)
      MyBusinessScreen.js     # hub del negocio
      BusinessProfileScreen.js # perfil público del negocio
      MyServicesScreen.js     # perfil + servicios del profesional
      business/            # Agenda, Bookings, Services, Team, Reviews, Documents,
                           # Notifications del negocio + ServiceEditorModal + deposit.js
```
