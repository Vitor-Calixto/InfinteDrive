// Detecção automática de stack via GitHub API (sem clonar).
// Retorna { ok, repo, flags, files, hints } onde flags são os checkboxes do painel:
// node, prisma, postgres, mysql, mongo, redis, docker, pm2, nginx, build, python, static, nextjs, vite
import path from 'node:path';

export function parseGithubUrl(url) {
  const m = String(url || '').trim().match(/github\.com[/:]([^/]+)\/([^/.#?]+)/i);
  if (!m) throw new Error('URL do GitHub inválida. Ex: https://github.com/usuario/repo');
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

async function ghFetch(apiPath) {
  const headers = { 'User-Agent': 'contabo-deploy-dashboard', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${apiPath}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status} em ${apiPath}`);
  return res.json();
}

async function getFile(owner, repo, filePath) {
  const data = await ghFetch(`/repos/${owner}/${repo}/contents/${filePath}`);
  if (!data?.content) return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}

export async function detectStack(githubUrl) {
  const { owner, repo } = parseGithubUrl(githubUrl);
  const [root, pkgRaw, composeRaw, dockerfile, ecosystem, prismaSchema, requirements, composerJson] = await Promise.all([
    ghFetch(`/repos/${owner}/${repo}/contents/`),
    getFile(owner, repo, 'package.json'),
    getFile(owner, repo, 'docker-compose.yml').then((v) => v ?? getFile(owner, repo, 'compose.yaml').catch(() => null)).catch(() => null),
    getFile(owner, repo, 'Dockerfile').then((v) => !!v).catch(() => false),
    getFile(owner, repo, 'ecosystem.config.js').then((v) => !!v).catch(() => false),
    getFile(owner, repo, 'prisma/schema.prisma').then((v) => v ?? getFile(owner, repo, 'backend/prisma/schema.prisma')).catch(() => null),
    getFile(owner, repo, 'requirements.txt').then((v) => !!v).catch(() => false),
    getFile(owner, repo, 'composer.json').then((v) => !!v).catch(() => false),
  ]);

  const files = Array.isArray(root) ? root.map((f) => f.name) : [];
  let pkg = null;
  try { pkg = pkgRaw ? JSON.parse(pkgRaw) : null; } catch { pkg = null; }
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const scripts = pkg?.scripts || {};
  const has = (n) => Object.keys(deps).some((d) => d.toLowerCase().includes(n));

  const flags = {
    node: !!pkg || files.includes('server.js') || files.includes('index.js'),
    build: !!(scripts.build || has('next') || has('vite') || files.includes('vite.config.js')),
    nextjs: has('next'),
    vite: has('vite'),
    prisma: !!prismaSchema || has('@prisma/client'),
    postgres: /postgres/i.test(prismaSchema || '') || has('pg') || has('postgres'),
    mysql: /mysql/i.test(prismaSchema || '') || has('mysql'),
    mongo: /mongo/i.test(prismaSchema || '') || has('mongoose') || has('mongodb'),
    redis: has('redis') || has('ioredis') || has('bull'),
    docker: !!dockerfile || !!composeRaw,
    pm2: !!ecosystem || has('pm2'),
    python: !!requirements || files.includes('main.py') || files.includes('app.py'),
    php: !!composerJson,
    static: !pkg && (files.includes('index.html') || files.includes('frontend')),
  };

  // Banco sugerido a partir do schema.prisma
  let dbProvider = 'none';
  const m = (prismaSchema || '').match(/provider\s*=\s*"(\w+)"/);
  if (m) dbProvider = m[1]; // postgresql | mysql | mongodb | sqlite
  else if (flags.postgres) dbProvider = 'postgresql';
  else if (flags.mysql) dbProvider = 'mysql';
  else if (flags.mongo) dbProvider = 'mongodb';

  const hints = [];
  if (flags.prisma && dbProvider === 'none') hints.push('Prisma detectado mas sem provider claro — confira prisma/schema.prisma.');
  if (!flags.docker && !flags.pm2 && flags.node) hints.push('Sem Docker nem PM2 detectado — o painel vai sugerir PM2 por padrão.');
  if (flags.build) hints.push(`Build detectado (script "build"${flags.nextjs ? ' / Next.js' : ''}${flags.vite ? ' / Vite' : ''}).`);
  if (dbProvider !== 'none' && dbProvider !== 'sqlite') hints.push(`Banco ${dbProvider} — o deploy vai subir um container dedicado automaticamente.`);

  return { ok: true, owner, repo, files: files.slice(0, 40), flags, dbProvider, pkg: pkg ? { scripts: Object.keys(scripts), deps: Object.keys(deps).slice(0, 30) } : null, hints };
}
