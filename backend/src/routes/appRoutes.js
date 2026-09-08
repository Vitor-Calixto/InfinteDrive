import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readCollection, upsertRow, deleteRow } from '../config/store.js';
import { detectStack } from '../services/detectorService.js';
import { buildDeployScript } from '../services/deployService.js';
import { detectLimiter, fileLimiter } from '../middlewares/auth.js';
import { createSecureUpload } from '../middlewares/upload.js';
import { inspectZip } from '../middlewares/zipcheck.js';
import { assertGithubUrl, assertPort, assertDomain, sanitizeLabel } from '../middlewares/validate.js';

const r = Router();
const zipUpload = createSecureUpload({ maxBytes: 500 * 1024 * 1024 });
const ZIP_DIR = path.join(process.cwd(), 'data', 'tmp-zip');
if (!fs.existsSync(ZIP_DIR)) fs.mkdirSync(ZIP_DIR, { recursive: true });

// POST /api/apps/upload-zip (campo "file"): recebe o .zip da máquina,
// valida entradas e devolve { zipId } para usar no deploy.
r.post('/upload-zip', fileLimiter, zipUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo.' });
    if (!/\.zip$/i.test(req.file.originalname || '')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Envie um arquivo .zip.' });
    }
    const info = await inspectZip(req.file.path);
    const zipId = randomUUID();
    fs.renameSync(req.file.path, path.join(ZIP_DIR, `${zipId}.zip`));
    return res.json({ zipId, ...info });
  } catch (e) {
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: e.message });
  }
});

r.get('/', (req, res) => res.json(readCollection('apps')));
r.post('/', (req, res) => {
  try {
    const { name, githubUrl, domain, port, envVars, flags, dbProvider, serverId } = req.body;
    const source = req.body.source === 'upload' ? 'upload' : 'github';
    if (!name) return res.status(400).json({ error: 'Informe o nome.' });
    if (source === 'github' && !githubUrl) return res.status(400).json({ error: 'Informe githubUrl ou mude a fonte para .zip.' });
    const row = { id: req.body.id || randomUUID(), name: sanitizeLabel(name), source, githubUrl: source === 'github' ? assertGithubUrl(githubUrl) : '', domain: assertDomain(domain), port: assertPort(port), envVars: String(envVars || '').slice(0, 20000), flags: flags || {}, dbProvider: dbProvider || 'none', serverId: serverId || '', updatedAt: new Date().toISOString() };
    upsertRow('apps', row);
    res.json(row);
  } catch (e) { return res.status(400).json({ error: e.message }); }
});
r.delete('/:id', (req, res) => { deleteRow('apps', req.params.id); res.json({ ok: true }); });

// Detecção automática: GET /api/apps/detect?url=https://github.com/...
r.get('/detect', detectLimiter, async (req, res) => {
  try { res.json(await detectStack(req.query.url)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Pré-visualiza o script que o botão vai rodar na VPS
r.post('/preview', (req, res) => {
  try {
    const body = { ...req.body };
    if (body.githubUrl) body.githubUrl = assertGithubUrl(body.githubUrl);
    if (body.port !== undefined) body.port = assertPort(body.port);
    if (body.domain !== undefined) body.domain = assertDomain(body.domain);
    res.json(buildDeployScript(body));
  }
  catch (e) { res.status(400).json({ error: e.message }); }
});

export default r;
