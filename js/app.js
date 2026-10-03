/* ============================================================================
 * Oppi — App shell: chrome (header/nav), registro de rutas y arranque.
 * ----------------------------------------------------------------------------
 * Roles y mundos: cada rol ve solo su mundo.
 * - client: home, buscar, reservas, chat, perfil, ayuda (+ modo handyman
 *   como espacio compartido: explorar y publicar tareas).
 * - handyman (profesional): su panel — agenda/trabajos, clientes,
 *   ganancias, estadísticas, cumplimiento.
 * - business (negocio): panel de empresas completo.
 * El "Ver como" del perfil (visible solo con más de un rol real) fija el
 * modo de vista; el nav inferior y los guards de ruta lo respetan. Sin el
 * rol, la ruta redirige al home del mundo que sí corresponde (nunca una
 * pantalla rota).
 * ========================================================================== */
'use strict';

/* Modo de vista: qué mundo muestra el nav inferior.
   'client' | 'handyman' | 'business'. Lo fija el "Ver como" del perfil y
   los guards de ruta; se valida contra los roles reales en cada render. */
const OppiMode = {
  KEY: 'oppi_view_mode',
  get() {
    try { return OppiStore.get(this.KEY) || 'client'; } catch (e) { return 'client'; }
  },
  set(m) {
    if (!['client', 'handyman', 'business'].includes(m)) return;
    try { OppiStore.set(this.KEY, m); } catch (e) { /* noop */ }
  },
};

const PROFILE_MATCH = p => p.startsWith('/perfil') || p.startsWith('/favoritos') || p.startsWith('/notificaciones') || p.startsWith('/referidos') || p.startsWith('/pagos') || p.startsWith('/ayuda') || p.startsWith('/mis-pagos') || p.startsWith('/mi-cumplimiento') || p.startsWith('/mi-resumen') || p.startsWith('/politica-cancelacion') || p.startsWith('/admin') || p.startsWith('/terminos') || p.startsWith('/privacidad');

const AppChrome = {
  /* Nav del modo cliente (mundo por defecto). */
  NAV: [
    { href: '#/', icon: '🏠', label: 'Inicio', match: p => p === '/' },
    { href: '#/reservas', icon: '📅', label: 'Reservas', match: p => p.startsWith('/reservas') || p.startsWith('/reservar') },
    { href: '#/handyman', icon: '🔨', label: 'Tareas', match: p => p.startsWith('/handyman') || p.startsWith('/chambas-mapa') },
    { href: '#/chat', icon: '💬', label: 'Chat', match: p => p.startsWith('/chat') },
    { href: '#/perfil', icon: '👤', label: 'Perfil', match: PROFILE_MATCH },
  ],
  /* Tab Mapa: solo existe si FEATURE_MAP está prendido (hoy en pausa). */
  NAV_MAP: { href: '#/mapa', icon: '🗺️', label: 'Mapa', match: p => p.startsWith('/mapa') },

  /* Nav del modo handyman: su mundo (explorar, publicar, trabajos, ganancias). */
  NAV_HANDYMAN: [
    { href: '#/handyman', icon: '🔨', label: 'Tareas', match: p => p === '/handyman' || p.startsWith('/handyman/tarea') || p.startsWith('/chambas-mapa') },
    { href: '#/handyman/publicar', icon: '➕', label: 'Publicar', match: p => p.startsWith('/handyman/publicar') },
    { href: '#/handyman/trabajos', icon: '🧰', label: 'Trabajos', match: p => p.startsWith('/handyman/trabajos') || p.startsWith('/handyman/trabajo') || p === '/handyman/panel' },
    { href: '#/handyman/ganancias', icon: '💰', label: 'Ganancias', match: p => p.startsWith('/handyman/ganancias') || p.startsWith('/panel/') },
    { href: '#/perfil', icon: '👤', label: 'Perfil', match: PROFILE_MATCH },
  ],

  /* Nav del modo negocio: su panel completo. */
  NAV_BUSINESS: [
    { href: '#/empresas/panel', icon: '🏢', label: 'Panel', match: p => p === '/empresas/panel' },
    { href: '#/empresas/agenda', icon: '📅', label: 'Agenda', match: p => p.startsWith('/empresas/agenda') },
    { href: '#/empresas/reservas', icon: '📝', label: 'Reservas', match: p => p.startsWith('/empresas/reservas') },
    { href: '#/empresas/clientes', icon: '👥', label: 'Clientes', match: p => p.startsWith('/empresas/clientes') },
    { href: '#/perfil', icon: '👤', label: 'Perfil', match: PROFILE_MATCH },
  ],

  /* Items del nav según el modo de vista (y el flag del mapa). */
  navItems(mode) {
    if (mode === 'handyman') return this.NAV_HANDYMAN;
    if (mode === 'business') return this.NAV_BUSINESS;
    const items = this.NAV.slice();
    if (typeof OppiConfig !== 'undefined' && OppiConfig.FEATURE_MAP) items.splice(1, 0, this.NAV_MAP);
    return items;
  },

  async render() {
    const { path } = Router.parse();
    // Roles reales + modo validado: sin el rol, se vuelve al modo cliente.
    let roles = ['client'];
    try { roles = (await OppiAPI.myRoles()) || roles; } catch (e) { /* sin sesión */ }
    let mode = OppiMode.get();
    if (mode === 'handyman' && !roles.includes('handyman')) mode = 'client';
    if (mode === 'business' && !roles.includes('business')) mode = 'client';
    if (mode !== OppiMode.get()) OppiMode.set(mode);

    const hideNav = path.startsWith('/login') || path.startsWith('/registro')
      || path === '/empresas' || path.startsWith('/empresas/alta')
      || path.startsWith('/lanzamiento') || path.includes('/reservar');
    document.getElementById('bottomNav').style.display = hideNav ? 'none' : '';
    document.getElementById('view').classList.toggle('no-nav', hideNav);
    document.getElementById('bottomNav').innerHTML = this.navItems(mode).map(n =>
      `<a href="${n.href}" class="${n.match(path) ? 'active' : ''}"><span class="nav-ico">${n.icon}</span><span>${n.label}</span></a>`
    ).join('');
    await this.updateBell();
    // Botón flotante de soporte: vive dentro de la app, 1 toque abre el chat.
    try { SupportChat.mountFab(); } catch (e) {}
    const badge = document.getElementById('demoBadge');
    if (badge) badge.hidden = OppiAPI.adapterMode() !== 'mock-fallback';
  },

  async updateBell() {
    const bell = document.getElementById('bellCount');
    if (!bell) return;
    const n = await OppiAPI.unreadCount();
    bell.textContent = n > 9 ? '9+' : n;
    bell.style.display = n ? '' : 'none';
  },
};

