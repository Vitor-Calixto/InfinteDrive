import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { searchFiles } from '../services/searchService.js';
import { isVaultLocked } from '../services/vault.js';

const r = Router();
r.use(requireAuth);

// GET /api/search?q=termos — full-text nos MEUS arquivos.
// (admin com ?all=1 pesquisa tudo, auditado como no storage.)
r.get('/', (req, res) => {
  const q = String(req.query.q || '').slice(0, 120);
  if (q.trim().length < 2) return res.json([]);
  const res2 = searchFiles({
    ownerId: req.user.id,
    isAdmin: req.user.role === 'admin',
    all: req.query.all === '1',
    q,
  });
  // Cofre trancado não aparece nem na busca (só admin passa).
  if (req.user.role === 'admin') return res.json(res2);
  return res.json(res2.filter((m) => !m.vaultId || !isVaultLocked(m.ownerId, m.vaultId)));
});

export default r;
