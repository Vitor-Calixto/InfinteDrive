// sw.js — Deploy Center offline: shell sempre abre; blobs marcados abrem sem rede.
const SHELL = 'dc-shell-v1';
const MEDIA = 'dc-media-v1';
const CORE = [
  './', 'index.html', 'manifest.json',
  'css/style.css', 'css/responsive.css',
  'js/core.js', 'js/shell.js',
  'modules/auth/auth.js', 'modules/auth/twofa.js',
  'modules/drive/drive.js', 'modules/drive/drive.css',
  'modules/playlists/playlists.js', 'modules/playlists/playlists.css',
  'modules/player/player.js',
  'modules/search/search.js',
  'modules/upload/upload.js', 'modules/upload/upload.css',
  'modules/download/download.js', 'modules/download/download.css',
  'modules/share/share.js',
  'modules/vault/vault.js', 'modules/vault/vault.css',
  'modules/profiles/profiles.js', 'modules/profiles/profiles.css',
  'modules/trash/trash.js', 'modules/trash/trash.css',
  'modules/system/system.js', 'modules/system/system.css',
  'modules/import/import.js', 'modules/import/import.css',
  'modules/admin/admin.js', 'modules/admin/admin.css',
  'modules/planos/planos.js', 'modules/planos/planos.css',
  'modules/terms/terms.js', 'modules/terms/terms.html',
  'modules/security/security.html',
  'modules/cloudflare/cloudflare.js', 'modules/cloudflare/cloudflare.html', 'modules/cloudflare/cloudflare.css',
  'modules/compressdoc/compressdoc.js', 'modules/compressdoc/compressdoc.html',
  'icons/icon-192.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Estratégia: navegação e estático = cache primeiro (abre offline);
// API JSON = rede (dado vivo, sem cache velho);
// download/thumb = rede primeiro, cai pro cache offline (só tem o marcado).
// Chave sem ?token=: JWT troca no relogin, o arquivo é o mesmo.
function mediaKey(u) {
  const x = new URL(u.href);
  x.searchParams.delete('token');
  return x.href;
}
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  if (/\/api\/(storage|chunks)\/(download|thumb)\//.test(u.pathname)) {
    e.respondWith(fetch(e.request).catch(() => caches.open(MEDIA).then((c) => c.match(mediaKey(u)))));
    return;
  }
  if (u.pathname.startsWith('/api/')) return; // rede pura
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {});
    return r;
  }).catch(() => caches.match('index.html'))));
});
