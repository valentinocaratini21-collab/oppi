/**
 * Cliente HTTP contra el backend REAL de Oppi (~/workspace/oppi-api).
 *
 * Base URL:
 *   - En build: process.env.EXPO_PUBLIC_API_URL (las variables EXPO_PUBLIC_*
 *     se batean DENTRO del binario al compilar el build EAS: no se pueden
 *     cambiar después sin hacer un build nuevo)
 *   - Default: https://oppi-api.up.railway.app (backend de producción)
 *     ⚠️ URL PLACEHOLDER: actualizar este default (y/o EXPO_PUBLIC_API_URL)
 *     cuando el backend tenga su URL real deployada en Railway.
 *   - Desarrollo local: EXPO_PUBLIC_API_URL=http://192.168.1.50:3000
 *     npx expo start (usá la IP local de tu máquina: en un dispositivo
 *     físico la dirección loopback apuntaría al teléfono, no a tu computadora)
 *
 * Auth: el JWT se guarda en AsyncStorage. Todos los llamados con auth:true
 * mandan el header `Authorization: Bearer <token>`. Si el backend responde 401
 * (token vencido/inválido), el cliente borra el token y notifica al AuthContext
 * para desloguear automáticamente.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://oppi-api.up.railway.app').replace(/\/$/, '');

const TOKEN_KEY = 'oppi.jwt';
const USER_KEY = 'oppi.user';

let onUnauthorized = null;
/** El AuthContext se registra acá para que el 401 lo desloguee. */
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function saveSession(token, user) {
  await AsyncStorage.multiSet([
    [TOKEN_KEY, token],
    [USER_KEY, JSON.stringify(user)],
  ]);
}

export async function clearSession() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}

export async function getStoredUser() {
  const raw = await AsyncStorage.getItem(USER_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function request(path, { method = 'GET', body, auth = true, query } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let url = `${API_URL}${path}`;
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    await clearSession();
    if (onUnauthorized) onUnauthorized();
  }

  let data = {};
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: 'Respuesta inválida del servidor.' };
  }

  if (!res.ok) {
    throw new ApiError(res.status, data.error || `Error ${res.status}`, data);
  }
  return data;
}

const get = (path, opts) => request(path, { ...opts, method: 'GET' });
const post = (path, body, opts) => request(path, { ...opts, method: 'POST', body });
const patch = (path, body, opts) => request(path, { ...opts, method: 'PATCH', body });
// `del` acepta body opcional (ej. DELETE /api/push-tokens lleva {token} en el cuerpo).
const del = (path, body, opts) => request(path, { ...opts, method: 'DELETE', body });

/**
 * Endpoints. Los nombres siguen 1:1 el contrato de ~/workspace/oppi-api/src/routes.
 */
/**
 * Completa con el mock solo los campos que el backend no devolvió
 * (null/undefined). Los datos reales siempre ganan.
 */
