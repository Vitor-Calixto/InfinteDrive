// vault.js — cofre (playlists com senha)
const Vault = (() => {
  async function show() {
    const box = $('vaultBox');
    if (!box) return;
    try {
      const pls = await jget('/playlists');
      const locked = pls.filter((p) => p.vault || p.locked);
      box.innerHTML = locked.map((p) => '<div class="card">🔒 ' + esc(p.name) + ' <button class="btn-ghost" onclick="Vault.unlock(\'' + p.id + '\')">Abrir</button></div>').join('') || '<span class="text-zinc-500 text-xs">Nenhum cofre. Crie uma playlist e tranque com senha.</span>';
    } catch (e) { box.innerHTML = 'Erro: ' + esc(e.message); }
  }
  async function unlock(id) {
    const pw = await inputDlg('Senha do cofre:', { password: true });
    if (pw === null) return;
    try { await jpost('/playlists/' + id + '/unlock', { password: pw }); Drive.refresh(); show(); } catch (e) { toast(e.message); }
  }
  return { show, unlock };
})();
window.Vault = Vault;
