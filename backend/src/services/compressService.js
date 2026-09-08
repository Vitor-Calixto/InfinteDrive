import fs from 'node:fs';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import * as mm from 'music-metadata';
import { spawn } from 'node:child_process';
import { readCollection, writeCollection, upsertRow, pushRow } from '../config/store.js';
import { userRoot, getFileMeta, appendAudit } from './fileGuard.js';
import { indexPdfBody, backfillPdfIndex } from './searchService.js';
import { safeJoin } from '../middlewares/validate.js';

// Fila local (offline) de compressão: upload responde rápido, worker
// comprime em background 1 por vez para não matar a CPU da VPS.
// Imagem: sharp. Áudio/vídeo: ffmpeg-static (binário local, sem download).
// v2: tier Drive para gigantes + HLS.
let active = 0; // workers simultâneos no pool (ver processQueue)
let kickTimer = null;

export function enqueueCompression(fileId) {
  try {
    const meta = getFileMeta(fileId);
    if (!meta || meta.compressed) return;
    pushRow('queue', { fileId, attempts: 0, enqueuedAt: new Date().toISOString() }, 'fileId');
    kick();
  } catch { /* fila nunca quebra o upload */ }
}

export function kick() {
  if (kickTimer) return;
  kickTimer = setTimeout(() => { kickTimer = null; processQueue().catch(() => {}); }, 2000);
}

function thumbPath(ownerId, fileId) {
  return safeJoin(userRoot(ownerId), `${String(fileId)}-thumb.webp`);
}

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegStatic, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} reject(new Error('ffmpeg timeout')); }, timeoutMs);
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 4000) err = err.slice(-4000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(true) : reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`)); });
  });
}

function pcmPeaks(pcm, count = 100) {
  const total = Math.floor(pcm.length / 2);
  const per = Math.max(1, Math.floor(total / count));
  const peaks = [];
  for (let i = 0; i < count; i++) {
    let max = 0;
    const start = i * per;
    for (let j = start; j < Math.min(start + per, total); j += 7) {
      const v = Math.abs(pcm.readInt16LE(j * 2)) / 32768;
      if (v > max) max = v;
    }
    peaks.push(Math.round(max * 100));
  }
  return peaks;
}

function ffmpegPcm(abs, seconds = 600) {
  // Decodifica trecho para PCM mono 8k e devolve o buffer (cap ~10MB).
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegStatic, ['-v', 'error', '-t', String(seconds), '-i', abs, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 120000);
    p.stdout.on('data', (d) => { chunks.push(d); size += d.length; if (size > 12 * 1024 * 1024) { try { p.kill('SIGKILL'); } catch {} } });
    p.stderr.on('data', () => {});
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', () => { clearTimeout(t); resolve(Buffer.concat(chunks)); });
  });
}

async function compressAudio(abs, meta) {
  // Sem ler o arquivo inteiro na RAM: metadados via stream, transcode por path.
  const origLen = fs.existsSync(abs) ? fs.statSync(abs).size : (meta.sizeOrig || 0);
  try {
    const info = await mm.parseFile(abs, { duration: true });
    if (info.format.duration) meta.duration = Math.round(info.format.duration);
    const pic = info.common.picture?.[0];
    if (pic?.data?.length) {
      const thumb = await sharp(pic.data).resize(300, 300, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 60 }).toBuffer();
      fs.writeFileSync(thumbPath(meta.ownerId, meta.id), thumb);
      meta.thumb = true; // capa do álbum real
    }
  } catch { /* metadados opcionais */ }
  const out = `${abs}.opus`;
  try {
    await runFfmpeg(['-v', 'error', '-y', '-i', abs, '-map_metadata', '-1', '-vn', '-c:a', 'libopus', '-b:a', '96k', out], 600000);
    const nb = fs.statSync(out).size;
    if (nb < origLen) {
      fs.renameSync(out, abs);
      meta.mime = 'audio/ogg';
      meta.sizeFinal = nb;
    } else {
      fs.unlinkSync(out);
      meta.sizeFinal = origLen;
      meta.note = 'áudio-já-otimizado';
    }
  } catch (e) {
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch {}
    meta.sizeFinal = origLen;
    meta.note = 'áudio-sem-transcode';
  }
  try {
    const pcm = await ffmpegPcm(abs);
    if (pcm.length > 1000) meta.waveform = pcmPeaks(pcm);
  } catch { /* waveform opcional */ }
  meta.compressed = true;
  return { saved: origLen - meta.sizeFinal };
}

function runFfmpegProgress(args, timeoutMs, totalSec, onPct) {
  // Mesmo que runFfmpeg, mas reporta % via -progress (pra barra do usuário).
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegStatic, ['-progress', 'pipe:1', '-nostats', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let last = 0;
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} reject(new Error('ffmpeg timeout')); }, timeoutMs);
    p.stdout.on('data', (d) => {
      const m = /out_time_ms=(\d+)/.exec(d.toString());
      if (m && totalSec > 0) {
        const pct = Math.min(99, Math.round((Number(m[1]) / 1e6 / totalSec) * 100));
        if (pct - last >= 5) { last = pct; try { onPct(pct); } catch {} }
      }
    });
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 4000) err = err.slice(-4000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(true) : reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`)); });
  });
}

