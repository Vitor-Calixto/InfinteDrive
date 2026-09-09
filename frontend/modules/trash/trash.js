// trash.js — lixeira 30 dias
const Trash = (() => {
  async function show() {
    const grid = $('trashGrid');
    if (!grid) return;
    try {
      const list = await jget('/storage/list?trashed=1');
      const daysLeft = (f) => {
        if (!f.trashedAt) return '';
        const left = Math.max(0, 30 - Math.floor((Date.now() - new Date(f.trashedAt).getTime()) / 86400000));
        return ` · apaga em ${left}d`;
      };
      grid.innerHTML = list.map((f) => `<div class="sp-album" title="${esc(f.name)}">
        ${f.thumb ? `<img src="${Drive.thumbUrl(f.id)}" loading="lazy" />` : `<div class="sp-album-fallback">${Drive.icon(f)}</div>`}
        <div class="sp-album-title">${esc(f.name)}</div>
        <div class="sp-album-sub">${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}${daysLeft(f)}</div>
        <div class="sp-album-row">
          <button class="btn-ghost" onclick="Trash.restore('${f.id}')">Restaurar</button>
          <button class="btn-ghost" onclick="Trash.wipe('${f.id}')">Excluir</button>
        </div></div>`).join('') || '<span class="text-zinc-500 text-xs">Lixeira vazia. 🎉</span>';
      const c = $('trashCount');
      if (c) c.textContent = list.length ? `${list.length} arquivo(s)` : '';
    } catch (e) { grid.innerHTML = 'Erro: ' + esc(e.message); }
  }
  async function restore(id) { try { await jpost('/storage/' + id + '/restore', {}); show(); Drive.refresh(); } catch (e) { toast(e.message); } }
  async function wipe(id) {
    if (!await confirmDlg('Excluir para sempre? Não tem volta.')) return;
    try { await jdel('/storage/' + id + '/forever'); show(); Drive.refresh(); } catch (e) { toast(e.message); }
  }
  async function empty() {
    if (!await confirmDlg('Esvaziar a lixeira? Apaga tudo pra sempre.')) return;
    try {
      const r = await jdel('/storage/trash/empty');
      toast(`${r.removed} apagado(s).`);
      show(); Drive.refresh();
    } catch (e) { toast(e.message); }
  }
  return { show, restore, wipe, empty };
})();
window.Trash = Trash;
