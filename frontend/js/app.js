const $ = (id) => document.getElementById(id);
const api = () => $('apiBase').value.replace(/\/$/, '');
let selectedServerId = null;
let selectedAppId = null;

// Qualquer erro inesperado vira aviso visível (nada morre em silêncio).
function toast(msg) {
  let t = document.getElementById('errToast');
  if (!t) { t = document.createElement('div'); t.id = 'errToast'; t.className = 'sp-toast'; document.body.appendChild(t); }
  t.textContent = String(msg || 'Erro inesperado.').slice(0, 300);
  t.style.display = 'block';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.display = 'none'; }, 6000);
}
window.addEventListener('error', (e) => toast('Erro: ' + (e.message || 'falha de script')));

// Confirmação temática (troca o confirm() nativo feio do navegador).
function confirmDlg(msg) {
  return new Promise((resolve) => {
    $('confirmMsg').textContent = msg;
    $('confirmBox').hidden = false;
    const done = (v) => {
      $('confirmBox').hidden = true;
      $('confirmYes').onclick = null;
      $('confirmNo').onclick = null;
      resolve(v);
    };
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}

// Sessão local (offline): JWT em localStorage, nunca na URL (exceto EventSource).
const getToken = () => localStorage.getItem('deploy_jwt') || '';
const setToken = (t) => (t ? localStorage.setItem('deploy_jwt', t) : localStorage.removeItem('deploy_jwt'));
const authHeaders = () => ({ ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) });
const withTokenQuery = (url) => (getToken() ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(getToken()) : url);

function authLost() {
  // Sessão morreu (expirou, backend reiniciou sem JWT fixo, logout em outra aba):
  // volta pra tela de login em vez de fingir que está logado.
  setToken('');
  setAppAuth(false);
  try { showAuth('login'); } catch {}
  $('authState').textContent = 'Sessão expirada. Entre de novo.';
}
async function jget(p) {
  const r = await fetch(api() + p, { headers: authHeaders() });
  if (r.status === 401) { authLost(); throw new Error('Sessão expirada. Entre de novo (Acesso local).'); }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost(p, body) {
  const r = await fetch(api() + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body || {}) });
  if (r.status === 401) throw new Error(await r.text());
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jdel(p, body) {
  const r = await fetch(api() + p, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// Escapa texto controlado pelo usuário antes de injetar no HTML
// (nome de arquivo/app/servidor). Sem isso, onclick liberado + nome
// malicioso = XSS por atributo.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---- acesso local: telas entrar | cadastro | esqueci | perfil ----
function showAuth(which) {
  for (const t of ['Login', 'Register', 'Forgot', 'Reset', 'Profile']) {
    const el = $('auth' + t);
    if (el) el.hidden = t.toLowerCase() !== which;
  }
}
// App shell só aparece logado; deslogado cai na tela cheia de auth.
function setAppAuth(logged) {
  $('authScreen').hidden = logged;
  $('appShell').hidden = !logged;
  if (!logged) closePlayer();
}
function afterLogin(user, token) {
  setToken(token);
  setAppAuth(true);
  showAuth('profile');
  renderProfile(user);
  refreshServers(); refreshApps(); refreshHistory(); refreshQuota(); refreshFiles(); refreshProfiles(); refreshPlaylists();
}
function renderProfile(u) {
  if (!u) return;
  const av = u.avatar ? `<img class="sp-avatar" src="${esc(u.avatar)}" alt="" />` : '';
  $('profileBox').innerHTML = `${av}<b>${esc(u.name || '')}</b><br>${esc(u.email || '')} · ${esc(u.role || '')}`;
  $('authState').textContent = 'Logado: ' + (u.email || '');
  applyDev(u);
}
// Botão Google (só aparece com GOOGLE_CLIENT_ID no backend; GIS exige internet).
async function initGoogle() {
  try {
    const cfg = await (await fetch(api() + '/auth/config')).json();
    if (!cfg.google || window.google) return;
    if (document.getElementById('gisScript')) return;
    const s = document.createElement('script');
    s.id = 'gisScript';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => {
      try {
        window.google.accounts.id.initialize({
          client_id: cfg.clientId,
          callback: googleLogin,
        });
        window.google.accounts.id.renderButton($('googleBtn'), { theme: 'filled_black', size: 'large', width: 320 });
        $('googleWrap').hidden = false;
      } catch {}
    };
    document.head.appendChild(s);
  } catch {}
}
async function googleLogin(resp) {
  try {
    const r = await jpost('/auth/google', { credential: resp.credential });
    afterLogin(r.user, r.token);
  } catch (e) { alert('Erro: ' + e.message); }
}
function applyDev(u) {
  // Produto 100% Drive: Admin vê a aba Admin (disco + usuários). Resto não.
  const admin = u && u.role === 'admin';
  const nd = $('navAdmin'); if (nd) nd.hidden = !admin;
  const md = $('mAdmin'); if (md) md.hidden = !admin;
  if (!admin) showView('drive');
}
async function toggleDev() {
  try {
    const r = await fetch(api() + '/auth/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ dev: $('f_dev').checked }) });
    if (!r.ok) throw new Error(await r.text());
    applyDev(await r.json());
  } catch (e) { alert('Erro: ' + e.message); me(); }
}
async function registerFirst() {
  try {
    const r = await jpost('/auth/register', { name: $('u_name').value || 'admin', email: $('r_email').value, password: $('r_pass').value });
    afterLogin(r.user, r.token);
  } catch (e) { alert('Erro: ' + e.message); }
}
async function login() {
  try {
    const r = await jpost('/auth/login', { email: $('u_email').value, password: $('u_pass').value });
    afterLogin(r.user, r.token);
  } catch (e) { alert('Erro: ' + e.message); }
}
async function forgot() {
  try {
    const r = await jpost('/auth/forgot-password', { email: $('f_email').value });
    $('forgotState').textContent = r.msg || 'Verifique seu e-mail.';
  } catch (e) { $('forgotState').textContent = 'Erro: ' + e.message; }
}
function pendingResetToken() {
  const m = location.search.match(/[?&]reset=([0-9a-fA-F]+)/);
  return m ? m[1] : '';
}
async function resetPass() {
  const token = pendingResetToken();
  if (!token) return alert('Link inválido. Abra o link do e-mail de novo.');
  try {
    const r = await jpost('/auth/reset-password', { token, next: $('n_pass').value });
    history.replaceState(null, '', location.pathname);
    afterLogin(r && r.token ? { email: 'você', role: '' } : null, r.token);
    alert('Senha trocada. Você já está logado.');
  } catch (e) { alert('Erro: ' + e.message); }
}
async function changePass() {
  try {
    const r = await jpost('/auth/change-password', { current: $('c_cur').value, next: $('c_new').value });
    setToken(r.token);
    alert('Senha trocada.');
    $('c_cur').value = ''; $('c_new').value = '';
  } catch (e) { alert('Erro: ' + e.message); }
}
// ---- drive spotify + medidor de espaço ----
const fmtMB = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : (mb || 0).toFixed(2) + ' MB');
// ---- planos: mostra o jogo aberto (quota x efetivo) ----
function planFor(gb) { return gb <= 100 ? 'Leve' : gb <= 500 ? 'Família' : 'Studio'; }
function calcPlan() {
  const g = Number($('calcGB').value) || 0;
  $('calcIn').textContent = g >= 1000 ? (g / 1000).toFixed(1) + ' TB' : g + ' GB';
  const eff = Math.round(g / 5); // perfil misto honesto: 5x
  $('calcOut').textContent = eff >= 1000 ? (eff / 1000).toFixed(1) + ' TB' : eff + ' GB';
  $('calcPlan').textContent = '→ plano ' + planFor(eff);
}
function choosePlan(name) { alert(`Plano ${name}: pagamento em breve. Fala com a gente que ativamos na hora.`); }
function renderPlanLine(q) {
  const el = $('myPlanLine');
  if (!el) return;
  el.innerHTML = `Você guarda <b>${fmtMB(q.origMB)}</b> (equivale fora) ocupando <b>${fmtMB(q.finalMB)}</b> — plano ideal: <b>${planFor(Math.ceil(q.origMB / 5))}</b>.`;
}
async function refreshQuota() {
  if (!getToken()) return;
  try {
    const q = await jget('/storage/quota');
    $('qOrig').textContent = fmtMB(q.origMB);
    $('qFinal').textContent = fmtMB(q.finalMB);
    $('qSaved').textContent = `${fmtMB(q.savedMB)} (${q.savedPct}%)`;
    $('qFiles').textContent = q.files;
    $('qUseLabel').textContent = `Ocupando ${fmtMB(q.finalMB)}` + (q.processing?.files
      ? ` · ⏳ ${q.processing.files} processando (${fmtMB(q.processing.origMB)})`
      : '');
    $('qQuotaLabel').textContent = `de ${fmtMB(q.quotaMB)}`;
    $('qBar').style.width = Math.min(100, (q.finalMB / q.quotaMB) * 100).toFixed(1) + '%';
    const mini = $('qUseMini'); if (mini) mini.textContent = `${fmtMB(q.finalMB)} / ${fmtMB(q.quotaMB)}`;
    const barMini = $('qBarMini'); if (barMini) barMini.style.width = Math.min(100, (q.finalMB / q.quotaMB) * 100).toFixed(1) + '%';
    renderPlanLine(q);
    lastQuota = q;
    if (q.trash?.files) {
      $('qUseLabel').textContent += ` · 🗑 ${q.trash.files} (${fmtMB(q.trash.mb)})`;
    }
  } catch {}
}
function thumbUrl(id) { return withTokenQuery(`${api()}/storage/thumb/${id}`); }
function dlUrl(id) { return withTokenQuery(`${api()}/storage/download/${id}`); }
let allFiles = [];
let kindFilter = 'all';
let searchFilter = '';
let queue = [];
let queueIdx = -1;
function showView(name) {
  for (const v of ['drive', 'planos', 'trash', 'system']) {
    const el = $('view-' + v);
    if (el) el.hidden = v !== name;
  }
  document.querySelectorAll('.sp-nav-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'system') loadDisk();
  if (name === 'trash') refreshTrash();
}
async function loadDisk() {
  if (!getToken()) return;
  try {
    const d = await jget('/system/disk');
    $('dUseLabel').textContent = `Disco ${fmtMB(d.diskUsedMB)} em uso`;
    $('dTotalLabel').textContent = `de ${fmtMB(d.diskTotalMB)}`;
    $('dBar').style.width = Math.min(100, d.pct) + '%';
    $('dBar').style.background = d.pct >= 70 ? '#ef4444' : '';
    $('dAlert').textContent = d.alert || '';
    $('dApp').textContent = `App ocupa ${fmtMB(d.appMB)} em ${d.files} arquivo(s). Livre: ${fmtMB(d.diskFreeMB)}.`;
  } catch {}
  refreshUsers();
}
// ---- admin: usuários, memória usada/disponível e plano ----
function planQuota(plan) { return plan === 'Studio' ? 2048000 : plan === 'Família' ? 512000 : 102400; }
function planChanged(id) {
  // Trocar o plano preenche a quota padrão (editável antes de salvar).
  $('qq-' + id).value = planQuota($('qp-' + id).value);
}
async function refreshUsers() {
  const card = $('adminCard');
  if (!getToken()) { if (card) card.hidden = true; return; }
  try {
    const me = await jget('/auth/me');
    if (me.role !== 'admin') { if (card) card.hidden = true; return; }
    if (card) card.hidden = false;
    const list = await jget('/auth/overview');
    $('usersBox').innerHTML = list.map((u) => `
      <div class="bg-zinc-900 border border-zinc-800 rounded p-2">
        <div class="font-bold">${esc(u.name)} <span class="text-xs text-zinc-400">${esc(u.email)} · ${esc(u.role)}</span></div>
        <div class="flex justify-between text-xs text-zinc-400"><span>${fmtMB(u.usedMB)} de ${fmtMB(u.quotaMB)} · ${u.files} arq.</span><span>${u.pct}%</span></div>
        <div class="sp-bar"><div style="width:${Math.min(100, u.pct)}%"></div></div>
        <div class="flex gap-2 mt-2 items-center">
          <select id="qp-${u.id}" class="inp" style="width:auto;margin:0" onchange="planChanged('${u.id}')">
            ${['Leve', 'Família', 'Studio'].map((p) => `<option ${u.plan === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
          <input id="qq-${u.id}" class="inp" style="width:110px;margin:0" type="number" min="0" value="${u.quotaMB}" title="Quota em MB" />
          <button class="btn-ghost" onclick="saveUserPlan('${u.id}')">Salvar</button>
          <button class="btn-ghost" onclick="deleteUser('${u.id}')">Excluir</button>
        </div>
      </div>`).join('') || '<span class="text-zinc-500">Sem usuários.</span>';
  } catch {}
}
async function saveUserPlan(id) {
  try {
    const plan = $('qp-' + id).value;
    const quotaMB = Number($('qq-' + id).value) || planQuota(plan);
    await fetch(api() + `/auth/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ plan, quotaMB }) }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); });
    refreshUsers();
  } catch (e) { alert('Erro: ' + e.message); }
}
async function deleteUser(id) {
  if (!await confirmDlg('Excluir a conta E todos os arquivos dela? Não tem volta.')) return;
  try { await jdel('/auth/users/' + id); refreshUsers(); }
  catch (e) { alert('Erro: ' + e.message); }
}
// ---- cloudflare sem dashboard ----
async function saveCf() {
  try { await jpost('/cloudflare', { token: $('cf_token').value }); $('cf_token').value = ''; loadCfZones(); }
  catch (e) { alert('Erro: ' + e.message); }
}
async function loadCfZones() {
  try {
    const z = await jget('/cloudflare/zones');
    $('cf_zone').innerHTML = '<option value="">— escolha a zona —</option>' +
      z.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  } catch (e) { alert('Erro: ' + e.message); }
}
async function loadCfDns() {
  const zid = $('cf_zone').value;
  if (!zid) return;
  try {
    const r = await jget(`/cloudflare/zones/${zid}/dns`);
    $('cfDns').innerHTML = r.map((d) => `<div class="flex justify-between bg-zinc-900 border border-zinc-800 rounded px-2 py-1">
      <span><b>${d.type}</b> ${esc(d.name)} → ${esc(d.content)}${d.proxied ? ' ☁' : ''}</span>
      <button onclick="delCfDns('${zid}','${d.id}')" class="text-red-400">x</button></div>`).join('') || '<span class="text-zinc-500">Sem registros.</span>';
  } catch (e) { $('cfDns').innerHTML = `<span class="text-red-400">${esc(e.message)}</span>`; }
}
async function addCfDns() {
  const zid = $('cf_zone').value;
  if (!zid) return alert('Escolha a zona.');
  try {
    await jpost(`/cloudflare/zones/${zid}/dns`, { type: ($('cf_type').value || 'A').toUpperCase(), name: $('cf_name').value, content: $('cf_content').value, proxied: true });
    loadCfDns();
  } catch (e) { alert('Erro: ' + e.message); }
}
async function delCfDns(zid, id) {
  try { await jdel(`/cloudflare/zones/${zid}/dns/${id}`); loadCfDns(); }
  catch (e) { alert('Erro: ' + e.message); }
}
async function purgeCf() {
  const zid = $('cf_zone').value;
  if (!zid) return alert('Escolha a zona.');
  if (!await confirmDlg('Limpar todo o cache da zona?')) return;
  try { await jpost(`/cloudflare/zones/${zid}/purge`, {}); alert('Cache limpo.'); }
  catch (e) { alert('Erro: ' + e.message); }
}
function filterKind(k) {
  kindFilter = k; playlistFilter = ''; searchIds = null;
  const si = $('search'); if (si) si.value = ''; searchFilter = '';
  document.querySelectorAll('#kindNav .sp-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.kind === k));
  document.querySelectorAll('#playNav .sp-nav-btn').forEach((b) => b.classList.remove('active'));
  renderGrid();
}
let searchTimer = null;
let searchIds = null; // ordem ranqueada da API; null = sem busca
function filterPlaylist(id) {
  const pl = allPlaylists.find((p) => p.id === id);
  if (pl?.locked) return unlockPlaylist(id);
  playlistFilter = playlistFilter === id ? '' : id;
  if (playlistFilter) kindFilter = 'all';
  document.querySelectorAll('#kindNav .sp-nav-btn').forEach((b) => b.classList.toggle('active', !playlistFilter && b.dataset.kind === kindFilter));
  document.querySelectorAll('#playNav .sp-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.pl === playlistFilter));
  renderGrid();
}
function filterPlaylistPaint() {
  document.querySelectorAll('#kindNav .sp-nav-btn').forEach((b) => b.classList.toggle('active', !playlistFilter && b.dataset.kind === kindFilter));
  document.querySelectorAll('#playNav .sp-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.pl === playlistFilter));
}
async function unlockPlaylist(id) {
  const pw = prompt('Senha do cofre:');
  if (pw === null) return;
  try {
    await jpost(`/playlists/${id}/unlock`, { password: pw });
    await refreshPlaylists();
    playlistFilter = id;
    filterPlaylistPaint();
    renderGrid();
  } catch (e) { alert('Erro: ' + e.message); }
}
async function vaultSet(id) {
  const pw = prompt('Senha do cofre (4-64 caracteres). Vazia cancela:');
  if (!pw) return;
  try {
    await jpost(`/playlists/${id}/vault`, { password: pw });
    alert('Cofre criado. Arquivos somem da grade até desbloquear.');
    refreshPlaylists(); renderGrid();
  } catch (e) { alert('Erro: ' + e.message); }
}
async function vaultRemove(id) {
  const pw = prompt('Senha atual do cofre para remover:');
  if (pw === null) return;
  try {
    await jdel(`/playlists/${id}/vault`, { password: pw });
    refreshPlaylists(); renderGrid();
  } catch (e) { alert('Erro: ' + e.message); }
}
let allPlaylists = [];
let playlistFilter = '';
// ---- perfis (Netflix em casa: 1 conta, N perfis, PIN opcional) ----
let allProfiles = [];
let selectedProfile = localStorage.getItem('deploy_profile') || '';
function setProfile(id) { selectedProfile = id || ''; localStorage.setItem('deploy_profile', selectedProfile); paintProfiles(); refreshPlaylists(); }
async function refreshProfiles() {
  if (!getToken()) return;
  try {
    allProfiles = await jget('/profiles');
    if (selectedProfile && !allProfiles.some((p) => p.id === selectedProfile)) selectedProfile = '';
    paintProfiles();
  } catch {}
}
function paintProfiles() {
  const row = $('profRow');
  if (!row) return;
  const av = (p) => `<div class="av">${esc((p.name || '?')[0].toUpperCase())}</div>${esc(p.name)}${p.locked ? ' 🔒' : ''}`;
  row.innerHTML =
    `<button class="sp-prof ${!selectedProfile ? 'active' : ''}" onclick="setProfile('')"><div class="av">👥</div>Conta</button>` +
    allProfiles.map((p) => `<button class="sp-prof ${selectedProfile === p.id ? 'active' : ''}" onclick="selectProfile('${p.id}')">${av(p)}</button>`).join('') +
    `<button class="sp-prof add" onclick="createProfile()"><div class="av">＋</div>Novo</button>`;
}
async function selectProfile(id) {
  const p = allProfiles.find((x) => x.id === id);
  if (!p) return setProfile('');
  if (p.locked) {
    const pin = prompt(`PIN do perfil "${p.name}":`);
    if (pin === null) return;
    try { await jpost(`/profiles/${id}/unlock`, { pin }); }
    catch (e) { alert('Erro: ' + e.message); return; }
  }
  setProfile(id);
}
async function createProfile() {
  const name = prompt('Nome do perfil (ex: Crianças):');
  if (!name || !name.trim()) return;
  const pin = prompt('PIN de 4-8 dígitos (ou vazio p/ sem PIN):') || '';
  try {
    await jpost('/profiles', { name: name.trim(), pin: pin.trim() });
    refreshProfiles();
  } catch (e) { alert('Erro: ' + e.message); }
}
async function refreshPlaylists() {
  if (!getToken()) return;
  try {
    allPlaylists = await jget('/playlists');
    // Perfil filtra: vê as dele + as da conta (sem perfil). Conta vê tudo.
    const vis = allPlaylists.filter((p) => !selectedProfile || !p.profileId || p.profileId === selectedProfile);
    if (playlistFilter && !vis.some((p) => p.id === playlistFilter)) playlistFilter = '';
    $('playNav').innerHTML = vis.map((p) => `
      <button class="sp-nav-btn" data-pl="${p.id}" onclick="filterPlaylist('${p.id}')">${p.locked ? '🔒' : '📁'} ${esc(p.name)} <span class="text-zinc-500">· ${p.count}</span></button>`).join('');
    renderGrid();
  } catch {}
}
async function createPlaylist() {
  const name = prompt('Nome da playlist:');
  if (!name || !name.trim()) return;
  try { await jpost('/playlists', { name: name.trim(), profileId: selectedProfile || undefined }); refreshPlaylists(); }
  catch (e) { alert('Erro: ' + e.message); }
}
async function deletePlaylist(id, ev) {
  ev?.stopPropagation();
  if (!await confirmDlg('Apagar a playlist? (os arquivos ficam)')) return;
  try { await jdel('/playlists/' + id); if (playlistFilter === id) playlistFilter = ''; refreshPlaylists(); renderGrid(); }
  catch (e) { alert('Erro: ' + e.message); }
}
async function addToPlaylist(fileId, ev) {
  ev?.stopPropagation();
  const name = prompt('Playlist (nome novo ou existente):');
  if (!name || !name.trim()) return;
  try { await jpost('/playlists/by-name', { name: name.trim(), fileId }); refreshPlaylists(); alert('Adicionado.'); }
  catch (e) { alert('Erro: ' + e.message); }
}
async function removeFromPlaylist(fileId, ev) {
  ev?.stopPropagation();
  if (!playlistFilter) return;
  try { await jdel(`/playlists/${playlistFilter}/files/${fileId}`); refreshPlaylists(); refreshFiles(); }
  catch (e) { alert('Erro: ' + e.message); }
}
// Bota tudo que está visível (busca+filtro) numa playlist de uma vez.
let sortMode = localStorage.getItem('deploy_sort') || 'recent';
function setSort(v) { sortMode = v; localStorage.setItem('deploy_sort', v); renderGrid(); }
function sortList(list) {
  const by = {
    recent: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    oldest: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)),
    az: (a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'),
    za: (a, b) => (b.name || '').localeCompare(a.name || '', 'pt-BR'),
    biggest: (a, b) => (b.sizeFinal ?? b.sizeOrig ?? 0) - (a.sizeFinal ?? a.sizeOrig ?? 0),
    smallest: (a, b) => (a.sizeFinal ?? a.sizeOrig ?? 0) - (b.sizeFinal ?? b.sizeOrig ?? 0),
  }[sortMode] || (() => 0);
  return [...list].sort(by);
}
function visibleFiles() {
  // Busca da API manda: ordem ranqueada, ignora filtros locais.
  if (searchIds) return searchIds.map((id) => allFiles.find((f) => f.id === id)).filter(Boolean);
  const pl = playlistFilter ? allPlaylists.find((p) => p.id === playlistFilter) : null;
  const inPl = pl ? new Set(pl.fileIds || []) : null;
  return allFiles.filter((f) =>
    (!inPl || inPl.has(f.id)) &&
    (kindFilter === 'all' || kindOf(f) === kindFilter) &&
    (!searchFilter || (f.name || '').toLowerCase().includes(searchFilter)));
}
async function addVisibleToPlaylist() {
  const ids = visibleFiles().map((f) => f.id);
  if (!ids.length) return alert('Nada visível para adicionar.');
  const name = prompt(`Botar ${ids.length} arquivo(s) na playlist (nome novo ou existente):`);
  if (!name || !name.trim()) return;
  try {
    let pl = allPlaylists.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (!pl) pl = await jpost('/playlists', { name: name.trim() });
    const r = await jpost(`/playlists/${pl.id}/files`, { fileIds: ids });
    refreshPlaylists();
    alert(`${r.added} adicionados em "${pl.name}".`);
  } catch (e) { alert('Erro: ' + e.message); }
}
function filterSearch(s) {
  searchFilter = (s || '').toLowerCase();
  clearTimeout(searchTimer);
  if (searchFilter.trim().length < 2 || !getToken()) { searchIds = null; renderGrid(); return; }
  searchTimer = setTimeout(async () => {
    try {
      const res = await jget('/search?q=' + encodeURIComponent(searchFilter.trim()));
      for (const r of res) {
        const f = allFiles.find((x) => x.id === r.id);
        if (f && r.snippet) f.snippet = r.snippet;
      }
      searchIds = res.map((r) => r.id);
    } catch { searchIds = null; }
    renderGrid();
  }, 300);
}
function kindOf(f) { const m = f.mime || ''; if (m.startsWith('image/')) return 'image'; if (m.startsWith('audio/')) return 'audio'; if (m.startsWith('video/')) return 'video'; return 'doc'; }
function kindIcon(f) { const k = kindOf(f); return k === 'image' ? '🖼' : k === 'audio' ? '🎵' : k === 'video' ? '🎬' : '📄'; }
function fmtDur(s) { if (!s) return ''; const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, '0')}`; }
let trashMode = false; // legado: lixeira agora é view própria (sempre false)
let lastQuota = null;
let trashFiles = [];
async function refreshTrash() {
  if (!getToken()) return;
  try {
    trashFiles = await jget('/storage/list?trashed=1');
    renderTrash();
  } catch {}
}
function renderTrash() {
  const grid = $('trashGrid');
  if (!grid) return;
  const daysLeft = (f) => {
    if (!f.trashedAt) return '';
    const left = Math.max(0, 30 - Math.floor((Date.now() - new Date(f.trashedAt).getTime()) / 86400000));
    return ` · apaga em ${left}d`;
  };
  grid.innerHTML = (trashFiles.map((f) => `
    <div class="sp-album" title="${esc(f.name)}">
      ${f.thumb ? `<img src="${thumbUrl(f.id)}" loading="lazy" />` : `<div class="sp-album-fallback">${kindIcon(f)}</div>`}
      <div class="sp-album-title">${esc(f.name)}</div>
      <div class="sp-album-sub">${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}${daysLeft(f)}</div>
      <div class="sp-album-row">
        <button class="btn-ghost" onclick="restoreFile('${f.id}')">Restaurar</button>
        <button class="btn-ghost" onclick="delForever('${f.id}')">Excluir pra sempre</button>
      </div>
    </div>`).join('') || '<span class="text-zinc-500 text-xs">Lixeira vazia. 🎉</span>');
  const c = $('trashCount');
  if (c) c.textContent = trashFiles.length ? `${trashFiles.length} arquivo(s)` : '';
}
async function refreshFiles() {
  if (!getToken()) { $('filesGrid').innerHTML = '<span class="text-zinc-500 text-xs">Entre no acesso local para ver seus arquivos.</span>'; return; }
  try {
    allFiles = await jget('/storage/list');
    renderGrid();
  } catch {}
}
// Cabeçalho de playlist: capa própria > mosaico de capas + nome + play geral.
function coverUrl(pid) { return withTokenQuery(`${api()}/playlists/${pid}/cover`); }
function playlistHeader(pl) {
  const files = (pl.fileIds || []).map((id) => allFiles.find((f) => f.id === id)).filter(Boolean);
  const covers = files.filter((f) => f.thumb).slice(0, 4);
  const mosaic = pl.cover
    ? `<div class="sp-pl-mosaic single"><img src="${coverUrl(pl.id)}" loading="lazy" /></div>`
    : covers.length
      ? `<div class="sp-pl-mosaic">${covers.map((f) => `<img src="${thumbUrl(f.id)}" loading="lazy" />`).join('')}</div>`
      : `<div class="sp-pl-mosaic empty">📁</div>`;
  const totalSec = files.reduce((a, f) => a + (f.duration || 0), 0);
  return `<div class="sp-pl-head">${mosaic}
    <div class="sp-pl-info"><div class="sp-pl-kicker">Playlist${pl.vault ? ' 🔒' : ''}</div>
      <div class="sp-pl-name">${esc(pl.name)}</div>
      <div class="sp-pl-sub">${files.length} itens${totalSec ? ' · ' + fmtDur(totalSec) : ''}</div>
      <div class="sp-pl-row">
        <button class="sp-play-big" onclick="playPlaylist('${pl.id}')">▶</button>
        ${pl.vault
          ? `<button class="sp-link" onclick="vaultRemove('${pl.id}')">remover cofre</button>`
          : `<button class="sp-link" onclick="vaultSet('${pl.id}')">🔒 cofre</button>`}
        <button class="sp-link" onclick="deletePlaylist('${pl.id}')">apagar pasta</button>
      </div>
    </div></div>`;
}
function uploadCover(pid) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    if (!inp.files?.[0]) return;
    try {
      const fd = new FormData();
      fd.append('file', inp.files[0]);
      const r = await fetch(api() + `/playlists/${pid}/cover`, { method: 'POST', headers: authHeaders(), body: fd });
      if (!r.ok) throw new Error(await r.text());
      refreshPlaylists(); renderGrid();
    } catch (e) { alert('Erro: ' + e.message); }
  };
  inp.click();
}
function playPlaylist(id) {
  const pl = allPlaylists.find((p) => p.id === id);
  if (!pl) return;
  const files = (pl.fileIds || []).map((fid) => allFiles.find((f) => f.id === fid)).filter(Boolean);
  const audios = files.filter((f) => kindOf(f) === 'audio');
  if (audios.length) playQueue(audios, audios[0].id);
  else if (files.length) openFile(files[0].id);
}
// Playlist estilo Spotify de verdade: cabeçalho + lista de faixas
// (nº, capa, título, tamanho, duração, remover).
function renderTrackList(pl, list) {
  const rows = list.map((f, i) => `
    <div class="sp-track" onclick="openFile('${f.id}')">
      <span class="sp-t-num">${i + 1}</span>
      ${f.thumb ? `<img class="sp-t-cover" src="${thumbUrl(f.id)}" loading="lazy" />` : `<div class="sp-t-cover">${kindIcon(f)}</div>`}
      <div class="sp-t-main">
        <div class="sp-t-title">${esc(f.name)}</div>
        <div class="sp-t-sub">${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}${f.compressed ? '' : ' · ⏳'}</div>
      </div>
      <span class="sp-t-dur">${f.duration ? fmtDur(f.duration) : '—'}</span>
      <button class="sp-t-x" onclick="removeFromPlaylist('${f.id}', event)" title="Tirar da playlist">✕</button>
    </div>`).join('') || '<div class="text-zinc-500 text-xs" style="padding:16px">Playlist vazia. Bota arquivo nela com ＋ Playlist.</div>';
  $('filesGrid').innerHTML = playlistHeader(pl) +
    `<div class="sp-t-head"><span>#</span><span></span><span>Título</span><span class="sp-t-dur">⏱</span><span></span></div>` + rows;
  $('filesGrid').classList.add('sp-list-mode');
}
function renderGrid() {
  $('filesGrid').classList.remove('sp-list-mode');
  const pl = playlistFilter ? allPlaylists.find((p) => p.id === playlistFilter) : null;
  const inPl = pl ? new Set(pl.fileIds || []) : null;
  const bar = pl ? playlistHeader(pl) : '';
  const list = sortList(visibleFiles());
  if (pl) return renderTrackList(pl, list);
  $('filesGrid').innerHTML = bar + (list.map((f) => `
    <div class="sp-album" onclick="openFile('${f.id}')" title="${esc(f.name)}">
      ${f.thumb ? `<img src="${thumbUrl(f.id)}" loading="lazy" />` : `<div class="sp-album-fallback">${kindIcon(f)}</div>`}
      <button class="sp-album-play" onclick="event.stopPropagation();openFile('${f.id}')">▶</button>
      <div class="sp-album-title">${esc(f.name)}</div>
      <div class="sp-album-sub">${fmtMB((f.sizeOrig || 0) / 1048576)} → ${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}${f.duration ? ' · ' + fmtDur(f.duration) : ''}${f.compressed ? '' : (f.progress != null ? ` · ⏳ ${f.progress}%` : ' · ⏳')}</div>
      ${searchIds && f.snippet ? `<div class="sp-snippet">…${esc(f.snippet)}…</div>` : ''}
      <div class="sp-album-row">
        <button class="btn-ghost" onclick="event.stopPropagation();toggleCardMenu('${f.id}', event)">⋮</button>
        <div id="menu-${f.id}" class="sp-menu" hidden>
          <button onclick="openFile('${f.id}')">▶ Abrir</button>
          <button onclick="downloadFile('${f.id}')">⬇ Baixar</button>
          <button onclick="shareFile('${f.id}')">🔗 Compartilhar</button>
          <button onclick="addToPlaylist('${f.id}', event)">＋ Playlist</button>
          ${playlistFilter ? `<button onclick="removeFromPlaylist('${f.id}', event)">➖ Tirar da pasta</button>` : ''}
          <button onclick="event.stopPropagation();delFile('${f.id}')">🗑 Excluir</button>
        </div>
      </div>
    </div>`).join('') || '<span class="text-zinc-500 text-xs">Nada aqui ainda. Arraste arquivos acima.</span>');
}
function openFile(id) {
  const f = allFiles.find((x) => x.id === id);
  if (!f) return;
  window._openId = id;
  window._shareUrl = '';
  const k = kindOf(f);
  if (k === 'audio') { playQueue(allFiles.filter((x) => kindOf(x) === 'audio'), id); return; }
  const body = $('modalBody');
  if (k === 'video') body.innerHTML = `<video src="${dlUrl(id)}" controls autoplay style="width:100%"></video>`;
  else if (k === 'image') body.innerHTML = `<img src="${dlUrl(id)}" />`;
  else if ((f.mime || '') === 'application/pdf') body.innerHTML = `<embed src="${dlUrl(id)}" type="application/pdf" style="width:86vw;height:76vh;border-radius:12px;background:#fff" />`;
  else { window.open(dlUrl(id), '_blank'); return; }
  $('modalCap').textContent = `${f.name} · ${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}`;
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; $('modalBody').innerHTML = ''; window._openId = ''; window._shareUrl = ''; }
// Link público do arquivo aberto (cria 1x, vale 7 dias, revogável).
async function shareLink() {
  if (window._shareUrl) return window._shareUrl;
  if (!window._openId) throw new Error('Abra um arquivo primeiro.');
  const r = await jpost(`/share/${window._openId}`, {});
  let url = r.url || '';
  if (url.startsWith('/')) url = location.origin + url;
  window._shareUrl = url;
  return url;
}
async function shareVia(where) {
  try {
    const url = await shareLink();
    const f = allFiles.find((x) => x.id === window._openId);
    const text = `Olha: ${f?.name || 'arquivo'} ${url}`;
    if (where === 'wa') window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    else if (where === 'mail') location.href = 'mailto:?subject=' + encodeURIComponent(f?.name || 'Arquivo') + '&body=' + encodeURIComponent(url);
    else if (where === 'gmail') window.open('https://mail.google.com/mail/?view=cm&su=' + encodeURIComponent(f?.name || 'Arquivo') + '&body=' + encodeURIComponent(url), '_blank');
    else if (where === 'copy') { await navigator.clipboard.writeText(url); toast('Link copiado. Vale 7 dias.'); }
    else if (where === 'native') {
      if (navigator.share) await navigator.share({ title: f?.name || 'Arquivo', text, url }).catch(() => {});
      else { await navigator.clipboard.writeText(url); toast('Link copiado. Vale 7 dias.'); }
    }
  } catch (e) { alert('Erro: ' + e.message); }
}
function playQueue(list, startId) {
  queue = list; queueIdx = Math.max(0, list.findIndex((x) => x.id === startId));
  playCurrent();
}
function playCurrent() {
  const f = queue[queueIdx];
  if (!f) return;
  const a = $('audio');
  a.src = dlUrl(f.id);
  a.play().catch(() => {});
  $('player').hidden = false;
  $('pTitle').textContent = f.name;
  $('pSub').textContent = `${fmtDur(f.duration)}${f.duration ? ' · ' : ''}${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}`;
  $('pCover').src = f.thumb ? thumbUrl(f.id) : '';
  $('pToggle').textContent = '⏸';
}
function togglePlay() {
  const a = $('audio');
  if (a.paused) { a.play().catch(() => {}); $('pToggle').textContent = '⏸'; }
  else { a.pause(); $('pToggle').textContent = '▶'; }
}
function playNext() { if (!queue.length) return; queueIdx = (queueIdx + 1) % queue.length; playCurrent(); }
function playPrev() { if (!queue.length) return; queueIdx = (queueIdx - 1 + queue.length) % queue.length; playCurrent(); }
function closePlayer() { $('audio').pause(); $('player').hidden = true; queue = []; queueIdx = -1; }
const CHUNK = 8 * 1024 * 1024; // 8MB por fatia
const CHUNKED_FROM = 64 * 1024 * 1024; // acima disso, fatiado com resume
function sendXHR(url, fd, onProg) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (getToken()) xhr.setRequestHeader('Authorization', 'Bearer ' + getToken());
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProg(e.loaded); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText || ('HTTP ' + xhr.status))));
    xhr.onerror = () => reject(new Error('Falha de rede.'));
    xhr.send(fd);
  });
}
async function uploadSimple(file, i, paint) {
  const fd = new FormData();
  fd.append('file', file);
  await sendXHR(api() + '/storage/upload', fd, (loaded) => paint(i, loaded));
  paint(i, file.size || 0);
}
// Arquivo grande: fatia de 8MB, 3 fatias juntas, retoma as que faltam.
async function uploadChunked(file, i, paint) {
  const total = Math.max(1, Math.ceil((file.size || 0) / CHUNK));
  const uploadId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  let received = new Set();
  try {
    const st = await jget(`/chunks/chunk-status/${uploadId}`);
    received = new Set(st.received || []);
  } catch {}
  if (received.size) paint(i, Math.min(file.size || 0, received.size * CHUNK));
  let next = 0;
  const skipped = new Set([...received]);
  const sendSlice = async (idx) => {
    if (skipped.has(idx)) return;
    const fd = new FormData();
    fd.append('uploadId', uploadId);
    fd.append('index', String(idx));
    fd.append('total', String(total));
    fd.append('chunk', file.slice(idx * CHUNK, (idx + 1) * CHUNK));
    await sendXHR(api() + '/chunks/chunk', fd, () => {});
    skipped.add(idx);
    paint(i, Math.min(file.size || 0, skipped.size * CHUNK));
  };
  const workers = Array.from({ length: Math.min(3, total) }, async () => {
    while (next < total) await sendSlice(next++);
  });
  await Promise.all(workers);
  const fd = new FormData();
  fd.append('uploadId', uploadId);
  fd.append('name', file.name);
  fd.append('mime', file.type || 'application/octet-stream');
  fd.append('size', String(file.size || 0));
  fd.append('total', String(total));
  await sendXHR(api() + '/chunks/complete', fd, () => {});
  paint(i, file.size || 0);
}
async function uploadFiles(files) {
  if (!getToken()) return alert('Entre no acesso local primeiro.');
  const list = [...files];
  if (!list.length) return;
  const bar = $('upBar'), fill = $('upFill');
  const totalBytes = list.reduce((a, f) => a + (f.size || 0), 0);
  const sent = new Array(list.length).fill(0);
  let done = 0;
  const errors = [];
  const failed = [];
  const paintAll = () => {
    const s = sent.reduce((a, b) => a + b, 0);
    const pct = totalBytes ? Math.round((s / totalBytes) * 100) : 100;
    fill.style.width = pct + '%';
    $('upStatus').textContent = `Enviando ${done}/${list.length} arquivos… ${pct}%`;
  };
  bar.hidden = false; paintAll();
  const paintOne = (i, loaded) => { sent[i] = loaded; paintAll(); };
  const sendOne = (i) => new Promise((resolve) => {
    const file = list[i];
    // Grande vai fatiado (resume); pequeno vai direto.
    const job = (file.size || 0) > CHUNKED_FROM ? uploadChunked(file, i, paintOne) : uploadSimple(file, i, paintOne);
    job.then(() => { done++; paintAll(); resolve(); })
      .catch((e) => {
        done++; paintAll();
        failed.push(file);
        if (/401|expir/i.test(e.message || '')) { authLost(); errors.push(`${file.name}: sessão expirou, entre de novo`); }
        else errors.push(`${file.name}: ${(e.message || 'falha').slice(0, 200)}`);
        resolve();
      });
  });
  // 3 envios simultâneos: multiseleção anda junto em vez de fila única.
  const N = 3;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(N, list.length) }, async () => {
    while (next < list.length) await sendOne(next++);
  }));
  bar.hidden = true;
  lastFailed = failed;
  const rb = $('retryBtn');
  if (rb) rb.hidden = !failed.length;
  $('upStatus').textContent = errors.length
    ? `${done - errors.length}/${list.length} guardados. ${errors.length} falharam: ${errors.slice(0, 3).join(' | ')}`
    : `${list.length} guardado(s). Comprimindo… ⏳`;
  refreshFiles(); refreshQuota();
  setTimeout(() => { refreshFiles(); refreshQuota(); }, 8000);
}
let lastFailed = [];
async function retryFailed() {
  if (!lastFailed.length) return;
  const files = lastFailed;
  lastFailed = [];
  const rb = $('retryBtn');
  if (rb) rb.hidden = true;
  await uploadFiles(files);
}
// ---- importar do Google (Drive + Fotos, sem selecionar) ----
let gImportToken = '';
async function googleImport(source) {
  if (!getToken()) return alert('Entre primeiro.');
  try {
    const cfg = await (await fetch(api() + '/auth/config')).json();
    if (!cfg.google) return alert('Login Google desativado no servidor.');
    const scopes = source === 'drive'
      ? 'https://www.googleapis.com/auth/drive.readonly'
      : 'https://www.googleapis.com/auth/photoslibrary.readonly';
    const access = await new Promise((resolve, reject) => {
      const ensureGis = (done) => {
        if (window.google?.accounts?.oauth2) return done();
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = done;
        s.onerror = () => reject(new Error('Sem internet pro Google.'));
        document.head.appendChild(s);
      };
      ensureGis(() => {
        try {
          const client = window.google.accounts.oauth2.initTokenClient({
            client_id: cfg.clientId,
            scope: scopes,
            callback: (t) => (t?.access_token ? resolve(t.access_token) : reject(new Error('Permissão negada.'))),
          });
          client.requestAccessToken();
        } catch (e) { reject(e); }
      });
    });
    gImportToken = access;
    await jpost('/import/link', { accessToken: access });
    const job = await jpost(`/import/${source}/start`, {});
    pollImport(job.id);
  } catch (e) { alert('Erro: ' + e.message); }
}
async function pollImport(id) {
  const bar = $('impBar'), fill = $('impFill');
  bar.hidden = false;
  const tick = async () => {
    try {
      const j = await jget(`/import/jobs/${id}`);
      const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
      fill.style.width = pct + '%';
      $('impStatus').textContent = j.status === 'running'
        ? `Trazendo ${j.done}/${j.total || '?'}… ${pct}%`
        : `Pronto: ${j.done} arquivo(s)${j.errors.length ? `, ${j.errors.length} falha(s): ${j.errors.slice(0, 2).join(' | ')}` : ''}.`;
      if (j.status === 'running') setTimeout(tick, 3000);
      else { bar.hidden = true; refreshFiles(); refreshQuota(); }
    } catch (e) { $('impStatus').textContent = 'Erro: ' + e.message; }
  };
  tick();
}
function toggleCardMenu(id, ev) {
  ev?.stopPropagation();
  const m = $('menu-' + id);
  const wasHidden = m.hidden;
  document.querySelectorAll('.sp-menu').forEach((x) => (x.hidden = true));
  m.hidden = !wasHidden;
}
document.addEventListener('click', () => {
  document.querySelectorAll('.sp-menu').forEach((x) => (x.hidden = true));
});
function downloadFile(id) {
  const a = document.createElement('a');
  a.href = dlUrl(id);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function shareFile(id) {
  const f = allFiles.find((x) => x.id === id) || trashFiles.find((x) => x.id === id);
  window._openId = id;
  window._shareUrl = '';
  $('shareName').textContent = f ? f.name : 'Compartilhar';
  $('shareBox').hidden = false;
}
function closeShare() { $('shareBox').hidden = true; }
async function delFile(id) {
  if (!await confirmDlg('Mover pra lixeira? (30 dias pra restaurar)')) return;
  await jdel('/storage/' + id);
  refreshFiles(); refreshQuota();
}
async function restoreFile(id) {
  try { await jpost(`/storage/${id}/restore`, {}); refreshTrash(); refreshFiles(); refreshQuota(); }
  catch (e) { alert('Erro: ' + e.message); }
}
async function delForever(id) {
  if (!await confirmDlg('Excluir pra sempre? Não tem volta.')) return;
  await jdel('/storage/' + id + '/forever');
  refreshTrash(); refreshFiles(); refreshQuota();
}
async function emptyTrash() {
  if (!await confirmDlg('Esvaziar a lixeira? Apaga tudo pra sempre.')) return;
  try { const r = await jdel('/storage/trash/empty'); alert(`${r.removed} apagado(s).`); refreshTrash(); refreshFiles(); refreshQuota(); }
  catch (e) { alert('Erro: ' + e.message); }
}
function initDropzone() {
  const dz = $('dropzone');
  if (!dz) return;
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('border-emerald-500'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('border-emerald-500'); }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files); });
  $('filePick').addEventListener('change', (e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ''; });
}

