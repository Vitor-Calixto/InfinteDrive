// playlists.js — pastas que tocam
const Playlists = (() => {
  let all = [];
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
    nav.innerHTML = all.map((p) => `<button class="sp-nav-btn" onclick="Drive.setPlaylist('${p.id}')">${p.locked ? '🔒' : '📁'} ${esc(p.name)} <span class="text-zinc-500">· ${p.count ?? (p.fileIds||[]).length}</span></button>`).join('');
  }
  async function create() {
    const name = await inputDlg('Nome da playlist:', { placeholder: 'Viagem 2026' });
    if (!name?.trim()) return;
    try { await jpost('/playlists', { name: name.trim() }); refresh(); } catch (e) { toast(e.message); }
  }
  return { refresh, get, all: () => all, create };
})();
window.Playlists = Playlists;
