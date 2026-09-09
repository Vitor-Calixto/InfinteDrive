// share.js — viewer + link público
const Share = (() => {
  let openId = '';
  let shareUrl = '';
  async function open(id) {
    openId = id; shareUrl = '';
    const f = (window._files || []).find((x) => x.id === id);
    if (!f) return;
    const k = kindOf(f);
    if (k === 'audio') {
      Player.playList((window._files || []).filter((x) => kindOf(x) === 'audio'), id);
      return;
    }
    const body = $('modalBody');
    if (k === 'video') body.innerHTML = '<video src="' + Drive.dlUrl(id) + '" controls autoplay></video>';
    else if (k === 'image') body.innerHTML = '<img src="' + Drive.dlUrl(id) + '" />';
    else { window.open(Drive.dlUrl(id), '_blank'); return; }
    $('modalCap').textContent = f.name;
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; $('modalBody').innerHTML = ''; openId = ''; }
  async function link() {
    if (shareUrl) return shareUrl;
    const r = await jpost('/share/' + openId, {});
    let u = r.url || '';
    if (u.startsWith('/')) u = location.origin + u;
    shareUrl = u;
    return u;
  }
  async function via(w) {
    try {
      const u = await link();
      if (w === 'wa') window.open('https://wa.me/?text=' + encodeURIComponent(u), '_blank');
      else if (w === 'copy') { await navigator.clipboard.writeText(u); toast('Link copiado. Vale 7 dias.'); }
      else if (navigator.share) await navigator.share({ url: u }).catch(() => {});
    } catch (e) { toast(e.message); }
  }
  return { open, closeModal, via };
})();
window.Share = Share;