function logout() {
  fetch(api() + '/playlists/vault-lock', { method: 'POST', headers: authHeaders() }).catch(() => {});
  setToken(''); selectedProfile = ''; localStorage.removeItem('deploy_profile'); allProfiles = []; paintProfiles(); setAppAuth(false); showAuth('login'); $('authState').textContent = 'Deslogado.';
}
async function me() {
  if (pendingResetToken()) { setAppAuth(false); showAuth('reset'); $('authState').textContent = 'Defina sua nova senha.'; return; }
  if (!getToken()) { setAppAuth(false); showAuth('login'); $('authState').textContent = 'Deslogado.'; return; }
  try { const r = await jget('/auth/me'); setAppAuth(true); showAuth('profile'); renderProfile(r); }
  catch { setAppAuth(false); showAuth('login'); $('authState').textContent = getToken() ? 'Sessão inválida.' : 'Deslogado.'; }
}

function flagsFromUI() {
  return {
    node: $('f_node').checked, build: $('f_build').checked, pm2: $('f_pm2').checked,
    docker: $('f_docker').checked, prisma: $('f_prisma').checked, postgres: $('f_postgres').checked,
    mysql: $('f_mysql').checked, mongo: $('f_mongo').checked, redis: $('f_redis').checked,
    static: $('f_static').checked, python: $('f_python').checked, php: $('f_php').checked,
    nginx: $('f_nginx').checked, ssl: $('f_ssl').checked,
  };
}
function flagsToUI(f) {
  if (!f) return;
  for (const k of ['node', 'build', 'pm2', 'docker', 'prisma', 'postgres', 'mysql', 'mongo', 'redis', 'static', 'python', 'php', 'nginx', 'ssl']) {
    if (f[k] !== undefined) $('f_' + k).checked = !!f[k];
  }
}

