import { Router } from 'express';
import { readCollection } from '../config/store.js';
import {
  createUser, verifyUser, signToken, publicUser,
  setPassword, bumpTokenVersion, findById, findByEmail,
  issueResetToken, consumeResetToken, setDev, setPlan, isLastAdmin,
  findOrCreateGoogle, quotaFor,
} from '../config/users.js';
import { wipeUserData } from '../services/fileGuard.js';
import { sendResetEmail } from '../services/mailer.js';
import { requireAuth, loginLimiter } from '../middlewares/auth.js';

const r = Router();

// Registro aberto SOMENTE enquanto não existe nenhum usuário (bootstrap).
// Depois do primeiro admin, criar conta exige JWT de admin (sem auto-cadastro).
r.post('/register', (req, res) => {
  try {
    if (readCollection('users').length > 0) {
      return res.status(403).json({ error: 'Registro fechado. Peça a um admin.' });
    }
    const { name, email, password } = req.body || {};
    const u = createUser({ name, email, password, role: 'admin' });
    return res.json({ user: publicUser(u), token: signToken(u) });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// Admin cria contas (user ou admin) com quota própria.
r.post('/users', requireAuth, (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    const { name, email, password, role, quotaMB } = req.body || {};
    const u = createUser({ name, email, password, role, quotaMB });
    return res.json(publicUser(u));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

r.get('/users', requireAuth, (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    return res.json(readCollection('users').map(publicUser));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// GET /api/auth/overview — admin: cada usuário com uso real (MB), quota e plano.
r.get('/overview', requireAuth, (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    const files = readCollection('storage');
    const toMB = (b) => b / (1024 * 1024);
    return res.json(readCollection('users').map((u) => {
      const mine = files.filter((f) => f.ownerId === u.id);
      const usedB = mine.reduce((a, f) => a + (Number(f.sizeFinal ?? f.sizeOrig) || 0), 0);
      const quotaMB = Number(u.quotaMB) > 0 ? Number(u.quotaMB) : quotaFor(u.plan);
      return {
        id: u.id, name: u.name, email: u.email, role: u.role,
        plan: u.plan || 'Leve', quotaMB,
        usedMB: toMB(usedB), files: mine.length,
        pct: quotaMB > 0 ? Number(((toMB(usedB) / quotaMB) * 100).toFixed(1)) : 0,
        createdAt: u.createdAt,
      };
    }));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// PATCH /api/auth/users/:id — admin: troca plano/quota.
r.patch('/users/:id', requireAuth, (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    return res.json(setPlan(req.params.id, req.body || {}));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// DELETE /api/auth/users/:id — admin: exclui conta E tudo dela.
r.delete('/users/:id', requireAuth, (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    const u = findById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (isLastAdmin(u.id)) return res.status(400).json({ error: 'Não dá pra excluir o último admin.' });
    wipeUserData(u.id);
    return res.json({ ok: true });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// Erro sempre genérico: não revela se o e-mail existe.
r.post('/login', loginLimiter, (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(401).json({ error: 'Credenciais inválidas.' });
    const u = verifyUser(email, password);
    if (!u) return res.status(401).json({ error: 'Credenciais inválidas.' });
    return res.json({ user: publicUser(u), token: signToken(u) });
  } catch (e) { return res.status(401).json({ error: e.message }); }
});

// GET /api/auth/config — público: diz se o botão Google está ativo.
// (Client ID é público por natureza: ele vai no HTML de qualquer jeito.)
r.get('/config', (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  res.json({ google: !!clientId, clientId });
});

// POST /api/auth/google { credential } — ID token do Google Identity.
// Verificado no servidor (audiência = nosso client). Cria a conta se nova.
r.post('/google', loginLimiter, async (req, res) => {
  try {
    const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!clientId) return res.status(400).json({ error: 'Login Google desativado.' });
    const { OAuth2Client } = await import('google-auth-library');
    const ticket = await new OAuth2Client(clientId).verifyIdToken({
      idToken: String(req.body?.credential || ''),
      audience: clientId,
    });
    const p = ticket.getPayload() || {};
    if (!p.email_verified || !p.email) return res.status(401).json({ error: 'Google não verificou este e-mail.' });
    const u = findOrCreateGoogle({ email: p.email, name: p.name, picture: p.picture, googleId: p.sub });
    return res.json({ user: publicUser(u), token: signToken(u) });
  } catch {
    return res.status(401).json({ error: 'Login Google inválido.' });
  }
});

r.get('/me', requireAuth, (req, res) => {
  const u = findById(req.user.id) || req.user;
  return res.json(publicUser(u) || { id: 'master', role: 'admin', dev: true });
});

// Modo programador: o próprio usuário liga/desliga (revela Deploy/Sistema).
r.patch('/profile', requireAuth, (req, res) => {
  try {
    if (!req.user?.id || req.user.id === 'master') return res.status(400).json({ error: 'Token mestre já vê tudo.' });
    return res.json(setDev(req.user.id, req.body?.dev));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

r.post('/change-password', requireAuth, (req, res) => {
  try {
    if (!req.user?.id || req.user.id === 'master') {
      return res.status(400).json({ error: 'Token mestre não troca senha. Entre com e-mail/senha.' });
    }
    const { current, next } = req.body || {};
    const u = verifyUser(findById(req.user.id)?.email, current);
    if (!u) return res.status(401).json({ error: 'Senha atual incorreta.' });
    const updated = setPassword(u.id, next);
    return res.json({ ok: true, token: signToken(updated) });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// Logout global: invalida TODOS os JWTs deste usuário (bump de versão).
r.post('/logout', requireAuth, (req, res) => {
  if (req.user?.id && req.user.id !== 'master') bumpTokenVersion(req.user.id);
  return res.json({ ok: true });
});

// Esqueci a senha: sempre responde igual (não revela se o e-mail existe).
// Com SMTP, envia o link; sem SMTP, o link vai pro log do servidor (dev).
r.post('/forgot-password', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const u = email ? findByEmail(email) : null;
  if (u) {
    try {
      const token = issueResetToken(u.id);
      const base = String(process.env.PUBLIC_URL || '').replace(/\/$/, '') || 'http://localhost:4000';
      await sendResetEmail(u.email, `${base}/?reset=${token}`);
    } catch (e) { console.error('[email] falha ao enviar reset:', e.message); }
  }
  return res.json({ ok: true, msg: 'Se o e-mail existir, enviamos o link (vale 1h).' });
});

// Troca com token do e-mail. Token é uso único (setPassword limpa).
r.post('/reset-password', loginLimiter, (req, res) => {
  try {
    const { token, next } = req.body || {};
    const u = consumeResetToken(token);
    if (!u) return res.status(400).json({ error: 'Link inválido ou expirado. Peça outro.' });
    const updated = setPassword(u.id, next);
    return res.json({ ok: true, token: signToken(updated) });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

export default r;
