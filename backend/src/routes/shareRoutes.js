import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { readCollection, upsertRow, deleteRow } from '../config/store.js';
import { requireAuth } from '../middlewares/auth.js';
import { getFileMeta, assertOwner, blobPath } from '../services/fileGuard.js';

// Links públicos de compartilhamento: token aleatório por arquivo, com
// validade opcional. Quem tem o link baixa sem login — então: nunca de
// cofre trancado, nunca de lixeira, e dá pra revogar (DELETE).
// Montado em /s (fora do guard /api, que exige login).
export const sharePublic = Router();

// GET /s/:token — público. Só inline, sem listar nada ao redor.
sharePublic.get('/:token', (req, res) => {
  const s = readCollection('shares').find((x) => x.token === req.params.token);
  if (!s) return res.status(404).send('Link inválido ou expirado.');
  if (s.expiresAt && Date.now() > s.expiresAt) return res.status(410).send('Link expirado.');
  const meta = getFileMeta(s.fileId);
  if (!meta || meta.ownerId !== s.ownerId || meta.trashedAt) {
    return res.status(404).send('Arquivo indisponível.');
  }
  if (meta.vaultId) return res.status(404).send('Arquivo indisponível.');
  let abs;
  try { abs = blobPath(meta.ownerId, meta.id); } catch { return res.status(404).send('Arquivo indisponível.'); }
  if (!fs.existsSync(abs)) return res.status(404).send('Arquivo indisponível.');
  const isBin = /\.(exe|msi)$/i.test(meta.name || '');
  res.setHeader('Content-Type', meta.mime || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `${isBin ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(meta.name || 'arquivo')}`);
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
