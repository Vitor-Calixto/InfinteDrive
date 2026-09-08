import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { readCollection, upsertRow, deleteRow } from '../config/store.js';
import { requireAuth, fileLimiter } from '../middlewares/auth.js';
import { createSecureUpload } from '../middlewares/upload.js';
import { getFileMeta, assertOwner, userRoot } from '../services/fileGuard.js';
import { safeJoin } from '../middlewares/validate.js';
import {
  isVaultLocked, unlockVault, lockAllVaults,
  setFileVault, clearFileVaultEverywhere,
} from '../services/vault.js';

const r = Router();
r.use(requireAuth);

const mine = (req) => readCollection('playlists').filter((p) => p.ownerId === req.user.id);
const coverUpload = createSecureUpload({ maxBytes: 10 * 1024 * 1024 });

// POST /api/playlists/:id/cover (campo "file"): foto de capa da playlist.
// Só imagem, vira webp 600px. GET público-dono em /:id/cover.
r.post('/:id/cover', fileLimiter, coverUpload.single('file'), async (req, res) => {
  try {
    const pl = mine(req).find((p) => p.id === req.params.id);
    if (!pl) { try { fs.unlinkSync(req.file.path); } catch {} return res.status(404).json({ error: 'Playlist não encontrada.' }); }
    if (!req.file || !(req.file.mimetype || '').startsWith('image/')) {
      try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'Envie uma imagem.' });
    }
    const buf = fs.readFileSync(req.file.path);
    const webp = await sharp(buf, { animated: false }).rotate()
      .resize(600, 600, { fit: 'cover' }).webp({ quality: 70 }).toBuffer();
    fs.writeFileSync(safeJoin(userRoot(req.user.id), `${pl.id}-cover.webp`), webp);
    try { fs.unlinkSync(req.file.path); } catch {}
    pl.cover = true;
    upsertRow('playlists', pl);
    return res.json(pl);
  } catch (e) {
    try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'Falha na capa.' });
  }
});

r.get('/:id/cover', (req, res) => {
  const pl = mine(req).find((p) => p.id === req.params.id);
  if (!pl?.cover) return res.status(404).json({ error: 'Sem capa.' });
  if (pl.vaultHash && isVaultLocked(req.user.id, pl.id)) return res.status(404).json({ error: 'Sem capa.' });
  const abs = safeJoin(userRoot(req.user.id), `${pl.id}-cover.webp`);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Sem capa.' });
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.sendFile(abs, { dotfiles: 'deny' });
});

// GET /api/playlists — minhas playlists com contagem.
// Cofre trancado: conta zerada e sem fileIds (nem a lista entrega).
r.get('/', (req, res) => {
  const files = readCollection('storage');
  return res.json(mine(req).map((p) => {
    const { vaultHash, fileIds, ...pub } = p;
    const locked = !!vaultHash && isVaultLocked(req.user.id, p.id);
    return {
      ...pub,
      vault: !!vaultHash,
      locked,
      fileIds: locked ? [] : (fileIds || []),
      count: locked ? 0 : (fileIds || []).filter((id) => files.some((f) => f.id === id && f.ownerId === req.user.id)).length,
    };
  }));
});

