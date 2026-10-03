'use strict';

/**
 * Bot de soporte por WhatsApp de Oppi (español rioplatense, voseo).
 *
 * Dos menús según `support_conversations.kind`:
 *  - 'client'   → Oppi (buscar profesional, reprogramar, cancelar, otro tema)
 *  - 'business' → Oppi Empresas (asignar colaborador, reprogramar, no-show, asesor)
 *
 * Estado del bot en la conversación:
 *  - `bot_state`: null (saluda y muestra el menú), 'menu', 'await_reschedule_number',
 *    'await_noshow_number'.
 *  - `bot_misses`: "no te entendí" seguidos; a los 2 → handoff automático a humano.
 *
 * El bot solo actúa cuando la conversación está en status 'bot'. Todo lo que
 * envía se guarda en `support_messages` (sender 'bot', direction 'out').
 */
const { queryAll, run } = require('../db');
const { notify } = require('./notifications');
const { reportNoShow } = require('./no-show');

function nowTs() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function publicWebUrl() {
  return process.env.PUBLIC_WEB_URL || 'la web de Oppi';
}

const CLIENT_MENU = {
  text: '¡Hola! 👋 Gracias por escribir a Oppi. ¿Cómo te podemos ayudar?',
  buttons: [
    { id: 'buscar', title: 'Buscar profesional' },
    { id: 'reprogramar', title: 'Reprogramar' },
    { id: 'cancelar', title: 'Cancelar reserva' },
    { id: 'otro', title: 'Otro tema' },
  ],
};

const BUSINESS_MENU = {
  text: '¡Hola! 👋 Gracias por escribir a Oppi Empresas. ¿En qué te ayudamos?',
  buttons: [
    { id: 'asignar', title: 'Asignar colaborador' },
    { id: 'reprogramar', title: 'Reprogramar' },
    { id: 'noshow', title: 'Reportar no-show' },
    { id: 'asesor', title: 'Hablar con asesor' },
  ],
};

function menuFor(kind) {
  return kind === 'business' ? BUSINESS_MENU : CLIENT_MENU;
}

/**
 * Chips de respuesta rápida para el chat integrado in-app (títulos visibles
 * al usuario). Los `id` coinciden con los ids que `matchIntent` entiende.
 */
const CLIENT_QUICK_REPLIES = [
  { id: 'buscar', title: 'Buscar otro profesional' },
  { id: 'reprogramar', title: 'Reprogramar' },
  { id: 'cancelar', title: 'Cancelar una reserva' },
  { id: 'otro', title: 'Otro tema' },
];

const BUSINESS_QUICK_REPLIES = [
  { id: 'asignar', title: 'Asignar otro colaborador' },
  { id: 'reprogramar', title: 'Reprogramar reserva' },
  { id: 'noshow', title: 'Reportar un no-show' },
  { id: 'asesor', title: 'Hablar con un asesor' },
];

function quickRepliesFor(kind) {
  const base = kind === 'business' ? BUSINESS_QUICK_REPLIES : CLIENT_QUICK_REPLIES;
  return base.map((b) => ({ ...b }));
}

/**
 * Provider in-app: la misma interfaz que el provider de WhatsApp
 * (`sendText` / `sendButtons`), pero no toca la red — solo registra los
 * envíos en memoria. Sirve para correr el motor del bot en el chat
 * integrado (el `external_id` de la conversación es `inapp:<userId>`).
 */
class InAppProvider {
  constructor() {
    this.sent = [];
  }
  get name() { return 'inapp'; }

  _record(kind, to, body, extra) {
    const entry = { kind, to: String(to), body: String(body), at: new Date().toISOString(), ...(extra || {}) };
    this.sent.push(entry);
    return { ok: true, driver: 'inapp', id: `inapp-${this.sent.length}` };
  }

  async sendText(to, body) {
    return this._record('text', to, body);
  }

  async sendButtons(to, body, buttons) {
    const labels = (buttons || []).map((b) => (typeof b === 'string' ? b : b.title));
    return this._record('buttons', to, body, { buttons: labels });
  }

