// import.js — Drive (puxa tudo) + Fotos (Picker: escolhe no Google, traz aqui).
const ImportMod = (() => {
  let pickerSession = '';
  async function show() {}
  // Se a janela de permissão não voltar em 2min (popup bloqueado/fechado),
  // desiste com mensagem em vez de travar pra sempre na aba em branco.
  function tokenWithTimeout(scope, ms = 120000) {
    return Promise.race([
      googleToken(scope),
      new Promise((_, reject) => setTimeout(() => reject(new Error('A janela de permissão não respondeu. Libere POPUPS para este site e para accounts.google.com, depois tente de novo.')), ms)),
    ]);
  }
  // Pede um access token de escopo ao Google (GIS) e vincula no backend.
  async function googleToken(scope) {
    const cfg = await (await fetch(api() + '/auth/config')).json();
    if (!cfg.google) throw new Error('Login Google desativado no servidor.');
    return new Promise((resolve, reject) => {
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
            scope,
            callback: (t) => (t?.access_token ? resolve(t.access_token) : reject(new Error('Permissão negada.'))),
          });
          client.requestAccessToken();
        } catch (e) { reject(e); }
      });
    });
  }
  async function from(source) {
    if (!getToken()) return toast('Entre primeiro.');
    if (source === 'photos') return fromPhotos();
    try {
      const access = await tokenWithTimeout('https://www.googleapis.com/auth/drive.readonly');
      await jpost('/import/link', { accessToken: access });
      const job = await jpost('/import/drive/start', {});
      poll(job.id);
    } catch (e) { toast('Erro: ' + e.message); }
  }
  function fail(msg) {
    const st = $('impStatus');
    if (st) st.textContent = 'Erro: ' + msg; // fica escrito (toast some em 5s)
    toast('Erro: ' + msg);
  }
  // Fotos (Picker API): abre a escolha numa aba do Google; ao concluir, traz.
  async function fromPhotos() {
    const st = $('impStatus');
    // Aba aberta AQUI (no clique): depois dos awaits o navegador bloqueia popup.
    let tab = null;
    try { tab = window.open('', '_blank'); } catch {}
    try {
      if (st) st.textContent = 'Pedindo permissão ao Google… (complete na janela que abriu)';
      const access = await tokenWithTimeout('https://www.googleapis.com/auth/photospicker.mediaitems.readonly');
      if (st) st.textContent = 'Abrindo a escolha do Google Fotos…';
      await jpost('/import/link', { accessToken: access });
      const s = await jpost('/import/photos/session', {});
      pickerSession = s.sessionId;
      if (tab && !tab.closed) tab.location.href = s.pickerUri;
      else if (st) st.innerHTML = `Popup bloqueado — <a href="${s.pickerUri}" target="_blank" class="sp-link">clique aqui pra escolher</a>. Depois volte e aperte o botão abaixo.<br><button class="btn mt-2" onclick="ImportMod.bringPhotos()">Concluí no Google, trazer agora</button>`;
      if (tab && !tab.closed && st && !st.querySelector('button')) {
        st.innerHTML = `Escolha as fotos na aba do Google e clique <b>Concluir</b> lá. Depois volte aqui e aperte o botão abaixo.<br><button class="btn mt-2" onclick="ImportMod.bringPhotos()">Concluí no Google, trazer agora</button>`;
      }
    } catch (e) {
      try { if (tab && !tab.closed) tab.close(); } catch {}
      fail(e.message);
    }
  }
  async function bringPhotos() {
    const st = $('impStatus');
    try {
      if (!pickerSession) throw new Error('Abra a escolha primeiro (Importar Fotos).');
      const s = await jget(`/import/photos/session/${pickerSession}`);
      if (!s.ready) {
        if (st) st.textContent = 'Ainda não concluiu no Google. Escolha e clique Concluir na aba, depois tente de novo.';
        return;
      }
      const job = await jpost(`/import/photos/session/${pickerSession}/start`, {});
      pickerSession = '';
      poll(job.id);
    } catch (e) { fail(e.message); }
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
  return { show, from, bringPhotos };
})();
window.ImportMod = ImportMod;
