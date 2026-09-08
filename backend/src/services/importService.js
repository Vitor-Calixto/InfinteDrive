import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { readCollection, upsertRow } from '../config/store.js';
import { userRoot, blobPath, assertQuota, appendAudit } from './fileGuard.js';
import { sanitizeFilename } from '../middlewares/validate.js';
import { assertExtensionAllowed } from '../middlewares/upload.js';
import { enqueueCompression } from './compressService.js';

// Importação Google (Drive + Fotos): access token de escopo pedido no front,
// validado aqui (audiência + escopos), guardado SÓ em memória (nunca em disco),
// usado imediatamente pelo job em background com progresso.
const tokens = new Map(); // userId -> { token, scopes:[], exp }
const jobs = new Map(); // jobId -> { id, userId, source, status, total, done, errors:[], startedAt, finishedAt }

const NEED = {
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  photos: 'https://www.googleapis.com/auth/photoslibrary.readonly',
};

export async function linkToken(userId, accessToken) {
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!r.ok) throw new Error('Token Google inválido.');
  const info = await r.json();
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (clientId && info.aud !== clientId) throw new Error('Token de outro app.');
  const scopes = String(info.scope || '').split(' ');
  tokens.set(userId, { token: accessToken, scopes, exp: Date.now() + 50 * 60 * 1000 });
  return { scopes };
}

function takeToken(userId, source) {
  const t = tokens.get(userId);
  if (!t || Date.now() > t.exp) { tokens.delete(userId); throw new Error('Sessão Google expirou. Conecte de novo.'); }
  if (!t.scopes.includes(NEED[source])) throw new Error(`Permissão ${source} não concedida.`);
  return t.token;
}

async function gjson(token, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw new Error('Google expirou a sessão. Conecte de novo.');
  if (!r.ok) throw new Error(`Google ${r.status}. Tente de novo.`);
  return r.json();
}

async function listDriveAll(token) {
  const out = [];
  let page = '';
  for (let i = 0; i < 100; i++) {
    const q = `trashed=false`;
    const j = await gjson(token, `https://www.googleapis.com/drive/v3/files?pageSize=200&fields=nextPageToken,files(id,name,mimeType,size)&q=${encodeURIComponent(q)}${page ? `&pageToken=${page}` : ''}`);
    for (const f of j.files || []) {
      if (String(f.mimeType || '').startsWith('application/vnd.google-apps.')) continue; // Docs/Sheets: pula
      out.push({ id: f.id, name: f.name, mime: f.mimeType, size: Number(f.size) || 0 });
    }
    page = j.nextPageToken || '';
    if (!page) break;
  }
  return out;
}

async function listPhotosAll(token) {
  const out = [];
  let page = '';
  for (let i = 0; i < 100; i++) {
    const r = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageSize: 100, pageToken: page || undefined }),
    });
    if (r.status === 401) throw new Error('Google expirou a sessão. Conecte de novo.');
    if (!r.ok) throw new Error(`Google Fotos ${r.status}. Tente de novo.`);
    const j = await r.json();
    for (const m of j.mediaItems || []) {
      out.push({
        id: m.id,
        name: m.filename || `${m.id}.jpg`,
        mime: m.mimeType || 'image/jpeg',
        size: 0,
        baseUrl: m.baseUrl,
        photo: !!m.mediaMetadata?.photo,
      });
    }
    page = j.nextPageToken || '';
    if (!page) break;
  }
  return out;
}

async function downloadTo(token, url, dest, maxBytes) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok || !r.body) throw new Error(`Download falhou (${r.status}).`);
  let bytes = 0;
  let tooBig = false;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    out.on('finish', resolve);
    out.on('error', reject);
    r.body.on('data', (d) => {
      bytes += d.length;
      if (bytes > maxBytes && !tooBig) {
        tooBig = true;
        try { r.body.destroy(); } catch {}
        try { out.destroy(); } catch {}
        reject(new Error('Arquivo excede o limite.'));
      }
    });
    r.body.on('error', reject);
    r.body.pipe(out);
  });
  return bytes;
}

