import rateLimit from 'express-rate-limit';
import { verifyToken, findById } from '../config/users.js';

// Token mestre de recuperação (env). Login do dia a dia é JWT (offline).
function masterToken(req) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return null;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const query = typeof req.query?.token === 'string' ? req.query.token : '';
  const got = bearer || query;
  return got && got === expected ? true : null;
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ') && header.slice(7) !== (process.env.ADMIN_TOKEN || '')) return header.slice(7);
  const query = typeof req.query?.token === 'string' ? req.query.token : '';
  if (query && query !== (process.env.ADMIN_TOKEN || '')) return query;
  return '';
}

// Guarda principal da API: master OU JWT válido.
// Aceita Authorization: Bearer <jwt> OU ?token=<jwt> (EventSource, WS,
// <audio>/<video>/<img> não enviam headers). Sem credencial -> 401 genérico.
export function requireAuth(req, res, next) {
  if (masterToken(req)) {
    req.user = { id: 'master', name: 'master', email: '', role: 'admin', dev: true, via: 'master-token' };
    return next();
  }
  const t = extractToken(req);
  if (!t) return res.status(401).json({ error: 'Não autorizado.' });
  try {
    const u = verifyToken(t);
    if (!u) return res.status(401).json({ error: 'Não autorizado.' });
    const fresh = findById(u.id);
    if (!fresh) return res.status(401).json({ error: 'Não autorizado.' });
    req.user = { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role, quotaMB: fresh.quotaMB, dev: !!fresh.dev, via: 'jwt' };
    return next();
  } catch {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
}

// Modo programador: deploy/infra só p/ quem ligou (ou admin/master).
export function requireDev(req, res, next) {
  if (req.user?.role === 'admin' || req.user?.dev) return next();
  return res.status(403).json({ error: 'Ative o modo programador no perfil.' });
}

// Compat: rotas antigas que usavam o token mestre. Hoje é alias do requireAuth.
export function requireAdminToken(req, res, next) {
  return requireAuth(req, res, next);
}

// Global folgado; endpoints sensíveis têm o próprio limiter abaixo.
// Pula mídia (download/thumb) e health: o player dispara dezenas de ranges
// e o monitor pinga de 5 em 5s — nenhum dos dois é abuso.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => /\/storage\/(download|thumb)\//.test(req.path || '') || req.path === '/api/health',
});

// Mídia tem limite próprio generoso (só anti-abuso bruto; auth+quota protegem).
export const mediaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas faixas de mídia, aguarde 15 min.' },
});

// Login: alvo nº1 de força bruta (padrão Gym: 10/15min).
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas, tente em 15 min.' },
});

// Salvar credenciais Contabo/SSH e testar conexão: alvo de força bruta.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas, tente em 15 min.' },
});

// GitHub detect: evita estourar rate-limit da API pública.
export const detectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas detecções, aguarde 1 min.' },
});

// Deploy dispara SSH na VPS: caro, limita por IP.
export const deployLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitos deploys, aguarde 5 min.' },
});

// Upload/download de arquivos: folgado p/ lote (105 fotos de uma vez).
// Abuso contido por auth + quota por usuário, não por contagem.
export const fileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas operações de arquivo, aguarde 15 min.' },
});
