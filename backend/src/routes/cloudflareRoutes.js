import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { readCollection, upsertRow, deleteRow } from '../config/store.js';
import { encryptSecret, decryptSecret } from '../config/crypto.js';
import { cloudflareService } from '../services/cloudflareService.js';
import { requireAuth, requireDev, authLimiter } from '../middlewares/auth.js';

const r = Router();
r.use(requireAuth, requireDev);

function creds() {
  const row = readCollection('cloudflare')[0];
  if (!row) throw new Error('Sem token Cloudflare. Salve primeiro.');
  return { id: row.id, label: row.label, token: decryptSecret(row.tokenEnc) };
}

r.get('/', (req, res) => {
  res.json(readCollection('cloudflare').map(({ tokenEnc, ...rest }) => rest));
});

r.post('/', authLimiter, (req, res) => {
  const { label, token } = req.body || {};
  if (!token || String(token).length < 20) return res.status(400).json({ error: 'Token inválido.' });
  const row = {
    id: req.body.id || randomUUID(),
    label: String(label || 'cloudflare').slice(0, 60).replace(/[<>"']/g, ''),
    tokenEnc: encryptSecret(String(token)),
    updatedAt: new Date().toISOString(),
  };
  upsertRow('cloudflare', row);
  res.json({ id: row.id, label: row.label });
});

r.delete('/:id', (req, res) => { deleteRow('cloudflare', req.params.id); res.json({ ok: true }); });

r.get('/zones', async (req, res) => {
  try { res.json(await cloudflareService.listZones(creds().token)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

r.get('/zones/:zone/dns', async (req, res) => {
  try { res.json(await cloudflareService.listDns(creds().token, req.params.zone)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

r.post('/zones/:zone/dns', authLimiter, async (req, res) => {
  try {
    const { type, name, content, proxied } = req.body || {};
    res.json(await cloudflareService.createDns(creds().token, req.params.zone, { type, name, content, proxied }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

r.delete('/zones/:zone/dns/:id', async (req, res) => {
  try { res.json(await cloudflareService.deleteDns(creds().token, req.params.zone, req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

r.post('/zones/:zone/purge', authLimiter, async (req, res) => {
  try { res.json(await cloudflareService.purgeCache(creds().token, req.params.zone)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

export default r;
