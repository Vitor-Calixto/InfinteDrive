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
    grid.innerHTML = list.map((f) => `
      <div class="sp-album" onclick="Share.open('${f.id}')" title="${esc(f.name)}">
        ${f.thumb ? `<img src="${thumbUrl(f.id)}" loading="lazy" />` : `<div class="sp-album-fallback">${icon(f)}</div>`}
        <button class="sp-album-play" onclick="event.stopPropagation();Share.open('${f.id}')">▶</button>
        <div class="sp-album-title">${esc(f.name)}</div>
        <div class="sp-album-sub">${fmtMB((f.sizeOrig || 0) / 1048576)} → ${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}${f.duration ? ' · ' + fmtDur(f.duration) : ''}</div>
        ${pendLine(f)}
        ${f.snippet ? `<div class="sp-album-snippet">…${esc(f.snippet)}…</div>` : ''}
        <div class="sp-album-row">
          ${f.compressed && (kindOf(f) === 'video' || kindOf(f) === 'audio' || kindOf(f) === 'image') ? `<button class="btn-ghost" title="Comprimir de novo (config atual)" onclick="event.stopPropagation();Drive.recompress('${f.id}')">♻</button>` : ''}
          <button class="btn-ghost" onclick="event.stopPropagation();Drive.menu('${f.id}',event)">⋮</button>
        </div>
      </div>`).join('') || (searchTerm || serverIds !== null || playlistFilter
        ? '<span class="text-zinc-500 text-xs">Nada achado. Limpe a busca ou troque o filtro. 🔍</span>'
        : '<span class="text-zinc-500 text-xs">Nada aqui ainda. Arraste arquivos acima. ⬆</span>');
  }
  function menu(id, ev) {
    ev?.stopPropagation();
    Share.open(id);
  }
  async function del(id) {
    if (!await confirmDlg('Mover para a lixeira?')) return;
    try { await jdel('/storage/' + id); refresh(); } catch (e) { toast(e.message); }
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
  return { show, refresh, renderMock, refreshQuota, filterKind, setSearch, setServerResults, setSort, setPlaylist, render, del, recompress, openFile, thumbUrl, dlUrl, icon, visible: () => visible(), all: () => allFiles };
})();
window.Drive = Drive;
