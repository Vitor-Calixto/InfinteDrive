import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth, fileLimiter } from '../middlewares/auth.js';
import { linkToken, startImport, startPickerImport, createPickerSession, pickerSessionStatus, jobStatus, ensureAccess } from '../services/importService.js';
import { quotaFor } from '../config/users.js';

const r = Router();
r.use(requireAuth, fileLimiter);

// POST /api/import/link { accessToken } — token com escopo pedido no front.
// Validado (audiência + escopos), guardado só em memória por ~50min.
r.post('/link', async (req, res) => {
  try {
    const t = String(req.body?.accessToken || '');
    if (!t) return res.status(400).json({ error: 'Token ausente.' });
    return res.json(await linkToken(req.user.id, t));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// POST /api/import/drive/start — Drive puxa tudo sozinho (background).
r.post('/:source/start', async (req, res) => {
  try {
    const quotaMB = Number(req.user.quotaMB) > 0 ? Number(req.user.quotaMB) : quotaFor(req.user.plan);
    return res.json(await startImport(req.user.id, req.params.source, quotaMB));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// ---- Google Fotos (Picker): escolha numa aba do Google, download aqui.
// POST /api/import/photos/session -> { sessionId, pickerUri }
r.post('/photos/session', async (req, res) => {
  try {
    return res.json(await createPickerSession(req.user.id));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// GET /api/import/photos/session/:id -> { ready } (concluiu no Google?)
r.get('/photos/session/:id', async (req, res) => {
  try {
    return res.json(await pickerSessionStatus(req.user.id, req.params.id));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// POST /api/import/photos/session/:id/start -> { id } (job da seleção)
r.post('/photos/session/:id/start', async (req, res) => {
  try {
    const quotaMB = Number(req.user.quotaMB) > 0 ? Number(req.user.quotaMB) : quotaFor(req.user.plan);
    return res.json(await startPickerImport(req.user.id, req.params.id, quotaMB));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// GET /api/import/status -> { drive, photos } (vínculo válido agora?)
r.get('/status', async (req, res) => {
  const out = { drive: false, photos: false };
  try { await ensureAccess(req.user.id, 'drive'); out.drive = true; } catch {}
  try { await ensureAccess(req.user.id, 'photos'); out.photos = true; } catch {}
  return res.json(out);
});

// POST /api/import/picklog { ev } — rastro do front p/ diagnosticar o Picker.
r.post('/picklog', (req, res) => {
  try {
    fs.appendFileSync(path.join(process.cwd(), 'data', 'picker-debug.log'), `${new Date().toISOString()} FRONT ${String(req.body?.ev || '').slice(0, 160)}\n`);
  } catch {}
  return res.json({ ok: true });
});

r.get('/jobs/:id', (req, res) => {
  const j = jobStatus(req.user.id, req.user.role === 'admin', req.params.id);
  if (!j) return res.status(404).json({ error: 'Importação não encontrada.' });
  return res.json(j);
});

export default r;
