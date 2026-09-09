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
  // Fotos usa a Picker API (a Library API morreu em 31/03/2025 p/ leitura geral).
  photos: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
};
const PICKER = 'https://photospicker.googleapis.com/v1';

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

// ---- Google Photos Picker: o usuário ESCOLHE numa aba do Google, a gente baixa.
// 1) createPickerSession -> { sessionId, pickerUri } (front abre a URI)
// 2) usuário escolhe e clica Concluir na aba do Google
// 3) front chama startPickerImport(sessionId) -> job baixa a seleção
async function pickerFetch(token, path, opts = {}) {
  const r = await fetch(`${PICKER}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 401) throw new Error('Google expirou a sessão. Conecte de novo.');
  if (r.status === 403) throw new Error('Ative a "Google Photos Picker API" no projeto DriveSpotify (Cloud Console → APIs).');
  if (!r.ok) throw new Error(`Google Fotos ${r.status}. Tente de novo.`);
  return r.json();
}

export async function createPickerSession(userId) {
  const token = takeToken(userId, 'photos');
  const j = await pickerFetch(token, '/sessions', { method: 'POST', body: '{}' });
  if (!j.id || !j.pickerUri) throw new Error('Google não abriu a sessão de escolha.');
  return { sessionId: j.id, pickerUri: j.pickerUri };
}

export async function pickerSessionStatus(userId, sessionId) {
  const token = takeToken(userId, 'photos');
  const id = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) throw new Error('Sessão inválida.');
  const j = await pickerFetch(token, `/sessions/${id}`);
  return { ready: !!j.mediaItemsSet, mediaItemsSet: !!j.mediaItemsSet };
}

async function listPickerItems(token, sessionId) {
  const out = [];
  let page = '';
  for (let i = 0; i < 100; i++) {
    const j = await pickerFetch(token, `/sessions/${sessionId}/mediaItems?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
    for (const m of j.mediaItems || []) {
      const mf = m.mediaFile || {};
      out.push({
        id: m.id,
        name: mf.filename || `${m.id}.jpg`,
        mime: mf.mimeType || 'image/jpeg',
        size: 0,
        baseUrl: mf.baseUrl,
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

async function runJob(job, itemsOverride) {
  const { userId, source, quotaMB } = job;
  try {
    const token = takeToken(userId, source);
    const items = itemsOverride || (source === 'drive' ? await listDriveAll(token) : []);
    if (!itemsOverride && source !== 'drive') throw new Error('Use a escolha do Google Fotos (Picker).');
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

function newJob(userId, source, quotaMB) {
  for (const j of jobs.values()) {
    if (j.userId === userId && j.status === 'running') throw new Error('Já tem importação rodando.');
  }
  const job = {
    id: randomUUID(), userId, source, quotaMB,
    status: 'running', total: 0, done: 0, errors: [],
    startedAt: new Date().toISOString(), finishedAt: '',
  };
  jobs.set(job.id, job);
  return job;
}

export function startImport(userId, source, quotaMB) {
  // Drive puxa tudo sozinho; Fotos vai pelo Picker (startPickerImport).
  if (source !== 'drive') throw new Error('Fotos: escolha na janela do Google primeiro.');
  takeToken(userId, source); // falha rápido: sem vínculo/escopo, nem cria o job
  const job = newJob(userId, source, quotaMB);
  runJob(job).catch(() => {});
  return { id: job.id };
}

// Fotos (Picker): baixa a SELEÇÃO de uma sessão já concluída no Google.
export async function startPickerImport(userId, sessionId, quotaMB) {
  const token = takeToken(userId, 'photos');
  const id = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) throw new Error('Sessão inválida.');
  const st = await pickerFetch(token, `/sessions/${id}`);
  if (!st.mediaItemsSet) throw new Error('Escolha as fotos na aba do Google e clique Concluir primeiro.');
  const items = await listPickerItems(token, id);
  if (!items.length) throw new Error('Nenhuma foto escolhida.');
  const job = newJob(userId, 'photos', quotaMB);
  runJob(job, items).catch(() => {});
  return { id: job.id };
}

export function jobStatus(userId, isAdmin, id) {
  const j = jobs.get(id);
  if (!j) return null;
  if (j.userId !== userId && !isAdmin) return null;
  return j;
}
