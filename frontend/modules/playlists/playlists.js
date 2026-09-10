// playlists.js — página Suas Playlists (grade) + detalhe (faixas).
const Playlists = (() => {
  let all = [];
  let openId = '';
  function coverUrl(pid) { return withTokenQuery(`${api()}/playlists/${pid}/cover`); }
  async function refresh() {
    if (!getToken()) return;
    try {
      all = await jget('/playlists');
      paintNav();
    } catch {}
  }
  function get(id) { return all.find((p) => p.id === id); }
  function paintNav() {
    const nav = $('playNav'); if (!nav) return;
    // Perfil ativo filtra: só as playlists dele (+ as da conta, profileId vazio).
    let list = all;
    try {
      const cur = window.Profiles?.current?.();
      if (cur) list = all.filter((p) => !p.profileId || p.profileId === cur);
    } catch {}
    nav.innerHTML = list.map((p) => `<button class="sp-nav-btn" onclick="Drive.setPlaylist('${p.id}');Shell.show('drive')">${p.locked ? '🔒' : '📁'} ${esc(p.name)} <span class="text-zinc-500">· ${p.count ?? (p.fileIds||[]).length}</span></button>`).join('');
  }
  async function create() {
    const name = await inputDlg('Nome da playlist:', { placeholder: 'Viagem 2026' });
    if (!name?.trim()) return null;
    try {
      const pl = await jpost('/playlists', { name: name.trim() });
      await refresh();
      return pl;
    } catch (e) { toast('Erro: ' + e.message); return null; }
  }
  async function show() {
    openId = '';
    await refresh();
    renderGrid();
  }
  function renderGrid() {
    const g = $('plGrid'), d = $('plDetail'), back = $('plBack'), c = $('plCount');
    if (!g) return;
    if (d) d.hidden = true;
    g.hidden = false;
    if (back) back.hidden = true;
    if (c) c.textContent = all.length ? `${all.length} playlist(s)` : '';
    g.innerHTML = all.map((p) => `
      <div class="sp-album pl-card" onclick="Playlists.open('${p.id}')" title="${esc(p.name)}">
        ${p.locked
          ? `<div class="pl-fallback">🔒</div>`
          : `<img src="${coverUrl(p.id)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;pl-fallback&quot;>🎵</div>'" alt="" />`}
        <div class="sp-album-title">${p.locked ? '🔒 ' : ''}${esc(p.name)}</div>
        <div class="sp-album-sub">${p.count ?? (p.fileIds || []).length} faixa(s)</div>
      </div>`).join('') || '<span class="text-zinc-500 text-xs">Nenhuma playlist. Crie a primeira acima. ＋</span>';
  }
  function filesOf(pl) {
    const byId = new Map(Drive.all().map((f) => [f.id, f]));
    return (pl.fileIds || []).map((id) => byId.get(id)).filter(Boolean);
  }
  async function open(id) {
    const pl = get(id);
    if (!pl) return;
    if (pl.locked) {
      try { await Vault.unlock(id); } catch { return; }
      await refresh();
    }
    openId = id;
    const g = $('plGrid'), d = $('plDetail'), back = $('plBack');
    if (!g || !d) return;
    g.hidden = true;
    d.hidden = false;
    if (back) back.hidden = false;
    const p = get(id) || pl;
    const tracks = filesOf(p);
    const audios = tracks.filter((f) => kindOf(f) === 'audio');
    d.innerHTML = `
      <div class="pl-head">
        ${p.cover && !p.locked ? `<img src="${coverUrl(p.id)}" alt="" />` : `<div class="pl-head-fallback">${p.locked ? '🔒' : '🎵'}</div>`}
        <div>
          <div class="pl-title">${esc(p.name)}</div>
          <div class="pl-sub">${tracks.length} faixa(s)</div>
          <div class="pl-actions">
            ${audios.length ? `<button class="btn-ghost" onclick="Playlists.playAll('${id}')">▶ Tocar</button>` : ''}
            <button class="btn-ghost" onclick="Playlists.addFiles('${id}')">＋ Adicionar arquivos</button>
            <button class="btn-ghost" onclick="Playlists.setCover('${id}')">📷 Capa</button>
            <button class="btn-ghost" onclick="Playlists.remove('${id}')">🗑 Excluir</button>
          </div>
        </div>
      </div>
      <div>${tracks.map((f) => `
        <div class="pl-track" onclick="Playlists.playTrack('${id}','${f.id}')">
          ${f.thumb ? `<img src="${Drive.thumbUrl(f.id)}" loading="lazy" />` : `<div class="pl-track-fb">${Drive.icon(f)}</div>`}
          <div><div class="pl-track-name">${esc(f.name)}</div>
          <div class="pl-track-sub">${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}${f.duration ? ' · ' + fmtDur(f.duration) : ''}</div></div>
          <button class="pl-track-x" title="Tirar da playlist" onclick="event.stopPropagation();Playlists.unlist('${id}','${f.id}')">✕</button>
        </div>`).join('') || '<span class="text-zinc-500 text-xs">Vazia. Adicione pelo ⋮ → Mover p/ playlist nos arquivos.</span>'}</div>`;
  }
  function playTrack(pid, fid) {
    const p = get(pid);
    if (!p) return;
    const tracks = filesOf(p);
    const f = tracks.find((x) => x.id === fid);
    if (!f) return;
    if (kindOf(f) === 'audio') {
      Player.playList(tracks.filter((x) => kindOf(x) === 'audio'), fid);
    } else Share.open(fid);
  }
  function playAll(pid) {
    const p = get(pid);
    if (!p) return;
    const audios = filesOf(p).filter((f) => kindOf(f) === 'audio');
    if (audios.length) Player.playList(audios, audios[0].id);
  }
  async function unlist(pid, fid) {
    try {
      await jdel(`/playlists/${pid}/files/${fid}`);
      await refresh();
      if (openId) open(openId);
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function remove(pid) {
    const p = get(pid);
    if (!await confirmDlg(`Excluir a playlist "${p?.name || ''}"? (os arquivos ficam)`)) return;
    try {
      await jdel('/playlists/' + pid);
      await refresh();
      show();
      toast('Playlist excluída.');
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function setCover(pid) {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*';
    i.onchange = async () => {
      if (!i.files?.length) return;
      try {
        const fd = new FormData();
        fd.append('file', i.files[0]);
        const r = await fetch(api() + `/playlists/${pid}/cover`, { method: 'POST', headers: authHeaders(), body: fd });
        if (!r.ok) throw new Error(await r.text());
        toast('Capa atualizada. 📷');
        if (openId) { await refresh(); open(openId); }
        else show();
      } catch (e) { toast('Erro: ' + e.message); }
    };
    i.click();
  }
  function addFiles(pid) {
    Drive.addMode(pid);
    Shell.show('drive');
  }
  return { refresh, get, all: () => all, create, show, open, playTrack, playAll, unlist, remove, setCover, addFiles, coverUrl, paintNav };
})();
window.Playlists = Playlists;
