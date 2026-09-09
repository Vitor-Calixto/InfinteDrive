// player.js — barra inferior
const Player = (() => {
  let queue = []; let idx = -1;
  function playList(list, startId) {
    queue = list; idx = Math.max(0, list.findIndex((x) => x.id === startId));
    current();
  }
  function current() {
    const f = queue[idx]; if (!f) return;
    const a = $('audio'); a.src = Drive.dlUrl(f.id); a.play().catch(() => {});
    $('player').hidden = false;
    $('pTitle').textContent = f.name;
    $('pSub').textContent = `${fmtDur(f.duration)} · ${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}`;
    $('pCover').src = f.thumb ? Drive.thumbUrl(f.id) : '';
    $('pToggle').textContent = '⏸';
  }
  function toggle() {
    const a = $('audio');
    if (a.paused) { a.play().catch(() => {}); $('pToggle').textContent = '⏸'; }
    else { a.pause(); $('pToggle').textContent = '▶'; }
  }
  function next() { if (!queue.length) return; idx = (idx + 1) % queue.length; current(); }
  function prev() { if (!queue.length) return; idx = (idx - 1 + queue.length) % queue.length; current(); }
  function close() { try { $('audio').pause(); } catch {} $('player').hidden = true; queue = []; idx = -1; }
  return { playList, toggle, next, prev, close };
})();
window.Player = Player;
