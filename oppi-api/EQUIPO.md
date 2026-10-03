# 🤖 EQUIPO.md — El equipo IA de Oppi

Oppi tiene un equipo de agentes de IA que trabajan por áreas, cada uno con su
rol y sus reglas. Todos hablan español rioplatense con voseo, como la app.

**Regla madre del equipo (sin excepciones):** nada que llegue a un cliente,
profesional o negocio — mensajes, posteos, DMs, aprobaciones públicas — sale
sin la aprobación explícita del dueño. Los agentes preparan, proponen y
alertan; el dueño decide.

**Convención compartida:** todo agente que corre deja una fila en la tabla
`agent_runs` (agente, acción, objetivo, fecha). Así la Carta diaria puede
contar quién trabajó y no se spamea a nadie (máx 1 nudge por semana por
usuario).

---

## 1. 🛎️ Soporte

**Estado:** ✅ ya existe y funciona.

**Qué hace:** bot in-app + WhatsApp (`src/lib/supportBot.js`) que atiende
conversaciones de soporte. Tiene dos menús: clientes (buscar profesional,
reprogramar, cancelar, otro tema) y Oppi Empresas (asignar colaborador,
reprogramar, no-show, asesor). Si no entiende 2 veces seguidas, o el usuario
lo pide, deriva la conversación a un humano (`status='human'`). Todo queda
guardado en `support_conversations` / `support_messages`.

**Comando:** no tiene script propio — corre dentro de la API.
```bash
node src/server.js   # o: npm start
```
La bandeja humana se atiende en `GET/POST /api/support/conversations*`.

**Qué necesita del dueño:** para in-app, nada (ya anda). Para WhatsApp, una
cuenta de WhatsApp Business conectada — ver `WHATSAPP.md`.

---

## 2. 🔍 Verificador

**Estado:** ✅ construido (`src/lib/verifier.js`).

**Qué hace:** pre-revisa la cola de verificaciones pendientes (documentos de
negocios y perfiles de profesionales) con reglas legibles: archivo presente
(`file_url`), tamaño razonable (`file_size`: 0 = corrupto, < 5KB sospechoso,
> 10MB pesado), tipos esperados (ruc, habilitación, identidad), RUC paraguayo
con formato válido (`XXXXXXXX-X`), y completitud del registro. Devuelve
`{score 0-100, flags[]}` que el admin ve en `#/admin` (web y móvil) antes de
aprobar/rechazar. **Nada se auto-aprueba**: solo puntúa, la decisión es
humana. Hook `HOOK-VISION` marcado en el código para un modelo de visión
a futuro.

**Comando:** integrado en `GET /api/admin/verifications` (cada item trae
`precheck: {score, flags}`). Sin script separado.

**Qué necesita del dueño:** nada para la versión con reglas.

---

## 3. 🛡️ Moderador

**Estado:** ✅ construido (`src/lib/moderator.js`).

**Qué hace:** revisa cada reseña nueva ANTES de publicar con reglas claras:
insultos (lista ES, `boludo` excluido por ser trato rioplatense), URLs/spam,
TODO EN MAYÚSCULAS, texto duplicado (posible falsa), incoherencia
rating↔texto, y reseña vacía con rating bajo. Decide `aprobada` (se publica
y notifica al profesional) o `retenida` (queda en la cola de moderación del
`#/admin` con el motivo; la decide un humano: publicar o rechazar). Ante la
duda se publica. Hook `HOOK-LLM` marcado para análisis de sentimiento fino
a futuro.

**Comando:** integrado en `POST /api/reviews` + `GET/POST /api/admin/moderation`.
Sin script separado.

**Qué necesita del dueño:** nada para la versión con reglas.

---

## 4. 🎣 Reclutador

**Estado:** ✅ construido (`scripts/recruiter.js` + doc `RECLUTADOR.md`).

**Qué hace:** genera el lote diario de prospectos (10 combinaciones
categoría × barrio de Asunción sin prospecto previo, idempotente) con la
query de búsqueda lista en `notes`, y trackea el pipeline
(`nuevo` → `contactado` → `respondio` → `registrado`/`descartado`).
**Nunca contacta solo**: el contacto es manual hasta conectar Instagram.

**Comando:**
```bash
node scripts/recruiter.js --dry-run   # ver la matriz sin tocar la DB
node scripts/recruiter.js             # genera el lote diario
node scripts/recruiter.js --list [--status=X]
node scripts/recruiter.js --set <id> <estado>
```

**Qué necesita del dueño:** la cuenta de Instagram de Oppi (o el canal que se
elija para el outreach) y la aprobación de cada mensaje antes de enviarlo.
Sin aprobación, el reclutador solo prepara y lista — no envía nada.

---

## 5. ✍️ Contenido

**Estado:** ✅ construido (`scripts/content.js` + doc `CONTENIDO.md`).

