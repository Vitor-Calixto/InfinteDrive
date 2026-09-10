import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { readCollection, upsertRow, deleteRow } from '../config/store.js';
import { encryptSecret, decryptSecret } from '../config/crypto.js';
import { userRoot, blobPath, assertQuota, appendAudit } from './fileGuard.js';
import { sanitizeFilename } from '../middlewares/validate.js';
import { assertExtensionAllowed } from '../middlewares/upload.js';
import { enqueueCompression } from './compressService.js';

// Importação Google (Drive + Fotos): access token de escopo pedido no front,
// validado aqui (audiência + escopos), guardado SÓ em memória (nunca em disco),
// usado imediatamente pelo job em background com progresso.
const tokens = new Map(); // userId -> { access, accessExp, refresh, scopes:[] }
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
  tokens.set(userId, { access: accessToken, accessExp: Date.now() + 50 * 60 * 1000, refresh: tokens.get(userId)?.refresh || '', scopes });
  return { scopes };
}

// Vincula via fluxo redirect (código): guarda o refresh token (vale dias,
// renova o access sozinho — job longo não morre aos 50min).
// Persiste criptografado em disco: sobrevive a restart do backend.
export function linkRefresh(userId, { refreshToken, accessToken, scopes }) {
  const prev = tokens.get(userId) || {};
  const row = {
    access: accessToken || prev.access || '',
    accessExp: Date.now() + 50 * 60 * 1000,
    refresh: refreshToken || prev.refresh || '',
    scopes: scopes?.length ? scopes : (prev.scopes || []),
  };
  tokens.set(userId, row);
  try {
    if (row.refresh) upsertRow('google', { id: userId, refreshEnc: encryptSecret(row.refresh), scopes: row.scopes, updatedAt: new Date().toISOString() });
  } catch (e) { console.warn('[import] vínculo só em memória:', e.message); }
  return { ok: true };
}

// Restaura o vínculo do disco (pós-restart): access expirou, renova via refresh.
function restoreLink(userId) {
  try {
    const row = readCollection('google').find((r) => r.id === userId);
    const refresh = row?.refreshEnc ? decryptSecret(row.refreshEnc) : '';
    if (!refresh) return null;
    const t = { access: '', accessExp: 0, refresh, scopes: row.scopes || [] };
    tokens.set(userId, t);
    return t;
  } catch { return null; }
}

async function refreshAccess(userId, t) {
  const secret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!t.refresh) throw new Error('Sessão Google expirou. Conecte de novo.');
  if (!secret) throw new Error('Sem GOOGLE_CLIENT_SECRET no servidor: vincule de novo.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, refresh_token: t.refresh, grant_type: 'refresh_token' }),
  });
  if (!r.ok) {
    tokens.delete(userId);
    try { deleteRow('google', userId); } catch {}
    throw new Error('Google revogou o vínculo. Conecte de novo (Importar).');
  }
  const j = await r.json();
  t.access = j.access_token;
  t.accessExp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  tokens.set(userId, t);
  return t.access;
}

