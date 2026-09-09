// search.js — local instantâneo + servidor (full-text com rank e snippets).
const Search = (() => {
  let timer = null;
  function focus() { Shell.show('drive'); setTimeout(() => $('search')?.focus(), 200); }
  function onInput(v) {
    Drive.setSearch(v); // local responde na hora
    clearTimeout(timer);
    const q = (v || '').trim();
    if (q.length < 2 || !getToken()) { Drive.setServerResults(null); return; }
    timer = setTimeout(async () => {
      try {
        const res = await jget('/search?q=' + encodeURIComponent(q));
        // Corrida: só aplica se o input ainda é o mesmo (resposta velha não pinta).
        if ((($('search')?.value) || '').trim() !== q) return;
        const sn = {};
        for (const r of res) if (r.snippet) sn[r.id] = r.snippet;
        Drive.setServerResults(res.map((r) => r.id), sn);
      } catch { Drive.setServerResults(null); } // sem rede = volta ao local
    }, 300);
  }
  return { focus, onInput };
})();
window.Search = Search;
