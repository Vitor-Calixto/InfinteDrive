import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readCollection, upsertRow, deleteRow, withRetry } from '../config/store.js';
import { requireAuth, fileLimiter, mediaLimiter } from '../middlewares/auth.js';
import { createSecureUpload } from '../middlewares/upload.js';
import { sanitizeFilename } from '../middlewares/validate.js';
import {
  userRoot, blobPath, getFileMeta, assertOwner,
  assertQuota, quotaUsageMB, appendAudit, checkQuotaBefore,
} from '../services/fileGuard.js';
import { enqueueCompression } from '../services/compressService.js';
import { dropIndex } from '../services/searchService.js';
import { quotaFor } from '../config/users.js';
import { visibleFile, isVaultLocked } from '../services/vault.js';
import { safeJoin } from '../middlewares/validate.js';

const r = Router();
r.use(requireAuth, (req, res, next) => {
  // Mídia (player) usa o limite generoso; resto usa o de arquivos.
  if (/^\/(download|thumb)\//.test(req.path)) return mediaLimiter(req, res, next);
  return fileLimiter(req, res, next);
});
// Teto ajustável sem código: MAX_UPLOAD_MB (padrão 10GB). Acima disso, o
// certo é upload fatiado com resume (roadmap), não POST único.
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) > 0 ? Number(process.env.MAX_UPLOAD_MB) : 10240;
const upload = createSecureUpload({ maxBytes: MAX_UPLOAD_MB * 1024 * 1024 });

function sha256File(absPath) {
  // Por stream: nunca carrega o arquivo inteiro na RAM (instalador de 1GB).
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(absPath);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

// POST /api/storage/upload (campo "file"). Auth + quota + hash SHA256.
// Nome em disco = uuid, nunca o original. Resposta sem caminho real.
r.post('/upload', checkQuotaBefore, upload.single('file'), async (req, res) => {
  let savedId = '';
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo.' });
    const bytes = fs.statSync(req.file.path).size;
    assertQuota(req.user.id, req.user.quotaMB, bytes);
    const sha256 = await sha256File(req.file.path);
    const id = randomUUID();
    fs.renameSync(req.file.path, blobPath(req.user.id, id));
    savedId = id; // a partir daqui, falha precisa limpar o blob órfão abaixo
    const meta = {
      id,
      ownerId: req.user.id,
      name: sanitizeFilename(req.file.originalname),
      mime: String(req.file.mimetype || 'application/octet-stream').slice(0, 120),
      sizeOrig: bytes,
      sizeFinal: bytes,
      sha256,
      tier: 'local',
      compressed: false,
      thumb: false,
      createdAt: new Date().toISOString(),
    };
    await withRetry(() => {
      upsertRow('storage', meta);
      appendAudit({ userId: req.user.id, action: 'upload', fileId: id, ip: req.ip, detail: meta.name });
    });
    enqueueCompression(id); // worker comprime em background (não trava a resposta)
    return res.json(meta);
  } catch (e) {
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    try { if (savedId) { const o = blobPath(req.user.id, savedId); if (fs.existsSync(o)) fs.unlinkSync(o); } } catch {}
    const msg = /Quota esgotada/.test(e.message) ? e.message : 'Falha no upload.';
    return res.status(/Quota/.test(msg) ? 402 : 400).json({ error: msg, retry: true });
  }
});

