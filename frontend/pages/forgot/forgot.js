// forgot.js — página standalone: só recuperação de senha. Sem dependências.
const $ = (id) => document.getElementById(id);
function defaultApi() {
  if (location.port === '4000') return location.origin + '/api';
  return 'http://' + (location.hostname || 'localhost') + ':4000/api';
}
function api() {
  return ($('apiBase').value.trim() || localStorage.getItem('api_base') || defaultApi()).replace(/\/$/, '');
}
const Forgot = {
  async go() {
    $('err').hidden = true;
    $('ok').hidden = true;
    const email = $('email').value.trim();
    if (!email) {
      $('err').textContent = 'Preencha o e-mail.';
      $('err').hidden = false;
      return;
    }
    $('btn').disabled = true;
    try {
      localStorage.setItem('api_base', api());
      const r = await fetch(api() + '/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await r.json().catch(() => ({}));
      $('ok').textContent = data.msg || 'Se o e-mail existir, o link foi enviado. Verifique sua caixa.';
      $('ok').hidden = false;
    } catch (e) {
      $('err').textContent = 'Erro: ' + (e.message || 'falha').slice(0, 200);
      $('err').hidden = false;
    } finally {
      $('btn').disabled = false;
    }
  },
  boot() {
    $('apiBase').value = localStorage.getItem('api_base') || defaultApi();
    $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') Forgot.go(); });
  },
};
window.Forgot = Forgot;
Forgot.boot();
