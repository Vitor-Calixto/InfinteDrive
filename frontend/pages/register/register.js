// register.js — página standalone: só cadastro. Sem dependências.
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
const Register = {
  async go() {
    $('err').hidden = true;
    const name = $('name').value.trim();
    const email = $('email').value.trim();
    const password = $('pass').value;
    if (!name) return fail('Diga seu nome.');
    if (!email) return fail('Preencha o e-mail.');
    if (!password || password.length < 8) return fail('Senha com 8+ caracteres.');
    $('btn').disabled = true;
    try {
      localStorage.setItem('api_base', api());
      const r = await fetch(api() + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      localStorage.setItem('infdrive_jwt', data.token);
      location.href = '../../index.html?fresh=' + Date.now();
    } catch (e) {
      fail('Não cadastrou: ' + (e.message || 'erro').slice(0, 200));
    } finally {
      $('btn').disabled = false;
    }
  },
  boot() {
    $('apiBase').value = localStorage.getItem('api_base') || defaultApi();
    $('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') Register.go(); });
  },
};
window.Register = Register;
Register.boot();
