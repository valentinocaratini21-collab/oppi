/* ============================================================================
 * Oppi web — checks de alineación (node tests/render-check.js)
 * ----------------------------------------------------------------------------
 * 1) Renderiza las vistas con stubs de DOM y verifica HTML: sin "undefined",
 *    sin "seña", sin null/NaN visibles, y con los marcadores de diseño.
 * 2) Assertions del API layer (MockAdapter): pago 100%, roles, tracking,
 *    estadísticas MVP.
 * 3) Chrome por rol: navItems por modo, guards de ruta, flag FEATURE_MAP.
 * Sale con código 1 si algo falla.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'js');

/* ------------------------- stubs de DOM --------------------------------- */
function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false,
    disabled: false, hidden: false, scrollTop: 0, scrollHeight: 0,
    files: [], dataset: {}, style: {}, title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, remove() {}, click() {}, scrollIntoView() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return true; },
    getAttribute() { return null; },
    setAttribute() {},
  };
}

let capturedView = '';
const els = {};
function getEl(id) {
  if (id === 'view') {
    if (!els.view) {
      els.view = makeEl();
      Object.defineProperty(els.view, 'innerHTML', {
        get() { return capturedView; },
        set(v) { capturedView = String(v); },
      });
    }
    return els.view;
  }
  if (!els[id]) els[id] = makeEl();
  return els[id];
}

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, encodeURIComponent,
  document: {
    getElementById: getEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeEl(),
    addEventListener() {},
    body: makeEl(),
    title: 'Oppi',
  },
  window: {
    scrollTo() {}, scrollY: 0,
    addEventListener() {}, removeEventListener() {},
  },
  location: { hash: '#/', search: '?mock=1', href: 'http://localhost/#/?mock=1', reload() {} },
  navigator: {},
  history: { back() {} },
  // Sin localStorage: OppiStore usa memoria (igual que en los tests).
  // AppChrome y Router se cargan de verdad (js/app.js, js/router.js).
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['data.js', 'api.js', 'ui.js', 'router.js', 'views-public.js', 'views-auth.js',
                 'views-client.js', 'views-handyman.js', 'views-business.js', 'views-map.js',
                 'views-tasks-map.js', 'views-cancel.js', 'views-support.js', 'views-support-chat.js',
                 'views-plus.js', 'views-launch.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), sandbox, { filename: f });
}

/* ------------------------- mini runner ---------------------------------- */
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.error('  ✗ FAIL:', name); }
}
function noUndef(html, name) {
  ok(!/undefined/.test(html), `${name}: sin "undefined" en el HTML`);
}
/* Ningún "seña" suelto en UI: \b evita falsos positivos (diseñador, reseña). */
const SENA_RX = /\bseñas?\b/i;
function noSena(html, name) {
  ok(!SENA_RX.test(html), `${name}: sin "seña" en el HTML`);
}
function noNullNaN(html, name) {
  ok(!/\bnull\b|\bNaN\b|\bundefined\b/.test(html), `${name}: sin null/undefined/NaN visibles`);
}
function has(html, needle, name) {
  ok(html.includes(needle), `${name}: contiene «${needle}»`);
}
function notHas(html, needle, name) {
  ok(!html.includes(needle), `${name}: no contiene «${needle}»`);
}
function hasSrc(f, needle, name) {
  ok(fs.readFileSync(path.join(JS, f), 'utf8').includes(needle), `${f}: ${name}`);
}
function notSrc(f, needle, name) {
  ok(!fs.readFileSync(path.join(JS, f), 'utf8').includes(needle), `${f}: ${name}`);
}
async function render(fn, name) {
  capturedView = '';
  await fn();
  return capturedView;
}
/* Resuelve una ruta y devuelve el hash final (los guards redirigen con go). */
const R = name => vm.runInContext(name, sandbox);
async function resolveHash(hash) {
  sandbox.location.hash = hash.startsWith('#') ? hash : '#' + hash;
  const Router = R('Router');
  const run = Router.resolve();
  await run();
  return sandbox.location.hash;
}