async function compressVideo(abs, meta) {
  try {
    const info = await mm.parseFile(abs, { duration: true });
    if (info.format.duration) meta.duration = Math.round(info.format.duration);
  } catch { /* duração opcional */ }
  const dir = userRoot(meta.ownerId);
  // Terminal .mp4 de propósito: ffmpeg detecta o formato pela extensão.
  const out = safeJoin(dir, `${meta.id}.new.mp4`);
  const frame = safeJoin(dir, `${meta.id}.frame.png`);
  // 1º thumb (segundos): capa aparece antes do transcode terminar.
  try {
    await runFfmpeg(['-v', 'error', '-y', '-ss', '1', '-i', abs, '-vframes', '1', frame], 120000);
    const thumb = await sharp(fs.readFileSync(frame)).resize(300, 300, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 60 }).toBuffer();
    fs.writeFileSync(thumbPath(meta.ownerId, meta.id), thumb);
    meta.thumb = true;
    upsertRow('storage', meta);
  } catch { /* thumb opcional */ }
  finally { try { if (fs.existsSync(frame)) fs.unlinkSync(frame); } catch {} }
  // 2º transcode: gigante (>500MB) usa ultrafast — metade do tempo,
  // ~10% maior que veryfast. Vale pra 1.7GB não levar uma noite.
  const big = (meta.sizeOrig || 0) > 500 * 1024 * 1024;
  const preset = big ? 'ultrafast' : 'veryfast';
  try {
    // Teto 720p/30fps + strip de metadados (GPS etc). Sem slow/AV1.
    const bump = (pct) => { meta.progress = pct; upsertRow('storage', meta); };
    await runFfmpegProgress(['-v', 'error', '-y', '-i', abs, '-map_metadata', '-1', '-vf', "scale='min(iw,1280)':-2", '-r', '30', '-c:v', 'libx264', '-crf', '28', '-preset', preset, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], 3600000, meta.duration || 0, bump);
    delete meta.progress;
    const nb = fs.statSync(out).size;
    const origLen = fs.statSync(abs).size;
    if (nb < origLen) {
      fs.renameSync(out, abs);
      meta.mime = 'video/mp4';
      meta.sizeFinal = nb;
    } else {
      fs.unlinkSync(out);
      meta.sizeFinal = origLen;
      meta.note = 'vídeo-já-otimizado';
    }
  } catch (e) {
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch {}
    meta.sizeFinal = fs.existsSync(abs) ? fs.statSync(abs).size : meta.sizeOrig;
    meta.note = `vídeo-sem-transcode: ${String(e.message || e).slice(0, 150)}`;
    delete meta.progress;
  }
  meta.compressed = true;
  return { saved: (meta.sizeOrig || 0) - (meta.sizeFinal || 0) };
}

async function compressImage(abs, meta) {
  // Lê 1x para buffer e NUNCA passa path ao sharp: o libvips mantém o
  // arquivo mapeado até o GC e o Windows nega write-back no mesmo path.
  const orig = fs.readFileSync(abs);
  const isGif = (meta.mime || '').includes('gif');
  // Thumb sempre (até de gif: primeiro frame).
  const thumb = await sharp(orig, { animated: false }).rotate()
    .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 60 })
    .toBuffer();
  fs.writeFileSync(thumbPath(meta.ownerId, meta.id), thumb);
  meta.thumb = true;
  if (isGif) {
    // Não recomprime gif animado (quebraria animação): só thumb.
    meta.sizeFinal = orig.length;
    meta.compressed = true;
    meta.note = 'gif: só thumb';
    return { saved: 0 };
  }
  const webp = await sharp(orig).rotate().webp({ quality: 70 }).toBuffer();
  if (webp.length >= orig.length) {
    meta.sizeFinal = orig.length;
    meta.compressed = true;
    meta.note = 'já-otimizada';
    return { saved: 0 };
  }
  // Troca atômica via tmp+rename (mesmo padrão do store.js): nunca
  // deixa blob pela metade se o processo cair no meio da escrita.
  const tmp = `${abs}.${process.pid}.new`;
  fs.writeFileSync(tmp, webp);
  fs.renameSync(tmp, abs);
  const saved = orig.length - webp.length;
  meta.mime = 'image/webp';
  meta.sizeFinal = webp.length;
  meta.compressed = true;
  return { saved };
}