async function storeDownloaded(userId, quotaMB, tmpPath, { name, mime }) {
  const cleanName = sanitizeFilename(name);
  assertExtensionAllowed(cleanName); // mesma regra do upload: .exe/.msi só com flag
  const bytes = fs.statSync(tmpPath).size;
  assertQuota(userId, quotaMB, bytes);
  const sha256 = await new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(tmpPath);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
  const id = randomUUID();
  fs.renameSync(tmpPath, blobPath(userId, id));
  const meta = {
    id, ownerId: userId,
    name: cleanName,
    mime: String(mime || 'application/octet-stream').slice(0, 120),
    sizeOrig: bytes, sizeFinal: bytes,
    sha256,
    tier: 'local', compressed: false, thumb: false,
    importedFrom: 'google',
    createdAt: new Date().toISOString(),
  };
  upsertRow('storage', meta);
  appendAudit({ userId, action: 'import', fileId: id, ip: '', detail: meta.name });
  enqueueCompression(id);
  return meta;
}

async function runJob(job) {
  const { userId, source, quotaMB } = job;
  try {
    const token = takeToken(userId, source);
    const items = source === 'drive' ? await listDriveAll(token) : await listPhotosAll(token);
    job.total = items.length;
    const MAX = Number(process.env.MAX_UPLOAD_MB) > 0 ? Number(process.env.MAX_UPLOAD_MB) * 1024 * 1024 : 10 * 1024 * 1024 * 1024;
    // Paralelismo configurável (IMPORT_WORKERS, padrão 4): rede é o gargalo,
    // não CPU. Acima de ~8 o Google começa a responder 429.
    const W = Math.min(10, Math.max(1, Number(process.env.IMPORT_WORKERS) || 4));
    let next = 0;
    const one = async (it) => {
      if (job.status === 'cancelled') return;
      const tmp = path.join(process.cwd(), 'data', 'tmp', `${randomUUID()}.imp`);
      try {
        if (it.size && it.size > MAX) throw new Error('acima do limite');
        const url = source === 'drive'
          ? `https://www.googleapis.com/drive/v3/files/${it.id}?alt=media`
          : `${it.baseUrl}=d`;
        await downloadTo(token, url, tmp, MAX);
        await storeDownloaded(userId, quotaMB, tmp, it);
      } catch (e) {
        job.errors.push(`${it.name}: ${e.message}`.slice(0, 160));
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      }
      job.done++;
    };
    await Promise.all(Array.from({ length: Math.min(W, items.length) }, async () => {
      while (next < items.length) {
        if (job.status === 'cancelled') break;
        await one(items[next++]);
      }
    }));
    job.status = job.status === 'cancelled' ? 'cancelled' : 'done';
  } catch (e) {
    job.status = 'failed';
    job.errors.push(String(e.message || e).slice(0, 200));
  }
  job.finishedAt = new Date().toISOString();
}

export function startImport(userId, source, quotaMB) {
  if (!['drive', 'photos'].includes(source)) throw new Error('Fonte inválida.');
  for (const j of jobs.values()) {
    if (j.userId === userId && j.status === 'running') throw new Error('Já tem importação rodando.');
  }
  takeToken(userId, source); // falha rápido: sem vínculo/escopo, nem cria o job
  const job = {
    id: randomUUID(), userId, source, quotaMB,
    status: 'running', total: 0, done: 0, errors: [],
    startedAt: new Date().toISOString(), finishedAt: '',
  };
  jobs.set(job.id, job);
  runJob(job).catch(() => {});
  return { id: job.id };
}

export function jobStatus(userId, isAdmin, id) {
  const j = jobs.get(id);
  if (!j) return null;
  if (j.userId !== userId && !isAdmin) return null;
  return j;
}