// ---- health (sem sobreposição: pula se a anterior ainda roda; timeout 5s) ----
let healthBusy = false;
setInterval(async () => {
  if (healthBusy) return;
  healthBusy = true;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    await fetch(api() + '/health', { signal: ctl.signal });
    $('health').textContent = '● online'; $('health').style.color = '#10b981';
  }
  catch { $('health').textContent = '● offline'; $('health').style.color = '#ef4444'; }
  finally { clearTimeout(t); healthBusy = false; }
}, 5000);

// ---- contabo ----
async function saveContabo() {
  try {
    await jpost('/contabo', { label: $('c_label').value, clientId: $('c_id').value, clientSecret: $('c_secret').value, apiUser: $('c_user').value, apiPassword: $('c_pass').value });
    alert('Conexão Contabo salva (segredos criptografados).');
    loadInstances();
  } catch (e) { alert('Erro: ' + e.message); }
}
async function loadInstances() {
  try {
    const data = await jget('/contabo/instances');
    const list = data.data || [];
    $('instancesBox').innerHTML = list.map((i) => `
      <div class="bg-zinc-900 border border-zinc-800 rounded p-2">
        <div class="font-bold">${i.displayName || i.name} <span class="badge" style="background:#10b98122;color:#10b981">${i.status}</span></div>
        <div>IP: ${i.ipConfig?.v4?.ip || '-'} · ${i.cpuCores} vCPU · ${i.ramMb} MB · ${i.diskMb} MB</div>
        <div class="text-zinc-500">${i.productName || i.productId} · ${i.regionName || i.region} · ${i.dataCenter || ''}</div>
        <div class="mt-1 flex gap-1">
          <button class="btn-ghost" onclick="instanceAction('${i.instanceId || i.id}','restart')">Restart</button>
          <button class="btn-ghost" onclick="instanceAction('${i.instanceId || i.id}','stop')">Stop</button>
          <button class="btn-ghost" onclick="instanceAction('${i.instanceId || i.id}','start')">Start</button>
        </div>
      </div>`).join('') || '<span class="text-zinc-500">Nenhuma instância.</span>';
  } catch (e) { $('instancesBox').innerHTML = `<span class="text-red-400">${e.message}</span>`; }
}
async function instanceAction(id, action) {
  if (!await confirmDlg(`${action} na instância ${id}?`)) return;
  try { await jpost(`/contabo/instances/${id}/${action}`, {}); alert('Comando enviado: ' + action); loadInstances(); }
  catch (e) { alert('Erro: ' + e.message); }
}

