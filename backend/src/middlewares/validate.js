import path from 'node:path';

// Formato estrito: https://github.com/<owner>/<repo>(.git)(/|...).
// Rejeita quebras de linha, aspas, ; & | ` $ ( ) — tudo que permitiria
// injeção no `git clone "<url>"` do deployService via SSH.
const GITHUB_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(\.git)?(\/.*)?$/;

export function assertGithubUrl(url) {
  const s = String(url || '').trim();
  if (s.length > 300) throw new Error('githubUrl muito longa.');
  if (/[\r\n'"`;|&`$()\\]/.test(s)) throw new Error('githubUrl com caracteres inválidos.');
  if (!GITHUB_RE.test(s)) throw new Error('githubUrl deve ser https://github.com/<dono>/<repo>.');
  return s;
}

export function assertPort(port) {
  const n = Number(port) || 3000;
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Porta inválida (1-65535).');
  return n;
}

const DOMAIN_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
export function assertDomain(domain) {
  const s = String(domain || '').trim().toLowerCase();
  if (!s) return '';
  if (s.length > 253 || !DOMAIN_RE.test(s)) throw new Error('Domínio inválido.');
  return s;
}

export function sanitizeLabel(label, fallback = 'app') {
  const s = String(label ?? fallback).slice(0, 80).trim();
  if (!s) return fallback;
  return s.replace(/[<>"']/g, '');
}

// Junta `base + sub` e garante que o resultado continua dentro de `base`.
// Uso obrigatório em qualquer endpoint de arquivo (storage/vault) para
// bloquear path traversal (`..`, `/etc/passwd`, bytes nulos).
export function safeJoin(base, sub = '') {
  const clean = String(sub || '').replace(/\0/g, '');
  const resolved = path.resolve(base, `.${path.sep}${clean}`);
  const baseResolved = path.resolve(base);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
    throw new Error('Caminho fora da base permitida.');
  }
  return resolved;
}

// Nome de arquivo seguro para disco: nunca usar originalname direto.
// O original vai só para o metadado `name` exibido na UI.
export function sanitizeFilename(name, fallback = 'arquivo') {
  const base = path.basename(String(name || fallback)).replace(/\0/g, '').slice(0, 120) || fallback;
  return base.replace(/[^A-Za-z0-9._-]+/g, '_');
}
