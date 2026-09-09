// login.js — página standalone: só login. Sem dependências.
const $ = (id) => document.getElementById(id);
function defaultApi() {
  if (location.port === '4000') return location.origin + '/api';
  return 'http://' + (location.hostname || 'localhost') + ':4000/api';
}
function api() {
  return ($('apiBase').value.trim() || localStorage.getItem('api_base') || defaultApi()).replace(/\/$/, '');
}
function fail(msg) {
  const el = $('err');
  el.textContent = msg;
  el.hidden = false;
}
const Login = {
  async go() {
    $('err').hidden = true;
    const email = $('email').value.trim();
    const password = $('pass').value;
    if (!email || !password) return fail('Preencha e-mail e senha.');
    $('btn').disabled = true;
    try {
      localStorage.setItem('api_base', api());
      const r = await fetch(api() + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      localStorage.setItem('infdrive_jwt', data.token);
      location.href = '../../index.html?fresh=' + Date.now();
    } catch (e) {
      fail('Não entrou: ' + (e.message || 'erro').slice(0, 200));
    } finally {
      $('btn').disabled = false;
    }
  },
  async boot() {
    $('apiBase').value = localStorage.getItem('api_base') || defaultApi();
    $('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') Login.go(); });
    // Já logado? pula direto pro app.
    const token = localStorage.getItem('infdrive_jwt');
    if (!token) return Login.google();
    try {
      const r = await fetch(api() + '/auth/me', { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) location.href = '../../index.html?fresh=' + Date.now();
      else localStorage.removeItem('infdrive_jwt');
    } catch {}
    Login.google();
  },
  // Botão Google aparece sozinho quando o backend tem GOOGLE_CLIENT_ID.
  async google() {
    try {
      const cfg = await (await fetch(api() + '/auth/config')).json();
      if (!cfg.google || window.google || document.getElementById('gisScript')) return;
      const s = document.createElement('script');
      s.id = 'gisScript';
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => {
        try {
          window.google.accounts.id.initialize({ client_id: cfg.clientId, callback: Login.googleCb });
          window.google.accounts.id.renderButton($('googleBtn'), { theme: 'filled_black', size: 'large', width: 320 });
          $('googleWrap').hidden = false;
        } catch {}
      };
      document.head.appendChild(s);
    } catch {}
  },
  async googleCb(resp) {
    try {
      const r = await fetch(api() + '/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: resp.credential }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      localStorage.setItem('infdrive_jwt', data.token);
      location.href = '../../index.html?fresh=' + Date.now();
    } catch (e) { fail('Google: ' + (e.message || 'erro').slice(0, 200)); }
  },
};
window.Login = Login;
Login.boot();
