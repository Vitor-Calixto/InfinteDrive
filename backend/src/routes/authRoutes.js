import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { readCollection, upsertRow } from '../config/store.js';
import { linkRefresh } from '../services/importService.js';
import {
  createUser, verifyUser, signToken, publicUser,
  setPassword, bumpTokenVersion, findById, findByEmail,
  issueResetToken, consumeResetToken, setDev, setPlan, isLastAdmin,
  findOrCreateGoogle, quotaFor, tfaSetupStart, tfaEnable, tfaCheck, tfaDisable,
} from '../config/users.js';
import { wipeUserData, appendAudit } from '../services/fileGuard.js';
import crypto from 'node:crypto';

// Temporária legível (sem 0/O/l/1 pra não confundir ditando por telefone).
function randomTmp() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (const b of crypto.randomBytes(12)) s += abc[b % abc.length];
  return s;
}
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
    const { name, email, password, phone, acceptedTerms } = req.body || {};
    if (!acceptedTerms) return res.status(400).json({ error: 'Aceite os Termos para criar a conta.' });
    const u = createUser({ name, email, password, phone, phoneRequired: true, acceptedTerms: true, role: 'admin' });
    return res.json({ user: publicUser(u), token: signToken(u) });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// Admin cria contas (user ou admin) com quota própria.
r.post('/users', requireAuth, (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    const { name, email, password, phone, role, quotaMB } = req.body || {};
    const u = createUser({ name, email, password, phone, phoneRequired: true, role, quotaMB });
    return res.json(publicUser(u));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

r.get('/users', requireAuth, (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    return res.json(readCollection('users').map(publicUser));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// GET /api/auth/overview — admin: telefone (NÃO e-mail: privacidade), uso e plano.
// E-mail só aparece em busca direcionada (/users/search), auditada.

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
        id: u.id, name: u.name, phone: u.phone || '', role: u.role,
        plan: u.plan || 'Leve', quotaMB,
        usedMB: toMB(usedB), files: mine.length,
        pct: quotaMB > 0 ? Number(((toMB(usedB) / quotaMB) * 100).toFixed(1)) : 0,
        createdAt: u.createdAt,
      };
    }));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// GET /api/auth/users/search?email= — admin: acha 1 conta pelo e-mail (auditado).
// É o único lugar que revela o e-mail + permite redefinir a senha.
// (A senha NUNCA é exibida: só existe hash. Redefinir gera temporária 1x.)
r.get('/users/search', requireAuth, (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    const u = findByEmail(req.query.email);
    if (!u) return res.status(404).json({ error: 'Ninguém com esse e-mail.' });
    appendAudit({ userId: req.user.id, action: 'admin-search', ip: req.ip, detail: u.email });
    return res.json({ id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role, plan: u.plan || 'Leve', tfaEnabled: !!u.tfaEnabled, createdAt: u.createdAt });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// POST /api/auth/users/:id/reset-password — admin: nova temporária (1x na tela).
// Desloga tudo (bump) + audita. Nunca devolve a senha antiga (só hash).
r.post('/users/:id/reset-password', requireAuth, (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    const u = findById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!u.passHash) return res.status(400).json({ error: 'Conta Google: sem senha local.' });
    const tmp = randomTmp();
    setPassword(u.id, tmp);
    bumpTokenVersion(u.id);
    appendAudit({ userId: req.user.id, action: 'admin-reset-pw', ip: req.ip, detail: u.email });
    return res.json({ tempPassword: tmp });
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
    // 2FA ligado: senha ok, mas o JWT só sai no 2º passo.
    if (u.tfaEnabled) return res.status(202).json({ tfaRequired: true, email: u.email });
    return res.json({ user: publicUser(u), token: signToken(u) });
  } catch (e) { return res.status(401).json({ error: e.message }); }
});

// POST /api/auth/2fa/verify { email, token } — 2º passo (TOTP ou backup).
r.post('/2fa/verify', loginLimiter, (req, res) => {
  try {
    const { email, token } = req.body || {};
    const u = findByEmail(String(email || '').trim().toLowerCase());
    if (!u?.tfaEnabled) return res.status(401).json({ error: 'Credenciais inválidas.' });
    if (!tfaCheck(u, token)) return res.status(401).json({ error: 'Código inválido.' });
    return res.json({ user: publicUser(u), token: signToken(u) });
  } catch (e) { return res.status(401).json({ error: e.message }); }
});

// POST /api/auth/2fa/setup — gera segredo + QR (autenticado).
r.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    if (!req.user?.id || req.user.id === 'master') return res.status(400).json({ error: 'Entre com e-mail/senha.' });
    const { secret, uri } = tfaSetupStart(req.user.id);
    const QRCode = (await import('qrcode')).default;
    const qr = await QRCode.toDataURL(uri);
    return res.json({ secret, qr });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// POST /api/auth/2fa/enable { token } — confirma e ativa (devolve backups 1x).