**Qué hace:** genera borradores de posteos pre-lanzamiento (oct 2026 → ene
2027, 3/semana) en `content_drafts` como `draft`: tipos `beneficio`,
`como_funciona`, `prueba_social`, `countdown`, en voseo rioplatense con CTA
y hashtags. **Nunca publica solo**: el dueño aprueba cada pieza (`approved`)
y recién ahí se publica manualmente. Ningún path del código escribe
`published`.

**Comando:**
```bash
node scripts/content.js --dry-run   # ver sin insertar
node scripts/content.js             # genera el calendario (anti-duplicados)
node scripts/content.js --list [--status=X]
node scripts/content.js --approve <id>
```

**Qué necesita del dueño:** la cuenta de Instagram de Oppi, la aprobación de
cada pieza, y fotos/videos para acompañar (los scripts generan texto).

---

## 6. 🧭 Guardián

**Estado:** ✅ construido (`scripts/guardian.js`, score puro en
`src/lib/profile-score.js`).

**Qué hace:** cuida la salud de la base. Calcula un score de completitud
0-100 por profesional (foto, bio, servicios con precio, categoría, barrio,
disponibilidad) y por negocio (logo, descripción, servicios, horario,
dirección). Si el score < 80, manda **un** nudge amable en voseo con lo
concreto que falta. Usa `agent_runs` para no spamear: máximo 1 nudge por
semana por usuario.

**Comando:**
```bash
node scripts/guardian.js --dry-run   # ver a quién le escribiría
node scripts/guardian.js             # envía los nudges (con anti-spam)
```

**Qué necesita del dueño:** nada.

---

## 7. 🚨 Centinela

**Estado:** ✅ construido (`scripts/sentinel.js`).

**Qué hace:** vigila y solo alerta, nunca actúa solo. Mira: reservas
`pending` hace > 4h sin aceptar (alerta a los admins, 1 por reserva),
reservas confirmadas de hoy sin "voy en camino" a ≤ 1h del turno (aviso al
profesional), y cuentas con 2 no-shows (alerta a admins: están a 1 de la
suspensión). Todo queda en `agent_runs` + notificaciones in-app.

**Comando:**
```bash
node scripts/sentinel.js --dry-run   # ver qué alertaría
node scripts/sentinel.js             # envía las alertas (con anti-spam)
```

**Qué necesita del dueño:** nada (solo lectura).

---

## 8. 🗞️ Carta diaria

**Estado:** ✅ construida (`scripts/daily-brief.js`).

**Qué hace:** cada noche lee las métricas de las últimas 24h (usuarios,
reservas, GMV, verificaciones, reseñas, soporte, corridas de agentes, modo
piloto de cancelaciones) y escribe el brief en
`~/workspace/goals/oppi-app-launch/briefs/YYYY-MM-DD.md`: resumen, tabla de
métricas, qué necesita atención y nota de honestidad en pre-lanzamiento (si
todo es cero, lo dice — nunca inventa datos).

**Comando:**
```bash
node scripts/daily-brief.js            # genera y guarda el brief
node scripts/daily-brief.js --dry-run  # lo imprime sin guardar
```

**Qué necesita del dueño:** nada.

---

## 🕐 Propuesta de horarios

> ⚠️ **Aclaración explícita: NO crear cron jobs todavía.** Esta tabla es una
> propuesta para que el dueño la revise y apruebe. Recién después se
> programan.

| Agente | Frecuencia sugerida | Horario sugerido (Paraguay) |
|---|---|---|
| Soporte | Siempre activo (corre con la API) | — |
| Moderador | En vivo (corre en cada reseña nueva) | — |
| Verificador | En vivo (corre al abrir la cola de verificaciones) | — |
| Centinela | Cada 15 min | — |
| Reclutador | Diario | 9:00 (prepara; el contacto es manual con aprobación) |
| Contenido | Semanal | Miércoles 9:00 (borradores para aprobar) |
| Guardián | Semanal | Lunes 10:00 |
| Carta diaria | Diaria | 22:00 |

---

## 🔌 Nota de hooks (modelos a futuro)

Hoy ningún agente usa API keys: todo lo que existe o está propuesto funciona
con reglas legibles. Cuando el volumen lo pida, estos son los enchufes
naturales para un modelo:

- **Verificador → visión:** leer la foto del documento (`business_documents.file_url`)
  para chequear legibilidad, que el RUC sea visible y que el tipo de documento
  coincida con lo declarado. Requiere una API key de un proveedor de visión
  (ej. `OPENAI_API_KEY`).
- **Moderador → LLM:** entender el tono y el contexto de una reseña antes de
  retenerla (ironía, quejas legítimas vs. insultos). Misma key.
- **Contenido → LLM:** redactar los borradores con más variedad cuando haya
  datos reales de qué funciona.

Sin esas keys, los agentes siguen andando con reglas. No hay nada que
configurar hoy.
