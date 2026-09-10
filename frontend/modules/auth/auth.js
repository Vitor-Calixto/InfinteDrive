// auth.js
const Auth = (() => {
  let pendingEmail = '';
  function show(which) {
    for (const t of ['Login', 'Register', 'Forgot', '2fa']) {
      const el = $('auth' + t);
      if (el) el.hidden = t.toLowerCase() !== which;
    }
    // Garante o botão Google toda vez que o login aparece (não só no boot).
    if (which === 'login') { try { initGoogle(); } catch {} }
  }
  function setLogged(logged) {
    $('authScreen').hidden = logged;
    $('appShell').hidden = !logged;
    if (!logged) Player?.close?.();
  }
  function lost() { setToken(''); setLogged(false); show('login'); }
  async function login() {
    try {
      const r = await jpost('/auth/login', { email: $('u_email').value, password: $('u_pass').value });
      // 2FA ligado: senha ok, mas o JWT só sai no 2º passo.
      if (r.tfaRequired) {
        pendingEmail = r.email || $('u_email').value;
        const c = $('tfa_code');
        if (c) c.value = '';
        show('2fa');
        setTimeout(() => $('tfa_code')?.focus(), 50);
        return;
      }
      after(r.user, r.token);
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function verify2fa() {
    try {
      const r = await jpost('/auth/2fa/verify', { email: pendingEmail, token: $('tfa_code').value });
      pendingEmail = '';
      after(r.user, r.token);
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function register() {
    try {
      const r = await jpost('/auth/register', { name: $('u_name').value || 'admin', email: $('r_email').value, password: $('r_pass').value });
      after(r.user, r.token);
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function forgot() {
    try {
      const r = await jpost('/auth/forgot-password', { email: $('f_email').value });
      $('forgotState').textContent = r.msg || 'Verifique seu e-mail.';
    } catch (e) { $('forgotState').textContent = 'Erro: ' + e.message; }
  }
  function logout() { setToken(''); setLogged(false); show('login'); }
  // Integração Google (login + foto no avatar): ativa sozinha quando o
  // backend tiver GOOGLE_CLIENT_ID. Sem backend, falha em silêncio (demo ok).
  async function initGoogle() {
    if (location.search.includes('demo') || location.hash.includes('demo')) return; // demo: sem backend, sem 404 no console
    try {
      const cfg = await (await fetch(api() + '/auth/config')).json();
      if (!cfg.google || window.google || document.getElementById('gisScript')) return;
      const s = document.createElement('script');
      s.id = 'gisScript';
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => {
        try {
          window.google.accounts.id.initialize({ client_id: cfg.clientId, callback: googleLogin });
          window.google.accounts.id.renderButton($('googleBtn'), { theme: 'filled_black', size: 'large', width: 320 });
        } catch {}
      };
      document.head.appendChild(s);
    } catch {}
  }
  async function googleLogin(resp) {
    try {
      const r = await jpost('/auth/google', { credential: resp.credential });
      after(r.user, r.token); // r.user traz name + picture -> vira foto no avatar
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function me() {
    // Modo demo front-only: ?demo=1 ou #demo — valida tudo sem backend
    if (location.search.includes('demo') || location.hash.includes('demo')) { demo(); return; }
    if (!getToken()) { setLogged(false); show('login'); return; }
    try {
      const u = await jget('/auth/me');
      after(u, getToken(), true);
    } catch { setLogged(false); show('login'); }
  }
  function after(user, token, silent) {
    if (token) setToken(token);
    setLogged(true);
    window._user = user;
    try { window.Shell?.paintUser?.(user); } catch {}
    const na = document.getElementById('navAdmin');
    if (na) na.hidden = user?.role !== 'admin';
    try { Drive.refresh(); Profiles.refresh(); Playlists.refresh(); } catch (e) { console.warn(e); }
  }
  // Demo: shell visível + mocks pra validar sidebar, telas, player sem API.
  // Dados primeiro, pintura por último (se algo falhar, a grade continua cheia).
  function demo() {
    window._quota = { finalMB: 3200, quotaMB: 20480, origMB: 12000, savedMB: 8800, savedPct: 73 };
    window._files = [
      { id: 'd1', name: 'Foto praia.jpg', mime: 'image/jpeg', sizeOrig: 8 * 1048576, sizeFinal: 2 * 1048576, compressed: true, createdAt: new Date().toISOString() },
      { id: 'd2', name: 'Música teste.mp3', mime: 'audio/mpeg', sizeOrig: 10 * 1048576, sizeFinal: 4 * 1048576, duration: 214, compressed: true, createdAt: new Date().toISOString() },
      { id: 'd3', name: 'Vídeo festa.mp4', mime: 'video/mp4', sizeOrig: 200 * 1048576, sizeFinal: 60 * 1048576, duration: 95, compressed: false, createdAt: new Date().toISOString() },
      { id: 'd4', name: 'Doc.pdf', mime: 'application/pdf', sizeOrig: 5 * 1048576, sizeFinal: 2 * 1048576, compressed: true, createdAt: new Date().toISOString() },
    ];
    setLogged(true);
    const user = { name: 'Demo', email: 'demo@local' };
    window._user = user;
    try { window.Shell?.paintUser?.(user); } catch {}
    // Drive usa _files quando a API falha — nada a injetar, Drive.refresh() já usa mock no demo
  }
  return { show, login, verify2fa, register, forgot, logout, me, lost, initGoogle };
})();
window.Auth = Auth;
