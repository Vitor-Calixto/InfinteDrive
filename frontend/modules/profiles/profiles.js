// profiles.js — 1 conta, N perfis
const Profiles = (() => {
  let all = [];
  async function refresh() {
    if (!getToken()) return;
    try { all = await jget('/profiles'); } catch {}
  }
  function paintMenu(box) {
    box = box || $('pmProfiles');
    if (!box) return;
    box.innerHTML = '<button onclick="Shell.closeProfileMenu()">👥 Conta</button>' +
      all.map((p) => '<button onclick="Profiles.select(\'' + p.id + '\')">' + esc(p.name) + '</button>').join('') +
      '<button onclick="Profiles.create()">＋ Novo perfil</button>';
  }
  async function create() {
    const name = await inputDlg('Nome do perfil:', { placeholder: 'Crianças' });
    if (!name?.trim()) return;
    try { await jpost('/profiles', { name: name.trim() }); refresh(); } catch (e) { toast(e.message); }
  }
  async function select(id) { Shell.closeProfileMenu(); toast('Perfil trocado.'); }
  return { refresh, paintMenu, create, select };
})();
window.Profiles = Profiles;
