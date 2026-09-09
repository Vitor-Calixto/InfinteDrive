import fs from 'node:fs';
import path from 'node:path';
import { readCollection, writeCollection } from '../config/store.js';
import { quotaFor } from '../config/users.js';
import { safeJoin } from '../middlewares/validate.js';

// Isolamento anti-vazamento: cada usuário só enxerga o próprio diretório.
// O caminho em disco NUNCA deriva de input do usuário — só de uuid gerado
// no servidor (fileId). Metadados carregam ownerId e toda leitura confere dono.
export const STORAGE_ROOT = path.join(process.cwd(), 'data', 'files');

// Faxina da lixeira: apaga de verdade o que passou de 30 dias.
// Roda no boot + a cada 6h (disparado pelo server).
export function purgeTrash(ttlDays = 30) {
  try {
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    const rows = readCollection('storage');
    const old = rows.filter((m) => m.trashedAt && new Date(m.trashedAt).getTime() < cutoff);
    for (const m of old) {
      try {
        const abs = blobPath(m.ownerId, m.id);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
        const th = safeJoin(userRoot(m.ownerId), `${m.id}-thumb.webp`);
        if (fs.existsSync(th)) fs.unlinkSync(th);
      } catch {}
    }
    if (old.length) {
      const gone = new Set(old.map((m) => m.id));
      writeCollection('storage', rows.filter((m) => !gone.has(m.id)));
      const idx = readCollection('search-index').filter((x) => !gone.has(x.id));
      writeCollection('search-index', idx);
      console.log(`[lixeira] ${old.length} arquivo(s) expirado(s) apagados.`);
    }
    return old.length;
  } catch { return 0; }
}
export function wipeUserData(userId) {
  try {
    const dir = safeJoin(STORAGE_ROOT, String(userId));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  writeCollection('storage', readCollection('storage').filter((m) => m.ownerId !== userId));
  writeCollection('playlists', readCollection('playlists').filter((p) => p.ownerId !== userId));
  writeCollection('profiles', readCollection('profiles').filter((p) => p.ownerId !== userId));
  writeCollection('search-index', readCollection('search-index').filter((x) => x.ownerId !== userId));
  writeCollection('users', readCollection('users').filter((u) => u.id !== userId));
}

export function userRoot(userId) {
  const dir = safeJoin(STORAGE_ROOT, String(userId || 'anon'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function blobPath(userId, fileId) {
  return safeJoin(userRoot(userId), `${String(fileId)}.bin`);
}

export function getFileMeta(id) {
  return readCollection('storage').find((m) => m.id === id) || null;
}

// Dono OU admin. Retorna null quando não pode (chamador responde 404
// genérico nos dois casos — inexistente e alheio — para não revelar
// se o arquivo de outro usuário existe).
export function assertOwner(meta, user) {
  if (!meta || !user) return null;
  if (user.role === 'admin') return meta;
  if (meta.ownerId === user.id) return meta;
  return null;
}

export function quotaUsageMB(userId) {
  const bytes = readCollection('storage')
    .filter((m) => m.ownerId === userId)
    .reduce((acc, m) => acc + (Number(m.sizeFinal ?? m.sizeOrig) || 0), 0);
  return bytes / (1024 * 1024);
}

export function assertQuota(userId, quotaMB, newBytes) {
  const quota = Number(quotaMB) > 0 ? Number(quotaMB) : quotaFor();
  const used = quotaUsageMB(userId);
  if ((used * 1024 * 1024 + Number(newBytes || 0)) / (1024 * 1024) > quota) {
    throw new Error('Quota esgotada.');
  }
  return { usedMB: used, quotaMB: quota };
}

// Trava ANTES de receber bytes: usa Content-Length pra recusar 402 sem
// gastar banda/disco (o cheque final continua depois do upload).
export function checkQuotaBefore(req, res, next) {
  try {
    const len = Number(req.headers['content-length']);
    if (Number.isFinite(len) && len > 0 && req.user) {
      assertQuota(req.user.id, req.user.quotaMB, len);
    }
    return next();
  } catch (e) {
    return res.status(402).json({ error: e.message });
  }
}

// Auditoria local (offline): quem acessou qual arquivo e quando.
// Cap em 2000 linhas para não crescer sem limite.
export function appendAudit({ userId, action, fileId = '', ip = '', detail = '' }) {
  try {
    const rows = readCollection('audit');
    rows.push({
      ts: new Date().toISOString(),
      userId: String(userId || ''),
      action: String(action || ''),
      fileId: String(fileId || ''),
      ip: String(ip || '').slice(0, 64),
      detail: String(detail || '').slice(0, 200),
    });
    writeCollection('audit', rows.slice(-2000));
  } catch { /* auditoria nunca quebra a operação */ }
}
