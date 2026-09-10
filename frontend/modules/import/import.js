// import.js — Drive (puxa tudo) + Fotos (Picker: escolhe no Google, traz aqui).
// Vínculo por REDIRECT (sem popup): /api/auth/google/start -> Google -> volta ?import=.
const ImportMod = (() => {
  let pickerSession = '';
  function fail(msg) {
    // 404 no Picker = sessão de escolha expirou: o recomeço é escolher de novo.
    if (/fotos 404/i.test(msg || '')) {
      pickerSession = '';
      storeSid('');
      msg = 'A escolha expirou no Google. Clique Importar Fotos e escolha de novo.';
    }
    const st = $('impStatus');
    if (st) st.textContent = 'Erro: ' + msg; // fica escrito (toast some em 5s)
    toast('Erro: ' + msg);
  }
  // Ao voltar do Google (?import=), retoma sozinho onde parou.
  async function show() {
    let imp = '', msg = '';
    try {
      const q = new URLSearchParams(location.search);
      imp = q.get('import') || '';
      msg = q.get('msg') || 'Falha ao vincular.';
    } catch {}
    if (!imp) {
      // Voltou do picker (mesma aba) pelo histórico: retoma a vigia sozinho.
      // Só sessão FRESCA: velha é descartada (era o 404 fantasma).
      const sid = freshStoredSid();
      if (sid && getToken()) { pickerSession = sid; watchPicker(null, true); }
      return;
    }
    try { history.replaceState(null, '', location.pathname); } catch {}
    if (imp === 'drive') {
      try {
        const job = await jpost('/import/drive/start', {});
        poll(job.id);
      } catch (e) { fail(e.message); }
      return;
    }
    if (imp === 'photos') { openPickerChoice(); return; }
    if (imp === 'erro') fail(msg);
  }
  function go(scope) {
    if (!getToken()) return toast('Entre primeiro.');
    // Navegação normal (redirect): nenhum popup/cookie bloqueia.
    location.href = api() + '/auth/google/start?scope=' + scope + '&token=' + encodeURIComponent(getToken());
  }
  async function from(source) {
    if (!getToken()) return toast('Entre primeiro.');
    if (source === 'photos') return fromPhotosFast();
    return go('drive');
  }
  // Caminho rápido (vínculo válido por dias): sem redirect, abre no clique.
  async function fromPhotosFast() {
    const st = $('impStatus');
    // Popup de verdade (janelinha): fecha sozinha ao concluir = "volta pro app".
    let tab = null;
    try { tab = window.open('', 'gphotos_picker', 'width=1024,height=720,menubar=no,toolbar=no'); } catch {}
    try {
      let linked = false;
      try { linked = (await jget('/import/status')).photos; } catch {}
      if (!linked) {
        try { if (tab && !tab.closed) tab.close(); } catch {}
        return go('photos'); // 1ª vez (ou expirado): vincula por redirect
      }
      if (st) st.textContent = 'Abrindo a escolha do Google Fotos…';
      await openPickerDirect(tab);
    } catch (e) {
      try { if (tab && !tab.closed) tab.close(); } catch {}
      fail(e.message);
    }
  }
  // Fotos já vinculado: abre o picker e traz SOZINHO (poll → start → fecha aba).
  async function openPickerDirect(tab) {
    const st = $('impStatus');
    try {
      const s = await jpost('/import/photos/session', {});
      pickerSession = s.sessionId;
      storeSid(s.sessionId);
      if (tab && !tab.closed) {
        tab.location.href = pickUrl(s.pickerUri);
        if (st) st.textContent = 'Escolha as fotos e clique Concluir — o resto é automático.';
        watchPicker(tab);
        return;
      }
      // Sem janelinha: link (app nunca navega pra fora sozinho).
      const uri = String(pickUrl(s.pickerUri)).replace(/"/g, '&quot;');
      if (st) st.innerHTML = `Clique pra escolher no Google (esta tela continua aberta):<br><a class="btn mt-2" style="display:inline-block;text-decoration:none" href="${uri}" target="_blank" rel="noopener">Abrir Google Fotos</a>`;
      if (st) st.innerHTML += `<div class="text-xs mt-1 text-zinc-400">Escolha e clique Concluir — o resto é automático.</div>`;
      watchPicker(null);
    } catch (e) {
      try { if (tab && !tab.closed) tab.close(); } catch {}
      fail(e.message);
    }
  }
  // Pós-redirect (?import=photos): UMA sessão; janelinha se der, link se não.
  // App nunca navega pra fora sozinho.
  async function openPickerChoice() {
    const st = $('impStatus');
    // Retomada: voltou do picker pelo histórico com sessão FRESCA pendente.
    const sid = freshStoredSid();
    if (sid) {
      pickerSession = sid;
      storeSid('');
      watchPicker(null, true);
      return;
    }
    // Janelinha primeiro (fecha sozinha ao concluir).
    let tab = null;
    try { tab = window.open('', 'gphotos_picker', 'width=1024,height=720,menubar=no,toolbar=no'); } catch {}
    if (tab && !tab.closed) {
      try {
        const s = await jpost('/import/photos/session', {});
        pickerSession = s.sessionId;
        storeSid(s.sessionId);
        tab.location.href = pickUrl(s.pickerUri);
        if (st) st.textContent = 'Escolha as fotos e clique Concluir — o resto é automático.';
        watchPicker(tab);
        return;
      } catch (e) { try { tab.close(); } catch {} fail(e.message); return; }
    }
    // Popup bloqueado: link (clique abre em nova aba, app intacto).
    if (st) st.innerHTML = `Clique pra escolher no Google (esta tela continua aberta):<br><a class="btn mt-2" style="display:inline-block;text-decoration:none" href="#" onclick="ImportMod.openLink(event)">Abrir Google Fotos</a>`;
  }
  // Link da escolha (clique = gesto: abre mesmo com popup bloqueado).
  async function openLink(ev) {
    ev?.preventDefault();
    const st = $('impStatus');
    try {
      if (st) st.textContent = 'Abrindo a escolha…';
      const s = await jpost('/import/photos/session', {});
      pickerSession = s.sessionId;
      storeSid(s.sessionId);
      window.open(pickUrl(s.pickerUri), '_blank', 'noopener');
      if (st) st.textContent = 'Escolha as fotos e clique Concluir — o resto é automático.';
      watchPicker(null);
    } catch (e) { fail(e.message); }
  }
  function plog(ev) {
    try { jpost('/import/picklog', { ev }).catch(() => {}); } catch {}
  }
  // Doc oficial: pickerUri + /autoclose fecha a aba sozinha após o Concluir.
  const pickUrl = (u) => String(u || '').replace(/\/$/, '') + '/autoclose';
  let watching = false; // trava clique-duplo (2 sessões = confusão + expira a outra)
  function storeSid(sid) {
    try {
      if (sid) { sessionStorage.setItem('pick_sid', sid); sessionStorage.setItem('pick_ts', String(Date.now())); }
      else { sessionStorage.removeItem('pick_sid'); sessionStorage.removeItem('pick_ts'); }
    } catch {}
  }
  // Retoma SÓ sessão fresca (<15min): sid velho (outra aba/dia) é descartado,
  // nunca vigiado — era ele que dava 404 fantasma.
  function freshStoredSid() {
    try {
      const sid = sessionStorage.getItem('pick_sid') || '';
      const ts = Number(sessionStorage.getItem('pick_ts') || 0);
      if (sid && Date.now() - ts < 15 * 60 * 1000) return sid;
      if (sid) storeSid('');
    } catch {}
    return '';
  }
  // Vigia a sessão: concluiu no Google? Inicia o job e fecha a aba sozinha.
  async function watchPicker(tab, retried) {
    if (watching) { plog('watch-ignorado-duplo sid=' + pickerSession); return; }
    watching = true;
    plog('watch-ini sid=' + pickerSession + ' retried=' + !!retried);
    const st = $('impStatus');
    try {
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        let dead = false, ready = false, errm = '';
        try {
          const s = await jget(`/import/photos/session/${pickerSession}`);
          ready = !!s.ready;
        } catch (e) { errm = String(e.message || e).slice(0, 80); dead = /fotos 404/i.test(e.message || ''); }
        if (ready) { plog('watch-ready sid=' + pickerSession); break; }
        if (dead) plog('watch-dead sid=' + pickerSession + ' err=' + errm);
        if (dead) {
          // Sessão podre (velha/outra aba): troca pela nova e continua vigiando.
          if (retried) { fail('Google Fotos 404. Tente de novo.'); return; }
          try {
            const ns = await jpost('/import/photos/session', {});
            pickerSession = ns.sessionId;
            storeSid(ns.sessionId);
            if (tab && !tab.closed) tab.location.href = pickUrl(ns.pickerUri);
            else if (st) st.innerHTML = `Sessão antiga descartada — escolha na nova página:<br><a class="btn mt-2" style="display:inline-block;text-decoration:none" href="${String(ns.pickerUri || '').replace(/"/g, '&quot;')}" target="_blank" rel="noopener">Abrir Google Fotos</a>`;
            retried = true;
            continue;
          } catch (e2) { fail(e2.message); return; }
        }
        if (st) st.textContent = `Escolha as fotos no Google e clique Concluir… (aguardando ${i + 1})`;
      }
      plog('watch-start sid=' + pickerSession);
      try {
        const job = await jpost(`/import/photos/session/${pickerSession}/start`, {});
        plog('watch-started job=' + job.id);
        pickerSession = '';
        storeSid('');
        try { if (tab && !tab.closed) tab.close(); } catch {}
        poll(job.id);
      } catch (e) { plog('watch-start-fail ' + String(e.message || e).slice(0, 100)); fail(e.message); }
    } finally { watching = false; }
  }
  async function bringPhotos() {
    const st = $('impStatus');
    try {
      if (!pickerSession) throw new Error('Abra a escolha primeiro (Importar Fotos).');
      // O Google libera a seleção segundos DEPOIS do Concluir: espera sozinho.
      let ready = false, lastErr = '';
      for (let i = 0; i < 30; i++) {
        try {
          const s = await jget(`/import/photos/session/${pickerSession}`);
          if (s.ready) { ready = true; break; }
          lastErr = 'aguardando liberação';
        } catch (e) { lastErr = String(e.message || e).slice(0, 120); }
        if (st) st.textContent = `Aguardando o Google liberar a escolha… (${i + 1}/30)`;
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!ready) {
        if (st) st.textContent = `Google não liberou (${lastErr}). Volte na aba, confira se clicou Concluir, e aperte o botão de novo.`;
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
  return { show, from, bringPhotos, openLink };
})();
window.ImportMod = ImportMod;
