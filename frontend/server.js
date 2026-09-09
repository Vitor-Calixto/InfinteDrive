// server.js — estático do frontend InfiniteDrive. Zero dependências.
// Uso:  node server.js            (porta 5588)
//       PORT=5500 node server.js  (outra porta)
// Mata o `python -m http.server`: este aqui manda `Cache-Control: no-store`
// em tudo, então o navegador nunca mais mostra HTML/JS/CSS velho.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5588);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Clear-Site-Data': '"cache"',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    // Anti-traversal: nunca sai da pasta do frontend.
    if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found');
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Clear-Site-Data': '"cache"',
        Pragma: 'no-cache',
        Expires: '0',
      });
      fs.createReadStream(file).pipe(res);
    });
  } catch {
    send(res, 500, 'Error');
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} ocupada. Mate o outro (Get-Process node | Stop-Process) ou use PORT=5500 node server.js`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, () => {
  console.log(`Deploy Center front em http://localhost:${PORT}/  (demo: ?demo=1)`);
  console.log(`Login direto: http://localhost:${PORT}/pages/login/login.html`);
});
