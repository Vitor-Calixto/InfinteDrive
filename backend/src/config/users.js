import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { readCollection, upsertRow } from './store.js';

// Auth 100% offline: bcryptjs (hash local) + JWT HS256 (sessão local).
// Nenhuma chamada externa no login. Senhas NUNCA em claro, só hash.
// Segredos reutilizáveis (senha SSH, Contabo secret) continuam AES-256-GCM
// em crypto.js — hash é irreversível e não serviria para discar SSH.
// Planos: a quota deriva do plano (Leve 100GB, Família 500GB, Studio 2TB).
// Trocar o plano sem mexer na quota ajusta sozinho.
export const PLAN_QUOTA = { Leve: 102400, 'Família': 512000, Studio: 2048000 };
export function quotaFor(plan) {
  return PLAN_QUOTA[plan] || PLAN_QUOTA.Leve;
}
// Nenhuma chamada externa no login. Senhas NUNCA em claro, só hash.
// Segredos reutilizáveis (senha SSH, Contabo secret) continuam AES-256-GCM
// em crypto.js — hash é irreversível e não serviria para discar SSH.

// Aceita domínio local (admin@localhost) pois o painel roda offline/LAN.
const EMAIL_RE = /^[^@\s]{1,120}@[^@\s]{1,120}$/;
const DUMMY_HASH = '$2b$10$123456789012345678901uX8K7Qv6Z5Y4X3W2V1U0T9S8R7Q6P5O4N3M2';

let ephemeralSecret = '';

function getJwtSecret() {
  const s = process.env.JWT_SECRET || '';
  if (s && s.length >= 32) return s;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(48).toString('hex');
    console.warn('[segurança] JWT_SECRET ausente/curto: usando segredo efêmero (sessões expiram ao reiniciar). Defina 32+ chars no .env.');
  }
  return ephemeralSecret || s;
}

function assertPasswordPolicy(password) {
  const s = String(password || '');
  if (s.length < 8) throw new Error('Senha deve ter ao menos 8 caracteres.');
  if (s.length > 72) throw new Error('Senha deve ter no máximo 72 caracteres.');
  return s;
}

export function hashPassword(password) {
  return bcrypt.hashSync(assertPasswordPolicy(password), 10);
}

export function publicUser(u) {
  if (!u) return null;
  const { passHash, ...pub } = u;
  return pub;
}

export function findByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return readCollection('users').find((u) => u.email === e) || null;
}

export function findById(id) {
  return readCollection('users').find((u) => u.id === id) || null;
}

export function createUser({ name, email, password, role = 'user', quotaMB }) {
  const cleanName = String(name || '').trim().slice(0, 80) || 'usuário';
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) throw new Error('E-mail inválido.');
  if (findByEmail(cleanEmail)) throw new Error('E-mail já cadastrado.');
  const users = readCollection('users');
  // Bootstrap: o primeiro usuário do sistema é sempre admin (mesmo se pedir user).
  const finalRole = users.length === 0 ? 'admin' : (role === 'admin' ? 'admin' : 'user');
  const row = {
    id: randomUUID(),
    name: cleanName.replace(/[<>"']/g, ''),
    email: cleanEmail,
    passHash: hashPassword(password),
    role: finalRole,
    plan: 'Leve',
    quotaMB: Number(quotaMB) > 0 ? Math.min(Number(quotaMB), 5 * 1024 * 1024) : quotaFor('Leve'),
    dev: false, // modo programador: revela Deploy/Sistema (usuário liga no perfil)
    tokenVersion: 1,
    createdAt: new Date().toISOString(),
  };
  upsertRow('users', row);
  return row;
}

// Retorna o usuário ou null. Mensagem de erro sempre genérica no login
// (não revela se o e-mail existe). Compara com hash dummy quando não acha,
// para não vazar existência por timing.
export function verifyUser(email, password) {
  const u = findByEmail(email);
  if (u && !u.passHash) throw new Error('Conta Google: entre com o botão do Google.');
  const hash = u ? u.passHash : DUMMY_HASH;
  const ok = bcrypt.compareSync(String(password || ''), hash);
  return ok && u ? u : null;
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, v: user.tokenVersion || 1 },
    getJwtSecret(),
    { expiresIn: '12h' },
  );
}

export function verifyToken(token) {
  const payload = jwt.verify(String(token || ''), getJwtSecret());
  const u = findById(payload.sub);
  if (!u) return null;
  if ((u.tokenVersion || 1) !== (payload.v || 1)) return null; // logout global
  return u;
}

