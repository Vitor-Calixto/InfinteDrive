// upload.js — fila visível: selecionados, % por arquivo, retry, espera da compressão.
// 429 (limite) nunca vira falha direta: respeita Retry-After e tenta de novo.
const Upload = (() => {
  const CHUNK = 8 * 1024 * 1024;
  const BIG = 64 * 1024 * 1024; // acima disso vai fatiado com resume
  const TRIES = 7; // tentativas por request (429/rede) antes de desistir
  let failed = []; // File[] que falharam (botão Repetir)
  let pollTimer = null;

  function pick() {
    const i = document.createElement('input');
    i.type = 'file'; i.multiple = true;
    i.onchange = () => { send(i.files); };
    i.click();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // POST com % real (fetch não reporta upload) + backoff em 429/rede.
  // makeFd é fábrica (recria o FormData a cada tentativa: slice fresco).
  function postForm(url, makeFd, onProg, onWait) {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const go = () => {
        attempt++;
        let fd;
        try { fd = makeFd(); } catch (e) { return reject(e); }
        const x = new XMLHttpRequest();
        x.open('POST', url);
        const t = getToken();
        if (t) x.setRequestHeader('Authorization', 'Bearer ' + t);
        x.upload.onprogress = (e) => { if (e.lengthComputable) { try { onProg(e.loaded); } catch {} } };
        x.onload = () => {
          if (x.status >= 200 && x.status < 300) return resolve(x.responseText);
          if ((x.status === 429 || x.status === 503) && attempt < TRIES) {
            const ra = Number(x.getResponseHeader('Retry-After')) || 0;
            const waitMs = Math.min(60000, (ra > 0 ? ra * 1000 : 4000 * attempt)) + Math.random() * 1000;
            try { onWait && onWait(Math.ceil(waitMs / 1000)); } catch {}
            return setTimeout(go, waitMs);
          }
          reject(new Error((x.responseText || ('HTTP ' + x.status)).slice(0, 120)));
        };
        x.onerror = () => {
          if (attempt < 4) { // Wi-Fi piscou no meio de GB: espera e tenta
            try { onWait && onWait(3); } catch {}
            return setTimeout(go, 3000);
          }
          reject(new Error('Falha de rede.'));
        };
        x.send(fd);
      };
      go();
    });
  }

  const fdFile = (file) => () => {
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  };

  async function sendSimple(file, prog, wait) {
    await postForm(api() + '/storage/upload', fdFile(file), prog, wait);
  }

  async function sendChunked(file, prog, wait) {
    const total = Math.max(1, Math.ceil(file.size / CHUNK));
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    let done = 0;
    const paint = () => prog(Math.min(file.size, Math.round((done / total) * file.size)));
    const one = async (idx) => {
      const mk = () => {
        const fd = new FormData();
        fd.append('uploadId', id);
        fd.append('index', String(idx));
        fd.append('total', String(total));
        fd.append('chunk', file.slice(idx * CHUNK, (idx + 1) * CHUNK));
        return fd;
      };
      await postForm(api() + '/chunks/chunk', mk, () => {}, wait);
      done++;
      paint();
    };
    // 3 fatias juntas; backoff interno recua sozinho no 429.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, total) }, async () => {
      while (next < total) await one(next++);
    }));
    // Reconcilia: confere no servidor o que chegou e repõe faltante
    // (fatia barrada/lock de antivírus não quebra mais a montagem).
    for (let round = 0; round < 3; round++) {
      let have = new Set();
      try {
        const r = await fetch(api() + '/chunks/chunk-status/' + id, { headers: authHeaders() });
        const st = await r.json();
        have = new Set(st.received || []);
      } catch {}
      const missing = [];
      for (let i = 0; i < total; i++) if (!have.has(i)) missing.push(i);
      if (!missing.length) break;
      done = total - missing.length;
      paint();
      for (const i of missing) await one(i);
    }
    // Complete com retry (lock transitório de antivírus no Windows).
    let lastErr = null;
    for (let a = 0; a < 3; a++) {
      try {
        await postForm(api() + '/chunks/complete', () => {
          const fd = new FormData();
          fd.append('uploadId', id);
          fd.append('name', file.name);
          fd.append('mime', file.type || 'application/octet-stream');
          fd.append('size', String(file.size));
          fd.append('total', String(total));
          return fd;
        }, () => {}, wait);
        lastErr = null;
        break;
      } catch (e) { lastErr = e; await sleep(3000); }
    }
    if (lastErr) throw lastErr;
    prog(file.size);
  }

  function paintQueue(items) {
    const box = $('upQueue');
    if (!box) return;
    const ok = items.filter((i) => i.st === 'ok').length;
    const run = items.filter((i) => i.st === 'run').length;
    const err = items.filter((i) => i.st === 'err').length;
    box.hidden = false;
    box.innerHTML =
      `<div class="upq-head">📦 ${items.length} selecionado(s) · <b>${ok} ok</b>${run ? ` · ${run} enviando` : ''}${err ? ` · <b class="upq-err">${err} falharam</b>` : ''}</div>` +
      items.map((i) => `
        <div class="upq-row">
          <span class="upq-ico">${i.st === 'ok' ? '✅' : i.st === 'err' ? '❌' : i.st === 'run' ? '⬆' : '⏳'}</span>
          <span class="upq-name" title="${esc(i.file.name)}">${esc(i.file.name)}</span>
          <span class="upq-sub">${fmtMB((i.file.size || 0) / 1048576)}${i.st === 'run' ? ` · ${i.pct}%` : ''}${i.wait ? ` · ⏳ ${esc(i.wait)}` : ''}${i.err ? ` · ${esc(i.err)}` : ''}</span>
          <div class="upq-bar"><div style="width:${i.pct}%"></div></div>
        </div>`).join('') +
      (err ? `<button class="btn-ghost mt-2" onclick="Upload.retry()">↻ Repetir ${err} falha(s)</button>` : '');
  }

  async function send(files) {
    const list = [...(files || [])];
    if (!list.length) return;
    if (!getToken()) return toast('Entre primeiro.');
    failed = [];
    const items = list.map((file) => ({ file, st: 'wait', pct: 0, err: '', wait: '' }));
    paintQueue(items);
    const bar = $('upBar');
    if (bar) bar.hidden = true; // a % agora é por arquivo, na fila
    let done = 0;
    const st = $('upStatus');
    // 3 envios simultâneos: lote anda junto em vez de fila única.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, list.length) }, async () => {
      while (next < list.length) {
        const idx = next++;
        const it = items[idx];
        it.st = 'run'; it.wait = '';
        paintQueue(items);
        const prog = (loaded) => {
          it.wait = '';
          it.pct = it.file.size ? Math.round((loaded / it.file.size) * 100) : 100;
          paintQueue(items);
        };
        const wait = (s) => { it.wait = `limite da API, aguardando ${s}s…`; paintQueue(items); };
        try {
          const job = (it.file.size || 0) > BIG ? sendChunked : sendSimple;
          await job(it.file, prog, wait);
          it.st = 'ok'; it.pct = 100; it.wait = '';
        } catch (e) {
          it.st = 'err'; it.wait = '';
          it.err = String(e.message || 'falha').slice(0, 90);
          failed.push(it.file);
        }
        done++;
        if (st) st.textContent = `Enviados ${done}/${list.length}…`;
        paintQueue(items);
      }
    }));
    const oks = items.filter((i) => i.st === 'ok').length;
    if (st) st.textContent = failed.length
      ? `${oks}/${list.length} guardados. ${failed.length} falharam — repita sem reescolher.`
      : `${oks} guardado(s). Comprimindo… ⏳`;
    try { Drive.refresh(); } catch {}
    watchProcessing();
  }

  async function retry() {
    if (!failed.length) return;
    const files = failed;
    failed = [];
    await send(files);
  }

  // Enquanto houver ⏳, atualiza grade+quota sozinho (thumb, % e economia).
  function watchProcessing() {
    clearInterval(pollTimer);
    let rounds = 0;
    pollTimer = setInterval(() => {
      rounds++;
      let pend = 0;
      try { pend = Drive.all().filter((f) => !f.compressed && !f.trashedAt).length; } catch {}
      const st = $('upStatus');
      if (pend > 0 && rounds < 75) {
        if (st && !failed.length) st.textContent = `⏳ ${pend} comprimindo… a economia entra sozinha.`;
        try { Drive.refresh(); } catch {}
      } else {
        clearInterval(pollTimer);
        pollTimer = null;
        try { Drive.refresh(); } catch {}
        if (st && !failed.length) st.textContent = pend ? '' : '✅ Tudo pronto e comprimido.';
      }
    }, 8000);
  }

  return { pick, send, retry, watchProcessing };
})();
window.Upload = Upload;