(async () => {
  const G = name => vm.runInContext(name, sandbox);
  const OppiAPI = G('OppiAPI');
  const ViewsPublic = G('ViewsPublic'), BookingFlow = G('BookingFlow'),
        ViewsClient = G('ViewsClient'), ViewsHandyman = G('ViewsHandyman'),
        ViewsBusiness = G('ViewsBusiness'), BizBooking = G('BizBooking'),
        ViewsMap = G('ViewsMap'), ViewsCancel = G('ViewsCancel'),
        ViewsTasksMap = G('ViewsTasksMap'), ViewsPlus = G('ViewsPlus'),
        ViewsSupport = G('ViewsSupport'), ViewsLaunch = G('ViewsLaunch'),
        SupportChat = G('SupportChat'), Onboarding = G('Onboarding'),
        AppChrome = G('AppChrome'), Router = G('Router'),
        OppiMode = G('OppiMode'), OppiConfig = G('OppiConfig'),
        UI = G('UI');
  G('registerRoutes')();
  await OppiAPI.init(); // ?mock=1 -> MockAdapter
  ok(OppiAPI.adapterMode() === 'mock', 'adapter en modo mock');
  const lg = await OppiAPI.login({ email: 'vale@test.com', password: '1234' });
  ok(lg.ok, 'login mock');
  const todayISO = new Date().toISOString().slice(0, 10);
  const ydayISO = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const d5 = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);

  console.log('— pago 100%: sin seña en la UI —');

  // Perfil público del profesional: sin línea de seña + tracking fire-and-forget
  {
    const MA = G('MockAdapter'), s = MA._load();
    const before = (s.views && s.views.pros && s.views.pros.p1) || 0;
    let html = await render(() => ViewsPublic.pro({ id: 'p1' }), 'pro');
    noUndef(html, 'pro p1'); noSena(html, 'pro p1');
    has(html, 'data-protab="servicios"', 'pro: tabs');
    has(html, 'id="proDays"', 'pro: carrusel 14 días');
    has(html, 'Elegir', 'pro: botón Elegir');
    has(html, 'Reservar', 'pro: CTA reservar');
    const after = MA._load().views.pros.p1;
    ok(after === before + 1, 'pro: trackProView fire-and-forget (cuenta la visita)');
  }

  // Booking: paso 1 y 2
  {
    let html = await render(() => BookingFlow.step1({ proId: 'p1', serviceId: 'p1s2' }, {}), 'booking step1');
    noUndef(html, 'booking step1'); noSena(html, 'booking step1');
    has(html, 'id="bkSvcSel"', 'booking step1: selector de servicio');
    BookingFlow.state = { proId: 'p1', serviceId: 'p1s1', date: '2026-10-05', time: '10:00' };
    html = await render(() => BookingFlow.step2(), 'booking step2');
    noUndef(html, 'booking step2'); noSena(html, 'booking step2');
    noNullNaN(html, 'booking step2');
    has(html, 'Total a pagar', 'booking step2: total a pagar');
    const totalIdx = html.indexOf('Total a pagar');
    const payIdx = html.indexOf('Pagar Gs.');
    ok(totalIdx > -1 && payIdx > -1 && totalIdx < payIdx, 'booking step2: el total va antes del botón de pagar');
    has(html, 'pago simulado', 'booking step2: el botón aclara que es simulado');
    notHas(html, 'Seña hoy', 'booking step2: sin "Seña hoy"');
    notHas(html, 'Pagás después', 'booking step2: sin "Pagás después"');
  }

  // Detalle de servicio: botón "Reservar · Gs. X", sin línea de seña
  {
    const html = await render(() => ViewsPlus.serviceDetail({ id: 'p1s1' }), 'detalle servicio');
    noUndef(html, 'detalle servicio'); noSena(html, 'detalle servicio');
    has(html, 'Reservar', 'detalle servicio: botón reservar');
  }

  // Mis reservas del cliente
  {
    const html = await render(() => ViewsClient.bookings(), 'reservas');
    noUndef(html, 'reservas'); noSena(html, 'reservas');
  }

  // Negocio público: sin seña + tracking
  {
    const MA = G('MockAdapter');
    const v0 = MA._load().views || {};
    const before = (v0.biz && v0.biz.demo) || 0;
    const html = await render(() => ViewsBusiness.public({ id: 'demo' }), 'negocio público');
    noUndef(html, 'negocio público'); noSena(html, 'negocio público');
    has(html, 'Reservar', 'negocio público: botón reservar');
    ok(MA._load().views.biz.demo === before + 1, 'negocio público: trackBizView fire-and-forget');
  }

  // Alta de negocio paso 2: sin campos de seña
  {
    const html = await render(() => ViewsBusiness.signupStep2(), 'alta paso 2');
    noUndef(html, 'alta paso 2'); noSena(html, 'alta paso 2');
    notHas(html, 'Tipo de seña', 'alta paso 2: sin tipo de seña');
    has(html, 'Agregar servicio', 'alta paso 2: agregar servicio');
  }

  // Trabajo handyman: 100% pagado, completar sin cobro extra
  {
    const MA = G('MockAdapter'), s = MA._load();
    const j2 = s.jobs.find(j => j.id === 'j2');
    j2.status = 'in_progress'; j2.agreedPrice = 130000; j2.paid = 130000; MA._save();
    const html = await render(() => ViewsHandyman.jobDetail({ id: 'j2' }), 'trabajo');
    noUndef(html, 'trabajo'); noSena(html, 'trabajo');
    has(html, 'Completar trabajo', 'trabajo: botón completar');
    has(html, 'Ya pagaste el 100%', 'trabajo: aclara que ya se pagó el total');
    notHas(html, 'restantes', 'trabajo: sin cobro de "restantes"');
  }

  // Cancelar: gratis → 100%; tardía → sin mención de seña
  {
    const cb = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: d5, time: '10:00' });
    ok(cb.ok, 'fixture: reserva futura');
    let html = await render(() => ViewsCancel.cancel({ id: cb.booking.id }, {}), 'cancelar gratis');
    noUndef(html, 'cancelar gratis'); noSena(html, 'cancelar gratis');
    has(html, '100%', 'cancelar gratis: devolución del 100%');
    const cb2 = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: todayISO, time: '23:00' });
    ok(cb2.ok, 'fixture: reserva tardía');
    html = await render(() => ViewsCancel.cancel({ id: cb2.booking.id }, {}), 'cancelar tardía');
    noUndef(html, 'cancelar tardía'); noSena(html, 'cancelar tardía');
  }

  // BizBooking paso 1 y 3: total a pagar + botón "Confirmar y pagar"
  {
    BizBooking.state = { bizId: 'demo', serviceId: 'b1', staffId: null, date: null, time: null };
    let html = await render(() => BizBooking.step1({ id: 'demo' }, {}), 'biz booking paso 1');
    noUndef(html, 'biz booking paso 1'); noSena(html, 'biz booking paso 1');
    BizBooking.state = { bizId: 'demo', serviceId: 'b1', staffId: 'tm1', date: '2026-10-06', time: '10:00' };
    html = await render(() => BizBooking.step3(), 'biz booking paso 3');
    noUndef(html, 'biz booking paso 3'); noSena(html, 'biz booking paso 3');
    noNullNaN(html, 'biz booking paso 3');
    has(html, 'Total a pagar', 'biz booking paso 3: total a pagar');
    has(html, '¿Tenés un cupón?', 'biz booking paso 3: campo cupón');
    has(html, 'Confirmar y pagar', 'biz booking paso 3: botón confirmar y pagar');
    has(html, 'pago simulado', 'biz booking paso 3: aclara pago simulado');
    notHas(html, 'Seña hoy', 'biz booking paso 3: sin "Seña hoy"');
    notHas(html, 'Pagás después en el local', 'biz booking paso 3: sin "pagás después"');
  }

  // Booking éxito: muestra Pagado
  {
    const cb = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: d5, time: '11:00' });
    const html = await render(() => BookingFlow.step3(cb.booking), 'booking éxito');
    noUndef(html, 'booking éxito'); noSena(html, 'booking éxito');
    has(html, 'Pagado', 'booking éxito: muestra lo pagado');
    has(html, 'Cancelación gratis hasta', 'booking éxito: banner violeta');
  }

  // Cliente: pagos, métodos, ayuda, perfil
  {
    let html = await render(() => ViewsClient.payments(), 'mis pagos');
    noUndef(html, 'mis pagos'); noSena(html, 'mis pagos');
    html = await render(() => ViewsClient.paymentMethods(), 'métodos de pago');
    noUndef(html, 'métodos de pago'); noSena(html, 'métodos de pago');
    has(html, '100%', 'métodos de pago: pago total');
    html = await render(() => ViewsClient.help(), 'ayuda');
    noUndef(html, 'ayuda'); noSena(html, 'ayuda');
    html = await render(() => ViewsClient.profile(), 'perfil');
    noUndef(html, 'perfil'); noSena(html, 'perfil');
    has(html, '#/mi-resumen', 'perfil: entrada a Mi resumen');
    has(html, 'Ver como', 'perfil: "Ver como" con más de un rol real');
    has(html, 'data-vm="handyman"', 'perfil: "Ver como" fija el modo');
  }

  // Soporte: chip "La seña" eliminado
  notSrc('views-support-chat.js', 'La seña', 'chat soporte: chip "La seña" eliminado');

  // Fuente: "seña" solo queda en el matcher del bot (entiende la pregunta del usuario)
  {
    const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^"':])\/\/[^\n]*/g, '$1');
    const flagged = [];
    for (const f of fs.readdirSync(JS).filter(x => x.endsWith('.js'))) {
      const lines = strip(fs.readFileSync(path.join(JS, f), 'utf8')).split('\n');
      lines.forEach((l, i) => { if (SENA_RX.test(l)) flagged.push(`${f}:${i + 1}: ${l.trim().slice(0, 70)}`); });
    }
    ok(flagged.length === 1 && /api\.js.*seña\|pago/.test(flagged[0]),
      `fuente: "seña" solo en el matcher del bot de soporte (${flagged.join(' | ') || 'ninguna'})`);
  }

  console.log('— pago 100%: modelo en MockAdapter —');

  // createBooking cobra el 100%, sin depositPaid, con ledger "pago/cobrado"
  {
    const svc = (await OppiAPI.getProfessional('p2')).services.find(s => s.id === 'p2s1');
    const cb = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: d5, time: '12:00' });
    ok(cb.ok, 'createBooking ok');
    ok(cb.booking.paid === svc.price, 'createBooking: cobra el 100% del precio');
    ok(!('depositPaid' in cb.booking), 'createBooking: sin campo depositPaid');
    ok(!('rest' in cb.booking), 'createBooking: sin campo rest');
    const led = (await OppiAPI.getMyPayments()).find(p => p.booking_id === cb.booking.id);
    ok(led && led.estado === 'cobrado' && led.tipo === 'pago' && led.monto_gs === svc.price,
      'createBooking: ledger "pago/cobrado" por el total');
  }

  // Crédito de referidos: descuenta del total
  {
    const MA = G('MockAdapter'), s = MA._load();
    s.credit = 50000; MA._save();
    const svc = (await OppiAPI.getProfessional('p2')).services.find(s2 => s2.id === 'p2s1');
    const cb = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: d5, time: '13:00', payWithCredit: true });
    ok(cb.ok && cb.booking.paid === svc.price - 50000 && cb.booking.creditUsed === 50000,
      'createBooking: el crédito descuenta del total a pagar');
    s.credit = 0; MA._save();
  }

  // previewCancel / cancelBooking: 100% según plazo
  {
    const cb = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: d5, time: '14:00' });
    const pv = await OppiAPI.previewCancel(cb.booking.id);
    ok(pv.ok && pv.paid_gs === cb.booking.paid && pv.refund_gs === pv.paid_gs && pv.free_cancel,
      'previewCancel: dentro del plazo devuelve el 100%');
    ok(!('sena_gs' in pv), 'previewCancel: sin sena_gs');
    const cc = await OppiAPI.cancelBooking(cb.booking.id);
    ok(cc.ok && cc.refund_gs === cb.booking.paid, 'cancelBooking: reembolsa el 100%');
    const led = (await OppiAPI.getMyPayments()).find(p => p.booking_id === cb.booking.id);
    ok(led && led.estado === 'reembolsado', 'cancelBooking: ledger marca reembolsado');
    const cb2 = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: todayISO, time: '23:00' });
    const pv2 = await OppiAPI.previewCancel(cb2.booking.id);
    ok(pv2.ok && pv2.refund_gs === 0 && pv2.forfeit_gs === pv2.paid_gs && !pv2.free_cancel,
      'previewCancel: fuera del plazo, el 100% queda para el prestador');
  }

  // No-show: el destino del pago depende de quién no vino
  {
    const cb = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: ydayISO, time: '10:00' });
    const ns1 = await OppiAPI.markNoShow(cb.booking.id, true);
    ok(ns1.ok && ns1.booking.paid === cb.booking.paid, 'no-show cliente: el pago queda para el prestador');
    const cb2 = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: ydayISO, time: '11:00' });
    const ns2 = await OppiAPI.markNoShow(cb2.booking.id, false);
    ok(ns2.ok && ns2.amount_gs === cb2.booking.paid, 'no-show pro: reembolso total al cliente');
    ok(!(await OppiAPI.markNoShow(cb2.booking.id, true)).ok, 'no-show no se puede marcar dos veces');
  }

  // Negocio: alta sin seña, validación de precio, servicios sin deposit
  {
    const cr = await OppiAPI.createBusiness({
      name: 'Test Biz', category: 'Peluquería', barrio: 'Villa Morra',
      address: 'Av. Test 123', phone: '0981 000 000',
      services: [{ name: 'Corte', price: 80000, durationMin: 45 }],
      hours: 'Lun a Sáb 9:00–18:00',
    });
    ok(cr.ok, 'createBusiness ok sin seña');
    ok(!(await OppiAPI.createBusiness({ name: 'X', services: [{ name: 'Y', price: 0 }] })).ok,
      'createBusiness: precio 0 inválido');
    ok(!cr.business.services[0].deposit, 'createBusiness: el servicio no trae deposit');
    const as = await OppiAPI.addBusinessService({ name: 'Barba', price: 50000, durationMin: 30, deposit: { type: 'percent', value: 20 } });
    ok(as.ok && !as.service.deposit, 'addBusinessService: ignora/elimina deposit');
    ok(!(await OppiAPI.addBusinessService({ name: 'Malo', price: -5 })).ok,
      'addBusinessService: precio inválido');
    const us = await OppiAPI.updateBusinessService(as.service.id, { price: 55000, deposit: { type: 'fixed', value: 10000 } });
    ok(us.ok && us.service.price === 55000 && !us.service.deposit,
      'updateBusinessService: actualiza precio y no guarda deposit');
    ok(!(await OppiAPI.updateBusinessService(as.service.id, { price: 0 })).ok,
      'updateBusinessService: precio 0 inválido');
    let html = await render(() => ViewsBusiness.services(), 'mis servicios');
    noUndef(html, 'mis servicios'); noSena(html, 'mis servicios');
    has(html, 'Mis servicios', 'mis servicios: título');
    notHas(html, 'Tipo de seña', 'mis servicios: sin campos de seña');
    html = await render(() => ViewsBusiness.settings(), 'config negocio');
    noUndef(html, 'config negocio'); noSena(html, 'config negocio');
  }

  // Reserva en negocio: cobra 100%, sin "rest"
  {
    const biz = await OppiAPI.getBusiness();
    const svc = biz.services[0];
    await OppiAPI.createCoupon({ code: 'amiga20', type: 'percent', value: 20, maxUses: 50 });
    const bb = await OppiAPI.createBusinessBooking({ bizId: biz.id, serviceId: svc.id, staffId: null, date: '2026-10-12', time: '10:00', coupon_code: 'AMIGA20' });
    ok(bb.ok, 'createBusinessBooking ok');
    const expPrice = svc.price - Math.round(svc.price * 0.2);
    ok(bb.booking.paid === expPrice && bb.booking.price === expPrice,
      'createBusinessBooking: cobra el 100% con descuento aplicado');
    ok(!('rest' in bb.booking) && !('depositPaid' in bb.booking),
      'createBusinessBooking: sin rest ni depositPaid');
    ok(!(await OppiAPI.createBusinessBooking({ bizId: biz.id, serviceId: svc.id, staffId: null, date: '2026-10-12', time: '11:00', coupon_code: 'INVENTADO' })).ok,
      'createBusinessBooking con cupón inválido falla');
    const html = await render(() => ViewsPlus.bookingDetail({ id: bb.booking.id }), 'detalle reserva negocio');
    noUndef(html, 'detalle reserva negocio'); noSena(html, 'detalle reserva negocio');
    has(html, 'Pagado', 'detalle reserva: muestra Pagado');
  }

  // Tareas: aceptar oferta cobra 100%; aceptar cotización cobra 100%; completar no cobra de más
  {
    const MA = G('MockAdapter'), s = MA._load();
    let task = (s.tasks || []).find(t => t.status === 'open');
    ok(!!task, 'fixture: hay tarea abierta');
    const of = await OppiAPI.makeOffer({ taskId: task.id, amount: 150000, message: 'La hago' });
    ok(of.ok, 'makeOffer ok');
    const ao = await OppiAPI.acceptOffer({ taskId: task.id, offerId: of.offer.id });
    ok(ao.ok && ao.job.paid === 150000 && ao.job.agreedPrice === 150000,
      'acceptOffer: cobra el 100% al aceptar');
    ok(!('depositPaid' in ao.job), 'acceptOffer: sin depositPaid');
    const q = await OppiAPI.sendQuote({ jobId: ao.job.id, amount: 200000, detail: 'Con materiales' });
    ok(q.ok, 'sendQuote ok');
    const rq = await OppiAPI.respondQuote({ jobId: ao.job.id, quoteId: q.quote.id, accept: true });
    ok(rq.ok && rq.job.paid === 200000, 'respondQuote: al aceptar cobra el 100% de la cotización');
    const paidBefore = rq.job.paid;
    const cj = await OppiAPI.completeJob({ jobId: ao.job.id, rating: 5, review: 'Genial' });
    ok(cj.ok && cj.job.status === 'completed' && cj.job.paid === paidBefore,
      'completeJob: cierra sin cobrar de más');
  }

  // Reseña con fotos (límite 3)
  {
    const MA = G('MockAdapter'), s = MA._load();
    const mkJob = id => ({ id, taskId: 't1', title: 'Test rev ' + id, category: 'plomeria', barrio: 'Villa Morra', description: '', clientName: 'Vos', clientId: 'me', handymanId: 'h9', handymanName: 'Test H', agreedPrice: 100000, paid: 100000, status: 'in_progress', photos: [], quotes: [], messages: [] });
    s.jobs.push(mkJob('j_test_rev'), mkJob('j_test_rev2')); MA._save();
    const cr = await OppiAPI.completeJob({ jobId: 'j_test_rev', rating: 5, review: 'Genial', photos: ['https://x.test/1.jpg', 'https://x.test/2.jpg'] });
    ok(cr.ok && cr.job.status === 'completed', 'completeJob con reseña ok');
    ok(!(await OppiAPI.completeJob({ jobId: 'j_test_rev2', rating: 5, review: 'x', photos: ['a', 'b', 'c', 'd'] })).ok, 'completeJob rechaza más de 3 fotos');
    ok((await OppiAPI.getJob('j_test_rev')).myReviewPhotos.length === 2, 'getJob trae las fotos de la reseña');
    const html = await render(() => ViewsHandyman.jobDetail({ id: 'j_test_rev' }), 'trabajo con fotos');
    noUndef(html, 'trabajo con fotos'); noSena(html, 'trabajo con fotos');
  }

  // Mis pagos: ledger con estados coherentes al modelo 100%
  {
    const ps = await OppiAPI.getMyPayments();
    ok(ps.length > 0, 'getMyPayments trae movimientos');
    ok(ps.every(p => p.id && p.fecha && p.concepto && p.monto_gs > 0 && p.estado), 'getMyPayments: forma completa');
    ok(ps.some(p => p.estado === 'reembolsado'), 'getMyPayments: hay un reembolso (cancel gratis)');
    ok(ps.some(p => p.estado === 'cobrado'), 'getMyPayments: hay pagos cobrados al 100%');
    ok(!ps.some(p => p.estado === 'retenido'), 'getMyPayments: ya no hay "retenido" (se cobra el 100%, no hay holds)');
  }

  console.log('— paneles por rol: nav, guards, "Ver como" —');

  // Roles reales del mock (negocio creado arriba)
  {
    const roles = await OppiAPI.myRoles();
    ok(Array.isArray(roles) && roles.includes('client') && roles.includes('handyman') && roles.includes('business'),
      `myRoles: cliente + handyman + business (${roles.join(',')})`);
  }

  // Nav por modo: cada rol ve solo su mundo
  {
    const cli = AppChrome.navItems('client').map(n => n.label);
    ok(cli.join('|') === 'Inicio|Reservas|Tareas|Chat|Perfil', `nav cliente: ${cli.join(',')}`);
    const cliHrefs = AppChrome.navItems('client').map(n => n.href).join(' ');
    ok(!cliHrefs.includes('#/mapa'), 'nav cliente: sin tab Mapa (flag off)');
    ok(!cliHrefs.includes('/empresas/panel') && !cliHrefs.includes('/handyman/panel') && !cliHrefs.includes('/panel/estadisticas'),
      'nav cliente: sin links a paneles pro/empresa');
    const hm = AppChrome.navItems('handyman').map(n => n.label);
    ok(hm.join('|') === 'Tareas|Publicar|Trabajos|Ganancias|Perfil', `nav handyman: ${hm.join(',')}`);
    const hmHrefs = AppChrome.navItems('handyman').map(n => n.href).join(' ');
    ok(!hmHrefs.includes('/empresas/') && !hmHrefs.includes('#/buscar'),
      'nav handyman: sin mundo empresa ni buscar de cliente');
    const bz = AppChrome.navItems('business').map(n => n.label);
    ok(bz.join('|') === 'Panel|Agenda|Reservas|Clientes|Perfil', `nav negocio: ${bz.join(',')}`);
    const bzHrefs = AppChrome.navItems('business').map(n => n.href).join(' ');
    ok(!bzHrefs.includes('#/buscar') && !bzHrefs.includes('/handyman'),
      'nav negocio: sin mundo cliente/handyman');
  }

  // UI.segmented acepta attrs extra (data-vm del "Ver como")
  {
    const seg = UI.segmented([{ label: 'Cliente', href: '#/perfil', active: true, attrs: 'data-vm="client"' }]);
    ok(seg.includes('data-vm="client"'), 'UI.segmented: pasa attrs extra');
  }

  // OppiMode: se valida contra los roles reales en cada render
  {
    const MA = G('MockAdapter'), s = MA._load();
    const savedBiz = s.business;
    delete s.business; MA._save();
    ok((await OppiAPI.myRoles()).join(',') === 'client,handyman', 'myRoles sin negocio: client,handyman');
    OppiMode.set('business');
    sandbox.location.hash = '#/perfil';
    await AppChrome.render();
    ok(OppiMode.get() === 'client', 'AppChrome.render: modo inválido vuelve a client');
    const navHtml = getEl('bottomNav').innerHTML;
    ok(navHtml.includes('Reservas') && !navHtml.includes('#/mapa'), 'AppChrome.render: nav de cliente sin Mapa');
    // Guards: sin rol business → redirige al home de su mundo
    ok(await resolveHash('#/empresas/panel') === '#/empresas', 'guard: /empresas/panel sin rol → /empresas');
    ok(await resolveHash('#/empresas/reportes') === '#/empresas', 'guard: /empresas/reportes sin rol → /empresas');
    ok(await resolveHash('#/handyman/panel') === '#/handyman/panel', 'guard: /handyman/panel con rol handyman pasa');
    ok(OppiMode.get() === 'handyman', 'guard: entrar al panel handyman fija el modo');
    ok(await resolveHash('#/panel/estadisticas') === '#/panel/estadisticas', 'guard: /panel/estadisticas con rol pasa');
    ok(await resolveHash('#/mapa') === '#/', 'guard: /mapa con flag off → /');
    ok(await resolveHash('#/chambas-mapa') === '#/handyman', 'guard: /chambas-mapa con flag off → /handyman');
    // "Ver como": 2 roles → se muestra con Cliente + Handyman (sin Negocio)
    let html = await render(() => ViewsClient.profile(), 'perfil 2 roles');
    has(html, 'Ver como', 'perfil: "Ver como" visible con 2 roles');
    has(html, 'data-vm="handyman"', 'perfil: opción Handyman');
    notHas(html, 'data-vm="business"', 'perfil: sin opción Negocio si no tiene ese rol');
    // "Ver como": 1 rol → no se muestra
    const savedJobs = s.jobs;
    s.jobs = s.jobs.filter(j => j.handymanId !== 'me'); MA._save();
    ok((await OppiAPI.myRoles()).join(',') === 'client', 'myRoles solo cliente');
    html = await render(() => ViewsClient.profile(), 'perfil 1 rol');
    notHas(html, 'Ver como', 'perfil: sin "Ver como" con un solo rol');
    s.jobs = savedJobs; s.business = savedBiz; MA._save();
    ok((await OppiAPI.myRoles()).includes('business'), 'roles restaurados con negocio');
    // "Ver como": 3 roles → incluye Negocio
    html = await render(() => ViewsClient.profile(), 'perfil 3 roles');
    has(html, 'data-vm="business"', 'perfil: opción Negocio con rol business');
    // Con rol business, el guard deja pasar
    ok(await resolveHash('#/empresas/panel') === '#/empresas/panel', 'guard: /empresas/panel con rol business pasa');
    ok(await resolveHash('#/empresas/reportes') === '#/empresas/reportes', 'guard: /empresas/reportes con rol pasa');
    ok(OppiMode.get() === 'business', 'guard: entrar al panel empresa fija el modo');
    OppiMode.set('client');
  }

  console.log('— mapa en pausa (flag) —');
  {
    ok(OppiConfig.FEATURE_MAP === false, 'FEATURE_MAP default false');
    ok(typeof OppiConfig !== 'undefined', 'OppiConfig existe como global');
    // Código del mapa intacto: no se borró nada
    hasSrc('views-map.js', 'ViewsMap', 'código del mapa intacto');
    hasSrc('views-tasks-map.js', 'ViewsTasksMap', 'código del mapa de chambas intacto');
    hasSrc('app.js', "'/mapa'", 'ruta /mapa registrada (gateada por el flag)');
    // Con OFF: sin tab Mapa en el nav
    const items = AppChrome.navItems('client');
    ok(!items.some(n => n.href === '#/mapa'), 'nav: sin tab Mapa con flag off');
    // Con OFF: explorar handyman sin tabs Lista|Mapa
    let html = await render(() => ViewsHandyman.explore({}, {}), 'explorar sin mapa');
    noUndef(html, 'explorar sin mapa');
    notHas(html, '#/chambas-mapa', 'explorar: sin tabs Lista|Mapa con flag off');
    has(html, 'Publicar tarea', 'explorar: la lista funciona sin mapa');
    // Con OFF: publicar sin "Usar mi ubicación"
    html = await render(() => ViewsHandyman.publish(), 'publicar sin mapa');
    noUndef(html, 'publicar sin mapa');
    notHas(html, 'tLocBtn', 'publicar: sin "Usar mi ubicación" con flag off');
    has(html, 'Publicar tarea', 'publicar: se puede publicar sin coords');
    // Con ON: todo vuelve
    OppiConfig.FEATURE_MAP = true;
    ok(AppChrome.navItems('client').some(n => n.href === '#/mapa'), 'nav: tab Mapa vuelve con flag on');
    html = await render(() => ViewsHandyman.explore({}, {}), 'explorar con mapa');
    has(html, '#/chambas-mapa', 'explorar: tabs Lista|Mapa con flag on');
    html = await render(() => ViewsHandyman.publish(), 'publicar con mapa');
    has(html, 'tLocBtn', 'publicar: "Usar mi ubicación" con flag on');
    ok(await resolveHash('#/mapa') === '#/mapa', 'guard: /mapa pasa con flag on');
    ok(await resolveHash('#/chambas-mapa') === '#/chambas-mapa', 'guard: /chambas-mapa pasa con flag on');
    OppiConfig.FEATURE_MAP = false;
    ok(await resolveHash('#/mapa') === '#/', 'guard: /mapa vuelve a redirigir con flag off');
  }

  console.log('— estadísticas MVP por rol —');

  // API: GET /api/me/summary
  {
    const s0 = await OppiAPI.getMySummary();
    ok(s0.ok, 'getMySummary ok');
    const cb = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: ydayISO, time: '15:00' });
    ok(cb.ok, 'fixture: reserva de ayer (cuenta como completada)');
    const s1 = await OppiAPI.getMySummary();
    ok(s1.completed_bookings === s0.completed_bookings + 1, 'getMySummary: cuenta reservas completadas');
    ok(s1.total_spent_gs === s0.total_spent_gs + cb.booking.paid, 'getMySummary: suma lo pagado');
    ok(Number.isFinite(s1.points) && s1.points >= 0, 'getMySummary: Oppi Points como número');
  }

  // API: GET /api/pro/stats — campos extendidos
  {
    const ps = await OppiAPI.getProStats('semana');
    ok(ps && ps.periodo === 'semana' && Number.isFinite(ps.ingresos) && Number.isFinite(ps.reservas_count)
      && Array.isArray(ps.top_servicios) && Number.isFinite(ps.clientes_recurrentes),
      'getProStats: forma del contrato');
    ok(ps.conversion_pct === null, 'getProStats: conversion_pct null en mock (sin visitas medidas)');
    ok(ps.response_time_median === 25, 'getProStats: response_time_median coherente en mock');
    ok(Number.isFinite(ps.recurrent_pct), 'getProStats: recurrent_pct como número');
    const pm = await OppiAPI.getProStats('mes');
    ok(pm.periodo === 'mes', 'getProStats: respeta el período mes');
  }

  // API: GET /api/businesses/:id/stats — firma (id, periodo) + campos extendidos
  {
    const biz = await OppiAPI.getBusiness();
    const bs = await OppiAPI.getBizStats(biz.id, 'mes');
    ok(bs && bs.periodo === 'mes' && Number.isFinite(bs.ingresos) && Number.isFinite(bs.reservas_count)
      && Array.isArray(bs.top_servicios), 'getBizStats(id, periodo): forma del contrato');
    ok(bs.periodo === 'mes', 'getBizStats: respeta el período mes (firma con id)');
    ok(bs.conversion_pct === null, 'getBizStats: conversion_pct null en mock');
    ok(Number.isFinite(bs.recurrent_pct), 'getBizStats: recurrent_pct como número');
    ok(bs.top_staff === null || (bs.top_staff.nombre && Number.isFinite(bs.top_staff.reservas)),
      'getBizStats: top_staff con forma o null');
    const bw = await OppiAPI.getBizStats(biz.id, 'semana');
    ok(bw.periodo === 'semana', 'getBizStats: período semana');
  }

  // Cliente: "Mi resumen"
  {
    const html = await render(() => ViewsClient.summary(), 'mi resumen');
    noUndef(html, 'mi resumen'); noSena(html, 'mi resumen'); noNullNaN(html, 'mi resumen');
    has(html, 'Mi resumen', 'mi resumen: título');
    has(html, 'Oppi Points', 'mi resumen: puntos');
    has(html, 'Gastado en Oppi', 'mi resumen: total gastado');
    has(html, '#/mi-cumplimiento', 'mi resumen: link a Mi cumplimiento');
    has(html, 'Gs.', 'mi resumen: guaraníes con formato');
  }

  // Profesional: "Estadísticas" (distinta de las otras)
  {
    let html = await render(() => ViewsPlus.proStats({}, { periodo: 'mes' }), 'estadísticas pro');
    noUndef(html, 'estadísticas pro'); noSena(html, 'estadísticas pro'); noNullNaN(html, 'estadísticas pro');
    has(html, 'Estadísticas', 'estadísticas: título propio');
    has(html, 'Ingresos', 'estadísticas: tarjeta ingresos');
    has(html, 'Reservas', 'estadísticas: tarjeta reservas');
    has(html, 'Conversión', 'estadísticas: tarjeta conversión');
    has(html, '~25 min', 'estadísticas: tiempo de respuesta en lenguaje humano');
    has(html, 'Recurrentes', 'estadísticas: clientes recurrentes');
    has(html, 'periodo=mes', 'estadísticas: toggle Semana/Mes');
    has(html, 'seg active', 'estadísticas: mes activo');
    has(html, 'Top servicios', 'estadísticas: top servicios');
    has(html, 'earn-bar-fill', 'estadísticas: barras en CSS');
    has(html, 'Todavía no hay datos — compartí tu perfil para empezar a medir',
      'estadísticas: mensaje amable cuando no hay conversión');
    html = await render(() => ViewsPlus.proStats({}, {}), 'estadísticas semana');
    has(html, 'periodo=semana', 'estadísticas: toggle a semana');
  }

  // Negocio: "Reportes" (distinta de las otras)
  {
    let html = await render(() => ViewsPlus.bizStats({}, { periodo: 'mes' }), 'reportes negocio');
    noUndef(html, 'reportes negocio'); noSena(html, 'reportes negocio'); noNullNaN(html, 'reportes negocio');
    has(html, 'Reportes', 'reportes: título propio');
    has(html, 'Ingresos', 'reportes: tarjeta ingresos');
    has(html, 'Reservas', 'reportes: tarjeta reservas');
    has(html, 'Top colaborador', 'reportes: top colaborador');
    has(html, 'Servicios más vendidos', 'reportes: servicios más vendidos');
    has(html, 'Recurrentes', 'reportes: clientes recurrentes');
    has(html, 'periodo=mes', 'reportes: toggle Semana/Mes');
    has(html, 'earn-bar-fill', 'reportes: barras en CSS');
    html = await render(() => ViewsPlus.bizStats({}, {}), 'reportes semana');
    has(html, 'Reportes', 'reportes semana: título');
  }

  // Las tres pantallas son distintas entre sí
  {
    const hCli = await render(() => ViewsClient.summary(), 'cmp cli');
    const hPro = await render(() => ViewsPlus.proStats({}, {}), 'cmp pro');
    const hBiz = await render(() => ViewsPlus.bizStats({}, {}), 'cmp biz');
    ok(hCli.includes('Mi resumen') && !hPro.includes('Mi resumen') && !hBiz.includes('Mi resumen'),
      'pantallas distintas: solo el cliente ve "Mi resumen"');
    ok(hPro.includes('Estadísticas') && !hBiz.includes('<h1 class="page-title">Estadísticas'),
      'pantallas distintas: "Estadísticas" es del profesional');
    ok(hBiz.includes('Reportes'), 'pantallas distintas: "Reportes" es del negocio');
  }

  // Tracking: ya verificado en las vistas públicas (pro/negocio) arriba
  {
    const MA = G('MockAdapter');
    const ok1 = OppiAPI.trackProView('p1');
    const ok2 = OppiAPI.trackBizView('demo');
    ok(ok1 && ok1.ok && ok2 && ok2.ok, 'tracking: POST de view no bloquea ni rompe');
  }

  console.log('— ganancias y cupones —');
  {
    const pe0 = await OppiAPI.getProEarnings('semana');
    const pm0 = await OppiAPI.getProEarnings('mes');
    const MA = G('MockAdapter'), s = MA._load();
    s.jobs.push(
      { id: 'j_earn_now', taskId: 't1', title: 'Ahora', category: 'plomeria', barrio: 'Villa Morra', description: '', clientName: 'X', clientId: 'c9', handymanId: 'me', handymanName: 'Vos', agreedPrice: 200000, paid: 200000, status: 'completed', completedAt: new Date().toISOString(), photos: [], quotes: [], messages: [] },
      { id: 'j_earn_old', taskId: 't1', title: 'Viejo', category: 'pintura', barrio: 'Villa Morra', description: '', clientName: 'Y', clientId: 'c8', handymanId: 'me', handymanName: 'Vos', agreedPrice: 100000, paid: 100000, status: 'completed', completedAt: new Date(Date.now() - 20 * 864e5).toISOString(), photos: [], quotes: [], messages: [] },
    );
    MA._save();
    const pe = await OppiAPI.getProEarnings('semana');
    ok(pe.periodo === 'semana' && pe.reservas_count === pe0.reservas_count + 1
      && pe.ingresos_brutos === pe0.ingresos_brutos + 200000, 'getProEarnings semana: suma el trabajo nuevo');
    ok(pe.comision === Math.round(pe.ingresos_brutos * 0.15) && pe.neto === pe.ingresos_brutos - pe.comision,
      'getProEarnings: comisión 15% y neto');
    ok(pe.ticket_promedio === Math.round(pe.ingresos_brutos / pe.reservas_count), 'getProEarnings: ticket promedio');
    const pem = await OppiAPI.getProEarnings('mes');
    ok(pem.reservas_count === pm0.reservas_count + 2 && pem.ingresos_brutos === pm0.ingresos_brutos + 300000,
      'getProEarnings mes: incluye el trabajo viejo');
    const eg = await OppiAPI.getEarnings('semana');
    ok(eg && eg.periodo === 'semana' && Number.isFinite(eg.ingresos_brutos), 'getEarnings: forma');
    let html = await render(() => ViewsHandyman.earnings({ periodo: 'semana' }), 'ganancias pro');
    noUndef(html, 'ganancias pro'); noSena(html, 'ganancias pro');
    has(html, 'Ganancias', 'ganancias pro: título');
    html = await render(() => ViewsBusiness.earnings({ periodo: 'semana' }), 'ganancias negocio');
    noUndef(html, 'ganancias negocio'); noSena(html, 'ganancias negocio');
    html = await render(() => ViewsBusiness.coupons(), 'cupones');
    noUndef(html, 'cupones'); noSena(html, 'cupones');
    // Estado de error amable en ganancias
    const origPE = MA.getProEarnings;
    MA.getProEarnings = () => ({ ok: false, error: 'Sin conexión' });
    html = await render(() => ViewsHandyman.earnings({ periodo: 'semana' }), 'ganancias error');
    has(html, 'Sin conexión', 'ganancias: error amable');
    MA.getProEarnings = origPE;
  }

  console.log('— política de cancelación y comodines —');
  {
    const cb = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: d5, time: '16:00' });
    const pv = await OppiAPI.cancelPolicyPreview(cb.booking.id);
    ok(pv.ok && pv.resolucion === 'gratis', 'cancelPolicyPreview: gratis con anticipación');
    let html = await render(() => ViewsCancel.cancel({ id: cb.booking.id }, {}), 'cancelar gratis v2');
    noSena(html, 'cancelar gratis v2');
    has(html, 'Cancelar reserva', 'cancelar: botón');
    const ex = await OppiAPI.executeCancel(cb.booking.id, { reason: 'Cambio de planes' });
    ok(ex.ok, 'executeCancel gratis ok');
    ok((await OppiAPI.getWildcards()).balance === 3, 'balance intacto tras cancel gratis');
    const cb2 = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: todayISO, time: '22:00' });
    const pv2 = await OppiAPI.cancelPolicyPreview(cb2.booking.id);
    ok(pv2.ok && pv2.resolucion === 'comodin', 'cancelPolicyPreview: tardía usa comodín');
    html = await render(() => ViewsCancel.cancel({ id: cb2.booking.id }, {}), 'cancelar comodín');
    noSena(html, 'cancelar comodín');
    const ex2 = await OppiAPI.executeCancel(cb2.booking.id, { reason: 'Otro' });
    ok(ex2.ok && ex2.comodin_usado, 'executeCancel tardía usa comodín');
    ok((await OppiAPI.getWildcards()).balance === 2, 'comodín descontado');
    html = await render(() => ViewsCancel.policy(), 'política');
    noUndef(html, 'política'); noSena(html, 'política');
    has(html, 'Política de cancelación', 'política: título');
    html = await render(() => ViewsCancel.compliance(), 'cumplimiento');
    noUndef(html, 'cumplimiento'); noSena(html, 'cumplimiento');
    html = await render(() => ViewsCancel.bizHistory(), 'historial');
    noUndef(html, 'historial'); noSena(html, 'historial');
    const cb3 = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: ydayISO, time: '10:00' });
    html = await render(() => ViewsCancel.reportNoShow({ id: cb3.booking.id }, {}), 'reportar no-show');
    noUndef(html, 'reportar no-show'); noSena(html, 'reportar no-show');
    const rp = await OppiAPI.reportNoShow(cb3.booking.id, { kind: 'pro', notes: 'no vino' });
    ok(rp.ok, 'reportNoShow ok');
  }

  // Reprogramar: slots y confirmación con el pago intacto
  {
    const slots = await OppiAPI.getDaySlots('p1', '2026-10-09');
    ok(Array.isArray(slots) && slots.some(x => x.free), 'getDaySlots trae slots libres');
    const cb = await OppiAPI.createBooking({ proId: 'p1', serviceId: 'p1s1', date: '2026-10-09', time: '09:00' });
    ok(cb.ok, 'fixture: reserva para reprogramar');
    const free = (await OppiAPI.getDaySlots('p1', '2026-10-10')).find(x => x.free);
    const rs = await OppiAPI.rescheduleBooking(cb.booking.id, free.id);
    ok(rs.ok, 'rescheduleBooking ok');
    ok(!(await OppiAPI.rescheduleBooking(cb.booking.id, free.id)).ok, 'reschedule no duplica el slot');
    ok(!(await OppiAPI.rescheduleBooking('noexiste', free.id)).ok, 'reschedule con reserva inexistente falla');
  }

  // Voy en camino: solo el día del turno
  {
    const cb = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: todayISO, time: '10:00' });
    const er = await OppiAPI.markEnRoute(cb.booking.id);
    ok(er.ok && er.booking.en_route_at, 'markEnRoute marca el día del turno');
    const cb2 = await OppiAPI.createBooking({ proId: 'p2', serviceId: 'p2s1', date: '2026-10-25', time: '10:00' });
    ok(!(await OppiAPI.markEnRoute(cb2.booking.id)).ok, 'markEnRoute rechaza si no es hoy');
  }

  console.log('— lanzamiento: términos, privacidad, landing —');
  {
    let html = await render(() => ViewsLaunch.terms(), 'términos');
    noUndef(html, 'términos'); noSena(html, 'términos');
    has(html, 'Términos de servicio', 'términos: título');
    has(html, 'Reservas y pago', 'términos: sección de pago 100%');
    has(html, '100%', 'términos: pago total');
    notHas(html, 'Reservas y seña', 'términos: sin "Reservas y seña"');
    html = await render(() => ViewsLaunch.privacy(), 'privacidad');
    noUndef(html, 'privacidad'); noSena(html, 'privacidad');
    has(html, 'Política de privacidad', 'privacidad: título');
    has(html, 'Procesar reservas, pagos, cancelaciones y reembolsos', 'privacidad: fines con pagos');
    html = await render(() => ViewsLaunch.launch(), 'lanzamiento');
    noUndef(html, 'lanzamiento'); noSena(html, 'lanzamiento');
    has(html, '¿Cómo pago?', 'landing: FAQ de pago');
    notHas(html, '¿Qué es la seña?', 'landing: sin FAQ de seña');
    has(html, 'Pagás el 100%', 'landing: pago total en el hero');
  }

  console.log('— soporte: bandeja de agentes —');
  {
    const scAll = await OppiAPI.getSupportConversations({});
    ok(Array.isArray(scAll) && scAll.length === 3, 'support: 3 conversaciones semilla');
    ok(scAll.every(c => c.id && c.kind && c.status && c.updated_at), 'support: forma de conversación');
    const scBot = await OppiAPI.getSupportConversations({ status: 'bot' });
    ok(scBot.every(c => c.status === 'bot'), 'support: filtro por estado');
    const sm2 = await OppiAPI.getSupportMessages('sup2');
    ok(Array.isArray(sm2) && sm2.length > 0, 'support: mensajes de conversación');
    ok((await OppiAPI.getSupportConversations({})).find(c => c.id === 'sup2').unread === 0, 'support: leer resetea no leídas');
    const rp = await OppiAPI.replySupportConversation('sup1', { body: 'Hola! Te ayudo yo' });
    ok(rp.ok, 'support: responder');
    const after = (await OppiAPI.getSupportConversations({})).find(c => c.id === 'sup1');
    ok(after.status === 'human', 'support: responder pasa a humano');
    ok(!(await OppiAPI.replySupportConversation('sup1', { body: '   ' })).ok, 'support: no responde vacío');
    ok((await OppiAPI.botSupportConversation('sup1')).ok, 'support: devolver al bot');
    ok((await OppiAPI.resolveSupportConversation('sup1')).ok, 'support: marcar resuelta');
    ok((await OppiAPI.handoffSupportConversation('sup2')).ok, 'support: handoff a humano');
    const ag0 = await OppiAPI.getSupportAgents();
    ok(Array.isArray(ag0), 'support: agentes');
    const html = await render(() => ViewsSupport.inbox({}), 'bandeja soporte');
    noUndef(html, 'bandeja soporte'); noSena(html, 'bandeja soporte');
  }

  console.log('— onboarding —');
  {
    ok(!Onboarding.done(), 'onboarding: pendiente la primera vez');
    ok(Onboarding.SLIDES.length === 3 && Onboarding.SLIDES.every(s => s.emoji && s.title && s.text),
      'onboarding: 3 pantallas con emoji, título y texto');
    ok(Onboarding.SLIDES[2].text.includes('pagá el total'), 'onboarding: slide 3 con pago 100%');
    Onboarding.show();
    ok(!Onboarding.done(), 'onboarding: mostrar no marca completado');
    Onboarding.markDone();
    ok(Onboarding.done(), 'onboarding: se completa al terminar u omitir');
  }

  console.log('— admin —');
  {
    OppiAPI._setMockAdmin(false);
    let html = await render(() => ViewsLaunch.admin({}, {}), 'admin sin rol');
    has(html, 'Página no encontrada', 'admin: 404 amable sin rol');
    ok(!(await OppiAPI.getAdminOverview()).ok, 'admin sin rol: overview denegado');
    OppiAPI._setMockAdmin(true);
    delete els['adminBody'];
    html = await render(() => ViewsLaunch.admin({}, {}), 'admin resumen');
    noUndef(html, 'admin resumen');
    has(html, 'Panel admin', 'admin: título');
    const bodyHtml = els['adminBody'] ? els['adminBody'].innerHTML : '';
    has(bodyHtml, 'Usuarios', 'admin: tarjeta usuarios');
    const ov = await OppiAPI.getAdminOverview();
    ok(ov.ok && ov.overview.usuarios > 0, 'getAdminOverview con forma');
    const vv = await OppiAPI.getAdminVerifications();
    ok(vv.ok && vv.verifications.length >= 2, 'getAdminVerifications lista');
    const vPend = vv.verifications.filter(v => v.status === 'pending');
    const dec = await OppiAPI.decideVerification(vPend[0].id, 'approved');
    ok(dec.ok && dec.verification.status === 'approved', 'decideVerification aprueba');
    ok(!(await OppiAPI.decideVerification(vPend[1].id, 'rejected')).ok, 'decideVerification exige motivo para rechazar');
    const dec2 = await OppiAPI.decideVerification(vPend[1].id, 'rejected', 'Documento ilegible');
    ok(dec2.ok && dec2.verification.reason === 'Documento ilegible', 'decideVerification rechaza con motivo');
    const us = await OppiAPI.getAdminUsers({ q: 'ana' });
    ok(us.ok && us.users.length > 0, 'getAdminUsers con buscador');
    const sus = await OppiAPI.suspendUser(us.users[0].id);
    ok(sus.ok && sus.user.suspended === true, 'suspendUser');
    const uns = await OppiAPI.unsuspendUser(us.users[0].id);
    ok(uns.ok && uns.user.suspended === false, 'unsuspendUser');
    OppiAPI._setMockAdmin(false);
  }

  console.log('— rutas, CSS e index.html —');
  {
    const appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    for (const r of ['/', '/buscar', '/pro/:id', '/reservar/:proId/:serviceId', '/negocio/:id', '/negocio/:id/reservar',
                     '/reservas', '/mi-resumen', '/favoritos', '/chat', '/perfil', '/pagos', '/mis-pagos', '/ayuda',
                     '/handyman', '/chambas-mapa', '/handyman/publicar', '/handyman/panel', '/handyman/ganancias',
                     '/panel/estadisticas', '/panel/clientes',
                     '/empresas', '/empresas/panel', '/empresas/agenda', '/empresas/reservas', '/empresas/ganancias',
                     '/empresas/cupones', '/empresas/configuracion', '/empresas/servicios', '/empresas/reportes',
                     '/empresas/clientes', '/empresas/equipo',
                     '/mapa', '/politica-cancelacion', '/mi-cumplimiento', '/reservas/:id/cancelar',
                     '/terminos', '/privacidad', '/lanzamiento', '/admin']) {
      ok(appSrc.includes(`Router.add('${r}'`), `ruta ${r} registrada`);
    }
    ok(/Router\.guard\(\['handyman'\],\s*'#\/handyman'/.test(appSrc), 'app.js: guard de rol handyman');
    ok(/Router\.guard\(\['business'\],\s*'#\/empresas'/.test(appSrc), 'app.js: guard de rol business');
    ok(appSrc.includes('guardFlag'), 'app.js: guard de feature flag');
    ok(appSrc.includes('FEATURE_MAP'), 'app.js: respeta FEATURE_MAP');
    hasSrc('router.js', 'guard(roles', 'router.js: Router.guard');
    hasSrc('router.js', 'guardFlag(flag', 'router.js: Router.guardFlag');

    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
    for (const cls of ['.btn-cta', '.segmented', '.seg', '.stats-grid', '.stat', '.earn-bar-fill', '.earn-bar-track',
                       '.sticky-bookbar', '.rating-bars', '.highlight-card', '.cancel-banner', '.policy-tier',
                       '.wc-dots', '.radio-card', '.map-box', '.task-pin', '.menu-row2']) {
      ok(css.includes(cls), `CSS: clase ${cls}`);
    }

    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    for (const f of ['js/data.js', 'js/api.js', 'js/ui.js', 'js/router.js', 'js/views-public.js',
                     'js/views-client.js', 'js/views-handyman.js', 'js/views-business.js', 'js/views-map.js',
                     'js/views-cancel.js', 'js/views-plus.js', 'js/views-launch.js', 'js/app.js']) {
      ok(indexSrc.includes(f), `index.html: carga ${f}`);
    }
    const order = ['js/data.js', 'js/api.js', 'js/ui.js', 'js/router.js', 'js/app.js'];
    const idx = order.map(f => indexSrc.indexOf(f));
    ok(idx.every(i => i > -1) && idx.every((v, i) => i === 0 || v > idx[i - 1]),
      'index.html: orden data → api → ui → router → … → app');
    ok(indexSrc.includes('https://unpkg.com/leaflet'), 'index.html: Leaflet por CDN');
  }

  console.log(`\n${pass} ok, ${fail} fallos`);
  if (fail) { console.error('\nFallos:', failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
