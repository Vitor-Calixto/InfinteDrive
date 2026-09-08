import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
// Quando rodar via src/server.js dentro de backend/, process.cwd() = backend/
function fileFor(name) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, `${name}.json`);
}

export function readCollection(name) {
  const file = fileFor(name);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  } catch {
    return [];
  }
}

export function writeCollection(name, rows) {
  // Escrita atômica: tmp + rename. Evita JSON corrompido se o processo cair
  // no meio do write (crítico para storage.json / credenciais).
  const file = fileFor(name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, file);
}

// Trava por coleção (lockfile): upload e worker escrevem storage.json ao
// mesmo tempo — sem isso, dois read-modify-write concorrentes perdem linhas
// (multiseleção chegando "só com 1 arquivo"). Espera curta, processo único.
const sleepSync = (ms) => { const t = Date.now() + ms; while (Date.now() < t) { /* fila anda em ms */ } };
function locked(name, fn) {
  const lock = path.join(DATA_DIR, `.lock-${name}`);
  const deadline = Date.now() + 10000;
  for (;;) {
    let fd = -1;
    try {
      fd = fs.openSync(lock, 'wx');
    } catch { fd = -1; }
    if (fd >= 0) {
      try { return fn(); }
      finally { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(lock); } catch {} }
    }
    if (Date.now() > deadline) throw new Error('Timeout de escrita. Tente de novo.');
    sleepSync(2);
  }
}

// Retry assíncrono p/ rajadas (153 uploads): se a trava estourar, espera
// 200ms e tenta de novo em vez de perder o arquivo.
export async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return fn(); }
    catch (e) {
      last = e;
      if (!/Timeout de escrita/.test(e.message || '') || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw last;
}

export function upsertRow(name, row) {
  return locked(name, () => {
    const rows = readCollection(name);
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    writeCollection(name, rows);
    return row;
  });
}

export function deleteRow(name, id) {
  locked(name, () => {
    writeCollection(name, readCollection(name).filter((r) => r.id !== id));
  });
}

// Push atômico sem duplicar (chave opcional): p/ filas sob concorrência.
export function pushRow(name, row, key) {
  return locked(name, () => {
    const rows = readCollection(name);
    if (key && rows.some((r) => r[key] === row[key])) return rows;
    rows.push(row);
    writeCollection(name, rows);
    return rows;
  });
}
