// import.js — trazer do Google (Drive + Fotos, sem selecionar).
// Portado do front antigo: usa /api/import/* do nosso backend.
const ImportMod = (() => {
  async function show() {}
  async function from(source) {
    if (!getToken()) return toast('Entre primeiro.');
    try {
      const cfg = await (await fetch(api() + '/auth/config')).json();
      if (!cfg.google) return toast('Login Google desativado no servidor.');
      const scopes = source === 'drive'
        ? 'https://www.googleapis.com/auth/drive.readonly'
        : 'https://www.googleapis.com/auth/photoslibrary.readonly';
      const access = await new Promise((resolve, reject) => {
        const ensureGis = (done) => {
          if (window.google?.accounts?.oauth2) return done();
          const s = document.createElement('script');
          s.src = 'https://accounts.google.com/gsi/client';
          s.onload = done;
          s.onerror = () => reject(new Error('Sem internet pro Google.'));
          document.head.appendChild(s);
        };
        ensureGis(() => {
          try {
            const client = window.google.accounts.oauth2.initTokenClient({
              client_id: cfg.clientId,
              scope: scopes,
              callback: (t) => (t?.access_token ? resolve(t.access_token) : reject(new Error('Permissão negada.'))),
            });
            client.requestAccessToken();
          } catch (e) { reject(e); }
        });
      });
      await jpost('/import/link', { accessToken: access });
      const job = await jpost(`/import/${source}/start`, {});
      poll(job.id);
    } catch (e) { toast('Erro: ' + e.message); }
  }
  async function poll(id) {
    const bar = $('impBar'), fill = $('impFill');
    if (bar) bar.hidden = false;
    const tick = async () => {
      try {
        const j = await jget(`/import/jobs/${id}`);
        const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
        if (fill) fill.style.width = pct + '%';
        const st = $('impStatus');
        if (st) st.textContent = j.status === 'running'
          ? `Trazendo ${j.done}/${j.total || '?'}… ${pct}%`
          : `Pronto: ${j.done} arquivo(s)${j.errors?.length ? `, ${j.errors.length} falha(s): ${j.errors.slice(0, 2).join(' | ')}` : ''}.`;
        if (j.status === 'running') setTimeout(tick, 3000);
        else { if (bar) bar.hidden = true; try { Drive.refresh(); } catch {} }
      } catch (e) {
        const st = $('impStatus');
        if (st) st.textContent = 'Erro: ' + e.message;
      }
    };
    tick();
  }
  return { show, from };
})();
window.ImportMod = ImportMod;
