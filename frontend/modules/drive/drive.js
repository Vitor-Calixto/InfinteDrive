// drive.js — grade Spotify + quota
const Drive = (() => {
  let allFiles = [];
  let kindFilter = 'all';
  let searchTerm = '';
  let playlistFilter = '';
  let serverIds = null; // null = busca local; array = ordem ranqueada do servidor
  let sortMode = localStorage.getItem('infdrive_sort') || 'recent';

  function thumbUrl(id) { return withTokenQuery(`${api()}/storage/thumb/${id}`); }
  function dlUrl(id) { return withTokenQuery(`${api()}/storage/download/${id}`); }

  const isDemo = () => location.search.includes('demo') || location.hash.includes('demo');

  let pollTimer = null;
  async function refresh() {
    if (isDemo()) { useMock(); return; }
    if (!getToken()) return;
    try {
      allFiles = await jget('/storage/list');
      window._files = allFiles;
      render();
      paintProc();
      refreshQuota();
      ensurePoll();
    } catch {}
  }
  // Poll próprio: recarregou a página no meio da compressão? Continua sozinho
  // até zerar os ⏳ (sem depender do Upload ter visto o envio).
  function ensurePoll() {
    const pend = allFiles.some((f) => !f.compressed && !f.trashedAt);
    if (pend && !pollTimer) {
      pollTimer = setInterval(() => { try { refresh(); } catch {} }, 8000);
    } else if (!pend && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  // Faixa "⏳ N comprimindo": o usuário vê a fila do servidor, não um vazio.
  function paintProc() {
    const b = $('procBanner');
    if (!b) return;
    const pend = allFiles.filter((f) => !f.compressed && !f.trashedAt);
    if (!pend.length) { b.hidden = true; return; }
    const mb = pend.reduce((a, f) => a + (Number(f.sizeOrig) || 0), 0) / 1048576;
    b.hidden = false;
    b.innerHTML = `⏳ <b>${pend.length}</b> comprimindo (${fmtMB(mb)}) — ${esc(pend.slice(0, 3).map((f) => f.name).join(' · '))}${pend.length > 3 ? '…' : ''}. A economia entra sozinha.`;
  }
  function useMock() {
    if (window._files?.length) allFiles = window._files;
    render();
    if (window._quota) {
      const q = window._quota;
      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('qUseMini', fmtMB(q.finalMB) + ' / ' + fmtMB(q.quotaMB));
      const bar = $('qBarMini'); if (bar) bar.style.width = '15%';
    }
  }
  function renderMock() { useMock(); }
  async function refreshQuota() {
    try {
      const q = await jget('/storage/quota');
      window._quota = q;
      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('qUseMini', `${fmtMB(q.finalMB)} / ${fmtMB(q.quotaMB)}`);
      const bar = $('qBarMini'); if (bar) bar.style.width = Math.min(100, (q.finalMB / q.quotaMB) * 100).toFixed(1) + '%';
      set('pmQuota', `Ocupando ${fmtMB(q.finalMB)} de ${fmtMB(q.quotaMB)}`);
      if (window.System?.paint) window.System.paint(q);
    } catch {}
  }
  function show() {
    const s = $('sortSel');
    if (s) s.value = sortMode;
    refresh();
  }
  function clearSearchInput() {
    searchTerm = ''; serverIds = null;
    const si = $('search'); if (si) si.value = '';
  }
  // Modo adicionar: da página da playlist, escolhe arquivos no drive.
  let addPid = '';
  function addMode(pid) {
    addPid = pid || '';
    const pl = pid ? Playlists.get(pid) : null;
    const b = $('addBanner');
    if (b) {
      b.hidden = !pid;
      if (pid) b.innerHTML = `＋ Adicionando em <b>${esc(pl?.name || 'playlist')}</b> — toque ＋ nos arquivos. <button class="sp-link" onclick="Drive.addMode('')">concluir</button>`;
    }
    render();
  }
  async function addOne(pid, fid) {
    try {
      await jpost(`/playlists/${pid}/files`, { fileIds: [fid] });
      await Playlists.refresh();
      const ok = (Playlists.get(pid)?.fileIds || []).includes(fid);
      toast(ok ? 'Adicionado. ✅' : 'Erro: servidor não confirmou.');
      render();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  function filterKind(k) {
    kindFilter = k; playlistFilter = '';
    clearSearchInput();
    document.querySelectorAll('#kindNav .sp-pill').forEach((b) => b.classList.toggle('active', b.dataset.kind === k));
    render();
  }
  function setSearch(s) { searchTerm = (s || '').toLowerCase(); render(); }
  // Resultado do servidor: filtra pela ordem ranqueada + cola snippets (PDF).
  function setServerResults(ids, snips) {
    serverIds = ids;
    if (snips) {
      for (const f of allFiles) {
        if (snips[f.id]) f.snippet = snips[f.id];
        else if (f.snippet) delete f.snippet;
      }
    }
    render();
  }
  function setSort(v) { sortMode = v; localStorage.setItem('infdrive_sort', v); render(); }
  function setPlaylist(id) {
    playlistFilter = (playlistFilter === id ? '' : id);
    clearSearchInput();
    render();
  }

  function visible() {
    let list = allFiles.filter((f) => !f.trashedAt);
    const ranked = serverIds !== null;
    if (ranked) {
      // Ordem do servidor (score nome > tipo > corpo PDF). Filtro local sai.
      const pos = new Map(serverIds.map((id, i) => [id, i]));
      list = list.filter((f) => pos.has(f.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
    }
    if (playlistFilter && window.Playlists?.get) {
      const pl = window.Playlists.get(playlistFilter);
      if (pl) { const set = new Set(pl.fileIds || []); list = list.filter((f) => set.has(f.id)); }
    }
    if (kindFilter !== 'all') list = list.filter((f) => kindOf(f) === kindFilter);
    if (!ranked && searchTerm) list = list.filter((f) => (f.name || '').toLowerCase().includes(searchTerm));
    if (ranked) return list;
    const by = {
      recent: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
      oldest: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)),
      az: (a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'),
      za: (a, b) => (b.name || '').localeCompare(a.name || '', 'pt-BR'),
      biggest: (a, b) => (b.sizeFinal ?? 0) - (a.sizeFinal ?? 0),
      smallest: (a, b) => (a.sizeFinal ?? 0) - (b.sizeFinal ?? 0),
    }[sortMode] || (() => 0);
    return [...list].sort(by);
  }

  function icon(f) { const k = kindOf(f); return k === 'image' ? '🖼' : k === 'audio' ? '🎵' : k === 'video' ? '🎬' : '📄'; }
  // "há 3 min" desde o upload — o usuário sente o tempo passar, não um ⏳ mudo.
  function elapsed(f) {
    const ms = Date.now() - new Date(f.createdAt || Date.now()).getTime();
    if (ms < 60000) return 'agora mesmo';
    const m = Math.floor(ms / 60000);
    if (m < 60) return `há ${m} min`;
    return `há ${Math.floor(m / 60)}h${m % 60 ? (m % 60) + 'min' : ''}`;
  }
  // Status de compressão sob o card: % real do ffmpeg (vídeo) ou "na fila".
  function pendLine(f) {
    if (f.compressed) return '';
    const pct = Number(f.progress) || 0;
    const st = pct > 0 ? `comprimindo ${pct}%` : 'na fila';
    return `<div class="sp-album-prog${pct > 0 ? '' : ' idle'}"><div style="width:${pct}%"></div></div>
      <div class="sp-album-pend">⏳ ${st} · ${elapsed(f)}</div>`;
  }

  function render() {
    const grid = $('filesGrid');
    if (!grid) return;
    const list = visible();
    const c = $('fileCount');
    if (c) {
      const total = allFiles.filter((f) => !f.trashedAt).length;
      c.textContent = list.length === total ? `${total} arquivo(s)` : `${list.length} de ${total}`;
    }
    grid.innerHTML = list.map((f) => `
      <div class="sp-album" onclick="Share.open('${f.id}')" title="${esc(f.name)}">
        ${f.thumb ? `<img src="${thumbUrl(f.id)}" loading="lazy" />` : `<div class="sp-album-fallback">${icon(f)}</div>`}
        <button class="sp-album-more" title="Mais ações" onclick="event.stopPropagation();Drive.menu('${f.id}',event)">⋮</button>
        <button class="sp-album-play" onclick="event.stopPropagation();Share.open('${f.id}')">▶</button>
        <div class="sp-album-title">${esc(f.name)}</div>
        <div class="sp-album-sub">${fmtMB((f.sizeOrig || 0) / 1048576)} → ${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}${f.duration ? ' · ' + fmtDur(f.duration) : ''}</div>
        ${f.broken ? `<div class="sp-album-broken" title="${esc(f.note || 'Sem conteúdo')}">⚠️ quebrado na origem</div>` : ''}
        ${!f.broken ? pendLine(f) : ''}
        ${f.snippet ? `<div class="sp-album-snippet">…${esc(f.snippet)}…</div>` : ''}
        <div class="sp-album-row">
          ${addPid ? `<button class="btn-ghost icon" title="Adicionar na playlist" onclick="event.stopPropagation();Drive.addOne('${addPid}','${f.id}')">＋</button>` : ''}
          <button class="btn-ghost icon" title="Mover pra lixeira" onclick="event.stopPropagation();Drive.del('${f.id}')">${ICO_TRASH}</button>
          <button class="btn-ghost icon" title="Enviar" onclick="event.stopPropagation();Drive.sendFile('${f.id}')">${ICO_SEND}</button>
          <button class="btn-ghost icon" title="Copiar link" onclick="event.stopPropagation();Drive.copyLink('${f.id}')">${ICO_COPY}</button>
        </div>
      </div>`).join('') || (searchTerm || serverIds !== null || playlistFilter
        ? '<span class="text-zinc-500 text-xs">Nada achado. Limpe a busca ou troque o filtro. 🔍</span>'
        : '<span class="text-zinc-500 text-xs">Nada aqui ainda. Arraste arquivos acima. ⬆</span>');
  }
  // Ícones SVG (emoji 🗑 vira ⬛ em Windows sem fonte colorida).
  const ICO_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
  const ICO_SEND = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  const ICO_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const STAR = '⭐ Favoritas';

  function closeMenus() { document.getElementById('cardmenu')?.remove(); }
  async function menu(id, ev) {
    ev?.stopPropagation();
    closeMenus();
    const f = allFiles.find((x) => x.id === id);
    if (!f) return;
    const m = document.createElement('div');
    m.className = 'sp-menu card-menu';
    m.id = 'cardmenu';
    m.style.left = Math.max(8, Math.min(ev.clientX || 0, window.innerWidth - 240)) + 'px';
    m.style.top = Math.max(8, Math.min(ev.clientY || 0, window.innerHeight - 320)) + 'px';
    m.innerHTML = '<div class="sp-menu-title">carregando…</div>';
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
    await paintMain(m, id);
  }
  async function paintMain(m, id) {
    const f = allFiles.find((x) => x.id === id);
    if (!f || !document.getElementById('cardmenu')) return;
    try {
      await Playlists.refresh();
      const starPl = Playlists.all().find((p) => p.name === STAR);
      const starred = starPl && (starPl.fileIds || []).includes(id);
      const k = kindOf(f);
      m.innerHTML = `
        <div class="sp-menu-title">${esc((f.name || '').slice(0, 30))}</div>
        <button onclick="Drive.rename('${id}')">✏️ Renomear</button>
        <button onclick="Drive.download('${id}')">⬇️ Baixar</button>
        <button onclick="Drive.moveMenu('${id}')">📁 Mover p/ playlist…</button>
        <button onclick="Drive.toggleStar('${id}')">${starred ? '☆ Tirar estrela' : '⭐ Favoritar'}</button>
        <button onclick="Drive.vaultMove('${id}')">🔒 Pasta trancada…</button>
        <button onclick="Drive.offline('${id}')">📴 Deixar offline</button>
        ${(k === 'video' || k === 'audio' || k === 'image') && f.compressed ? `<button onclick="Drive.recompress('${id}')">♻ Comprimir mais</button>` : ''}`;
    } catch (e) { m.innerHTML = '<div class="sp-menu-title">Erro: ' + esc(e.message) + '</div>'; }
  }
  async function moveMenu(id) {
    const m = document.getElementById('cardmenu');
    const f = allFiles.find((x) => x.id === id);
    if (!m || !f) return;
    try {
      await Playlists.refresh();
      const pls = Playlists.all();
      m.innerHTML = `<div class="sp-menu-title">Mover para…</div>` +
        (pls.map((p) => `<button onclick="Drive.moveTo('${p.id}','${id}')">${p.locked ? '🔒' : '📁'} ${esc(p.name)}</button>`).join('') || '<div class="sp-menu-title">sem playlists</div>') +
        `<button onclick="Drive.moveNew('${id}')">＋ Nova playlist</button>
         <button onclick="Drive.menuBack('${id}')">‹ Voltar</button>`;
    } catch (e) { m.innerHTML = '<div class="sp-menu-title">Erro: ' + esc(e.message) + '</div>'; }
  }
  async function menuBack(id) {
    const m = document.getElementById('cardmenu');
    if (m) await paintMain(m, id);
  }
  async function moveTo(pid, fid) {
    closeMenus();
    try {
      await Playlists.refresh();
      let pl = Playlists.get(pid);
      if (!pl) return toast('Playlist sumiu. Atualize.');
      if (pl.locked) {
        await Vault.unlock(pid); // pede a senha do cofre
        await Playlists.refresh();
        pl = Playlists.get(pid);
        if (!pl || pl.locked) return toast('Cofre continua trancado — nada movido. 🔒');
      }
      const f = allFiles.find((x) => x.id === fid);
      await jpost(`/playlists/${pid}/files`, { fileIds: [fid] });
      // Confere de verdade: relê e garante o arquivo lá dentro.
      await Playlists.refresh();
      const ok = (Playlists.get(pid)?.fileIds || []).includes(fid);
      if (!ok) throw new Error('servidor não confirmou. Tente de novo.');
      toast(`"${f?.name || 'Arquivo'}" na playlist ${pl.name}. ✅`);
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function moveNew(fid) {
    closeMenus();
    const name = await inputDlg('Nome da nova playlist:', { placeholder: 'Viagem 2026' });
    if (!name?.trim()) return;
    try {
      const pl = await jpost('/playlists', { name: name.trim() });
      await Playlists.refresh();
      await moveTo(pl.id, fid);
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function toggleStar(fid) {
    closeMenus();
    try {
      await Playlists.refresh();
      let pl = Playlists.all().find((p) => p.name === STAR);
      if (pl && (pl.fileIds || []).includes(fid)) {
        await jdel(`/playlists/${pl.id}/files/${fid}`);
        toast('☆ Tirada das favoritas.');
      } else {
        if (!pl) pl = await jpost('/playlists', { name: STAR });
        await jpost(`/playlists/${pl.id}/files`, { fileIds: [fid] });
        toast('⭐ Nas favoritas!');
      }
      await Playlists.refresh();
      render();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function vaultMove(fid) {
    const m = document.getElementById('cardmenu');
    if (!m) return;
    try {
      await Playlists.refresh();
      const locked = Playlists.all().filter((p) => p.vault);
      m.innerHTML = `<div class="sp-menu-title">Pasta trancada…</div>` +
        locked.map((p) => `<button onclick="Drive.moveTo('${p.id}','${fid}')">🔒 ${esc(p.name)}</button>`).join('') +
        `<button onclick="Drive.vaultNew('${fid}')">＋ Nova trancada</button>
         <button onclick="Drive.menuBack('${fid}')">‹ Voltar</button>`;
    } catch (e) { m.innerHTML = '<div class="sp-menu-title">Erro: ' + esc(e.message) + '</div>'; }
  }
  async function vaultNew(fid) {
    closeMenus();
    const name = await inputDlg('Nome da pasta trancada:', { placeholder: 'Pessoal' });
    if (!name?.trim()) return;
    const pw = await inputDlg('Senha (4+ caracteres):', { password: true });
    if (!pw || pw.length < 4) return toast('Senha curta demais.');
    try {
      const pl = await jpost('/playlists', { name: name.trim() });
      await jpost(`/playlists/${pl.id}/vault`, { password: pw });
      await jpost(`/playlists/${pl.id}/unlock`, { password: pw });
      await jpost(`/playlists/${pl.id}/files`, { fileIds: [fid] });
      await Playlists.refresh();
      refresh();
      toast('🔒 Guardado no cofre.');
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function rename(id) {
    closeMenus();
    const f = allFiles.find((x) => x.id === id);
    if (!f) return;
    const name = await inputDlg('Novo nome:', { value: f.name || '' });
    if (!name || !name.trim() || name.trim() === f.name) return;
    try {
      await fetch(api() + `/storage/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name: name.trim() }) }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); });
      refresh();
      toast('Renomeado. ✅');
    } catch (e) { toast('Erro: ' + e.message); }
  }
  function download(id) {
    closeMenus();
    const a = document.createElement('a');
    a.href = dlUrl(id);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function offline(id) {
    download(id);
    toast('📴 Baixando pro aparelho — fica disponível offline.');
  }
  async function copyLink(id) {
    try {
      const r = await jpost('/share/' + id, {});
      let url = r.url || '';
      if (url.startsWith('/')) url = location.origin + url;
      await navigator.clipboard.writeText(url);
      toast('Link copiado. Vale 7 dias. 🔗');
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function sendFile(id) {
    try {
      const r = await jpost('/share/' + id, {});
      let url = r.url || '';
      if (url.startsWith('/')) url = location.origin + url;
      const f = allFiles.find((x) => x.id === id);
      if (navigator.share) await navigator.share({ title: f?.name || 'Arquivo', text: f?.name || '', url }).catch(() => {});
      else { await navigator.clipboard.writeText(url); toast('Link copiado. Vale 7 dias.'); }
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function del(id) {
    if (!await confirmDlg('Mover para a lixeira?')) return;
    try { await jdel('/storage/' + id); refresh(); } catch (e) { toast(e.message); }
  }
  async function cleanAll() {
    const list = visible();
    if (!list.length) return toast('Nada visível pra excluir.');
    if (!await confirmDlg(`Mover ${list.length} arquivo(s) visível(is) pra lixeira? (30 dias pra restaurar)`)) return;
    try {
      const r = await jpost('/storage/trash/many', { ids: list.map((f) => f.id) });
      toast(`🗑 ${r.trashed} na lixeira.`);
      refresh();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function cleanBroken() {
    const n = allFiles.filter((f) => f.broken && !f.trashedAt).length;
    if (!n) return toast('Nenhum quebrado por aqui. 🎉');
    if (!await confirmDlg(`${n} vídeo(s) sem conteúdo vão pra lixeira. Reimporte os originais depois. Continuar?`)) return;
    try {
      const r = await jdel('/storage/broken/all');
      toast(`🧹 ${r.removed} pra lixeira.`);
      refresh();
    } catch (e) { toast('Erro: ' + e.message); }
  }
  function openFile(id) { Share.open(id); }
  async function recompress(id) {
    if (!await confirmDlg('Comprimir de novo com a configuração atual? Pode encolher mais (ou quase nada, se já estiver no limite).')) return;
    try {
      await jpost('/storage/' + id + '/recompress', {});
      toast('♻ Na fila de compressão. A economia entra sozinha.');
      refresh();
      try { window.Upload?.watchProcessing?.(); } catch {}
    } catch (e) { toast('Erro: ' + e.message); }
  }
  return { show, refresh, renderMock, refreshQuota, filterKind, setSearch, setServerResults, setSort, setPlaylist, render, del, cleanAll, cleanBroken, recompress, openFile, menu, menuBack, moveMenu, moveTo, moveNew, toggleStar, vaultMove, vaultNew, rename, download, offline, copyLink, sendFile, addMode, addOne, thumbUrl, dlUrl, icon, visible: () => visible(), all: () => allFiles };
})();
window.Drive = Drive;
