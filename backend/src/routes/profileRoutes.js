import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { readCollection, upsertRow, deleteRow } from '../config/store.js';
import { requireAuth } from '../middlewares/auth.js';

// Perfis estilo Netflix dentro de UMA conta: quota e arquivos são da conta,
// cada perfil tem nome + PIN opcional + suas playlists. Trocar de perfil não
// desloga; perfil com PIN pede o código na hora de abrir.
const r = Router();
r.use(requireAuth);

const mine = (req) => readCollection('profiles').filter((p) => p.ownerId === req.user.id);
const pub = (p) => ({ id: p.id, name: p.name, locked: !!p.pinHash, createdAt: p.createdAt });

r.get('/', (req, res) => res.json(mine(req).map(pub)));

r.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 30).replace(/[<>"']/g, '');
  if (!name) return res.status(400).json({ error: 'Dê um nome ao perfil.' });
  if (mine(req).length >= 8) return res.status(400).json({ error: 'Limite de 8 perfis.' });
  if (mine(req).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'Já existe perfil com esse nome.' });
  }
  const pin = String(req.body?.pin || '');
  if (pin && !/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'PIN: 4 a 8 dígitos.' });
  const row = {
    id: randomUUID(), ownerId: req.user.id, name,
    pinHash: pin ? bcrypt.hashSync(pin, 10) : '',
    createdAt: new Date().toISOString(),
  };
  upsertRow('profiles', row);
  return res.json(pub(row));
});

// POST /api/profiles/:id/unlock { pin } — valida o PIN (perfil sem PIN abre direto).
r.post('/:id/unlock', (req, res) => {
  const p = mine(req).find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado.' });
  if (!p.pinHash) return res.json({ ok: true });
  const ok = bcrypt.compareSync(String(req.body?.pin || ''), p.pinHash);
  if (!ok) return res.status(401).json({ error: 'PIN incorreto.' });
  return res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  const p = mine(req).find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado.' });
  // Playlists do perfil voltam pra conta (profileId=null), arquivos intactos.
  for (const pl of readCollection('playlists').filter((x) => x.profileId === p.id && x.ownerId === req.user.id)) {
    pl.profileId = null;
    upsertRow('playlists', pl);
  }
  deleteRow('profiles', p.id);
  return res.json({ ok: true });
});

export default r;
