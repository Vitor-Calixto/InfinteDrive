import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { readCollection, upsertRow, deleteRow } from '../config/store.js';
import { encryptSecret, decryptSecret } from '../config/crypto.js';
import { testConnection, collectStats } from '../services/sshService.js';
import { authLimiter } from '../middlewares/auth.js';
import { sanitizeLabel } from '../middlewares/validate.js';

const r = Router();

export function getServerDecrypted(id) {
  const row = readCollection('servers').find((s) => s.id === id) || readCollection('servers')[0];
  if (!row) throw new Error('Nenhum servidor SSH cadastrado.');
  return {
    ...row,
    password: row.passwordEnc ? decryptSecret(row.passwordEnc) : undefined,
    privateKey: row.privateKeyEnc ? decryptSecret(row.privateKeyEnc) : undefined,
  };
}

r.get('/', (req, res) => {
  res.json(readCollection('servers').map(({ passwordEnc, privateKeyEnc, ...rest }) => rest));
});

r.post('/', authLimiter, (req, res) => {
  try {
    const { label, host, port, username, password, privateKey } = req.body;
    const cleanHost = String(host || '').trim().slice(0, 253);
    const cleanUser = String(username || '').trim().slice(0, 64);
    if (!cleanHost || !cleanUser) return res.status(400).json({ error: 'Preencha host e username.' });
    if (/[\r\n'"`;|&`$()\\]/.test(cleanHost + cleanUser)) return res.status(400).json({ error: 'Host/usuário com caracteres inválidos.' });
    const cleanPort = Number(port) || 22;
    if (!Number.isInteger(cleanPort) || cleanPort < 1 || cleanPort > 65535) return res.status(400).json({ error: 'Porta SSH inválida.' });
    if (!password && !privateKey) return res.status(400).json({ error: 'Informe senha OU chave privada.' });
    if (String(password || '').length > 500 || String(privateKey || '').length > 20000) return res.status(400).json({ error: 'Credencial longa demais.' });
    const row = {
      id: req.body.id || randomUUID(), label: sanitizeLabel(label || cleanHost, cleanHost), host: cleanHost, port: cleanPort, username: cleanUser,
      passwordEnc: password ? encryptSecret(password) : '', privateKeyEnc: privateKey ? encryptSecret(privateKey) : '',
      updatedAt: new Date().toISOString(),
    };
    upsertRow('servers', row);
    const { passwordEnc, privateKeyEnc, ...pub } = row;
    res.json(pub);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

r.delete('/:id', (req, res) => { deleteRow('servers', req.params.id); res.json({ ok: true }); });

r.post('/:id/test', authLimiter, async (req, res) => {
  try {
    const srv = getServerDecrypted(req.params.id);
    const out = await testConnection(srv);
    res.json({ ok: true, out });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

r.get('/:id/stats', async (req, res) => {
  try {
    const srv = getServerDecrypted(req.params.id);
    const raw = await collectStats(srv);
    res.json({ ok: true, raw });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

export default r;