/* Helpers de guards (viven en Router; acá se aplican a las rutas). */
const mapOn = () => typeof OppiConfig !== 'undefined' && !!OppiConfig.FEATURE_MAP;
const needHandyman = (handler) => Router.guard(['handyman'], '#/handyman', handler, 'handyman');
const needBusiness = (handler) => Router.guard(['business'], '#/empresas', handler, 'business');
const needMap = (fallback, handler) => Router.guardFlag(mapOn, fallback, handler);

function registerRoutes() {
  Router.add('/', () => ViewsPublic.home());
  Router.add('/buscar', (p, q) => ViewsPublic.search(p, q));
  Router.add('/categorias', () => ViewsPlus.categories());
  Router.add('/categorias/:id', p => ViewsPlus.categoryDetail(p));
  Router.add('/mapa', needMap('#/', () => ViewsMap.index()));
  // OJO: las rutas específicas de /pro/* van ANTES de /pro/:id (el router
  // matchea en orden y :id se comería "clientes"/"estadisticas").
  Router.add('/panel/clientes', needHandyman(() => ViewsPlus.proClients()));
  Router.add('/panel/clientes/:id', needHandyman(p => ViewsPlus.proClientDetail(p)));
  Router.add('/panel/estadisticas', needHandyman((p, q) => ViewsPlus.proStats(p, q)));
  Router.add('/pro/:id', p => ViewsPublic.pro(p));
  Router.add('/servicio/:id', p => ViewsPlus.serviceDetail(p));
  Router.add('/reservar/:proId/:serviceId', (p, q) => BookingFlow.step1(p, q));
  Router.add('/negocio/:id', (p, q) => ViewsBusiness.public(p, q));
  Router.add('/negocio/:id/reservar', (p, q) => BizBooking.step1(p, q));

  Router.add('/reservas', () => ViewsClient.bookings());
  Router.add('/reservas/:id', p => ViewsPlus.bookingDetail(p));
  Router.add('/reservas/:id/cancelar', (p, q) => ViewsCancel.cancel(p, q));
  Router.add('/reservas/:id/reportar-no-show', (p, q) => ViewsCancel.reportNoShow(p, q));
  Router.add('/politica-cancelacion', () => ViewsCancel.policy());
  Router.add('/mi-cumplimiento', () => ViewsCancel.compliance());
  Router.add('/mi-resumen', () => ViewsClient.summary());
  Router.add('/favoritos', () => ViewsClient.favorites());
  Router.add('/chat', () => ViewsClient.chats());
  Router.add('/chat/:id', p => ViewsClient.chatThread(p));
  Router.add('/perfil', () => ViewsClient.profile());
  Router.add('/perfil/editar', () => ViewsClient.editProfile());
  Router.add('/referidos', () => ViewsClient.referrals());
  Router.add('/pagos', () => ViewsClient.paymentMethods());
  Router.add('/mis-pagos', () => ViewsClient.payments());
  Router.add('/ayuda', () => ViewsClient.help());
  Router.add('/notificaciones', () => ViewsClient.notifications());

  Router.add('/handyman', (p, q) => ViewsHandyman.explore(p, q));
  Router.add('/chambas-mapa', needMap('#/handyman', () => ViewsTasksMap.index()));
  Router.add('/handyman/publicar', () => ViewsHandyman.publish());
  Router.add('/handyman/tarea/:id', p => ViewsHandyman.taskDetail(p));
  Router.add('/handyman/trabajos', () => ViewsHandyman.myJobs());
  Router.add('/handyman/trabajo/:id', p => ViewsHandyman.jobDetail(p));
  Router.add('/handyman/panel', needHandyman(() => ViewsHandyman.panel()));
  Router.add('/handyman/ganancias', needHandyman((p, q) => ViewsHandyman.earnings(q)));

  Router.add('/empresas', () => ViewsBusiness.landing());
  Router.add('/empresas/alta', () => ViewsBusiness.signupStep1());
  Router.add('/empresas/alta/paso2', () => ViewsBusiness.signupStep2());
  Router.add('/empresas/alta/paso3', () => ViewsBusiness.signupStep3());
  Router.add('/empresas/panel', needBusiness(() => ViewsBusiness.panel()));
  Router.add('/empresas/agenda', needBusiness(() => ViewsBusiness.agenda()));
  Router.add('/empresas/reservas', needBusiness(() => ViewsBusiness.bookings()));
  Router.add('/empresas/ganancias', needBusiness((p, q) => ViewsBusiness.earnings(q)));
  Router.add('/empresas/cancelaciones', needBusiness(() => ViewsCancel.bizHistory()));
  Router.add('/empresas/cupones', needBusiness(() => ViewsBusiness.coupons()));
  Router.add('/empresas/configuracion', needBusiness(() => ViewsBusiness.settings()));
  Router.add('/empresas/servicios', needBusiness(() => ViewsBusiness.services()));
  Router.add('/empresas/sucursales', needBusiness(() => ViewsPlus.branches()));
  Router.add('/empresas/clientes', needBusiness(() => ViewsPlus.bizClients()));
  Router.add('/empresas/clientes/:id', needBusiness(p => ViewsPlus.bizClientDetail(p)));
  Router.add('/empresas/reportes', needBusiness((p, q) => ViewsPlus.bizStats(p, q)));
  Router.add('/empresas/equipo', needBusiness(() => ViewsBusiness.team()));
  Router.add('/empresas/resenas', needBusiness(() => ViewsBusiness.reviews()));
  Router.add('/empresas/documentos', needBusiness(() => ViewsBusiness.documents()));

  Router.add('/login', () => ViewsAuth.login());
  Router.add('/registro', () => ViewsAuth.register());

  // Lanzamiento: admin, legales y landing pública.
  Router.add('/admin', (p, q) => ViewsLaunch.admin(p, q));
  Router.add('/terminos', () => ViewsLaunch.terms());
  Router.add('/privacidad', () => ViewsLaunch.privacy());
  Router.add('/lanzamiento', () => ViewsLaunch.launch());

  Router.add('/soporte', (p, q) => ViewsSupport.inbox(q));
}

document.addEventListener('DOMContentLoaded', async () => {
  // Elige el adaptador: backend real si responde, mock si no (?mock=1 lo fuerza).
  try { await OppiAPI.init(); } catch (e) { /* cae al mock */ }
  registerRoutes();
  // Onboarding: carrusel de 3 pantallas solo la primera vez.
  if (typeof Onboarding !== 'undefined' && !Onboarding.done()) {
    Onboarding.show(() => Router.start());
    return;
  }
  Router.start();
});