r.post('/2fa/enable', requireAuth, (req, res) => {
  try {
    if (!req.user?.id || req.user.id === 'master') return res.status(400).json({ error: 'Entre com e-mail/senha.' });
    return res.json(tfaEnable(req.user.id, req.body?.token));
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// POST /api/auth/2fa/disable { password } — desliga (pede a senha).
r.post('/2fa/disable', requireAuth, (req, res) => {
  try {
    if (!req.user?.id || req.user.id === 'master') return res.status(400).json({ error: 'Entre com e-mail/senha.' });
    tfaDisable(req.user.id, req.body?.password);
    return res.json({ ok: true });
  } catch (e) { return res.status(400).json({ error: e.message }); }
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

// ---- Google OAuth por redirect (sem popup: nada bloqueia).
// /auth/google/start?scope=drive|photos (JWT via ?token=) -> Google ->
// /api/auth/google/callback -> volta pro front com ?import=drive|photos|erro.
// Pede GOOGLE_CLIENT_SECRET no .env + redirect URI cadastrada no Console.
const G_SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  photos: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  login: 'openid email profile',
};
const gTickets = new Map(); // ticket -> { userId, exp } (login redirect, uso único, 5min)
const gNonces = new Map(); // state -> { userId, scope, exp } (uso único, 10min)
const gRedirectUri = () => `${String(process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '')}/api/auth/google/callback`;

r.get('/google/start', requireAuth, (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const secret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !secret) return res.status(400).json({ error: 'Falta GOOGLE_CLIENT_ID/SECRET no servidor.' });
  const scope = req.query.scope === 'photos' ? 'photos' : 'drive';
  const nonce = randomUUID();
  gNonces.set(nonce, { userId: req.user.id, scope, exp: Date.now() + 10 * 60 * 1000 });
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', gRedirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', G_SCOPES[scope]);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent'); // garante refresh_token a cada vínculo
  u.searchParams.set('state', nonce);
  return res.redirect(u.toString());
});

async function exchangeCode(code) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const secret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const t = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code), client_id: clientId, client_secret: secret,
      redirect_uri: gRedirectUri(), grant_type: 'authorization_code',
    }),
  })).json();
  if (t.error || !t.access_token) throw new Error('Troca com o Google falhou.');
  return t;
}

// Login por redirect (público: sem JWT ainda). Sem popup branco do GIS.
r.get('/google/login/start', (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const secret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !secret) return res.status(400).json({ error: 'Falta GOOGLE_CLIENT_ID/SECRET no servidor.' });
  const nonce = randomUUID();
  gNonces.set(nonce, { userId: '', scope: 'login', exp: Date.now() + 10 * 60 * 1000 });
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', gRedirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', G_SCOPES.login);
  u.searchParams.set('access_type', 'online');
  u.searchParams.set('prompt', 'select_account');
  u.searchParams.set('state', nonce);
  return res.redirect(u.toString());
});

// Ticket de uso único -> JWT (front troca sem expor nada na URL além do ticket).
r.post('/google/consume', loginLimiter, (req, res) => {
  try {
    const t = gTickets.get(String(req.body?.ticket || ''));
    gTickets.delete(String(req.body?.ticket || ''));
    if (!t || Date.now() > t.exp) return res.status(400).json({ error: 'Sessão expirada. Tente de novo.' });
    const u = findById(t.userId);
    if (!u) return res.status(404).json({ error: 'Conta sumiu.' });
    return res.json({ user: publicUser(u), token: signToken(u) });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

r.get('/google/callback', async (req, res) => {
  const front = String(process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');
  const back = (msg, kind = 'erro') => res.redirect(`${front}/?import=${kind}&msg=${encodeURIComponent(msg)}`);
  try {
    const { code, state, error } = req.query || {};
    if (error) {
      const n0 = gNonces.get(String(state || ''));
      gNonces.delete(String(state || ''));
      if (n0?.scope === 'login') return res.redirect(`${front}/?glogin=cancel`);
      return back('Permissão negada no Google.');
    }
    const n = gNonces.get(String(state || ''));
    gNonces.delete(String(state || ''));
    if (!n || Date.now() > n.exp) return back('Sessão expirou. Tente de novo.');
    if (!code) return back('Sem código do Google.');
    // O code só vale p/ nosso client+redirect: sem vínculo trocado não há fraude.
    const t = await exchangeCode(code);
    if (n.scope === 'login') {
      // Identidade via userinfo (access do login não guarda refresh).
      const me = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
      if (!me.email_verified || !me.email) return res.redirect(`${front}/?glogin=erro`);
      const u = findOrCreateGoogle({ email: me.email, name: me.name, picture: me.picture, googleId: me.sub });
      const ticket = randomUUID();
      gTickets.set(ticket, { userId: u.id, exp: Date.now() + 5 * 60 * 1000 });
      return res.redirect(`${front}/?glogin=${ticket}`);
    }
    if (!t.access_token || !t.refresh_token) return back('Google não devolveu o vínculo.');
    linkRefresh(n.userId, { refreshToken: t.refresh_token, accessToken: t.access_token, scopes: String(t.scope || '').split(' ') });
    return res.redirect(`${front}/?import=${n.scope}`);
  } catch {
    return back('Falha ao vincular.');
  }
});

// PATCH /api/auth/accept-terms — registra aceite dos Termos (data/hora). 1x.
r.patch('/accept-terms', requireAuth, (req, res) => {
  try {
    if (!req.user?.id || req.user.id === 'master') return res.json({ ok: true });
    const u = findById(req.user.id);
    if (!u) return res.status(404).json({ error: 'Conta sumiu.' });
    u.acceptedTermsAt = new Date().toISOString();
    upsertRow('users', u);
    appendAudit({ userId: u.id, action: 'accept-terms', ip: req.ip, detail: 'v1.1' });
    return res.json({ ok: true, at: u.acceptedTermsAt });
  } catch (e) { return res.status(400).json({ error: e.message }); }
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
