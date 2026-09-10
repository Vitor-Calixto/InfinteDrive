// player.js — barra inferior: fila, auto-next, erros, MediaSession (tela bloqueio).
const Player = (() => {
  let queue = []; let idx = -1;
  function bindOnce() {
    const a = $('audio');
    if (!a || a._bound) return;
    a._bound = true;
    a.addEventListener('ended', () => next());
    a.addEventListener('error', () => {
      const f = queue[idx];
      toast(`Não deu pra tocar ${f ? f.name : 'a faixa'}. Pulando…`);
      next();
    });
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('previoustrack', () => prev());
        navigator.mediaSession.setActionHandler('nexttrack', () => next());
        navigator.mediaSession.setActionHandler('play', () => toggle(true));
        navigator.mediaSession.setActionHandler('pause', () => toggle(false));
      }
    } catch {}
  }
  function playList(list, startId) {
    bindOnce();
    queue = list; idx = Math.max(0, list.findIndex((x) => x.id === startId));
    current();
  }
  function current() {
    const f = queue[idx]; if (!f) return;
    const a = $('audio');
    a.src = Drive.dlUrl(f.id);
    a.play().catch(() => {});
    $('player').hidden = false;
    $('pTitle').textContent = f.name;
    $('pSub').textContent = `faixa ${idx + 1}/${queue.length}${f.duration ? ' · ' + fmtDur(f.duration) : ''} · ${fmtMB((f.sizeFinal ?? f.sizeOrig) / 1048576)}`;
    $('pCover').src = f.thumb ? Drive.thumbUrl(f.id) : '';
    $('pToggle').textContent = '⏸';
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: f.name, artist: 'Deploy Center',
          artwork: f.thumb ? [{ src: Drive.thumbUrl(f.id), sizes: '300x300', type: 'image/webp' }] : [],
        });
      }
    } catch {}
  }
  function toggle(force) {
    const a = $('audio');
    const wantPlay = force !== undefined ? force : a.paused;
    if (wantPlay) { a.play().catch(() => {}); $('pToggle').textContent = '⏸'; }
    else { a.pause(); $('pToggle').textContent = '▶'; }
  }
  function next() { if (!queue.length) return; idx = (idx + 1) % queue.length; current(); }
  function prev() { if (!queue.length) return; idx = (idx - 1 + queue.length) % queue.length; current(); }
  function close() { try { $('audio').pause(); } catch {} $('player').hidden = true; queue = []; idx = -1; }
  return { playList, toggle, next, prev, close };
})();
window.Player = Player;
