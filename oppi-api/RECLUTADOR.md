# Agente RECLUTADOR — prospección de profesionales para Oppi

El Reclutador arma la lista de profesionales a contactar para el lanzamiento. No usa API keys: trabaja con **plantillas + reglas** y un flujo **manual** hasta que exista conexión con Instagram.

## Cómo funciona

1. **Matriz categoría × barrio**: 8 categorías × 16 barrios de Asunción = 128 combinaciones. Cada celda tiene una query de búsqueda lista para pegar, ej: `peluquera "Villa Morra" instagram`.
2. **Lote diario**: cada corrida genera las siguientes **10 combinaciones sin prospect** y las inserta en `prospects` con `status='nuevo'`, `source='manual'` y la query sugerida en `notes`. Es **idempotente**: nunca duplica una combinación que ya existe.
3. **Vos buscás a mano** (Instagram/Google) con la query, anotás el @handle real y el contacto.
4. **Tracking manual**: movés cada prospecto por el funnel con `--set`.

## Comandos

Desde la raíz del repo (`oppi-api/`):

```bash
node scripts/recruiter.js --dry-run        # Matriz completa con queries (no toca la DB)
node scripts/recruiter.js                  # Lote diario: 10 prospectos nuevos
node scripts/recruiter.js --list           # Todos los prospectos
node scripts/recruiter.js --list --status=nuevo
node scripts/recruiter.js --set 12 contactado
```

Estados del funnel: `nuevo` → `contactado` → `respondio` → `registrado` / `descartado`.

- **nuevo**: recién generado, todavía no buscado.
- **contactado**: le enviaste el primer mensaje.
- **respondio**: te contestó (interesado o con dudas).
- **registrado**: se registró como profesional en Oppi. 🎉
- **descartado**: no le interesa / no califica. Sin rencores.

> Para no ensuciar la DB de desarrollo: `DB_PATH=/tmp/oppi-test.db node scripts/recruiter.js`

## Flujo diario recomendado (manual)

1. Corré el lote: `node scripts/recruiter.js` (sin flags).
2. Para cada prospecto nuevo, copiá la query de `notes` y buscala en Instagram (y Google si hace falta).
3. Cuando encuentres al profesional: actualizá `name` con su @handle o nombre real y `contact` con su WhatsApp/email si lo publica.
4. Mandale el primer mensaje por DM (ver abajo) y marcá `--set <id> contactado`.
5. Si responde → `respondio`. Si se registra → `registrado`. Si no le interesa → `descartado` (anotá el motivo en `notes` si querés).

**Ritmo sugerido**: 10 prospectos nuevos por día, contactando de a pocos por vez. Nada de spam: un DM por profesional, y si no responde en una semana, se deja en paz.

## El primer mensaje

2-3 líneas, en voseo, **sin pitch agresivo**. Presentate como persona, no como vendedor. Ejemplo:

> hola! soy valentino, estoy armando oppi, una app para que profesionales como vos reciban reservas sin estar coordinando por whatsapp todo el día
>
> te puedo contar en 1 minuto cómo funciona? si no te copa, ningún drama 🙌

Reglas del mensaje:

- **Nada de links en el primer mensaje.** El link va cuando responden y muestran interés.
- **Nada de "oportunidad única" ni urgencia falsa.** Si no les sirve, no les sirve.
- **Personalizá una línea**: mencioná algo real de su perfil ("vi que hacés balayage", "vi tus laburos de herrería"). Un mensaje genérico se nota a la legua.
- Si te dejan en visto, no insistir. Un solo follow-up amable a la semana, como máximo.

## Qué necesita del dueño

- **Cuenta de Instagram de Oppi** para buscar perfiles y mandar los DMs (esto es 100% manual: no hay automatización de mensajes).
- Definir el **perfil ideal**: ¿qué rubros primero? (sugerencia: Belleza y Hogar, los de mayor demanda).
- Cuando haya volumen, evaluar la conexión oficial con Instagram para semi-automatizar (eso es otro proyecto; este flujo sigue valiendo igual).