// ---- servers ----
async function saveServer() {
  try {
    const r = await jpost('/servers', { label: $('s_label').value, host: $('s_host').value, port: $('s_port').value, username: $('s_user').value, password: $('s_pass').value, privateKey: $('s_key').value });
    selectedServerId = r.id;
    refreshServers();
  } catch (e) { alert('Erro: ' + e.message); }
}
async function refreshServers() {
  if (!getToken()) return; // sem login nem chama a API (evita 401 no console)
  try {
    const list = await jget('/servers');
    if (list[0] && !selectedServerId) selectedServerId = list[0].id;
    $('serverList').innerHTML = list.map((s) => `<div class="flex justify-between bg-zinc-900 border ${s.id === selectedServerId ? 'border-emerald-600' : 'border-zinc-800'} rounded px-2 py-1 mb-1">
      <button onclick="selectedServerId='${s.id}';refreshServers()">${s.id === selectedServerId ? '● ' : '○ '}${esc(s.label)} (${esc(s.username)}@${esc(s.host)})</button>
      <button onclick="delServer('${s.id}')" class="text-red-400">x</button></div>`).join('');
  } catch {}
}
async function delServer(id) { await jdel('/servers/' + id); refreshServers(); }
async function testServer() {
  if (!selectedServerId) return alert('Salve a VPS primeiro.');
  $('statsBox').classList.remove('hidden');
  $('statsBox').textContent = 'Testando SSH…';
  try {
    const r = await jpost(`/servers/${selectedServerId}/test`, {});
    $('statsBox').textContent = 'OK ✅\n' + r.out;
  } catch (e) { $('statsBox').textContent = 'FALHOU ❌\n' + e.message; }
}
async function loadStats() {
  if (!selectedServerId) return alert('Salve a VPS primeiro.');
  $('statsBox').classList.remove('hidden');
  $('statsBox').textContent = 'Coletando…';
  try {
    const r = await jget(`/servers/${selectedServerId}/stats`);
    $('statsBox').textContent = r.raw;
  } catch (e) { $('statsBox').textContent = 'Erro: ' + e.message; }
}

