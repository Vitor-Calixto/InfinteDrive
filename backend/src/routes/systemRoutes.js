import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readCollection } from '../config/store.js';
import { requireAuth, requireDev } from '../middlewares/auth.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const r = Router();
r.use(requireAuth, requireDev);

// GET /api/system/disk — disco real (statfs) + uso do app (soma sizeFinal).
// Alerta em 70%: hora de assinar o Object Storage.
r.get('/disk', (req, res) => {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const st = fs.statfsSync(dataDir);
    const totalB = st.blocks * st.bsize;
    const freeB = st.bfree * st.bsize;
    const usedB = totalB - freeB;
    const mine = readCollection('storage').filter((m) => req.user.role === 'admin' ? true : m.ownerId === req.user.id);
    const appB = mine.reduce((a, m) => a + (Number(m.sizeFinal ?? m.sizeOrig) || 0), 0);
    const pct = totalB > 0 ? Number(((usedB / totalB) * 100).toFixed(1)) : 0;
    if (pct >= 70) console.warn(`[disco] ${pct}% ocupado — hora do Object Storage.`);
    const MB = (b) => b / (1024 * 1024);
    return res.json({
      diskTotalMB: MB(totalB), diskFreeMB: MB(freeB), diskUsedMB: MB(usedB), pct,
      appMB: MB(appB), files: mine.length,
      alert: pct >= 70 ? 'Disco acima de 70%. Hora de plugar o Object Storage.' : '',
    });
  } catch (e) { return res.status(500).json({ error: 'Falha ao ler disco.' }); }
});

// ---- Backup: zip de data/ (JSONs + blobs). Restaura deszipando com backend parado.
const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');
function ensureBackupDir() {
  // Preguiçoso de propósito: mkdir no topo quebrava o boot inteiro (EPERM).
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// POST /api/system/backup — gera backup agora (pode demorar em base grande).
r.post('/backup', async (req, res) => {
  try {
    ensureBackupDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `backup-${stamp}.zip`;
    const abs = path.join(BACKUP_DIR, file);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(abs);
      const zip = new archiver.ZipArchive({ zlib: { level: 6 } });
      out.on('close', resolve);
      zip.on('error', reject);
      zip.pipe(out);
      const dataDir = path.join(process.cwd(), 'data');
      for (const e of fs.readdirSync(dataDir)) {
        // Pula transitórios (tmp de upload, fatias, locks). Backups entram (histórico).
        if (['tmp', 'chunks'].includes(e) || e.startsWith('.lock-') || e.endsWith('.tmp')) continue;
        const full = path.join(dataDir, e);
        if (fs.statSync(full).isDirectory()) zip.directory(full, `data/${e}`);
        else zip.file(full, { name: `data/${e}` });
      }
      zip.finalize();
    });
    return res.json({ file, bytes: fs.statSync(abs).size });
  } catch (e) { return res.status(500).json({ error: 'Falha no backup.' }); }
});

r.get('/backups', (req, res) => {
  const list = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.zip')) : [];
  return res.json(list
    .map((f) => ({ file: f, bytes: fs.statSync(path.join(BACKUP_DIR, f)).size }))
    .sort((a, b) => (a.file < b.file ? 1 : -1)));
});

r.get('/backups/:file', (req, res) => {
  const f = path.basename(String(req.params.file || ''));
  if (!/^backup-[\dT-]+\.zip$/.test(f)) return res.status(400).json({ error: 'Backup inválido.' });
  const abs = path.join(BACKUP_DIR, f);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Backup não encontrado.' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${f}"`);
  return res.sendFile(abs, { dotfiles: 'deny' });
});

r.delete('/backups/:file', (req, res) => {
  const f = path.basename(String(req.params.file || ''));
  if (!/^backup-[\dT-]+\.zip$/.test(f)) return res.status(400).json({ error: 'Backup inválido.' });
  try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
  return res.json({ ok: true });
});

export default r;
