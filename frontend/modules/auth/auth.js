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
      if (!$('r_terms')?.checked) return toast('Aceite os Termos para criar a conta.');
      const r = await jpost('/auth/register', { name: $('u_name').value || 'admin', email: $('r_email').value, phone: $('r_phone').value, password: $('r_pass').value, acceptedTerms: true });
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
  // Login Google por redirect (sem popup GIS — o popup branco travava).
  function googleLogin() {
    location.href = api() + '/auth/google/login/start';
  }
  async function initGoogle() {} // legado: botão GIS removido (redirect não precisa)
  // Volta do Google (?glogin=ticket): troca pelo JWT e entra.
  async function consumeTicket() {
    let t = '';
    try { t = new URLSearchParams(location.search).get('glogin') || ''; } catch {}
    if (!t) return false;
    try { history.replaceState(null, '', location.pathname); } catch {}
    if (t === 'cancel') { toast('Login cancelado no Google.'); return true; }
    if (t === 'erro') { toast('Google não confirmou. Tente de novo.'); return true; }
    try {
      const r = await jpost('/auth/google/consume', { ticket: t });
      after(r.user, r.token);
    } catch (e) { toast('Erro: ' + e.message); }
    return true;
  }
  async function me() {
    // Modo demo front-only: ?demo=1 ou #demo — valida tudo sem backend
    if (location.search.includes('demo') || location.hash.includes('demo')) { demo(); return; }
    try { if (await consumeTicket()) return; } catch {}
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
    const nc = document.getElementById('navCf');
    if (nc) nc.hidden = !(user?.role === 'admin' || user?.dev);
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
  return { show, login, verify2fa, register, forgot, logout, me, lost, initGoogle, googleLogin };
})();
window.Auth = Auth;