// ---- apps (fonte: GitHub ou .zip da máquina) ----
let deploySource = 'github';
let deployZipId = '';
function setSource(s) {
  deploySource = s;
  $('srcGithub').className = s === 'github' ? 'btn' : 'btn-ghost';
  $('srcUpload').className = s === 'upload' ? 'btn' : 'btn-ghost';
  $('srcGithubBox').hidden = s !== 'github';
  $('srcUploadBox').hidden = s !== 'upload';
}
function appPayload() {
  return {
    name: $('a_name').value, source: deploySource, githubUrl: $('a_url').value, domain: $('a_domain').value,
    port: Number($('a_port').value) || 3000, envVars: $('a_env').value,
    flags: flagsFromUI(), dbProvider: $('a_db').value, serverId: selectedServerId,
  };
}
async function autoDetect() {
  const url = $('a_url').value;
  if (!url) return alert('Cole o link do GitHub primeiro.');
  $('detectBox').textContent = 'Analisando repo…';
  try {
    const d = await jget('/apps/detect?url=' + encodeURIComponent(url));
    flagsToUI(d.flags);
    $('a_db').value = d.dbProvider || 'none';
    if (!$('a_name').value) $('a_name').value = d.repo;
    $('detectBox').innerHTML = `<b>Auto-detecção:</b> ${Object.entries(d.flags).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nada óbvio — marque manual'}<br><span class="text-zinc-500">${(d.hints || []).join('<br>')}</span>`;
  } catch (e) { $('detectBox').textContent = 'Erro: ' + e.message; }
}
async function previewDeploy() {
  try {
    const r = await jpost('/apps/preview', appPayload());
    $('previewBox').classList.remove('hidden');
    $('previewBox').textContent = r.script;
  } catch (e) { alert('Erro: ' + e.message); }
}
async function saveApp() {
  try {
    const r = await jpost('/apps', appPayload());
    selectedAppId = r.id;
    refreshApps();
  } catch (e) { alert('Erro: ' + e.message); }
}
async function refreshApps() {
  if (!getToken()) return;
  try {
    const list = await jget('/apps');
    $('appsList').innerHTML = list.map((a) => `<div class="bg-zinc-900 border ${a.id === selectedAppId ? 'border-emerald-600' : 'border-zinc-800'} rounded p-2">
      <div class="font-bold">${esc(a.name)} <span class="text-xs text-zinc-400">${a.source === 'upload' ? '📦 zip' : '🐙 github'}</span></div>
      <div class="text-xs text-zinc-400 truncate">${esc(a.githubUrl || '')}</div>
      <div class="text-xs">porta ${a.port}${a.domain ? ' · ' + esc(a.domain) : ''} · ${esc(a.dbProvider)}</div>
      <div class="mt-1 flex gap-1">
        <button class="btn-ghost" onclick="selectedAppId='${a.id}';loadToForm('${a.id}')">Editar</button>
        <button class="btn-ghost" onclick="selectedAppId='${a.id}';deployNow()">Deploy</button>
        <button class="btn-ghost" onclick="delApp('${a.id}')">Excluir</button>
      </div></div>`).join('') || '<span class="text-zinc-500">Nenhum app. Cole o GitHub acima.</span>';
  } catch {}
}
async function loadToForm(id) {
  const list = await jget('/apps');
  const a = list.find((x) => x.id === id);
  if (!a) return;
  setSource(a.source === 'upload' ? 'upload' : 'github');
  $('a_name').value = a.name; $('a_url').value = a.githubUrl || ''; $('a_domain').value = a.domain || '';
  $('a_port').value = a.port; $('a_env').value = a.envVars || ''; $('a_db').value = a.dbProvider || 'none';
  flagsToUI(a.flags);
  if (a.serverId) { selectedServerId = a.serverId; refreshServers(); }
}
async function delApp(id) { await jdel('/apps/' + id); refreshApps(); }

