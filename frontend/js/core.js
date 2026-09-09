// core.js — helpers, sessão, fetch. Carregado primeiro.
const $ = (id) => document.getElementById(id);
function defaultApi() {
  try {
    // API mora no backend :4000. Só usa same-origin quando a página já está nele.
    if (location.port === '4000') return location.origin + '/api';
    return 'http://' + (location.hostname || 'localhost') + ':4000/api';
  } catch { return 'http://localhost:4000/api'; }
}
const api = () => (localStorage.getItem('api_base') || defaultApi()).replace(/\/$/, '');
const getToken = () => localStorage.getItem('infdrive_jwt') || '';
const setToken = (t) => (t ? localStorage.setItem('infdrive_jwt', t) : localStorage.removeItem('infdrive_jwt'));
// Migração sem fricção: quem vinha do front antigo (deploy_jwt) continua logado.
try {
  if (!localStorage.getItem('infdrive_jwt') && localStorage.getItem('deploy_jwt')) {
    localStorage.setItem('infdrive_jwt', localStorage.getItem('deploy_jwt'));
  }
} catch {}
const authHeaders = () => ({ ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) });
const withTokenQuery = (url) => (getToken() ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(getToken()) : url);
async function jget(p) {
  const r = await fetch(api() + p, { headers: authHeaders() });
  if (r.status === 401) { Auth.lost(); throw new Error('Sessão expirada.'); }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost(p, body) {
  const r = await fetch(api() + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpatch(p, body) {
  const r = await fetch(api() + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jdel(p, body) {
  const r = await fetch(api() + p, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmtMB = (mb) => ((mb || 0) >= 1000 ? ((mb || 0) / 1024).toFixed(2) + ' GB' : (mb || 0).toFixed(2) + ' MB');
function fmtDur(s) { if (!s) return ''; const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; }
function kindOf(f) { const m = f.mime || ''; if (m.startsWith('image/')) return 'image'; if (m.startsWith('audio/')) return 'audio'; if (m.startsWith('video/')) return 'video'; return 'doc'; }
function planFor(gb) { return gb <= 200 ? 'Leve' : gb <= 500 ? 'Plus' : 'Studio'; }
function toast(msg) {
  let t = document.getElementById('errToast');
  if (!t) { t = document.createElement('div'); t.id = 'errToast'; t.className = 'sp-toast'; document.body.appendChild(t); }
  t.textContent = String(msg || 'Erro.').slice(0, 300);
  t.style.display = 'block';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.display = 'none'; }, 5000);
}
window.addEventListener('error', (e) => toast('Erro: ' + (e.message || 'falha')));
function inputDlg(msg, { placeholder = '', password = false, value = '' } = {}) {
  return new Promise((resolve) => {
    $('inputMsg').textContent = msg;
    const f = $('inputField');
    f.type = password ? 'password' : 'text'; f.placeholder = placeholder; f.value = value;
    $('inputBox').hidden = false;
    setTimeout(() => f.focus(), 50);
    const done = (v) => { $('inputBox').hidden = true; $('inputYes').onclick = null; $('inputNo').onclick = null; f.onkeydown = null; resolve(v); };
    $('inputYes').onclick = () => done(f.value);
    $('inputNo').onclick = () => done(null);
    f.onkeydown = (e) => { if (e.key === 'Enter') done(f.value); if (e.key === 'Escape') done(null); };
  });
}
function confirmDlg(msg) {
  return new Promise((resolve) => {
    $('confirmMsg').textContent = msg;
    $('confirmBox').hidden = false;
    const done = (v) => { $('confirmBox').hidden = true; $('confirmYes').onclick = null; $('confirmNo').onclick = null; resolve(v); };
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}