async function processOne(job) {
  const meta = getFileMeta(job.fileId);
  if (!meta) return; // arquivo apagado: some da fila
  if (meta.compressed) return;
  const abs = safeJoin(userRoot(meta.ownerId), `${meta.id}.bin`);
  if (!fs.existsSync(abs)) {
    meta.compressed = true;
    meta.compressError = 'blob ausente';
    upsertRow('storage', meta);
    return;
  }
  const mime = meta.mime || '';
  if (mime.startsWith('image/')) {
    const { saved } = await compressImage(abs, meta);
    upsertRow('storage', meta);
    appendAudit({ userId: meta.ownerId, action: 'compress', fileId: meta.id, detail: `imagem ok, -${saved}B` });
    return;
  }
  if (mime.startsWith('audio/')) {
    const { saved } = await compressAudio(abs, meta);
    upsertRow('storage', meta);
    appendAudit({ userId: meta.ownerId, action: 'compress', fileId: meta.id, detail: `áudio ok, -${saved}B` });
    return;
  }
  if (mime.startsWith('video/')) {
    const { saved } = await compressVideo(abs, meta);
    upsertRow('storage', meta);
    appendAudit({ userId: meta.ownerId, action: 'compress', fileId: meta.id, detail: `vídeo ok, -${saved}B` });
    return;
  }
  // Sem compressor para este tipo: indexa PDF p/ busca e marca para
  // não reprocessar em loop, mantendo o blob cru servindo normalmente.
  if ((meta.mime || '') === 'application/pdf') {
    try {
      if ((meta.sizeOrig || 0) <= 100 * 1024 * 1024) {
        const { extractPdfText } = await import('./searchService.js');
        indexPdfBody(meta.id, meta.ownerId, await extractPdfText(abs));
        meta.textIndexed = true;
      }
    } catch { /* busca de PDF é opcional */ }
  }
  meta.compressed = true;
  meta.note = 'tipo-sem-compressor-v1';
  upsertRow('storage', meta);
}

export async function processQueue() {
  // Pool de workers (COMPRESS_WORKERS, padrão 2): ffmpeg escala com núcleo,
  // e fila anda em paralelo em vez de 1 por vez. Teto 4 por segurança.
  const W = Math.min(4, Math.max(1, Number(process.env.COMPRESS_WORKERS) || 2));
  if (active >= W) return;
  active++;
  try {
    for (;;) {
      const job = takeNext();
      if (!job) break;
      try {
        await processOne(job);
      } catch (e) {
        job.attempts = (job.attempts || 0) + 1;
        if (job.attempts < 3) {
          const q = readCollection('queue');
          q.push(job);
          writeCollection('queue', q);
        } else {
          const meta = getFileMeta(job.fileId);
          if (meta) {
            meta.compressed = true;
            meta.compressError = String(e.message || 'falha').slice(0, 300);
            upsertRow('storage', meta);
            console.error(`[compress] ${job.fileId}: ${e.stack || e.message}`);
          }
        }
      }
    }
  } finally {
    active--;
  }
}

// Pega o próximo job: síncrono e sem await no caminho = atômico entre os
// workers do pool (JS não intercala no meio), sem lockfile.
function takeNext() {
  const q = readCollection('queue');
  if (!q.length) return null;
  let bi = 0;
  let bs = Infinity;
  for (let i = 0; i < q.length; i++) {
    const m = getFileMeta(q[i].fileId);
    const s = m ? Number(m.sizeOrig) || 0 : 0;
    if (!m || s < bs) { bs = s; bi = i; if (!m) break; }
  }
  const [job] = q.splice(bi, 1);
  writeCollection('queue', q);
  return job;
}

export function startWorker(intervalMs = 15000) {
  const t = setInterval(() => processQueue().catch(() => {}), intervalMs);
  if (t.unref) t.unref();
  reconcileQueue();
  processQueue().catch(() => {});
  backfillPdfIndex().catch(() => {}); // PDFs antigos entram na busca sem reupload
  return () => clearInterval(t);
}

// Auto-cura de boot: restart no meio do transcode órfã o job (fila em
// memória esvazia, meta fica ⏳ pra sempre). Reenfileira o pendente.
function reconcileQueue() {
  try {
    const metas = readCollection('storage').filter((m) => !m.compressed);
    if (!metas.length) return;
    const q = readCollection('queue');
    const queued = new Set(q.map((j) => j.fileId));
    let n = 0;
    for (const m of metas) {
      if (queued.has(m.id)) continue;
      delete m.progress;
      upsertRow('storage', m);
      q.push({ fileId: m.id, attempts: 0, enqueuedAt: new Date().toISOString() });
      n++;
    }
    if (n) {
      writeCollection('queue', q);
      console.log(`[compress] ${n} órfão(s) reenfileirados.`);
    }
  } catch {}
}
