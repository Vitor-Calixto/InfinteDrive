// shell.js — casca: 1 sidebar única + loader de módulos. Carregado por último.
const Shell = (() => {
  const VIEWS = {
    drive: { html: 'modules/drive/drive.html', css: ['modules/drive/drive.css', 'modules/upload/upload.css', 'modules/download/download.css'], js: null, onShow: () => Drive.show() },
    playlists: { html: 'modules/playlists/playlists.html', css: 'modules/playlists/playlists.css', js: null, onShow: () => Playlists.show() },
    profiles: { html: 'modules/profiles/profiles.html', css: 'modules/profiles/profiles.css', js: null, onShow: () => Profiles.show() },
    system: { html: 'modules/system/system.html', css: 'modules/system/system.css', onShow: () => System.show() },
    planos: { html: 'modules/planos/planos.html', css: 'modules/planos/planos.css', onShow: () => Planos.show() },
    import: { html: 'modules/import/import.html', css: 'modules/import/import.css', onShow: () => ImportMod.show() },
    admin: { html: 'modules/admin/admin.html', css: 'modules/admin/admin.css', onShow: () => Admin.show() },
    cloudflare: { html: 'modules/cloudflare/cloudflare.html', css: 'modules/cloudflare/cloudflare.css', js: null, onShow: () => Cf.show() },
    compressdoc: { html: 'modules/compressdoc/compressdoc.html', css: null, onShow: () => CompressDoc.show() },
    terms: { html: 'modules/terms/terms.html', css: null, onShow: () => Terms.show() },
    security: { html: 'modules/security/security.html', css: null, onShow: () => {} },
    trash: { html: 'modules/trash/trash.html', css: 'modules/trash/trash.css', onShow: () => Trash.show() },
    vault: { html: 'modules/vault/vault.html', css: 'modules/vault/vault.css', onShow: () => Vault.show() },
  };
  const loaded = {};
  let current = 'drive';

  function ensureCss(href) {
    const list = Array.isArray(href) ? href : [href];
    for (const h of list) {
      if (!h || document.querySelector(`link[data-mod="${h}"]`)) continue;
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = h; l.dataset.mod = h;
      document.head.appendChild(l);
    }
  }

  async function show(name) {
    if (!VIEWS[name]) name = 'drive';
    current = name;
    document.querySelectorAll('.sp-nav-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    closeProfileMenu();
    document.querySelectorAll('.sp-menu').forEach((x) => (x.hidden = true));
    const host = $('viewHost');
    if (!loaded[name]) {
      try {
        const v = VIEWS[name];
        const r = await fetch(v.html);
        if (!r.ok) throw new Error('view ' + name);
        const wrap = document.createElement('div');
        wrap.id = 'view-' + name;
        wrap.innerHTML = await r.text();
        host.appendChild(wrap);
        ensureCss(v.css);
        loaded[name] = true;
      } catch (e) { toast('Erro ao abrir tela.'); return; }
    }
    host.querySelectorAll(':scope > div[id^="view-"]').forEach((el) => { el.hidden = el.id !== 'view-' + name; });
    host.scrollTop = 0; // trocar de tela sempre volta ao topo (sem título cortado)
    try { await VIEWS[name].onShow(); } catch (e) { console.warn(e); }
  }

  // Perfil Conta/Sair ficam no rodapé da sidebar; o hamburger só abre/recolhe.
  function isHidden() { return document.body.classList.contains('sidebar-hidden'); }
  function paintNav() {
    // Ícone é SVG fixo no HTML (sem troca de texto, sem risco de fonte).
    // Estado aparece no giro + borda verde.
  }
  function toggleSidebarOnly(ev) {
    ev?.stopPropagation();
    document.body.classList.toggle('sidebar-hidden');
    localStorage.setItem('infdrive_sidebar', isHidden() ? 'hidden' : 'shown');
    paintNav();
    closeProfileMenu();
  }
  function paintMenu() {
    const box = $('pmProfiles');
    if (box && window.Profiles?.paintMenu) window.Profiles.paintMenu(box);
    const q = $('pmQuota');
    if (q && window._quota) q.textContent = `Ocupando ${fmtMB(window._quota.finalMB)} de ${fmtMB(window._quota.quotaMB)}`;
  }
  function closeProfileMenu() { const m = $('profileMenu'); if (m) m.hidden = true; }

  function toggleCriar(ev) {
    ev?.stopPropagation();
    const m = $('criarMenu');
    const was = m.hidden;
    document.querySelectorAll('.sp-menu').forEach((x) => (x.hidden = true));
    m.hidden = !was;
  }

  function paintUser(u) {
    const b = $('topAvatar');
    if (b) {
      // Integração Google: quando houver foto (u.avatar/u.picture), mostra <img>; senão, inicial.
      const photo = u?.avatar || u?.picture || '';
      if (photo) b.innerHTML = '<img src="' + esc(photo) + '" alt="perfil" />';
      else b.textContent = ((u?.name || u?.email || '?')[0] || '?').toUpperCase();
    }
    const nm = $('pmName');
    if (nm) nm.textContent = u?.name ? `${u.name} · ${u.email || ''}` : (u?.email || 'Minha conta');
    const q = $('pmQuota');
    if (q && window._quota) q.textContent = `Ocupando ${fmtMB(window._quota.finalMB)} de ${fmtMB(window._quota.quotaMB)}`;
  }

  async function boot() {
    // Override via URL (?sidebar=1 mostra, ?sidebar=0 esconde) + tecla B alterna.
    // Caminho de emergência se o botão sumir por cache velho.
    const q = new URLSearchParams(location.search);
    if (q.get('sidebar') === '1') localStorage.setItem('infdrive_sidebar', 'shown');
    if (q.get('sidebar') === '0') localStorage.setItem('infdrive_sidebar', 'hidden');
    if (localStorage.getItem('infdrive_sidebar') === 'hidden') document.body.classList.add('sidebar-hidden');
    paintNav();
    document.addEventListener('keydown', (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if ((e.key === 'b' || e.key === 'B') && tag !== 'input' && tag !== 'textarea' && tag !== 'select') toggleSidebarOnly(e);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest?.('.sp-userwrap')) closeProfileMenu();
      if (!e.target.closest?.('#criarMenu') && !e.target.closest?.('.sp-icon-btn')) {
        const c = $('criarMenu'); if (c) c.hidden = true;
      }
    });
    // Dropzone global do drive (delegado, funciona após view carregar)
    document.addEventListener('dragover', (e) => {
      const dz = document.getElementById('dropzone');
      if (dz && e.target.closest?.('#view-drive')) { e.preventDefault(); dz.classList.add('over'); }
    });
    document.addEventListener('dragleave', (e) => {
      const dz = document.getElementById('dropzone');
      if (dz) dz.classList.remove('over');
    });
    document.addEventListener('drop', (e) => {
      const dz = document.getElementById('dropzone');
      if (dz && e.target.closest?.('#view-drive') && e.dataTransfer?.files?.length) {
        e.preventDefault(); dz.classList.remove('over');
        window.Upload?.send(e.dataTransfer.files);
      }
    });
    try { await Auth.me(); } catch (e) { console.warn(e); }
    try { Auth.initGoogle(); } catch {}
    await show('drive');
    // Seguro demo: se a grade veio vazia (corrida de boot), renderiza de novo com o mock.
    setTimeout(() => {
      try {
        const demo = location.search.includes('demo') || location.hash.includes('demo');
        const grid = $('filesGrid');
        if (demo && grid && !grid.querySelector('.sp-album') && window.Drive) Drive.refresh();
      } catch {}
    }, 600);
  }
  // auto-boot (shell é o último script)
  try { boot(); } catch (e) { console.warn(e); }

  return { show, toggleSidebar: toggleSidebarOnly, toggleCriar, closeProfileMenu, paintUser, paintMenu, boot, current: () => current };
})();
window.Shell = Shell;
// toggleSidebar: o hamburger do canto superior esquerdo alterna a sidebar única.