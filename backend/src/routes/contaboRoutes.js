import { Router } from 'express';
import { readCollection, upsertRow, deleteRow } from '../config/store.js';
import { encryptSecret, decryptSecret } from '../config/crypto.js';
import { contaboService } from '../services/contaboService.js';
import { authLimiter } from '../middlewares/auth.js';
import { sanitizeLabel } from '../middlewares/validate.js';
import { randomUUID } from 'node:crypto';

const r = Router();

// Conexão Contabo (uma só, já que é 1 VPS — mas suportamos várias salvas)
function withDecrypted(row) {
  return {
    clientId: row.clientId,
    clientSecret: decryptSecret(row.clientSecretEnc),
    apiUser: row.apiUser,
    apiPassword: decryptSecret(row.apiPasswordEnc),
  };
}

r.get('/', (req, res) => {
  const rows = readCollection('contabo').map(({ clientSecretEnc, apiPasswordEnc, ...rest }) => rest);
  res.json(rows);
});

r.post('/', authLimiter, (req, res) => {
  try {
    const { label, clientId, clientSecret, apiUser, apiPassword } = req.body;
    if (!clientId || !clientSecret || !apiUser || !apiPassword) return res.status(400).json({ error: 'Preencha clientId, clientSecret, apiUser e apiPassword (my.contabo.com > API).' });
    if (String(clientSecret).length > 500 || String(apiPassword).length > 500) return res.status(400).json({ error: 'Segredo longo demais.' });
    const row = { id: req.body.id || randomUUID(), label: sanitizeLabel(label || 'contabo-main', 'contabo-main'), clientId, apiUser, clientSecretEnc: encryptSecret(clientSecret), apiPasswordEnc: encryptSecret(apiPassword), createdAt: new Date().toISOString() };
    upsertRow('contabo', row);
    res.json({ id: row.id, label: row.label });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

r.delete('/:id', (req, res) => { deleteRow('contabo', req.params.id); res.json({ ok: true }); });

// --- Proxy de monitoramento (máximo de info possível via API oficial) ---
async function credsOf(req) {
  const row = readCollection('contabo').find((x) => x.id === (req.query.connId || req.body?.connId)) || readCollection('contabo')[0];
  if (!row) throw new Error('Nenhuma conexão Contabo cadastrada. Cadastre primeiro.');
  return withDecrypted(row);
}

r.get('/instances', async (req, res) => {
  try { res.json(await contaboService.listInstances(await credsOf(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.get('/instances/:id', async (req, res) => {
  try { res.json(await contaboService.getInstance(await credsOf(req), req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.post('/instances/:id/:action', authLimiter, async (req, res) => {
  try {
    const { id, action } = req.params;
    if (!['start', 'restart', 'stop', 'shutdown'].includes(action)) return res.status(400).json({ error: 'action inválida' });
    res.json(await contaboService.instanceAction(await credsOf(req), id, action));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
r.get('/audits', async (req, res) => {
  try { res.json(await contaboService.listAudits(await credsOf(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.get('/snapshots', async (req, res) => {
  try { res.json(await contaboService.listSnapshots(await credsOf(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
r.get('/images', async (req, res) => {
  try { res.json(await contaboService.listImages(await credsOf(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

export default r;
