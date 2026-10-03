# Pagos — Oppi API

Estado: `PAYMENT_PROVIDER=mock` es el default y funciona hoy (cobro simulado
del 100% del total + registro contable en la tabla `payments`). `bancard` está
**implementado a nivel de protocolo** en `src/lib/payments.js`
(`BancardProvider`): construcción de requests, firmas MD5 por operación,
endpoints staging/prod, confirmación y validación del webhook.
**Solo faltan las credenciales del dueño** (checklist abajo).

**La seña se eliminó (2026-10):** el cliente paga el 100% del total al
confirmar la reserva (o al aceptar una oferta en el marketplace). La interfaz
es `charge({ amountGs, description, metadata })` + `refund(paymentId,
amountGs?)`. No hay holds, preautorizaciones, capturas ni liberaciones.

## Cómo funciona con Bancard (vPOS 0.3, venta directa)

El cobro de Oppi se mapea a una **venta directa** de Bancard:

1. **Cobrar el total** — `charge({ amountGs, description })`
   → `POST /vpos/api/0.3/single_buy` **sin** `preauthorization`.
   Devuelve `{ paymentId, status: 'pending', amountGs, processId, checkoutJsUrl }`.
   `paymentId` es el `shop_process_id` (entero de 15 dígitos, único por operación).
   El frontend abre el iframe de Bancard con
   `Bancard.Checkout.createForm(contenedor, processId)` usando `checkoutJsUrl`
   (`https://{env}/checkout/javascript/dist/bancard-checkout-4.0.0.js`).
   **La tarjeta del cliente nunca pasa por nuestros servidores.**
2. **El cliente paga en el iframe** — Bancard hace `POST` servidor-a-servidor
   (`single_buy_confirm`) a la URL de confirmación configurada en el portal de
   comercios, y redirige el browser a `PAYMENT_BANCARD_RETURN_URL`.
3. **Webhook** — la ruta (ver abajo) verifica la firma, re-consulta y marca el
   pago como `captured` en la tabla `payments`, y la reserva como pagada
   (`paid=1`). ⚠️ Responder HTTP 200 en ≤ 30 segundos; si no llega el webhook,
   re-consultar con `getConfirmation()`.
4. **Reembolso** — `refund(paymentId)` → reversa total vía
   `POST /vpos/api/0.3/single_buy/rollback` (solo el mismo día; después es
   manual por el portal). vPOS no tiene reembolso parcial por API: montos
   parciales se hacen desde el portal y se registran a mano en `payments`.

## Firmas (tokens MD5 por operación)

La clave privada **nunca viaja en claro**, solo dentro del hash. Fórmulas
(verificadas contra la documentación oficial "eCommerce – Compra Simple" v1.23.1):

| Operación | Fórmula |
|---|---|
| `single_buy` | `md5(private_key + shop_process_id + amount + currency)` |
| `get_confirmation` | `md5(private_key + shop_process_id + "get_confirmation")` |
| `rollback` | `md5(private_key + shop_process_id + "rollback" + "0.00")` |
| webhook `single_buy_confirm` | `md5(private_key + shop_process_id + "confirm" + amount + currency)` |

`amount` = string con 2 decimales y punto (`"150000.00"`), `currency = "PYG"`.

## Endpoints

| Ambiente | Base |
|---|---|
| staging | `https://vpos.infonet.com.py:8888` |
| prod | `https://vpos.infonet.com.py` |

Rutas (base + path): `/vpos/api/0.3/single_buy`,
`/vpos/api/0.3/single_buy/confirmations`, `/vpos/api/0.3/single_buy/rollback`.

⚠️ **TLS/HTTP**: vPOS exige TLS 1.2+. Cloudflare delante de
`vpos.infonet.com.py` puede bloquear pedidos HTTP/1.1 con huella TLS de
OpenSSL 3.0 (403 "Sorry, you have been blocked"): si staging devuelve eso,
hay que salir por HTTP/2.

## Webhook: qué tiene que hacer la ruta

