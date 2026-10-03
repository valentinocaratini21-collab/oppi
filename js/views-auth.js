/* ============================================================================
 * Oppi — Auth (mock). En producción: login/registro contra la API real.
 * ========================================================================== */
'use strict';

const ViewsAuth = {
  async login() {
    setView(`
    <div class="auth-wrap">
      <div class="auth-logo">oppi</div>
      <h1>¡Hola de nuevo! 👋</h1>
      <form id="loginForm" class="stack">
        ${UI.field('Email', `<input id="lEmail" type="email" required placeholder="vos@email.com">`)}
        ${UI.field('Contraseña', `<input id="lPass" type="password" required placeholder="••••••">`)}
        <p class="small error" id="lErr"></p>
        <button class="btn btn-primary btn-block" type="submit">Entrar</button>
      </form>
      <p class="center small">¿No tenés cuenta? <a class="link" href="#/registro">Registrate</a></p>
      <p class="center"><a class="link small" href="#/">← Volver sin entrar</a></p>
    </div>`);
    document.getElementById('loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const r = await OppiAPI.login({ email: document.getElementById('lEmail').value, password: document.getElementById('lPass').value });
      if (!r.ok) { document.getElementById('lErr').textContent = r.error; return; }
      UI.toast('¡Hola, ' + r.user.name.split(' ')[0] + '! 👋');
      Router.go('#/');
    });
  },

  async register() {
    /* Selector de rol: 4 caminos (cliente / profesional / handyman / negocio),
       igual que en la app móvil. */
    const ROLES = [
      { value: 'client', icon: '🙋', title: 'Cliente', desc: 'Quiero reservar servicios' },
      { value: 'pro', icon: '💼', title: 'Profesional', desc: 'Ofrezco mis servicios' },
      { value: 'handyman', icon: '🔨', title: 'Handyman', desc: 'Quiero ganar plata con changas' },
      { value: 'business', icon: '🏢', title: 'Negocio', desc: 'Tengo un local y quiero recibir reservas' },
    ];
    setView(`
    <div class="auth-wrap">
      <div class="auth-logo">oppi</div>
      <h1>Creá tu cuenta 🎉</h1>
      <p class="muted center small">¿Cómo vas a usar Oppi?</p>
      <form id="regForm" class="stack">
        <div class="role-cards" role="radiogroup" aria-label="Elegí tu rol">
          ${ROLES.map((r, i) => `
          <button type="button" class="role-card${i === 0 ? ' active' : ''}" data-role="${r.value}"
                  role="radio" aria-checked="${i === 0}" tabindex="0">
            <span class="role-ico">${r.icon}</span>
            <span><strong>${r.title}</strong><br><span class="small muted">${r.desc}</span></span>
          </button>`).join('')}
        </div>
        <input type="hidden" id="rRole" value="client">
        ${UI.field('Nombre', `<input id="rName" required placeholder="Tu nombre">`)}
        ${UI.field('Email', `<input id="rEmail" type="email" required placeholder="vos@email.com">`)}
        ${UI.field('Contraseña', `<input id="rPass" type="password" required placeholder="Mínimo 4 caracteres">`)}
        <label class="terms-check">
          <input id="rTerms" type="checkbox">
          <span>Acepto los <a class="link" href="#/terminos" target="_blank" rel="noopener">Términos de servicio</a> y la <a class="link" href="#/privacidad" target="_blank" rel="noopener">Política de privacidad</a> de Oppi.</span>
        </label>
        <p class="small error" id="rErr"></p>
        <button class="btn btn-primary btn-block" type="submit">Crear cuenta</button>
      </form>
      <p class="center small">¿Ya tenés cuenta? <a class="link" href="#/login">Entrá</a></p>
      <p class="center"><a class="link small" href="#/">← Volver sin registrarme</a></p>
    </div>`);
    document.querySelectorAll('.role-card').forEach(card => {
      const pick = () => {
        document.querySelectorAll('.role-card').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-checked', 'false'); });
        card.classList.add('active');
        card.setAttribute('aria-checked', 'true');
        document.getElementById('rRole').value = card.dataset.role;
      };
      card.addEventListener('click', pick);
      card.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(); } });
    });
    document.getElementById('regForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = document.getElementById('rErr');
      err.textContent = '';
      if (!document.getElementById('rTerms').checked) {
        err.textContent = 'Para crear tu cuenta tenés que aceptar los Términos y la Política de privacidad.';
        return;
      }
      const role = document.getElementById('rRole').value;
      const r = await OppiAPI.register({
        name: document.getElementById('rName').value,
        email: document.getElementById('rEmail').value,
        password: document.getElementById('rPass').value,
        role,
        terms_accepted: true,
      });
      if (!r.ok) { err.textContent = r.error; return; }
      UI.toast('¡Cuenta creada! 🎉');
      /* Cada rol aterriza en su mundo. */
      if (role === 'business') Router.go('#/empresas/alta');
      else if (role === 'pro' || role === 'handyman') { OppiMode.set('handyman'); Router.go('#/handyman/panel'); }
      else Router.go('#/');
    });
  },

  notFound() {
    setView(UI.empty('😕', 'Página no encontrada', 'Esta dirección no existe.', '<a class="btn btn-primary" href="#/">Ir al inicio</a>'));
  },
};