  /** Limpia el registro de enviados (tests). */
  clear() { this.sent = []; }
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Extrae un número de reserva del texto (ej. "#1387" o "1387").
 * Prefiere el número con # (acepta 1+ dígitos); si no hay #, pide 2+ dígitos
 * para no confundir un "tengo 2 dudas" con un número de reserva. */
function extractBookingNumber(text) {
  const s = String(text || '');
  const withHash = s.match(/#(\d{1,8})/);
  if (withHash) return Number(withHash[1]);
  const plain = s.match(/\b(\d{2,8})\b/);
  return plain ? Number(plain[1]) : null;
}

/** Clasifica el mensaje entrante. Devuelve un intent o 'unknown'. */
function matchIntent(text) {
  const t = normalize(text);
  if (!t) return 'unknown';
  // IDs exactos de los botones interactivos.
  const ids = ['buscar', 'reprogramar', 'cancelar', 'otro', 'asignar', 'noshow', 'asesor'];
  if (ids.includes(t)) return t;

  const has = (...words) => words.some((w) => t.includes(w));
  if (has('menu', 'inicio', 'empezar', 'volver')) return 'menu';
  if (has('otro profesional', 'busco profesional', 'busco peluquero', 'busco barbero')) return 'buscar';
  if (has('no-show', 'noshow', 'no vino', 'no vinieron', 'falto', 'no se presento', 'no aparecio')) return 'noshow';
  if (has('cancelar', 'cancelacion', 'devolver', 'devolucion', 'reembolso', 'sena')) return 'cancelar';
  if (has('reprogramar', 'reprogramacion', 'cambiar turno', 'cambiar mi turno', 'mover turno', 'cambiar fecha', 'cambiar hora')) return 'reprogramar';
  if (has('asignar', 'colaborador', 'empleado', 'otro empleado')) return 'asignar';
  if (has('asesor', 'humano', 'persona', 'ayuda', 'otro tema', 'otra cosa', 'hablar con alguien')) return 'otro';
  if (has('buscar', 'encontrar', 'profesional', 'peluqueria', 'barberia')) return 'buscar';
  return 'unknown';
}

async function setBotState(db, convId, patch) {
  const sets = [];
  const params = [];
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.bot_state !== undefined) { sets.push('bot_state = ?'); params.push(patch.bot_state); }
  if (patch.bot_misses !== undefined) { sets.push('bot_misses = ?'); params.push(patch.bot_misses); }
  sets.push("updated_at = ?");
  params.push(nowTs(), convId);
  await run(db, `UPDATE support_conversations SET ${sets.join(', ')} WHERE id = ?`, params);
}

/** Envía por el provider y guarda el mensaje saliente del bot. */
async function botSay(db, provider, conv, body, buttons) {
  if (buttons && buttons.length) {
    await provider.sendButtons(conv.external_id, body, buttons);
  } else {
    await provider.sendText(conv.external_id, body);
  }
  await run(db,
    `INSERT INTO support_messages (conversation_id, direction, sender, body) VALUES (?, 'out', 'bot', ?)`,
    [conv.id, body]);
  await run(db, 'UPDATE support_conversations SET updated_at = ? WHERE id = ?', [nowTs(), conv.id]);
}

async function notifyAgents(db, title, body) {
  const agents = await queryAll(db, 'SELECT user_id FROM support_agents');
  for (const a of agents) {
    await notify(db, { userId: a.user_id, type: 'support', title, body });
  }
}

/**
 * Deriva la conversación a un humano: pausa el bot (status 'human'),
 * avisa a los agentes in-app y le avisa al contacto por WhatsApp.
 * `opts.agentContext`: texto para la notificación a agentes.
 * `opts.userMsg`: mensaje personalizado para el contacto (default genérico).
 */
async function handoffToHuman(db, provider, conv, opts) {
  const { agentContext, userMsg } = opts || {};
  await setBotState(db, conv.id, { status: 'human', bot_state: null, bot_misses: 0 });
  const who = conv.kind === 'business' ? 'Oppi Empresas' : 'un cliente';
  await notifyAgents(db,
    '💬 Chat de WhatsApp para atender',
    `${who} necesita un asesor${agentContext ? `: ${agentContext}` : ''}.`);
  await botSay(db, provider, conv,
    userMsg || 'Te paso con un asesor 👌 Enseguida te escribe alguien del equipo.');
}

async function sendMenu(db, provider, conv) {
  const menu = menuFor(conv.kind);
  await setBotState(db, conv.id, { bot_state: 'menu', bot_misses: 0 });
  await botSay(db, provider, conv, menu.text, menu.buttons);
}

function searchStepsText() {
  const web = publicWebUrl();
  return `Dale, te ayudo a buscar otro profesional 👍\n` +
    `1️⃣ Entrá a ${web}/buscar\n` +
    `2️⃣ Filtrá por rubro y barrio\n` +
    `3️⃣ Elegí tu turno y reservá en el acto\n\n` +
    `Si querés que te recomendemos opciones, escribí "asesor" y te pasamos con alguien del equipo.`;
}

function cancelPolicyText() {
  const web = publicWebUrl();
  return `Nuestra política de cancelación, en 3 líneas:\n` +
    `1️⃣ Con 24 h o más de anticipación: cancelás sin cargo y te devolvemos todo lo cobrado.\n` +
    `2️⃣ Con menos anticipación: lo cobrado queda para el profesional o negocio (es su turno reservado).\n` +
    `3️⃣ Durante el piloto: cero cargos ocultos, siempre ves el monto exacto antes de confirmar.\n\n` +
    `El detalle completo está acá: ${web}/politica-cancelacion`;
}

function assignGuideText() {
  return `Para asignar otro colaborador a una reserva:\n` +
    `1️⃣ Entrá a Oppi Empresas → Reservas\n` +
    `2️⃣ Abrí la reserva y tocá "Asignar colaborador"\n` +
    `3️⃣ Elegí quién la toma y listo ✅\n\n` +
    `Si preferís que lo hagamos nosotros, escribí "asesor" y te pasamos con alguien del equipo.`;
}

async function handleUnknown(db, provider, conv) {
  const misses = (conv.bot_misses || 0) + 1;
  if (misses >= 2) {
    await handoffToHuman(db, provider, conv);
    return;
  }
  await setBotState(db, conv.id, { bot_misses: misses });
  const menu = menuFor(conv.kind);
  await botSay(db, provider, conv,
    'Mmm, no te entendí 🤔 Elegí una de estas opciones y te ayudo enseguida:',
    menu.buttons);
}

async function handleNoShowNumber(db, provider, conv, text) {
  const n = extractBookingNumber(text);
  if (!n) return handleUnknown(db, provider, conv);
  if (!conv.user_id) {
    await handoffToHuman(db, provider, conv, {
      agentContext: 'quiere reportar un no-show pero no pudimos vincular su WhatsApp con una cuenta de Oppi Empresas',
    });
    return;
  }
  const r = await reportNoShow(db, n, conv.user_id);
  if (r.ok) {
    await setBotState(db, conv.id, { bot_state: 'menu', bot_misses: 0 });
    await botSay(db, provider, conv,
      `Listo ✅ Marqué el no-show de la reserva #${n} (${r.serviceName}). ` +
      `El cobro quedó para vos según la política. Si necesitás algo más, escribí "menu".`);
  } else {
    await setBotState(db, conv.id, { bot_state: 'menu', bot_misses: 0 });
    await botSay(db, provider, conv,
      `No pude marcar el no-show de la reserva #${n}: ${r.error} ` +
      `Si querés, te paso con un asesor: escribí "asesor".`);
  }
}

/**
 * Corre un turno del bot para un mensaje entrante.
 * `conversation` es la fila fresca de support_conversations.
 */
async function runBot({ db, provider, conversation, text }) {
  const conv = await (async () => {
    const { queryOne } = require('../db');
    return queryOne(db, 'SELECT * FROM support_conversations WHERE id = ?', [conversation.id]);
  })();
  if (!conv || conv.status !== 'bot') return;

  // Primera vez: saludar con el menú (ignora el contenido del mensaje).
  if (!conv.bot_state) {
    await sendMenu(db, provider, conv);
    return;
  }

  // El bot esperaba un número de reserva.
  if (conv.bot_state === 'await_reschedule_number') {
    const n = extractBookingNumber(text);
    if (!n) return handleUnknown(db, provider, conv);
    await handoffToHuman(db, provider, conv, {
      agentContext: `quiere reprogramar la reserva #${n}`,
      userMsg: `¡Listo! Anoté tu reserva #${n}. Te paso con un asesor que la reprograma con vos 👌`,
    });
    return;
  }
  if (conv.bot_state === 'await_noshow_number') {
    await handleNoShowNumber(db, provider, conv, text);
    return;
  }

  const intent = matchIntent(text);
  switch (intent) {
    case 'buscar':
      await setBotState(db, conv.id, { bot_misses: 0 });
      await botSay(db, provider, conv, searchStepsText());
      break;
    case 'cancelar':
      await setBotState(db, conv.id, { bot_misses: 0 });
      await botSay(db, provider, conv, cancelPolicyText());
      break;
    case 'reprogramar':
      await setBotState(db, conv.id, { bot_state: 'await_reschedule_number', bot_misses: 0 });
      await botSay(db, provider, conv, 'Pasame el número de tu reserva (ej. #1387) y la vemos con un asesor.');
      break;
    case 'noshow':
      if (conv.kind !== 'business') {
        await handoffToHuman(db, provider, conv, { agentContext: 'quiere reportar un no-show' });
        break;
      }
      await setBotState(db, conv.id, { bot_state: 'await_noshow_number', bot_misses: 0 });
      await botSay(db, provider, conv, 'Dale. Pasame el número de la reserva donde el cliente no se presentó (ej. #1387).');
      break;
    case 'asignar':
      await setBotState(db, conv.id, { bot_misses: 0 });
      await botSay(db, provider, conv, assignGuideText());
      break;
    case 'otro':
    case 'asesor': // el botón "Hablar con asesor" manda el id del botón
      await handoffToHuman(db, provider, conv);
      break;
    case 'menu':
      await sendMenu(db, provider, conv);
      break;
    default:
      await handleUnknown(db, provider, conv);
  }
}

module.exports = {
  runBot, handoffToHuman, sendMenu, matchIntent, extractBookingNumber,
  CLIENT_MENU, BUSINESS_MENU, notifyAgents,
  CLIENT_QUICK_REPLIES, BUSINESS_QUICK_REPLIES, quickRepliesFor, InAppProvider,
};
