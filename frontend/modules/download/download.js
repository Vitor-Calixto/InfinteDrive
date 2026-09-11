// download.js — fila de downloads: pasta, menor→maior, dedup por hash, resume, retry.
// Usa File System Access (Chrome/Edge): salva direto no disco, sem estourar RAM.
const DlQueue = (() => {
  const KIND_DIR = { image: 'Fotos', audio: 'Musicas', video: 'Videos', docs: 'Docs' };
  let failed = []; // [{f}] p/ Repetir
  let lastDir = null;

  const safeName = (n) => String(n || 'arquivo').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const dirFor = (f) => KIND_DIR[kindOf(f)] || 'Docs';
  const sizeOf = (f) => Number(f.sizeFinal ?? f.sizeOrig) || 0;

  function paint(items, extra) {
    const box = $('dlQueue');
    if (!box) return;
    const ok = items.filter((i) => i.st === 'ok' || i.st === 'skip').length;
    const run = items.filter((i) => i.st === 'run').length;
    const err = items.filter((i) => i.st === 'err').length;
    box.hidden = false;
    box.innerHTML =
      `<div class="upq-head">⬇ ${items.length} na fila · <b>${ok} ok</b>${extra?.dups ? ` · ${extra.dups} duplicado(s) pulados` : ''}${run ? ` · ${run} baixando` : ''}${err ? ` · <b class="upq-err">${err} falharam</b>` : ''}</div>` +
      items.map((i) => `
        <div class="upq-row">
          <span class="upq-ico">${i.st === 'ok' ? '✅' : i.st === 'skip' ? '⏭' : i.st === 'err' ? '❌' : '⬇'}</span>
          <span class="upq-name" title="${esc(i.f.name)}">${esc(i.f.name)}</span>
          <span class="upq-sub">${fmtMB(sizeOf(i.f) / 1048576)}${i.st === 'run' ? ` · ${i.pct}%` : ''}${i.st === 'skip' ? ' · já estava' : ''}${i.err ? ` · ${esc(i.err)}` : ''}</span>
          <div class="upq-bar"><div style="width:${i.pct}%"></div></div>
        </div>`).join('') +
      (err ? `<button class="btn-ghost mt-2" onclick="DlQueue.retry()">↻ Repetir ${err} falha(s)</button>` : '');
  }

  // Baixa 1 arquivo na subpasta do tipo, com resume (Range) e % real.
  async function dlOne(dirH, f, prog) {
    const sub = await dirH.getDirectoryHandle(dirFor(f), { create: true });
    const name = safeName(f.name);
    const expect = sizeOf(f);
    let start = 0;
    try {
      const cur = await (await sub.getFileHandle(name)).getFile();
      if (cur.size === expect && expect > 0) { prog(expect, expect); return 'skip'; }
      if (cur.size > 0 && cur.size < expect) start = cur.size; // parcial: retoma
    } catch {} // não existe ainda
    const headers = { ...authHeaders() };
    if (start > 0) headers.Range = `bytes=${start}-`;
    const r = await fetch(api() + '/storage/download/' + f.id, { headers });
    if (start > 0 && r.status !== 206) start = 0; // servidor ignorou o range
    if (!r.ok) throw new Error((await r.text()).slice(0, 100));
    const h = await sub.getFileHandle(name, { create: true });
    let w;
    try {
      w = await h.createWritable({ keepExistingData: start > 0 });
      if (start > 0) await w.seek(start);
    } catch { w = await h.createWritable(); start = 0; }
    const reader = r.body.getReader();
    let got = start;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await w.write(value);
      got += value.length;
      prog(got, expect);
    }
    await w.close();
    return 'ok';
  }

  async function run(queue, dirH, dups) {
    failed = [];
    const items = queue.map((f) => ({ f, st: 'wait', pct: 0, err: '' }));
    paint(items, { dups });
    let done = 0;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (next < queue.length) {
        const idx = next++;
        const it = items[idx];
        it.st = 'run';
        paint(items, { dups });
        try {
          it.st = await dlOne(dirH, it.f, (got, total) => {
            it.pct = total ? Math.round((got / total) * 100) : 100;
            paint(items, { dups });
          });
          if (it.st === 'ok') it.pct = 100;
        } catch (e) {
          it.st = 'err';
          it.err = String(e.message || 'falha').slice(0, 80);
          failed.push({ f: it.f });
        }
        done++;
        paint(items, { dups });
      }
    }));
    paint(items, { dups });
    if (!failed.length) toast(`⬇ Pronto: ${queue.length} baixado(s)${dups ? `, ${dups} duplicado(s) pulados` : ''}.`);
  }

  async function start(only) {
    if (!window.showDirectoryPicker) {
      toast('A fila precisa de Chrome/Edge. Alternativa: peça o .zip.');
      return;
    }
    if (!getToken()) return toast('Entre primeiro.');
    // Com lista (multisseleção) usa ela; sem, respeita o filtro atual.
    const base = Array.isArray(only) && only.length ? only : Drive.visible();
    const ready = base.filter((f) => !f.trashedAt && f.compressed);
    const pend = base.filter((f) => !f.trashedAt && !f.compressed);
    if (!ready.length) {
      toast(pend.length ? `⏳ ${pend.length} ainda comprimindo. Baixe quando prontos.` : 'Nada para baixar aqui.');
      return;
    }
    // Menor → maior (iguais em bytes = empate, ordem irrelevante).
    ready.sort((a, b) => sizeOf(a) - sizeOf(b));
    // Dedup: hash repetido baixa 1x (idênticos em bytes, nomes podem diferir).
    const seen = new Set();
    const queue = [];
    let dups = 0;
    for (const f of ready) {
      if (f.hash && seen.has(f.hash)) { dups++; continue; }
      if (f.hash) seen.add(f.hash);
      queue.push(f);
    }
    let dirH;
    try {
      dirH = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch { return; } // cancelou a escolha da pasta
    lastDir = dirH;
    await run(queue, dirH, dups);
  }

  async function retry() {
    if (!failed.length) return;
    if (!lastDir) return start();
    const files = failed.map((x) => x.f);
    failed = [];
    await run(files, lastDir, 0);
  }

  return { start, retry };
})();
window.DlQueue = DlQueue;
