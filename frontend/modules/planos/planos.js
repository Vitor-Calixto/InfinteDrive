// planos.js — vitrine + calculadora ligada à quota real.
const Planos = (() => {
  async function show() {
    calc();
    try {
      const q = window._quota || await jget('/storage/quota');
      const el = $('myPlanLine');
      if (el && q) el.innerHTML = `Você guarda <b>${fmtMB(q.origMB)}</b> (equivale fora) ocupando <b>${fmtMB(q.finalMB)}</b> — plano ideal: <b>${planFor(Math.ceil(q.origMB / 5))}</b>.`;
    } catch {}
  }
  function calc() {
    const g = Number($('calcGB')?.value) || 0;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('calcIn', g >= 1000 ? (g / 1000).toFixed(1) + ' TB' : g + ' GB');
    const eff = Math.round(g / 5); // perfil misto honesto: 5x
    set('calcOut', eff >= 1000 ? (eff / 1000).toFixed(1) + ' TB' : eff + ' GB');
    set('calcPlan', '→ plano ' + planFor(eff));
  }
  function choose(name) { toast(`Plano ${name}: pagamento em breve. Fala com a gente que ativamos na hora.`); }
  return { show, calc, choose };
})();
window.Planos = Planos;