// ---- deploy 1-clique (GitHub ou .zip) ----
async function uploadDeployZip(file) {
  if (!getToken()) return alert('Entre no acesso local primeiro.');
  if (!/\.zip$/i.test(file.name)) return alert('Envie um arquivo .zip.');
  $('zipStatus').textContent = `Enviando ${file.name}…`;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(api() + '/apps/upload-zip', { method: 'POST', headers: authHeaders(), body: fd });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    deployZipId = j.zipId;
    $('zipStatus').textContent = `${file.name}: ${j.files} arquivos, ${(j.totalBytes / 1048576).toFixed(1)} MB validados. Pronto pra SUBIR.`;
  } catch (e) { deployZipId = ''; $('zipStatus').textContent = `Erro: ${e.message}`; }
}
function initZipDrop() {
  const box = $('srcUploadBox');
  const pick = $('zipPick');
  if (!box || !pick || box._wired) return;
  box._wired = true;
  ['dragover', 'dragenter'].forEach((ev) => box.addEventListener(ev, (e) => e.preventDefault()));
  box.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.[0]) uploadDeployZip(e.dataTransfer.files[0]); });
  pick.addEventListener('change', (e) => { if (e.target.files?.[0]) uploadDeployZip(e.target.files[0]); e.target.value = ''; });
}
async function deployNow() {
  try {
    let appId = selectedAppId;
    if (deploySource === 'upload' && !appId && !deployZipId) return alert('Envie o .zip primeiro.');
    if (!appId) {
      if (!$('a_name').value) return alert('Preencha o nome do app.');
      if (deploySource === 'github' && !$('a_url').value) return alert('Preencha nome + GitHub (ou Detectar).');
      const saved = await jpost('/apps', appPayload());
      appId = saved.id; selectedAppId = appId; refreshApps();
    } else {
      await jpost('/apps', { ...appPayload(), id: appId }); // salva overrides
    }
    const r = await jpost(`/deploy/${appId}`, { ...appPayload(), zipId: deployZipId });
    $('logs').textContent = `Deploy ${r.deployId} iniciado (${r.appName})…\n`;
    const es = new EventSource(withTokenQuery(`${api()}/deploy/${r.deployId}/logs`));
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.line) { $('logs').textContent += msg.line + '\n'; $('logs').scrollTop = 1e9; }
      if (msg.done) { $('logs').textContent += `\n== ${msg.status === 'success' ? 'SUCESSO ✅' : 'FALHOU ❌'} ==`; es.close(); refreshHistory(); }
    };
  } catch (e) { alert('Erro no deploy: ' + e.message); }
}
async function refreshHistory() {
  if (!getToken()) return;
  try {
    const h = await jget('/deploy');
    $('history').innerHTML = h.map((d) => `<div>● ${esc(d.appName)} — <b>${esc(d.status)}</b> <span class="text-zinc-500">${esc(d.startedAt || '')}</span></div>`).join('');
  } catch {}
}

me(); refreshServers(); refreshApps(); refreshHistory(); initDropzone(); initZipDrop(); refreshQuota(); refreshFiles(); refreshProfiles(); refreshPlaylists(); initGoogle();
if ($('sortSel')) $('sortSel').value = sortMode;
// PWA: registra SW (ignora file:// e Live Server sem SW).
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Enquanto houver ⏳, atualiza sozinho a cada 10s (thumb, % e economia).
setInterval(() => {
  if (getToken() && allFiles.some((f) => !f.compressed)) { refreshFiles(); refreshQuota(); }
}, 10000);
