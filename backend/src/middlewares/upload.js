import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Upload genérico do Drive: aceita qualquer mídia. Executáveis (.exe/.msi)
// só passam com ALLOW_EXECUTABLES=true — e mesmo assim nunca ganham nome
// executável em disco (uuid + .bin) e nunca são executados: só download.
// Scripts (.bat/.sh/.ps1) continuam sempre bloqueados.
const ALWAYS_BLOCKED_EXT = new Set([
  '.bat', '.cmd', '.com', '.scr', '.pif',
  '.sh', '.ps1', '.jar', '.apk',
]);
const OPT_IN_EXT = new Set(['.exe', '.msi']);

const BLOCKED_MIME_PREFIX = ['application/x-sh'];

export function executablesAllowed() {
  return process.env.ALLOW_EXECUTABLES === 'true';
}

// Mesma regra do fileFilter, reutilizável onde o nome real só aparece
// depois (upload fatiado: as partes chegam sem extensão).
export function assertExtensionAllowed(originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (ALWAYS_BLOCKED_EXT.has(ext)) throw new Error(`Extensão bloqueada: ${ext}`);
  if (OPT_IN_EXT.has(ext) && !executablesAllowed()) {
    throw new Error(`Executáveis bloqueados. Ative ALLOW_EXECUTABLES=true no .env para guardar instaladores.`);
  }
}

export function createSecureUpload({ tmpDir, maxBytes = 500 * 1024 * 1024 } = {}) {
  const dir = tmpDir || path.join(process.cwd(), 'data', 'tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    // uuid puro, sem extensão do usuário: a extensão real é resolvida após
    // checagem MIME + compressão (sharp/ffmpeg) no storageService.
    filename: (req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}.tmp`),
  });
  return multer({
    storage,
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      try {
        assertExtensionAllowed(file.originalname);
      } catch (e) { return cb(e); }
      if (BLOCKED_MIME_PREFIX.some((p) => (file.mimetype || '').startsWith(p))) {
        return cb(new Error(`MIME bloqueado: ${file.mimetype}`));
      }
      cb(null, true);
    },
  });
}
