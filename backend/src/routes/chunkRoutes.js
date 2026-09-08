import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readCollection, upsertRow } from '../config/store.js';
import { requireAuth, fileLimiter } from '../middlewares/auth.js';
import { createSecureUpload, assertExtensionAllowed } from '../middlewares/upload.js';
import { sanitizeFilename } from '../middlewares/validate.js';
import { userRoot, blobPath, assertQuota, appendAudit } from '../services/fileGuard.js';
import { enqueueCompression } from '../services/compressService.js';

const r = Router();
r.use(requireAuth, fileLimiter);

// Upload fatiado: arquivos grandes sobem em pedaços de 8MB com resume.
// 1) POST /chunk { uploadId, index, total } + campo "chunk" (8MB)
// 2) GET /chunk-status/:uploadId -> { received: [indices] }
// 3) POST /complete { uploadId, name, mime, size } -> monta por stream
//    direto no destino final (sem 2x transitório) e cria o meta.
const CHUNK_DIR = path.join(process.cwd(), 'data', 'chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });
const chunkUpload = createSecureUpload({ maxBytes: 16 * 1024 * 1024 });
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB) > 0 ? Number(process.env.MAX_UPLOAD_MB) * 1024 * 1024 : 10 * 1024 * 1024 * 1024;

const upDir = (uploadId) => {
  if (!/^[0-9a-f-]{36}$/.test(String(uploadId || ''))) throw new Error('uploadId inválido.');
  return path.join(CHUNK_DIR, String(uploadId));
};

r.post('/chunk', chunkUpload.single('chunk'), (req, res) => {
  try {
    const { uploadId, index, total } = req.body || {};
    const i = Number(index), n = Number(total);
    if (!Number.isInteger(i) || i < 0 || !Number.isInteger(n) || n <= 0 || i >= n || n > 4096) {
      throw new Error('Fatia inválida.');
    }
    const dir = upDir(uploadId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(req.file.path, path.join(dir, `part-${i}`));
    return res.json({ ok: true, index: i });
  } catch (e) {
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: e.message });
  }
});

r.get('/chunk-status/:uploadId', (req, res) => {
  try {
    const dir = upDir(req.params.uploadId);
    if (!fs.existsSync(dir)) return res.json({ received: [] });
    const received = fs.readdirSync(dir)
      .map((f) => (/^part-(\d+)$/.exec(f) || [])[1])
      .filter((x) => x !== undefined)
      .map(Number);
    return res.json({ received });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

r.post('/complete', chunkUpload.none(), async (req, res) => {
  const dir = (() => { try { return upDir(req.body?.uploadId); } catch { return ''; } })();
  try {
    const { name, mime, size, total } = req.body || {};
    const n = Number(total);
    const sizeNum = Number(size);
    if (!dir || !fs.existsSync(dir)) return res.status(400).json({ error: 'Envio não encontrado. Recomece.' });
    if (!Number.isInteger(n) || n <= 0 || n > 4096) return res.status(400).json({ error: 'Total inválido.' });
    if (!Number.isFinite(sizeNum) || sizeNum <= 0 || sizeNum > MAX_BYTES) {
      return res.status(400).json({ error: 'Tamanho fora do limite.' });
    }
    for (let i = 0; i < n; i++) {
      if (!fs.existsSync(path.join(dir, `part-${i}`))) {
        return res.status(400).json({ error: `Fatia ${i} faltando. Retome o envio.` });
      }
    }
    const cleanName = sanitizeFilename(name);
    try { assertExtensionAllowed(cleanName); }
    catch (e) { fs.rmSync(dir, { recursive: true, force: true }); return res.status(400).json({ error: e.message }); }
    assertQuota(req.user.id, req.user.quotaMB, sizeNum);
    const id = randomUUID();
    const dest = blobPath(req.user.id, id);
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      out.on('finish', resolve);
      out.on('error', reject);
      (async () => {
        try {
          for (let i = 0; i < n; i++) {
            await new Promise((res2, rej2) => {
              const inp = fs.createReadStream(path.join(dir, `part-${i}`));
              inp.on('data', (d) => hash.update(d));
              inp.on('end', res2);
              inp.on('error', rej2);
              inp.pipe(out, { end: false });
            });
          }
          out.end();
        } catch (e) { rej2safe(e); }
        function rej2safe(e) { try { out.destroy(e); } catch {} reject(e); }
      })();
    });
    const real = fs.statSync(dest).size;
    if (real !== sizeNum) {
      try { fs.unlinkSync(dest); } catch {}
      return res.status(400).json({ error: 'Tamanho final divergiu. Reenvie.' });
    }
    // Checagem de extensão após montar (mesma regra do upload simples).
    const meta = {
      id,
      ownerId: req.user.id,
      name: cleanName,
      mime: String(mime || 'application/octet-stream').slice(0, 120),
      sizeOrig: real,
      sizeFinal: real,
      sha256: hash.digest('hex'),
      tier: 'local',
      compressed: false,
      thumb: false,
      createdAt: new Date().toISOString(),
    };
    upsertRow('storage', meta);
    appendAudit({ userId: req.user.id, action: 'upload-chunked', fileId: id, ip: req.ip, detail: cleanName });
    enqueueCompression(id);
    fs.rmSync(dir, { recursive: true, force: true });
    return res.json(meta);
  } catch (e) {
    return res.status(400).json({ error: 'Falha ao montar arquivo.' });
  }
});

export default r;