```js
// 1. Leer el body JSON: { operation: { token, shop_process_id, response, amount, ... } }
// 2. const provider = getPaymentProvider(); // PAYMENT_PROVIDER=bancard
//    const cb = provider.verifyConfirmationCallback(req.body); // valida la firma MD5
// 3. Zero-trust: const conf = await provider.getConfirmation(cb.shopProcessId);
// 4. Buscar en `payments` por provider_payment_id = cb.shopProcessId
//    y actualizar status → 'captured' (si aprobado) o 'failed'.
//    Si es el cobro de una reserva, marcar bookings.paid = 1.
// 5. Responder 200 rápido (≤ 30 s). Ante duda, NO acreditar: re-consultar.
```

La verificación de firma usa comparación en tiempo constante
(`crypto.timingSafeEqual`).

## Límites operativos de vPOS (importantes para producto)

- **El rollback solo funciona el mismo día** de la operación. Después la
  reversa es manual por el portal de comercios.
- Con tarjeta de débito el monto se **acredita en el acto** (no hay hold).
- Pasar a producción exige completar la **lista de tests del portal**
  (single_buy, confirm, get_confirmation y rollback exitosos) y la
  certificación del equipo de soporte de Bancard.
- Antifraude: 7 rechazos de la misma tarjeta en 24 h (o 35 en 30 días) la
  bloquean en el comercio por 30 días → limitar reintentos del lado de Oppi.

## Checklist de credenciales (pedirle al dueño)

Todo sale del **portal de comercios de Bancard**
(lo entrega Bancard al dar de alta el comercio; el ejecutivo de cuenta indica
cómo entrar). Nada de esto va commiteado: va en variables de entorno.

| Variable | Qué es | Dónde se consigue |
|---|---|---|
| `PAYMENT_BANCARD_PUBLIC_KEY` | Llave pública del comercio | Portal de comercios de Bancard → credenciales del comercio |
| `PAYMENT_BANCARD_PRIVATE_KEY` | Llave privada del comercio (solo para firmar los MD5) | Portal de comercios de Bancard → credenciales del comercio |
| `PAYMENT_BANCARD_ENV` | `staging` o `prod` | Empezar en `staging`; `prod` solo tras certificar |
| `PAYMENT_BANCARD_RETURN_URL` | (opcional) URL a la que vuelve el browser tras pagar | La define el dueño (ej. `https://app.oppi.com.py/pago/ok`); si se omite usa la del portal |
| `PAYMENT_BANCARD_CANCEL_URL` | (opcional) URL a la que vuelve si cancela | Igual que arriba |
| URL de confirmación del webhook | `POST https://<api>/api/payments/bancard-webhook` — **se configura en el portal, no por API** | Portal de comercios → configuración del comercio (una sola URL para vPOS; pedirle al ejecutivo si hay una por ambiente) |

Además, del lado comercial (no es código, pero bloquea el go-live):
- [ ] Alta del comercio en Bancard con producto **vPOS compra simple** (venta directa, sin preautorización)
- [ ] Credenciales de **staging** + casos de prueba del portal
- [ ] Completar la lista de tests y la **certificación** con soporte de Bancard
- [ ] Montos mínimos/máximos por transacción acordados con el ejecutivo

## Probar en staging (cuando haya credenciales)

```bash
PAYMENT_PROVIDER=bancard \
PAYMENT_BANCARD_PUBLIC_KEY=... \
PAYMENT_BANCARD_PRIVATE_KEY=... \
PAYMENT_BANCARD_ENV=staging \
node -e "
const { BancardProvider } = require('./src/lib/payments');
(async () => {
  const p = new BancardProvider();
  const charge = await p.charge({ amountGs: 10000, description: 'Prueba staging' });
  console.log('shop_process_id:', charge.paymentId, '| process_id:', charge.processId);
  console.log('iframe JS:', charge.checkoutJsUrl);
})();
"
```

Si el `POST` devuelve 403 en HTML de Cloudflare → hay que migrar el cliente
HTTP a HTTP/2 (avisar; el código está aislado en `BancardProvider._post`).

## Historial

- **2026-10**: se eliminó la seña. Antes el flujo era preautorización
  (`createDepositHold`/`captureHold`/`releaseHold`); ahora es venta directa
  (`charge`/`refund`). Las columnas `bookings.deposit_gs/deposit_paid` y
  `jobs.deposit_held_gs` quedaron deprecadas (se conservan por historial);
  el cobro vive en `bookings.paid_gs/paid`, `jobs.paid_gs` y la tabla
  `payments` (`kind='charge'`).
