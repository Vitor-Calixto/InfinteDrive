import { readCollection, upsertRow, deleteRow } from '../config/store.js';
// Busca full-text honesta (não "IA"): normaliza acentos/caixa, exige TODOS
// os termos (AND) e ranqueia nome > tipo/duração > corpo do PDF.
// Índice corporal só de PDF em search-index.json; nome/tipo/duração pontuam
// direto do meta (sempre frescos). Dono isolado: só pesquisa o próprio.
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

export function indexPdfBody(fileId, ownerId, text) {
  const clean = norm(text).replace(/\s+/g, ' ').slice(0, 20000);
  if (!clean.trim()) return;
  upsertRow('search-index', { id: fileId, ownerId, text: clean });
}

export function dropIndex(fileId) {
  try { deleteRow('search-index', fileId); } catch {}
}

// Extrai texto de 1 PDF (pdf-parse v2: classe PDFParse). Retorna '' se falhar.
export async function extractPdfText(absPath) {
  try {
    const fs = (await import('node:fs')).default;
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: fs.readFileSync(absPath) });
    const out = await parser.getText();
    const txt = out?.text || out?.pages?.map((p) => p.text).join('\n') || '';
    try { await parser.destroy(); } catch {}
    return txt.slice(0, 60000);
  } catch {
    return '';
  }
}

// Backfill: indexa PDFs antigos já marcados como comprimidos (1x por boot,
// no máximo 20, sem travar a subida).
export async function backfillPdfIndex() {
  try {
    const { blobPath } = await import('./fileGuard.js');
    const metas = readCollection('storage').filter((m) =>
      m.mime === 'application/pdf' && !m.textIndexed && (m.sizeOrig || 0) <= 100 * 1024 * 1024);
    const have = new Set(readCollection('search-index').map((r) => r.id));
    let n = 0;
    for (const m of metas) {
      if (n >= 20 || have.has(m.id)) continue;
      try {
        indexPdfBody(m.id, m.ownerId, await extractPdfText(blobPath(m.ownerId, m.id)));
        m.textIndexed = true;
        upsertRow('storage', m);
        n++;
      } catch {}
    }
    if (n) console.log(`[busca] ${n} PDF(s) indexados no backfill.`);
  } catch {}
}

export function searchFiles({ ownerId, isAdmin, all = false, q = '', limit = 50 }) {
  const terms = norm(q).split(/\s+/).filter((t) => t.length >= 2);
  if (!terms.length) return [];
  const metas = readCollection('storage').filter((m) =>
    !m.trashedAt && (all && isAdmin ? true : m.ownerId === ownerId));
  const bodies = new Map(readCollection('search-index').map((r) => [r.id, r.text || '']));
  const out = [];
  for (const m of metas) {
    const nameN = norm(m.name);
    const kindN = norm(kindLabel(m.mime));
    const durN = m.duration ? `${Math.floor(m.duration / 60)}min ${m.duration}s ${m.duration}` : '';
    const body = bodies.get(m.id) || '';
    let score = 0;
    let okAll = true;
    for (const t of terms) {
      let s = 0;
      if (nameN.includes(t)) s += 10;
      if (kindN.includes(t) || (durN && durN.includes(t))) s += 3;
      if (body.includes(t)) s += 1;
      if (!s) { okAll = false; break; }
      score += s;
    }
    if (!okAll) continue;
    if (m.compressed === false) score -= 0.5; // pronto primeiro
    let snippet = '';
    const bt = terms.map((t) => body.indexOf(t)).find((i) => i >= 0);
    if (bt !== undefined && bt >= 0) {
      snippet = body.slice(Math.max(0, bt - 50), bt + 80).trim();
    }
    const { sha256, ...pub } = m;
    out.push({ ...pub, snippet, _score: score });
  }
  return out.sort((a, b) => b._score - a._score).slice(0, limit).map(({ _score, ...r }) => r);
}

function kindLabel(mime = '') {
  if (mime.startsWith('image/')) return 'foto imagem picture';
  if (mime.startsWith('audio/')) return 'musica audio song';
  if (mime.startsWith('video/')) return 'video filme';
  if (mime.includes('pdf')) return 'pdf documento';
  return 'arquivo';
}
