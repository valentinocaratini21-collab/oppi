/* ============================================================================
 * Oppi — Router por hash (js/router.js)
 * Rutas: #/  #/buscar  #/pro/:id  #/reservar/...  #/reservas  #/favoritos
 *         #/chat  #/perfil  #/notificaciones  #/handyman/...  #/empresas/...
 *         #/login  #/registro
 * ========================================================================== */
'use strict';

const Router = {
  routes: [],

  add(pattern, handler) {
    const names = [];
    const rx = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, n) => {
      names.push(n);
      return '([^/?#]+)';
    }) + '$');
    this.routes.push({ rx, names, handler });
  },

  parse() {
    let h = location.hash.slice(1) || '/';
    const qi = h.indexOf('?');
    let query = {};
    if (qi >= 0) {
      query = Object.fromEntries(new URLSearchParams(h.slice(qi + 1)));
      h = h.slice(0, qi);
    }
    return { path: h, query };
  },

  resolve() {
    const { path, query } = this.parse();
    for (const r of this.routes) {
      const m = path.match(r.rx);
      if (m) {
        const params = {};
        r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        return () => r.handler(params, query);
      }
    }
    return () => ViewsAuth.notFound();
  },

  start() {
    const render = async () => {
      window.scrollTo(0, 0);
      closeModal();
      await this.resolve()();
      await AppChrome.render();
    };
    window.addEventListener('hashchange', render);
    render();
  },

  go(hash) { location.hash = hash; },

  /* Guard de rol: envuelve un handler para que solo corra si el usuario
     tiene al menos uno de `roles` (vía OppiAPI.myRoles()). Si no, lo manda
     a `fallback` (el home de su mundo) en vez de mostrar una pantalla rota.
     `setMode` opcional: fija el modo de vista (nav inferior) al entrar. */
  guard(roles, fallback, handler, setMode) {
    return async (params, query) => {
      let mine = ['client'];
      try { mine = (await OppiAPI.myRoles()) || mine; } catch (e) { /* sin sesión: cliente */ }
      if (!roles.some(r => mine.includes(r))) { this.go(fallback); return; }
      if (setMode && typeof OppiMode !== 'undefined') OppiMode.set(setMode);
      return handler(params, query);
    };
  },

  /* Guard de feature flag: si `flag` (valor o función que lo devuelve) es
     false, redirige a `fallback`. Acepta función para flags que cambian en
     tiempo de ejecución (ej. FEATURE_MAP). */
  guardFlag(flag, fallback, handler) {
    return (params, query) => {
      const on = typeof flag === 'function' ? flag() : flag;
      if (!on) { this.go(fallback); return; }
      return handler(params, query);
    };
  },
};
