// system.js — Conta: espaço, economia, por-tipo, lixeira, 2FA.
const System = (() => {
  const KIND_LABEL = { image: '🖼 Fotos', audio: '🎧 Músicas', video: '🎬 Vídeos', docs: '📄 Docs e outros' };
  function paint(q) {
    window._quota = q;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('uOrig', fmtMB(q.origMB));
    set('uFinal', fmtMB(q.finalMB));
    set('uSaved', `${fmtMB(q.savedMB)} (${q.savedPct}%)`);
    set('uFiles', q.files);
    set('uUseLabel', `Ocupando ${fmtMB(q.finalMB)}`);
    set('uQuotaLabel', `de ${fmtMB(q.quotaMB)}`);
    const bar = $('uBar');
    if (bar) bar.style.width = Math.min(100, (q.finalMB / q.quotaMB) * 100).toFixed(1) + '%';
    const pr = $('uProc');
    if (pr) pr.textContent = q.processing?.files
      ? `⏳ ${q.processing.files} processando (${fmtMB(q.processing.origMB)}) — entram na conta ao concluir.`
      : '';
    const tr = $('uTrash');
    if (tr) tr.innerHTML = q.trash?.files
      ? `🗑 ${q.trash.files} na lixeira (${fmtMB(q.trash.mb)}). <button class="sp-link" onclick="Shell.show('trash')">Ver lixeira</button>`
      : '';
    const kl = $('uKinds');
    if (kl) kl.innerHTML = (q.byKind || []).map((k) => {
      const pct = q.finalMB ? Math.min(100, (k.finalMB / q.finalMB) * 100) : 0;
      const eco = k.origMB > 0 ? Math.max(0, Math.round((1 - k.finalMB / k.origMB) * 100)) : 0;
      return `<div class="kind-row">
        <div class="flex justify-between text-sm"><b>${KIND_LABEL[k.kind] || k.kind}</b>
        <span class="text-zinc-400">${k.files} arq. · ${fmtMB(k.origMB)} → ${fmtMB(k.finalMB)} · −${eco}%</span></div>
        <div class="sp-bar"><div style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
    }).join('');
    // Mini-quota da sidebar conversa com os mesmos números.
    set('qUseMini', `${fmtMB(q.finalMB)} / ${fmtMB(q.quotaMB)}`);
    const qb = $('qBarMini');
    if (qb) qb.style.width = Math.min(100, (q.finalMB / q.quotaMB) * 100).toFixed(1) + '%';
    set('pmQuota', `Ocupando ${fmtMB(q.finalMB)} de ${fmtMB(q.quotaMB)}`);
  }
  async function show() {
    if (!getToken()) return;
    try { paint(await jget('/storage/quota')); } catch {}
    try {
      const u = window._user || await jget('/auth/me');
      window._user = u;
      window.TwoFA?.paint(u);
    } catch {}
  }
  return { show, paint };
})();
window.System = System;