// POST /api/playlists { name, profileId? } — cria pasta-playlist.
// profileId (opcional) prende a pasta a um perfil da conta.
r.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Dê um nome para a playlist.' });
  if (mine(req).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'Já existe playlist com esse nome.' });
  }
  let profileId = null;
  if (req.body?.profileId) {
    const ok = readCollection('profiles').some((x) => x.id === req.body.profileId && x.ownerId === req.user.id);
    if (!ok) return res.status(400).json({ error: 'Perfil inválido.' });
    profileId = req.body.profileId;
  }
  const row = { id: randomUUID(), ownerId: req.user.id, profileId, name: name.replace(/[<>"']/g, ''), fileIds: [], createdAt: new Date().toISOString() };
  upsertRow('playlists', row);
  return res.json(row);
});

// POST /api/playlists/by-name { name, fileId } — acha ou cria e adiciona.
r.post('/by-name', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const meta = assertOwner(getFileMeta(req.body?.fileId), req.user);
  if (!name) return res.status(400).json({ error: 'Dê um nome para a playlist.' });
  if (!meta) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  let pl = mine(req).find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!pl) {
    pl = { id: randomUUID(), ownerId: req.user.id, name: name.replace(/[<>"']/g, ''), fileIds: [], createdAt: new Date().toISOString() };
  }
  pl.fileIds = [...new Set([...(pl.fileIds || []), meta.id])];
  upsertRow('playlists', pl);
  if (pl.vaultHash) setFileVault(meta.id, req.user.id, pl.id);
  return res.json(pl);
});

// POST /api/playlists/:id/files { fileIds: [] } — adiciona vários de uma vez.
// Só entra arquivo do próprio dono; inexistente/alheio é ignorado (sem vazar).
r.post('/:id/files', (req, res) => {
  const pl = mine(req).find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist não encontrada.' });
  const ids = Array.isArray(req.body?.fileIds) ? req.body.fileIds.slice(0, 2000) : [];
  const ok = ids.filter((id) => assertOwner(getFileMeta(id), req.user));
  pl.fileIds = [...new Set([...(pl.fileIds || []), ...ok])];
  upsertRow('playlists', pl);
  if (pl.vaultHash) ok.forEach((id) => setFileVault(id, req.user.id, pl.id));
  return res.json({ added: ok.length, total: pl.fileIds.length });
});
r.delete('/:id', (req, res) => {
  const pl = mine(req).find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist não encontrada.' });
  // Cofre trancado só apaga aberto (unlock antes) — sem senha no DELETE.
  if (pl.vaultHash && isVaultLocked(req.user.id, pl.id)) {
    return res.status(401).json({ error: 'Abra o cofre antes de apagar.' });
  }
  for (const fid of pl.fileIds || []) clearFileVaultEverywhere(fid, req.user.id, pl.id);
  try {
    const cov = safeJoin(userRoot(req.user.id), `${pl.id}-cover.webp`);
    if (fs.existsSync(cov)) fs.unlinkSync(cov);
  } catch {}
  deleteRow('playlists', pl.id);
  return res.json({ ok: true });
});

// DELETE /api/playlists/:id/files/:fileId — tira o arquivo da pasta.
r.delete('/:id/files/:fileId', (req, res) => {
  const pl = mine(req).find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist não encontrada.' });
  pl.fileIds = (pl.fileIds || []).filter((id) => id !== req.params.fileId);
  upsertRow('playlists', pl);
  clearFileVaultEverywhere(req.params.fileId, req.user.id, pl.id);
  return res.json(pl);
});

// Cofre: senha definida pelo usuário (4-64 chars, hash bcrypt).
// POST /:id/vault { password, current? } — cria ou troca (troca exige a atual).
r.post('/:id/vault', (req, res) => {
  const pl = mine(req).find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist não encontrada.' });
  const pw = String(req.body?.password || '');
  if (pw.length < 4 || pw.length > 64) return res.status(400).json({ error: 'Senha do cofre: 4 a 64 caracteres.' });
  if (pl.vaultHash && !bcrypt.compareSync(String(req.body?.current || ''), pl.vaultHash)) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }
  pl.vaultHash = bcrypt.hashSync(pw, 10);
  upsertRow('playlists', pl);
  for (const fid of pl.fileIds || []) setFileVault(fid, req.user.id, pl.id);
  return res.json({ ok: true, locked: true });
});

// DELETE /:id/vault { password } — remove o cofre (arquivos voltam a aparecer).
r.delete('/:id/vault', (req, res) => {
  const pl = mine(req).find((p) => p.id === req.params.id);
  if (!pl?.vaultHash) return res.status(404).json({ error: 'Sem cofre aqui.' });
  if (!bcrypt.compareSync(String(req.body?.password || ''), pl.vaultHash)) {
    return res.status(401).json({ error: 'Senha do cofre incorreta.' });
  }
  delete pl.vaultHash;
  upsertRow('playlists', pl);
  for (const fid of pl.fileIds || []) clearFileVaultEverywhere(fid, req.user.id, pl.id);
  return res.json({ ok: true });
});

// POST /:id/unlock { password } — abre o cofre nesta sessão.
r.post('/:id/unlock', (req, res) => {
  const pl = mine(req).find((p) => p.id === req.params.id);
  if (!pl?.vaultHash) return res.json({ ok: true });
  if (!bcrypt.compareSync(String(req.body?.password || ''), pl.vaultHash)) {
    return res.status(401).json({ error: 'Senha do cofre incorreta.' });
  }
  unlockVault(req.user.id, pl.id);
  return res.json({ ok: true });
});

// POST /vault-lock — tranca todos os meus cofres (chamado no logout).
r.post('/vault-lock', (req, res) => {
  lockAllVaults(req.user.id);
  return res.json({ ok: true });
});

export default r;
