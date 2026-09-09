import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { readCollection, upsertRow, deleteRow } from '../config/store.js';
import { requireAuth } from '../middlewares/auth.js';
import { getFileMeta, assertOwner, blobPath, userRoot } from '../services/fileGuard.js';
import { safeJoin } from '../middlewares/validate.js';

// Links públicos de compartilhamento: token aleatório por arquivo, com
// validade opcional. Quem tem o link baixa sem login — então: nunca de
// cofre trancado, nunca de lixeira, e dá pra revogar (DELETE).
// Montado em /s (fora do guard /api, que exige login).
export const sharePublic = Router();

function loadShare(token) {
  const s = readCollection('shares').find((x) => x.token === String(token || ''));
  if (!s) return {};
  if (s.expiresAt && Date.now() > s.expiresAt) return {};
  const meta = getFileMeta(s.fileId);
  if (!meta || meta.ownerId !== s.ownerId || meta.trashedAt || meta.vaultId) return {};
  return { s, meta };
}

function escHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// GET /s/:token — página com Open Graph (cartão rico no WhatsApp/Telegram)
// + player embutido. O byte cru mora em /s/:token/file.
sharePublic.get('/:token', (req, res) => {
  const { meta } = loadShare(req.params.token);
  if (!meta) return res.status(404).send('Link inválido ou expirado.');
  const base = `${req.protocol}://${req.get('host')}`;
  const fileUrl = `${base}/s/${req.params.token}/file`;
  const thumbUrl = meta.thumb ? `${base}/s/${req.params.token}/thumb` : '';
  const isVideo = (meta.mime || '').startsWith('video/');
  const isAudio = (meta.mime || '').startsWith('audio/');
  const isImage = (meta.mime || '').startsWith('image/');
  const media = isVideo
    ? `<video src="${fileUrl}" controls playsinline style="width:100%;max-height:62vh;border-radius:12px;background:#000"></video>`
    : isAudio
      ? `<audio src="${fileUrl}" controls style="width:100%"></audio>`
      : isImage
        ? `<img src="${fileUrl}" style="width:100%;border-radius:12px" />`
        : `<p><a class="dl" href="${fileUrl}">⬇ Baixar ${escHtml(meta.name)}</a></p>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escHtml(meta.name)}</title>
<meta property="og:title" content="${escHtml(meta.name)}" />
<meta property="og:description" content="Via DecaVault 🎵" />
<meta property="og:type" content="${isVideo ? 'video.other' : isAudio ? 'music.song' : 'website'}" />
${thumbUrl ? `<meta property="og:image" content="${thumbUrl}" />` : ''}
${isVideo ? `<meta property="og:video" content="${fileUrl}" /><meta property="og:video:type" content="video/mp4" />` : ''}
${isAudio ? `<meta property="og:audio" content="${fileUrl}" />` : ''}
<style>body{margin:0;background:#000;color:#fff;font-family:system-ui;display:flex;justify-content:center;padding:24px}main{width:min(720px,94vw);text-align:center}h1{font-size:18px}.dl{display:inline-block;background:#1DB954;color:#000;font-weight:700;border-radius:999px;padding:10px 22px;text-decoration:none}</style>
</head><body><main><h1>${escHtml(meta.name)}</h1>${media}<p><a class="dl" href="${fileUrl}">⬇ Baixar</a></p></main></body></html>`);
});

// GET /s/:token/thumb — capa pro cartão (e pro player).
sharePublic.get('/:token/thumb', (req, res) => {
  const { meta } = loadShare(req.params.token);
  if (!meta?.thumb) return res.status(404).send('Sem capa.');
  try {
    const abs = safeJoin(userRoot(meta.ownerId), `${meta.id}-thumb.webp`);
    if (!fs.existsSync(abs)) return res.status(404).send('Sem capa.');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(abs, { dotfiles: 'deny' });
  } catch { return res.status(404).send('Sem capa.'); }
});

// GET /s/:token/file — o byte cru (player e download usam este).
sharePublic.get('/:token/file', (req, res) => {
  const { meta } = loadShare(req.params.token);
  if (!meta) return res.status(404).send('Arquivo indisponível.');
  let abs;
  try { abs = blobPath(meta.ownerId, meta.id); } catch { return res.status(404).send('Arquivo indisponível.'); }
  if (!fs.existsSync(abs)) return res.status(404).send('Arquivo indisponível.');
  const isBin = /\.(exe|msi)$/i.test(meta.name || '');
  const isActive = /\.(html?|js|svg|xml|xhtml)$/i.test(meta.name || '');
  const forceDl = isBin || isActive;
  res.setHeader('Content-Type', isActive ? 'text/plain; charset=utf-8' : (meta.mime || 'application/octet-stream'));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `${forceDl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(meta.name || 'arquivo')}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(abs, { dotfiles: 'deny' });
});

export const shareApi = Router();
shareApi.use(requireAuth);

// POST /api/share/:fileId { hours? } — cria link (padrão 7 dias, 0 = sem expirar).
shareApi.post('/:fileId', (req, res) => {
  const meta = assertOwner(getFileMeta(req.params.fileId), req.user);
  if (!meta || meta.trashedAt) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  if (meta.vaultId) return res.status(400).json({ error: 'Tire do cofre antes de compartilhar.' });
  const hours = Number(req.body?.hours);
  const token = crypto.randomBytes(24).toString('hex');
  const row = {
    token,
    fileId: meta.id,
    ownerId: req.user.id,
    createdAt: new Date().toISOString(),
    expiresAt: hours > 0 ? Date.now() + hours * 3600 * 1000 : Date.now() + 7 * 24 * 3600 * 1000,
  };
  upsertRow('shares', { ...row, id: token });
  const base = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return res.json({ url: `${base || ''}/s/${token}`, expiresAt: row.expiresAt });
});

// GET /api/share — meus links ativos.
shareApi.get('/', (req, res) => {
  const now = Date.now();
  const mine = readCollection('shares').filter((s) => s.ownerId === req.user.id && (!s.expiresAt || s.expiresAt > now));
  return res.json(mine.map(({ token, fileId, createdAt, expiresAt }) => ({ token, fileId, createdAt, expiresAt })));
});

// DELETE /api/share/:token — revoga.
shareApi.delete('/:token', (req, res) => {
  const s = readCollection('shares').find((x) => x.token === req.params.token);
  if (!s || (s.ownerId !== req.user.id && req.user.role !== 'admin')) {
    return res.status(404).json({ error: 'Link não encontrado.' });
  }
  deleteRow('shares', s.id || s.token);
  return res.json({ ok: true });
});
