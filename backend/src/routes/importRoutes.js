import { Router } from 'express';
import { requireAuth, fileLimiter } from '../middlewares/auth.js';
import { linkToken, startImport, startPickerImport, createPickerSession, pickerSessionStatus, jobStatus } from '../services/importService.js';
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
r.post('/:source/start', (req, res) => {
  try {
    const quotaMB = Number(req.user.quotaMB) > 0 ? Number(req.user.quotaMB) : quotaFor(req.user.plan);
    return res.json(startImport(req.user.id, req.params.source, quotaMB));
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

r.get('/jobs/:id', (req, res) => {
  const j = jobStatus(req.user.id, req.user.role === 'admin', req.params.id);
  if (!j) return res.status(404).json({ error: 'Importação não encontrada.' });
  return res.json(j);
});

export default r;