// Access válido garantido (renova sozinho via refresh quando precisa).
export async function ensureAccess(userId, source) {
  const t = tokens.get(userId) || restoreLink(userId);
  if (!t || (!t.access && !t.refresh)) throw new Error('Sem vínculo Google. Conecte de novo.');
  if (!t.scopes.includes(NEED[source])) throw new Error(`Permissão ${source} não concedida.`);
  if (Date.now() < t.accessExp - 60000) return t.access;
  return refreshAccess(userId, t);
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
async function pickerFetch(token, apiPath, opts = {}) {
  const r = await fetch(`${PICKER}${apiPath}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 401) throw new Error('Google expirou a sessão. Conecte de novo.');
  if (r.status === 403) throw new Error('Ative a "Google Photos Picker API" no projeto DriveSpotify (Cloud Console → APIs).');
  if (!r.ok) {
    try { fs.appendFileSync(path.join(process.cwd(), 'data', 'picker-debug.log'), `${new Date().toISOString()} GOOGLE ${r.status} em ${apiPath}\n`); } catch {}
  }
  if (r.status === 404) throw new Error('Google Fotos 404. Tente de novo.');
  if (!r.ok) throw new Error(`Google Fotos ${r.status}. Tente de novo.`);
  return r.json();
}

export async function createPickerSession(userId) {
  const token = await ensureAccess(userId, 'photos');
  const j = await pickerFetch(token, '/sessions', { method: 'POST', body: '{}' });
  if (!j.id || !j.pickerUri) throw new Error('Google não abriu a sessão de escolha.');
  try { fs.appendFileSync(path.join(process.cwd(), 'data', 'picker-debug.log'), `${new Date().toISOString()} criada sid=${j.id} user=${userId} exp=${j.expireTime || j.expiry || '?'} raw=${JSON.stringify(j).slice(0, 300)}\n`); } catch {}
  return { sessionId: j.id, pickerUri: j.pickerUri };
}

export async function pickerSessionStatus(userId, sessionId) {
  const token = await ensureAccess(userId, 'photos');
  const id = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) throw new Error('Sessão inválida.');
  const j = await pickerFetch(token, `/sessions/${id}`);
  try { fs.appendFileSync(path.join(process.cwd(), 'data', 'picker-debug.log'), `${new Date().toISOString()} status sid=${id} ready=${!!j.mediaItemsSet}\n`); } catch {}
  return { ready: !!j.mediaItemsSet, mediaItemsSet: !!j.mediaItemsSet };
}

async function listPickerItems(token, sessionId) {
  const out = [];
  let page = '';
  for (let i = 0; i < 100; i++) {
    // Doc oficial: GET /v1/mediaItems?sessionId=… (não é subcaminho de sessions).
    const j = await pickerFetch(token, `/mediaItems?sessionId=${encodeURIComponent(sessionId)}&pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
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
  // fetch nativo (Node 18+): body é web stream (sem .on/.pipe) — for await vale p/ ambos.
  let bytes = 0;
  const out = fs.createWriteStream(dest);
  await new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
    (async () => {
      try {
        for await (const d of r.body) {
          bytes += d.length;
          if (bytes > maxBytes) throw new Error('Arquivo excede o limite.');
          if (!out.write(d)) await new Promise((res2) => out.once('drain', res2));
        }
        out.end();
      } catch (e) { try { out.destroy(e); } catch {} reject(e); }
    })();
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
    const token = await ensureAccess(userId, source);
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
        // Token fresco por arquivo: job de horas renova sozinho via refresh.
        const tk = await ensureAccess(userId, source);
        const url = source === 'drive'
          ? `https://www.googleapis.com/drive/v3/files/${it.id}?alt=media`
          : `${it.baseUrl}=d`;
        await downloadTo(tk, url, tmp, MAX);
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

export async function startImport(userId, source, quotaMB) {
  // Drive puxa tudo sozinho; Fotos vai pelo Picker (startPickerImport).
  if (source !== 'drive') throw new Error('Fotos: escolha na janela do Google primeiro.');
  await ensureAccess(userId, source); // falha rápido: sem vínculo/escopo, nem cria o job
  const job = newJob(userId, source, quotaMB);
  runJob(job).catch(() => {});
  return { id: job.id };
}

// Fotos (Picker): baixa a SELEÇÃO de uma sessão já concluída no Google.
export async function startPickerImport(userId, sessionId, quotaMB) {
  const token = await ensureAccess(userId, 'photos');
  const id = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) throw new Error('Sessão inválida.');
  const st = await pickerFetch(token, `/sessions/${id}`);
  if (!st.mediaItemsSet) throw new Error('Escolha as fotos na aba do Google e clique Concluir primeiro.');
  const items = await listPickerItems(token, id);
  try { fs.appendFileSync(path.join(process.cwd(), 'data', 'picker-debug.log'), `${new Date().toISOString()} start sid=${id} items=${items.length}\n`); } catch {}
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
