// vault.js — cofre (playlists com senha)
const Vault = (() => {
  async function show() {
    const box = $('vaultBox');
    if (!box) return;
    try {
      const pls = await jget('/playlists');
      const locked = pls.filter((p) => p.vault || p.locked);
      box.innerHTML = locked.map((p) => '<div class="card">🔒 ' + esc(p.name) + ' <span class="flex gap-2 mt-2"><button class="btn-ghost" onclick="Vault.unlock(\'' + p.id + '\')">Abrir</button><button class="btn-ghost" onclick="Vault.addFiles(\'' + p.id + '\')">＋ Adicionar arquivos</button></span></div>').join('') || '<span class="text-zinc-500 text-xs">Nenhum cofre. Crie uma playlist e tranque com senha.</span>';
    } catch (e) { box.innerHTML = 'Erro: ' + esc(e.message); }
  }
  async function unlock(id) {
    const pw = await inputDlg('Senha do cofre:', { password: true });
    if (pw === null) return;
    try { await jpost('/playlists/' + id + '/unlock', { password: pw }); Drive.refresh(); show(); } catch (e) { toast(e.message); }
  }
  async function addFiles(id) {
    // Cofre pede a senha antes (trancado não recebe nada).
    try {
      const pls = await jget('/playlists');
      if ((pls.find((p) => p.id === id) || {}).locked) await unlock(id);
      const fresh = await jget('/playlists');
      if ((fresh.find((p) => p.id === id) || {}).locked) return; // errou/cancelou
    } catch (e) { return toast(e.message); }
    Drive.addMode(id);
    Shell.show('drive');
  }
  return { show, unlock, addFiles };
})();
window.Vault = Vault;