export function bumpTokenVersion(id) {
  const u = findById(id);
  if (!u) return;
  u.tokenVersion = (u.tokenVersion || 1) + 1;
  upsertRow('users', u);
}

export function setPassword(id, newPassword) {
  const u = findById(id);
  if (!u) throw new Error('Usuário não encontrado.');
  u.passHash = hashPassword(newPassword);
  u.tokenVersion = (u.tokenVersion || 1) + 1; // derruba outras sessões
  delete u.resetHash;
  delete u.resetExpires;
  upsertRow('users', u);
  return u;
}

// Login social (Google): sem senha local. passHash vazio = só entra via Google.
export function findOrCreateGoogle({ email, name, picture, googleId }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('E-mail do Google inválido.');
  let u = findByEmail(cleanEmail);
  if (u) {
    let changed = false;
    if (picture && u.avatar !== picture) { u.avatar = picture; changed = true; }
    if (googleId && u.googleId !== googleId) { u.googleId = googleId; changed = true; }
    if (changed) upsertRow('users', u);
    return u;
  }
  const users = readCollection('users');
  u = {
    id: randomUUID(),
    name: String(name || cleanEmail.split('@')[0]).slice(0, 80).replace(/[<>"']/g, ''),
    email: cleanEmail,
    passHash: '',
    avatar: picture || '',
    googleId: googleId || '',
    role: users.length === 0 ? 'admin' : 'user',
    plan: 'Leve',
    quotaMB: quotaFor('Leve'),
    dev: false,
    tokenVersion: 1,
    createdAt: new Date().toISOString(),
  };
  upsertRow('users', u);
  return u;
}

// Token de recuperação: salva só o SHA256 (se a base vazar, o token não serve).
// Expira em 1h. Retorna o token puro (vai só no e-mail).
export function issueResetToken(id) {
  const u = findById(id);
  if (!u) return '';
  const token = crypto.randomBytes(32).toString('hex');
  u.resetHash = crypto.createHash('sha256').update(token).digest('hex');
  u.resetExpires = Date.now() + 60 * 60 * 1000;
  upsertRow('users', u);
  return token;
}

export function setDev(id, dev) {
  const u = findById(id);
  if (!u) throw new Error('Usuário não encontrado.');
  u.dev = !!dev;
  upsertRow('users', u);
  return publicUser(u);
}

// Admin: ajusta plano + quota (MB). Sem quota explícita, herda a do plano.
export function setPlan(id, { plan, quotaMB }) {
  const u = findById(id);
  if (!u) throw new Error('Usuário não encontrado.');
  if (plan !== undefined) u.plan = String(plan).slice(0, 30) || 'Leve';
  if (quotaMB !== undefined && quotaMB !== '' && quotaMB !== null) {
    const q = Number(quotaMB);
    if (!Number.isFinite(q) || q < 0 || q > 10 * 1024 * 1024) throw new Error('Quota inválida.');
    u.quotaMB = q > 0 ? q : quotaFor(u.plan);
  } else {
    u.quotaMB = quotaFor(u.plan);
  }
  upsertRow('users', u);
  return publicUser(u);
}

// Admin: conta se é o último admin (exclusão bloqueada nesse caso).
export function isLastAdmin(id) {
  const admins = readCollection('users').filter((x) => x.role === 'admin');
  return admins.length <= 1 && admins.some((x) => x.id === id);
}

export function consumeResetToken(token) {
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const u = readCollection('users').find((x) => x.resetHash === hash) || null;
  if (!u || !u.resetExpires || Date.now() > u.resetExpires) return null;
  return u;
}

// Bootstrap via .env na primeira subida. Hash na hora, nunca salva claro.
// Depois do primeiro usuário, ADMIN_EMAIL/PASSWORD são ignorados.
export function ensureAdminBootstrap() {
  try {
    if (readCollection('users').length > 0) return;
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const pass = String(process.env.ADMIN_PASSWORD || '');
    if (!email || !pass) return;
    const u = createUser({ name: 'admin', email, password: pass, role: 'admin' });
    console.log(`[segurança] admin bootstrap criado: ${u.email} (troque a senha em /api/auth/change-password)`);
  } catch (e) {
    console.warn(`[segurança] bootstrap admin ignorado: ${e.message}`);
  }
}