// GET /api/storage/list — só os MEUS arquivos (admin usa ?all=1, auditado).
// Expõe o sha256 como `hash` (só dono/admin, que já podem baixar e calcular):
// o front deduplica downloads por ele. Cofre trancado some daqui
// (só volta com unlock). Lixeira (?trashed=1) à parte.
r.get('/list', (req, res) => {
  const all = readCollection('storage');
  const trashedOnly = req.query.trashed === '1';
  const mine = (req.user.role === 'admin' && req.query.all === '1')
    ? all.filter((m) => trashedOnly ? m.trashedAt : !m.trashedAt)
    : all.filter((m) => visibleFile(req.user.id, m) && (trashedOnly ? m.trashedAt : !m.trashedAt));
  if (req.user.role === 'admin' && req.query.all === '1') {
    appendAudit({ userId: req.user.id, action: 'list-all', ip: req.ip });
  }
  // hash exposto AO DONO como `hash`: ele já pode baixar e calcular,
  // então nada novo vaza — e o front usa p/ deduplicar downloads.
  const pub = mine.map(({ sha256, ...rest }) => ({ ...rest, hash: sha256 }));
  return res.json(pub.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});

// GET /api/storage/quota — medidor de espaço: guardado (original) vs
// ocupando (final comprimido) + economia da compressão.
// Regra: só arquivo COMPRIMIDO entra na conta. Em processamento aparece
// separado (processing) e entra nos números ao concluir — o medidor nunca
// mostra pico transitório. A trava de quota no upload continua pessimista
// (conta o original), então o disco nunca estoura por causa disso.
r.get('/quota', (req, res) => {
  const quotaMB = Number(req.user.quotaMB) > 0 ? Number(req.user.quotaMB) : quotaFor(req.user.plan);
  const mine = readCollection('storage').filter((m) => m.ownerId === req.user.id);
  const done = mine.filter((m) => m.compressed && !m.trashedAt);
  const pending = mine.filter((m) => !m.compressed && !m.trashedAt);
  const trashed = mine.filter((m) => m.trashedAt);
  const origB = done.reduce((acc, m) => acc + (Number(m.sizeOrig) || 0), 0);
  const finalB = done.reduce((acc, m) => acc + (Number(m.sizeFinal ?? m.sizeOrig) || 0), 0);
  const pendB = pending.reduce((acc, m) => acc + (Number(m.sizeOrig) || 0), 0);
  const usedMB = finalB / (1024 * 1024);
  return res.json({
    usedMB, quotaMB,
    origMB: origB / (1024 * 1024),
    finalMB: usedMB,
    savedMB: Math.max(0, origB - finalB) / (1024 * 1024),
    savedPct: origB > 0 ? Math.max(0, Math.round((1 - finalB / origB) * 1000) / 10) : 0,
    files: done.length,
    processing: { files: pending.length, origMB: pendB / (1024 * 1024) },
    trash: { files: trashed.length, mb: trashed.reduce((a, m) => a + (Number(m.sizeFinal ?? m.sizeOrig) || 0), 0) / (1024 * 1024) },
    byKind: ['image', 'audio', 'video'].map((k) => {
      const items = done.filter((m) => String(m.mime || '').startsWith(k + '/'));
      const o = items.reduce((a, m) => a + (Number(m.sizeOrig) || 0), 0);
      const f = items.reduce((a, m) => a + (Number(m.sizeFinal ?? m.sizeOrig) || 0), 0);
      return { kind: k, files: items.length, origMB: o / (1024 * 1024), finalMB: f / (1024 * 1024) };
    }).concat([(() => {
      const items = done.filter((m) => !/^(image|audio|video)\//.test(String(m.mime || '')));
      const o = items.reduce((a, m) => a + (Number(m.sizeOrig) || 0), 0);
      const f = items.reduce((a, m) => a + (Number(m.sizeFinal ?? m.sizeOrig) || 0), 0);
      return { kind: 'docs', files: items.length, origMB: o / (1024 * 1024), finalMB: f / (1024 * 1024) };
    })()]),
  });
});

// GET /api/storage/download/:id — dono ou admin. 404 genérico nos dois casos
// (inexistente ou alheio) para não revelar arquivos de outro usuário.
// Express trata Range automaticamente no sendFile (seek do player).
r.get('/download/:id', (req, res) => {
  const meta = assertOwner(getFileMeta(req.params.id), req.user);
  if (!meta || meta.trashedAt) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  // Cofre trancado: nem download direto pelo id (só admin passa).
  if (req.user.role !== 'admin' && meta.vaultId && isVaultLocked(meta.ownerId, meta.vaultId)) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  let abs;
  try { abs = blobPath(meta.ownerId, meta.id); } catch { return res.status(404).json({ error: 'Arquivo não encontrado.' }); }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  appendAudit({ userId: req.user.id, action: 'download', fileId: meta.id, ip: req.ip });
  // Executável e HTML/JS/SVG sempre como anexo: navegador baixa, nunca
  // interpreta (stored-XSS: virus.html com <script> não roda na nossa origem).
  const isBin = /\.(exe|msi)$/i.test(meta.name || '');
  const isActive = /\.(html?|js|svg|xml|xhtml)$/i.test(meta.name || '');
  const forceDl = isBin || isActive;
  res.setHeader('Content-Type', isActive ? 'text/plain; charset=utf-8' : (meta.mime || 'application/octet-stream'));
  res.setHeader('Content-Length', String(meta.sizeFinal ?? meta.sizeOrig ?? fs.statSync(abs).size));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `${forceDl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(meta.name || 'arquivo')}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(abs, { dotfiles: 'deny' });
});

// GET /api/storage/thumb/:id — capa 300px (capa do álbum no Spotify).
// Mesmo isolamento do download: dono ou admin, 404 genérico.
r.get('/thumb/:id', (req, res) => {
  const meta = assertOwner(getFileMeta(req.params.id), req.user);
  if (!meta || !meta.thumb || meta.trashedAt) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  if (req.user.role !== 'admin' && meta.vaultId && isVaultLocked(meta.ownerId, meta.vaultId)) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  let abs;
  try { abs = safeJoin(userRoot(meta.ownerId), `${meta.id}-thumb.webp`); } catch { return res.status(404).json({ error: 'Arquivo não encontrado.' }); }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(abs, { dotfiles: 'deny' });
});

// DELETE /api/storage/:id — vai pra LIXEIRA (30 dias p/ restaurar).
// Exclusão definitiva só em /:id/forever ou esvaziando a lixeira.
r.delete('/:id', (req, res) => {
  const meta = assertOwner(getFileMeta(req.params.id), req.user);
  if (!meta) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  if (meta.trashedAt) return res.json({ ok: true, trashed: true });
  meta.trashedAt = new Date().toISOString();
  upsertRow('storage', meta);
  dropIndex(meta.id); // some da busca enquanto na lixeira
  appendAudit({ userId: req.user.id, action: 'trash', fileId: meta.id, ip: req.ip, detail: meta.name });
  return res.json({ ok: true, trashed: true });
});

// PATCH /api/storage/:id { name } — renomeia (só o rótulo; disco continua uuid).
r.patch('/:id', (req, res) => {
  const meta = assertOwner(getFileMeta(req.params.id), req.user);
  if (!meta) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  const name = sanitizeFilename(String(req.body?.name || ''));
  if (!name || name.length > 120) return res.status(400).json({ error: 'Nome inválido.' });
  meta.name = name;
  upsertRow('storage', meta);
  appendAudit({ userId: req.user.id, action: 'rename', fileId: meta.id, ip: req.ip, detail: name });
  const { sha256, ...pub } = meta;
  return res.json(pub);
});

// POST /api/storage/:id/restore — volta da lixeira.
r.post('/:id/restore', (req, res) => {
  const meta = assertOwner(getFileMeta(req.params.id), req.user);
  if (!meta) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  if (!meta.trashedAt) return res.json({ ok: true });
  delete meta.trashedAt;
  upsertRow('storage', meta);
  appendAudit({ userId: req.user.id, action: 'restore', fileId: meta.id, ip: req.ip, detail: meta.name });
  return res.json({ ok: true });
});

// POST /api/storage/:id/recompress — roda o compressor de novo com as
// configurações atuais (ex: CRF novo). Só vale p/ imagem/áudio/vídeo;
// outros tipos voltam como "sem compressor" sem mudar o blob.
r.post('/:id/recompress', (req, res) => {
  const meta = assertOwner(getFileMeta(req.params.id), req.user);
  if (!meta) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  if (meta.trashedAt) return res.status(400).json({ error: 'Restaure da lixeira antes.' });
  meta.compressed = false;
  delete meta.progress;
  delete meta.note;
  delete meta.compressError;
  upsertRow('storage', meta);
  enqueueCompression(meta.id);
  appendAudit({ userId: req.user.id, action: 'recompress', fileId: meta.id, ip: req.ip, detail: meta.name });
  return res.json({ ok: true });
});

// DELETE /api/storage/:id/forever — apaga de verdade (blob+thumb+meta).
r.delete('/:id/forever', (req, res) => {
  const meta = assertOwner(getFileMeta(req.params.id), req.user);
  if (!meta) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  destroyBlob(meta);
  deleteRow('storage', meta.id);
  dropIndex(meta.id);
  appendAudit({ userId: req.user.id, action: 'delete', fileId: meta.id, ip: req.ip, detail: meta.name });
  userRoot(req.user.id);
  return res.json({ ok: true });
});

// DELETE /api/storage/trash/empty — esvazia MINHA lixeira.
r.delete('/trash/empty', (req, res) => {
  const mine = readCollection('storage').filter((m) => m.ownerId === req.user.id && m.trashedAt);
  for (const meta of mine) {
    destroyBlob(meta);
    deleteRow('storage', meta.id);
    dropIndex(meta.id);
  }
  appendAudit({ userId: req.user.id, action: 'empty-trash', ip: req.ip, detail: `${mine.length} arquivo(s)` });
  return res.json({ ok: true, removed: mine.length });
});

function destroyBlob(meta) {
  try {
    const abs = blobPath(meta.ownerId, meta.id);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    const th = safeJoin(userRoot(meta.ownerId), `${meta.id}-thumb.webp`);
    if (fs.existsSync(th)) fs.unlinkSync(th);
  } catch {}
}

export default r;
