// profiles.js — 1 conta, N perfis (tipo Netflix). Filtra as playlists da sidebar.
const Profiles = (() => {
  let all = [];
  const current = () => localStorage.getItem('infdrive_profile') || '';
  async function refresh() {
    if (!getToken()) { all = []; return; }
    try {
      all = await jget('/profiles');
      if (current() && !all.some((p) => p.id === current())) clear(false);
      paintMenu();
      try { Playlists.paintNav(); } catch {}
    } catch {}
  }
  function paintMenu(box) {
    box = box || $('pmProfiles');
    if (!box) return;
    box.innerHTML = '<button onclick="Profiles.pick(\'\');Shell.closeProfileMenu()">👥 Conta</button>' +
      all.map((p) => '<button onclick="Profiles.pick(\'' + p.id + '\')">' + (current() === p.id ? '✓ ' : '') + esc(p.name) + (p.locked ? ' 🔒' : '') + '</button>').join('') +
      '<button onclick="Profiles.create()">＋ Novo perfil</button>';
  }
  function pick(id) {
    if (id) localStorage.setItem('infdrive_profile', id);
    else localStorage.removeItem('infdrive_profile');
    try { Shell.closeProfileMenu(); } catch {}
    paintMenu();
    try { Playlists.paintNav(); } catch {}
  }
  function clear(repaint = true) {
    localStorage.removeItem('infdrive_profile');
    if (repaint) { paintMenu(); try { Playlists.paintNav(); } catch {} }
  }
  function visible() {
    const cur = current();
    if (!cur) return all;
    return all.filter((p) => p.id === cur);
  }
  async function show() {
    await refresh();
    render();
  }
  function render() {
    const g = $('profGrid');
    if (!g) return;
    const cur = current();
    g.innerHTML = all.map((p) => `
      <div class="sp-album prof-card ${cur === p.id ? 'active' : ''}" title="${esc(p.name)}">
        <div class="prof-av">${esc((p.name || '?')[0].toUpperCase())}</div>
        <div class="prof-name">${cur === p.id ? '✓ ' : ''}${esc(p.name)}${p.locked ? ' 🔒' : ''}</div>
        <div class="prof-row">
          <button class="btn-ghost" onclick="Profiles.select('${p.id}')">Entrar</button>
          <button class="btn-ghost" onclick="Profiles.remove('${p.id}')">Excluir</button>
        </div>
      </div>`).join('') || '<span class="text-zinc-500 text-xs">Só a conta. Crie perfis pra dividir playlists (ex: Crianças).</span>';
  }
  async function create() {
    const name = await inputDlg('Nome do perfil:', { placeholder: 'Crianças' });
    if (!name?.trim()) return;
    const pin = await inputDlg('PIN de 4 a 8 dígitos (vazio = sem PIN):', { password: true, placeholder: 'opcional' }) || '';
    if (pin.trim() && !/^\d{4,8}$/.test(pin.trim())) return toast('PIN: 4 a 8 dígitos.');
    try {
      await jpost('/profiles', { name: name.trim(), pin: pin.trim() });
      toast(`Perfil ${name.trim()} criado. ✅`);
      await refresh();
      render();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function select(id) {
    const p = all.find((x) => x.id === id);
    if (!p) return;
    if (p.locked) {
      const pin = await inputDlg(`PIN do perfil "${p.name}":`, { password: true });
      if (pin === null) return;
      try { await jpost(`/profiles/${id}/unlock`, { pin }); }
      catch (e) { return toast('Erro: ' + e.message); }
    }
    pick(id);
    render();
    toast(`Perfil ${p.name} ativo. ✅`);
  }
  async function remove(id) {
    const p = all.find((x) => x.id === id);
    if (!await confirmDlg(`Excluir o perfil "${p?.name || ''}"? (playlists dele voltam pra conta)`)) return;
    try {
      await jdel('/profiles/' + id);
      if (current() === id) clear(false);
      await refresh();
      render();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  return { refresh, paintMenu, create, select, pick, clear, show, visible, current };
})();
window.Profiles = Profiles;