function fillMissing(real, mock) {
  const out = { ...mock };
  for (const [k, v] of Object.entries(real || {})) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/** Mock coherente: estadísticas del profesional (stats MVP). */
function proStatsMock(periodo) {
  const m = periodo === 'mes';
  return {
    ingresos: m ? 3450000 : 850000,
    reservas_count: m ? 47 : 12,
    conversion_pct: m ? 32.4 : 34.5,
    response_time_median_min: 25,
    clientes_recurrentes: m ? 19 : 5,
    recurrent_pct: m ? 40.4 : 41.7,
    clientes_nuevos: m ? 28 : 7,
    top_servicios: [
      { servicio_id: 1, nombre: 'Corte + barba', ingresos: m ? 1200000 : 320000, reservas: m ? 18 : 5 },
      { servicio_id: 2, nombre: 'Corte clásico', ingresos: m ? 980000 : 240000, reservas: m ? 14 : 4 },
      { servicio_id: 3, nombre: 'Afeitado navaja', ingresos: m ? 640000 : 150000, reservas: m ? 8 : 2 },
    ],
  };
}

/** Mock coherente: reportes del negocio (stats MVP). */
function businessStatsMock(periodo) {
  const m = periodo === 'mes';
  return {
    ingresos: m ? 12800000 : 3100000,
    reservas_count: m ? 186 : 45,
    clientes_recurrentes: m ? 74 : 18,
    recurrent_pct: m ? 39.8 : 40.0,
    top_servicios: [
      { servicio_id: 1, nombre: 'Corte + barba', ingresos: m ? 4200000 : 1050000, reservas: m ? 62 : 15 },
      { servicio_id: 2, nombre: 'Color', ingresos: m ? 3600000 : 880000, reservas: m ? 40 : 10 },
      { servicio_id: 3, nombre: 'Manicura', ingresos: m ? 2100000 : 520000, reservas: m ? 48 : 12 },
    ],
    top_staff: { nombre: 'Lucía Gómez', reservas_count: m ? 58 : 14, ingresos: m ? 3900000 : 960000 },
  };
}

/** Mock coherente: resumen del cliente (stats MVP). */
function clientSummaryMock() {
  return {
    reservas_completadas: 8,
    total_gastado_gs: 640000,
    oppi_points: 320,
  };
}

export const api = {
  // Auth
  register: (payload) => post('/api/auth/register', payload, { auth: false }),
  login: (email, password) => post('/api/auth/login', { email, password }, { auth: false }),
  me: () => get('/api/me'),
  /** PATCH /api/me {nombre, telefono, barrio, foto_url} → usuario actualizado. */
  updateMe: (data) => patch('/api/me', data),

  // Profesionales / catálogo
  professionals: (filters = {}) => get('/api/professionals', { auth: false, query: filters }),
  professional: (id) => get(`/api/professionals/${id}`, { auth: false }),
  /**
   * Búsqueda unificada. Filtros: {q, rubro, lat, lng, radio_km,
   * min_price, max_price (Gs.), disponibilidad ('hoy'|'manana'|'semana'),
   * orden ('relevancia'|'precio_asc'|'precio_desc'|'rating'|'distancia')}.
   * Con lat/lng cada resultado trae `distance_km` ordenado ascendente. */
  search: (filters = {}) => get('/api/search', { auth: false, query: filters }),
  createProfessional: (payload) => post('/api/professionals', payload),
  updateProfessional: (id, payload) => patch(`/api/professionals/${id}`, payload),
  // ⚠️ El backend NO tiene DELETE /api/professionals/:id (solo POST/PATCH).
  services: (filters = {}) => get('/api/services', { auth: false, query: filters }),
  createService: (payload) => post('/api/services', payload),
  updateService: (id, payload) => patch(`/api/services/${id}`, payload),
  deleteService: (id) => del(`/api/services/${id}`),
  slots: (filters = {}) => get('/api/slots', { auth: false, query: filters }),
  createSlot: (payload) => post('/api/slots', payload),
  deleteSlot: (id) => del(`/api/slots/${id}`),
  // ⚠️ El backend NO tiene PATCH /api/slots/:id (solo POST/DELETE).
  config: () => get('/api/config', { auth: false }),

  // Reservas
  bookings: (filters = {}) => get('/api/bookings', { query: filters }),
  booking: (id) => get(`/api/bookings/${id}`),
  createBooking: (payload) => post('/api/bookings', payload),
  updateBooking: (id, payload) => patch(`/api/bookings/${id}`, payload),
  /**
   * Reprogramar una reserva confirmada a otro turno del profesional.
   * POST /api/bookings/:id/reschedule { slot_id } → { booking } (el pago se mantiene).
   */
  rescheduleBooking: (id, slot_id) => post(`/api/bookings/${id}/reschedule`, { slot_id }),
  /**
   * Vista previa de la cancelación: { deposit_gs, refund_gs, forfeit_gs,
   * hours_before, free_cancel, policy_text }. Hay que mostrarla ANTES de
   * ejecutar la cancelación (la plata nunca se mueve sin mostrar el monto exacto).
   */
  cancelPreview: (id) => post(`/api/bookings/${id}/cancel-preview`),
  /** Ejecuta la cancelación (después de mostrar el preview). */
  cancelBooking: (id) => post(`/api/bookings/${id}/cancel`),
  /**
   * Ejecuta la cancelación con motivo (nueva política de comodines).
   * POST /api/bookings/:id/cancel { reason, reason_detail? }
   */
  cancelBookingWithReason: (id, { reason, reason_detail } = {}) =>
    post(`/api/bookings/${id}/cancel`, { reason, reason_detail }),
  /**
   * Vista previa de la nueva política de cancelación (comodines).
   * GET /api/bookings/:id/cancel-preview →
   *   { free_until, dentro_plazo_gratis, resolucion: 'gratis'|'comodin'|'sin_comodin',
   *     comodines: { balance, proximo_en, reset_fecha }, policy_text, pilot_mode }
   * ⚠️ Si el backend aún no lo expone (404), las pantallas lo manejan con gracia.
   */
  cancelPolicyPreview: (id) => get(`/api/bookings/${id}/cancel-preview`),
  /**
   * Reportar no-show con motivo y promesas del dueño.
   * POST /api/bookings/:id/report-no-show { kind, notes?, photo_url? }
   */
  reportNoShow: (id, { kind, notes, photo_url } = {}) =>
    post(`/api/bookings/${id}/report-no-show`, { kind, notes, photo_url }),
  /** GET /api/me/compliance → cumplimiento del usuario (%, no-shows, etc.) */
  myCompliance: () => get('/api/me/compliance'),
  /** GET /api/me/wildcards → comodines del usuario { balance, proximo_en, reset_fecha } */
  myWildcards: () => get('/api/me/wildcards'),
  /** GET /api/businesses/:id/cancellation-history → { history, wildcards } */
  businessCancellationHistory: (id) => get(`/api/businesses/${id}/cancellation-history`),
  /**
   * Marcar "no vino": el backend decide el estado según quién pide
   * (no_show_client si lo pide el pro/negocio, no_show_pro si lo pide el cliente).
   */
  noShowBooking: (id) => post(`/api/bookings/${id}/no-show`),
  /** El profesional/negocio avisa que va en camino (solo el día del servicio). */
  markEnRoute: (id) => post(`/api/bookings/${id}/en-route`),

  // Cupones del negocio (descuentos en el checkout)
  /** GET /api/businesses/:id/coupons → { coupons } */
  businessCoupons: (businessId) => get(`/api/businesses/${businessId}/coupons`),
  /** POST /api/businesses/:id/coupons { code, discount_gs, active? } */
  createCoupon: (businessId, payload) => post(`/api/businesses/${businessId}/coupons`, payload),
  /** PATCH /api/coupons/:id { active } → pausar/activar. */
  setCouponActive: (id, active) => patch(`/api/coupons/${id}`, { active }),
  /** POST /api/coupons/validate { code, business_id, service_id } → { valid, discount_gs } */
  validateCoupon: ({ code, business_id, service_id }) =>
    post('/api/coupons/validate', { code, business_id, service_id }),

  // Ganancias del profesional (Mi servicios → "Ganancias")
  getProEarnings: (periodo) => get('/api/pro/earnings', { query: { periodo } }),

  // Estadísticas / reportes (stats MVP del dueño, 2026-10-03)
  /**
   * Mocks coherentes mientras el backend no tenga los endpoints/campos nuevos.
   * Estrategia:
   *  - GET /api/pro/stats y GET /api/businesses/:id/stats YA existen pero sin
   *    los campos nuevos: se llama al endpoint real y solo se completan con
   *    el mock los campos que vengan null/undefined. Cuando el backend agregue
   *    conversion_pct, response_time_median_min, top_staff y recurrent_pct, los
   *    mocks dejan de usarse para esos campos automáticamente.
   *  - GET /api/me/summary, POST /api/professionals/:id/view y
   *    POST /api/businesses/:id/view todavía NO existen: se intenta el
   *    endpoint real y ante cualquier error se usa el mock (summary) o se
   *    ignora en silencio (view tracking, fire-and-forget).
   */
  proStats: async (periodo) => {
    const mock = proStatsMock(periodo);
    try {
      const real = await get('/api/pro/stats', { query: { periodo } });
      return { stats: fillMissing(real?.stats || real, mock) };
    } catch {
      return { stats: mock };
    }
  },
  /**
   * GET /api/businesses/:id/stats?periodo=semana|mes → contrato extendido
   * (ingresos, reservas_count, top_servicios[], top_staff, recurrentes…).
   */
  businessStats: async (id, periodo) => {
    const mock = businessStatsMock(periodo);
    try {
      const real = await get(`/api/businesses/${id}/stats`, { query: { periodo } });
      return { stats: fillMissing(real?.stats || real, mock) };
    } catch {
      return { stats: mock };
    }
  },
  /**
   * GET /api/me/summary → { reservas_completadas, total_gastado_gs, oppi_points }.
   * Todavía no existe en el backend: usa el mock hasta que esté.
   */
  meSummary: async () => {
    try {
      const real = await get('/api/me/summary');
      return fillMissing(real?.summary || real, clientSummaryMock());
    } catch {
      return clientSummaryMock();
    }
  },
  /**
   * Tracking de vistas de perfiles públicos. Fire-and-forget: dispara el POST
   * al abrir el perfil y nunca rompe la UI si el endpoint aún no existe.
   */
  trackProfessionalView: (id) => {
    if (!id) return;
    post(`/api/professionals/${id}/view`).catch(() => {});
  },
  trackBusinessView: (id) => {
    if (!id) return;
    post(`/api/businesses/${id}/view`).catch(() => {});
  },

  // Clientes (pro y negocio)
  /**
   * GET /api/pro/clients y GET /api/businesses/:id/clients →
   * [{ id, nombre, barrio, reservas_count, ultima_visita, gasto_total,
   *    rating_promedio_dado }].
   */
  proClients: () => get('/api/pro/clients'),
  businessClients: (id) => get(`/api/businesses/${id}/clients`),

  // Pagos del usuario (Perfil → "Mis pagos")
  /** GET /api/me/payments → { payments: [{ id, fecha, concepto, monto_gs, estado, booking_id?, tipo }] } */
  myPayments: () => get('/api/me/payments'),

  // Favoritos
  favorites: () => get('/api/favorites'),
  addFavorite: (professional_id) => post('/api/favorites', { professional_id }),
  removeFavorite: (professional_id) => del(`/api/favorites/${professional_id}`),

  // Handyman: tareas y ofertas
  tasks: (filters = {}) => get('/api/tasks', { auth: false, query: filters }),
  createTask: (payload) => post('/api/tasks', payload),
  task: (id) => get(`/api/tasks/${id}`, { auth: false }),
  updateTask: (id, payload) => patch(`/api/tasks/${id}`, payload),
  createOffer: (taskId, payload) => post(`/api/tasks/${taskId}/offers`, payload),
  taskOffers: (taskId) => get(`/api/tasks/${taskId}/offers`),
  acceptOffer: (offerId, payload) => post(`/api/offers/${offerId}/accept`, payload || {}),
  jobs: () => get('/api/jobs'),
  job: (id) => get(`/api/jobs/${id}`),
  updateJob: (id, payload) => patch(`/api/jobs/${id}`, payload),

  // Chat
  conversations: () => get('/api/conversations'),
  createConversation: (payload) => post('/api/conversations', payload),
  messages: (conversationId) => get(`/api/conversations/${conversationId}/messages`),
  sendMessage: (conversationId, payload) => post(`/api/conversations/${conversationId}/messages`, payload),
  answerQuote: (messageId, status) => patch(`/api/messages/${messageId}/quote`, { status }),

  // Reseñas
  reviews: (filters = {}) => get('/api/reviews', { auth: false, query: filters }),
  createReview: (payload) => post('/api/reviews', payload),
  // Respuesta del profesional/negocio reseñado (una sola vez; body { reply_text }).
  replyReview: (id, reply_text) => post(`/api/reviews/${id}/reply`, { reply_text }),

  // Notificaciones / push
  notifications: (filters = {}) => get('/api/notifications', { query: filters }),
  markNotificationRead: (id, read = true) => patch(`/api/notifications/${id}`, { read }),
  registerPushToken: (token, platform = 'android') => post('/api/push-tokens', { token, platform }),
  // El backend espera el token en el BODY del DELETE (no hay :id en el path).
  unregisterPushToken: (token) => del('/api/push-tokens', { token }),

  // Empresas / Oppi Empresas
  businesses: (filters = {}) => get('/api/businesses', { auth: false, query: filters }),
  business: (id) => get(`/api/businesses/${id}`, { auth: false }),
  createBusiness: (payload) => post('/api/businesses', payload),
  updateBusiness: (id, payload) => patch(`/api/businesses/${id}`, payload),
  businessDocuments: (id) => get(`/api/businesses/${id}/documents`),
  uploadBusinessDocument: (id, payload) => post(`/api/businesses/${id}/documents`, payload),
  updateBusinessDocument: (id, docId, payload) => patch(`/api/businesses/${id}/documents/${docId}`, payload),
  // Equipo: path real del backend (no anidado bajo /businesses/:id).
  team: () => get('/api/team'),
  addTeamMember: (payload) => post('/api/team', payload),
  updateTeamMember: (id, payload) => patch(`/api/team/${id}`, payload),
  removeTeamMember: (id) => del(`/api/team/${id}`),

  // Sucursales del negocio
  /**
   * GET /api/businesses/:id/branches →
   * [{ id, business_id, nombre, direccion, lat, lng, telefono, horario }].
   */
  businessBranches: (id) => get(`/api/businesses/${id}/branches`),
  /** POST /api/businesses/:id/branches {nombre, direccion, lat, lng, telefono, horario} */
  createBranch: (id, payload) => post(`/api/businesses/${id}/branches`, payload),
  /** PATCH /api/businesses/:id/branches/:branchId (mismo payload) */
  updateBranch: (id, branchId, payload) =>
    patch(`/api/businesses/${id}/branches/${branchId}`, payload),
  /** DELETE /api/businesses/:id/branches/:branchId */
  deleteBranch: (id, branchId) => del(`/api/businesses/${id}/branches/${branchId}`),

  // Taxonomía de categorías
  /**
   * GET /api/taxonomy →
   * { categories: [{ id, nombre, icono, professions: [{id, nombre}],
   *                  subcategories: [{id, nombre}] }] }.
   * Si el backend aún no lo expone (404), la UI usa el fallback local.
   */
  taxonomy: () => get('/api/taxonomy', { auth: false }),

  // Subida de fotos: el backend acepta JSON { filename, data_url }
  // (o binario con ?filename=, que en RN es más incómodo).
  upload: ({ filename, data_url }) => post('/api/uploads', { filename, data_url }),

  // Ganancias del negocio (Mi negocio → "Ganancias")
  getEarnings: (periodo) => get('/api/business/earnings', { query: { periodo } }),

  // Referidos
  referrals: () => get('/api/referrals'),
  redeemReferral: (code) => post('/api/referrals/redeem', { code }),

  // Lista de espera de turnos del cliente
  waitlist: () => get('/api/waitlist'),
  joinWaitlist: (payload) => post('/api/waitlist', payload),
  leaveWaitlist: (id) => del(`/api/waitlist/${id}`),

  // Soporte in-app: chat del usuario con el bot (el soporte vive dentro de la
  // app, no en WhatsApp).
  /** POST /api/support/chat { body } → { reply, quick_replies[], status }.
   *  status: 'bot' | 'human' (handoff). */
  supportChat: (body) => post('/api/support/chat', { body }),
  /** GET /api/support/chat/history → { messages: [{ sender: 'bot'|'user'|'agent', body, created_at }] }.
   *  El backend todavía no lo expone: las pantallas lo manejan con gracia. */
  supportHistory: () => get('/api/support/chat/history'),

  // Soporte: bandeja de agentes (WhatsApp)
  /** GET /api/support/conversations?status= → { conversations: [{ id, kind, status, last_message, updated_at, user_name? }] }.
   *  El backend responde 403 si quien pide no es agente. */
  supportConversations: (filters = {}) => get('/api/support/conversations', { query: filters }),
  /** GET /api/support/conversations/:id/messages → { messages } */
  supportMessages: (id) => get(`/api/support/conversations/${id}/messages`),
  /** POST /api/support/conversations/:id/reply { body } → responde y pasa a 'human'. */
  supportReply: (id, body) => post(`/api/support/conversations/${id}/reply`, { body }),
  /** POST /api/support/conversations/:id/handoff → pasa a 'human' sin responder. */
  supportHandoff: (id) => post(`/api/support/conversations/${id}/handoff`),
  /** POST /api/support/conversations/:id/bot → devuelve al bot. */
  supportBot: (id) => post(`/api/support/conversations/${id}/bot`),
  /** POST /api/support/conversations/:id/resolve → marca resuelta. */
  supportResolve: (id) => post(`/api/support/conversations/${id}/resolve`),
  /** GET /api/support/agents → { agents } (puede no existir todavía: manejar null). */
  supportAgents: () => get('/api/support/agents'),
  /** POST /api/support/agents { email } → agrega un agente. */
  addSupportAgent: (email) => post('/api/support/agents', { email }),
  /** GET /api/whatsapp/status → { mode, connected } (puede no existir: manejar null). */
  whatsappStatus: () => get('/api/whatsapp/status'),

  // Cuenta: eliminación, preferencias de notificaciones
  /**
   * DELETE /api/me { password } → elimina la cuenta (anonimiza los datos).
   * El servidor invalida la sesión; la app hace logout después.
   */
  deleteAccount: (password) => del('/api/me', { password }),
  /**
   * GET /api/me/notification-prefs →
   * { reminders, offers, messages, promos } (booleanos).
   */
  getNotificationPrefs: () => get('/api/me/notification-prefs'),
  /**
   * PATCH /api/me/notification-prefs
   * { reminders, offers, messages, promos } → preferencias guardadas.
   */
  saveNotificationPrefs: (prefs) => patch('/api/me/notification-prefs', prefs),

  // Admin (solo usuarios admin)
  /** GET /api/admin/overview → { stats: {...} | contadores varios }. */
  adminOverview: () => get('/api/admin/overview'),
  /**
   * GET /api/admin/verifications →
   * { verifications: [{ id, user/business info, documents: [url], status, created_at }] }.
   */
  adminVerifications: () => get('/api/admin/verifications'),
  /**
   * POST /api/admin/verifications/:id { decision: 'approved'|'rejected', reason? }.
   */
  verifyDecision: (id, { decision, reason } = {}) =>
    post(`/api/admin/verifications/${id}`, { decision, reason }),
  /** POST /api/admin/users/:id/suspend → suspende la cuenta del usuario. */
  suspendUser: (id) => post(`/api/admin/users/${id}/suspend`),
  /** POST /api/admin/users/:id/unsuspend → reactiva la cuenta del usuario. */
  unsuspendUser: (id) => post(`/api/admin/users/${id}/unsuspend`),
  // Equipo IA: cola de moderación de reseñas.
  /** GET /api/admin/moderation → { queue: [...] } (reseñas retenidas). */
  adminModeration: () => get('/api/admin/moderation'),
  /** POST /api/admin/moderation/:id { decision: 'approve'|'reject' }. */
  decideModeration: (id, decision) => post(`/api/admin/moderation/${id}`, { decision }),
};
