// admin.js — disco, usuários, backup (só admin vê a página)
const Admin = (() => {
  const isDemo = () => location.search.includes('demo') || location.hash.includes('demo');

  async function show() {
    if (isDemo()) { paintDemo(); return; }
    if (window._user && window._user.role !== 'admin') {
      const box = $('usersBox');
      if (box) box.innerHTML = '<span class="text-zinc-500 text-xs">Área do admin. Sua conta não tem acesso.</span>';
      return;
    }
    loadDisk();
  }
  function paintDemo() {
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('dUseLabel', 'Disco 32,4 GB em uso');
    set('dTotalLabel', 'de 75 GB');
    const bar = $('dBar'); if (bar) bar.style.width = '43%';
    set('dApp', 'App ocupa 3,10 GB em 4 arquivos (demo). Livre: 42,6 GB.');
    const box = $('usersBox');
    if (box) box.innerHTML = '<div><b>Demo</b> <span class="text-xs text-zinc-400">demo@local · admin</span><div class="sp-bar"><div style="width:15%"></div></div></div>';
  }
  async function loadDisk() {
    if (!getToken()) return;
    try {
      const d = await jget('/system/disk');
      $('dUseLabel').textContent = 'Disco ' + fmtMB(d.diskUsedMB) + ' em uso';
      $('dTotalLabel').textContent = 'de ' + fmtMB(d.diskTotalMB);
      $('dBar').style.width = Math.min(100, d.pct) + '%';
      $('dBar').style.background = d.pct >= 70 ? '#ef4444' : '';
      $('dAlert').textContent = d.alert || '';
      $('dApp').textContent = 'App ocupa ' + fmtMB(d.appMB) + ' em ' + d.files + ' arquivo(s). Livre: ' + fmtMB(d.diskFreeMB) + '.';
      $('dPlan').hidden = d.pct < 70;
    } catch {}
    refreshUsers();
    refreshBackups();
  }
  function planQuota(plan) { return plan === 'Studio' ? 5242880 : plan === 'Plus' ? 512000 : 204800; }
  const PLAN_QUOTA = { Leve: 204800, Plus: 512000, Studio: 5242880 };
  async function refreshUsers() {
    try {
      const me = await jget('/auth/me');
      if (me.role !== 'admin') return;
      const list = await jget('/auth/overview');
      $('usersBox').innerHTML = list.map((u) => `<div class="user-row">
        <div><b>${esc(u.name)}</b> <span class="text-xs text-zinc-400">${esc(u.email)} · ${esc(u.role)} · ${esc(u.plan || '')}</span></div>
        <div class="flex justify-between text-xs text-zinc-400"><span>${fmtMB(u.usedMB)} de ${fmtMB(u.quotaMB)} · ${u.files} arq.</span><span>${u.pct}%</span></div>
        <div class="sp-bar"><div style="width:${Math.min(100, u.pct)}%"></div></div>
        <div class="flex gap-2 mt-2">
          <select id="qp-${u.id}" class="inp" style="width:auto;margin:0" onchange="document.getElementById('qq-${u.id}').value=Admin.planQuota(this.value)">
            ${['Leve', 'Plus', 'Studio'].map((p) => `<option ${u.plan === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
          <input id="qq-${u.id}" class="inp" style="width:110px;margin:0" type="number" min="0" value="${u.quotaMB}" title="Quota em MB" />
          <button class="btn-ghost" onclick="Admin.savePlan('${u.id}')">Salvar</button>
          <button class="btn-ghost" onclick="Admin.delUser('${u.id}')">Excluir</button>
        </div></div>`).join('') || 'Sem usuários.';
    } catch {}
  }
  function planQuota(plan) { return PLAN_QUOTA[plan] || 204800; }
  async function savePlan(id) {
    try {
      await jpatch('/auth/users/' + id, { plan: $('qp-' + id).value, quotaMB: Number($('qq-' + id).value) || planQuota($('qp-' + id).value) });
      toast('Plano salvo.');
      refreshUsers();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function delUser(id) {
    if (!await confirmDlg('Excluir a conta E todos os arquivos dela? Não tem volta.')) return;
    try { await jdel('/auth/users/' + id); refreshUsers(); }
    catch (e) { toast('Erro: ' + e.message); }
  }
  async function createUser() {
    try {
      const r = await jpost('/auth/users', { name: $('nu_name').value, email: $('nu_email').value, password: $('nu_pass').value, role: 'user' });
      await jpatch('/auth/users/' + r.id, { plan: $('nu_plan').value });
      $('nu_state').textContent = 'Conta ' + r.email + ' criada.';
      refreshUsers();
    } catch (e) { $('nu_state').textContent = 'Erro: ' + e.message; }
  }
  async function refreshBackups() {
    try {
      const list = await jget('/system/backups');
      $('backupBox').innerHTML = list.map((b) => '<div>' + esc(b.file) + ' · ' + fmtMB(b.bytes / 1048576) + '</div>').join('') || 'Sem backups.';
    } catch {}
  }
  async function makeBackup() {
    try {
      $('backupState').textContent = 'Gerando zip…';
      const r = await jpost('/system/backup', {});
      $('backupState').textContent = 'Pronto: ' + r.file;
      refreshBackups();
    } catch (e) { $('backupState').textContent = 'Erro: ' + e.message; }
  }
  return { show, loadDisk, refreshUsers, createUser, refreshBackups, makeBackup, planQuota, savePlan, delUser };
})();
window.Admin = Admin;
