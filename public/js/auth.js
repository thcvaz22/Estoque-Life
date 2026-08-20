/* ============================================================
   AUTH.JS — sessão do usuário no frontend
   A sessão real fica em cookie HttpOnly controlado pelo servidor.
   O navegador guarda apenas a representação pública do usuário
   em memória para exibição; ele nunca decide a identidade usada
   para auditoria das movimentações.
   ============================================================ */

const Auth = (() => {
  let user = null;
  let heartbeatStarted = false;

  async function request(url, options = {}) {
    return fetch(url, { ...options, cache: 'no-store' });
  }

  function showLogin(message = '') {
    user = null;
    const app = document.getElementById('app');
    const login = document.getElementById('login-screen');
    if (app) app.hidden = true;
    if (login) login.hidden = false;
    document.body.classList.add('auth-mode');
    const modalRoot = document.getElementById('modal-root');
    if (modalRoot) modalRoot.innerHTML = '';
    const error = document.getElementById('login-error');
    if (error) {
      error.textContent = message || '';
      error.hidden = !message;
    }
    setTimeout(() => document.getElementById('login-user')?.focus(), 0);
  }

  function showApp() {
    const app = document.getElementById('app');
    const login = document.getElementById('login-screen');
    if (login) login.hidden = true;
    if (app) app.hidden = false;
    document.body.classList.remove('auth-mode');
    updateHeader();
  }

  function updateHeader() {
    const label = document.getElementById('active-user-label');
    const profile = document.getElementById('active-user-profile');
    if (label) label.textContent = user ? `${user.perfil || 'Usuário'}: ${user.nome}` : '';
    if (profile) profile.textContent = user ? user.perfil : '';
  }

  async function check() {
    try {
      const res = await request('/api/auth/me');
      if (!res.ok) { showLogin(); return false; }
      const data = await res.json();
      user = data.user;
      if (user?.perfil === 'Vendedor' && !location.pathname.startsWith('/vendas')) { location.href = '/vendas/'; return false; }
      showApp();
      if (!heartbeatStarted) {
        heartbeatStarted = true;
        setInterval(async () => {
          try {
            const checkRes = await request('/api/auth/me');
            if (checkRes.status === 401) handleUnauthorized();
          } catch { /* perda de rede não desloga; as operações já ficam bloqueadas */ }
        }, 5 * 60 * 1000);
      }
      return true;
    } catch (e) {
      showLogin('Servidor indisponível. Inicie o Life Sucos para entrar.');
      return false;
    }
  }

  async function login(username, password) {
    const res = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || 'Não foi possível entrar.');
    user = data.user;
    // Recarregar é intencional: garante que nenhuma tela operacional
    // renderizada antes do login permaneça em memória.
    location.reload();
  }

  async function logout() {
    try { await request('/api/auth/logout', { method: 'POST' }); } catch {}
    user = null;
    location.reload();
  }

  function handleUnauthorized() {
    showLogin('Sua sessão expirou. Faça login novamente.');
  }

  function currentUser() { return user; }
  function isManager() { return !!(user && user.perfil === 'Gerente'); }
  function isAdmin() { return !!(user && (String(user.username || '').toLowerCase() === 'admin' || user.perfil === 'Administrador')); }
  function auditLabel() { return user ? user.auditLabel : 'Usuário não autenticado'; }

  function bindLoginForm() {
    const form = document.getElementById('login-form');
    if (!form || form.dataset.bound === '1') return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-user').value.trim();
      const password = document.getElementById('login-password').value;
      const btn = document.getElementById('login-submit');
      const error = document.getElementById('login-error');
      error.hidden = true;
      btn.disabled = true;
      btn.innerHTML = '<span>↪</span> Entrando…';
      try {
        await login(username, password);
      } catch (err) {
        error.textContent = err.message || 'Usuário ou senha incorretos.';
        error.hidden = false;
        document.getElementById('login-password').select();
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>↪</span> Entrar';
      }
    });
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    const pwdToggle = document.getElementById('login-password-toggle');
    if (pwdToggle && !pwdToggle.dataset.bound) {
      pwdToggle.dataset.bound = '1';
      pwdToggle.addEventListener('click', () => {
        const input = document.getElementById('login-password');
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        pwdToggle.textContent = show ? '🙈' : '👁️';
      });
    }
  }

  async function init() {
    bindLoginForm();
    return check();
  }

  return { init, check, login, logout, handleUnauthorized, currentUser, isManager, isAdmin, auditLabel, showLogin, showApp };
})();
