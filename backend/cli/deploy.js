#!/usr/bin/env node
// CLI estilo git para o Deploy Center. Roda em qualquer terminal (VS Code,
// PowerShell, bash, CI) sem GitHub: fala com a mesma API do painel.
//
//   node cli/deploy.js init --api http://localhost:4000/api --email eu@x.com
//   node cli/deploy.js add                        (marca tudo p/ snapshot)
//   node cli/deploy.js commit -m "landing nova"   (zipa snapshot local)
//   node cli/deploy.js push                       (sobe + deploya + mostra log)
//   node cli/deploy.js logs                       (últimos deploys)
// Senha pedida 1x no init (nunca salva). Token JWT de 12h em .deploy/config.json.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const DIR = path.join(process.cwd(), '.deploy');
const CFG = path.join(DIR, 'config.json');
const SNAPS = path.join(DIR, 'snapshots.json');
const EXCLUDE = new Set(['node_modules', '.git', '.env', '.deploy', 'data', 'deploy.zip']);

const arg = (k, d = '') => {
  const i = process.argv.findIndex((a) => a === `--${k}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${k}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  // atalho estilo git: -m "msg"
  if (k.length > 1) {
    const short = `-${k[0]}`;
    const j = process.argv.findIndex((a) => a === short);
    if (j >= 0 && process.argv[j + 1]) return process.argv[j + 1];
  }
  return d;
};
const loadCfg = () => (fs.existsSync(CFG) ? JSON.parse(fs.readFileSync(CFG, 'utf8')) : null);
const saveCfg = (c) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(CFG, JSON.stringify(c, null, 2)); };
const ask = (q, secret = false) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: secret ? undefined : process.stdout });
  rl.question(q, (a) => { rl.close(); if (secret) process.stdout.write('\n'); res(a.trim()); });
});

async function api(p, { method = 'GET', token = '', body = null, form = null } = {}) {
  const cfg = loadCfg();
  const base = (cfg?.api || arg('api', 'http://localhost:4000/api')).replace(/\/$/, '');
  const headers = {};
  if (token || cfg?.token) headers.Authorization = `Bearer ${token || cfg.token}`;
  let payload;
  if (form) payload = form;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + p, { method, headers, body: payload });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

async function cmdInit() {
  const apiUrl = arg('api', 'http://localhost:4000/api');
  const email = arg('email') || await ask('e-mail: ');
  const password = arg('password') || await ask('senha: ', true);
  const name = arg('name') || path.basename(process.cwd());
  const r = await fetch(`${apiUrl.replace(/\/$/, '')}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login falhou (${r.status}). Confira e-mail/senha.`);
  const j = await r.json();
  saveCfg({ api: apiUrl, email, token: j.token, appId: '', appName: name });
  console.log(`ok: logado como ${j.user.email}. App padrão: ${name}`);
}

function cmdAdd() {
  const n = [...walk(process.cwd())].length;
  console.log(`adicionados ${n} arquivos ao snapshot (tudo menos ${[...EXCLUDE].join(', ')}).`);
}

function* walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const r = path.join(rel, e.name);
    if (e.isDirectory()) yield* walk(full, r);
    else yield r;
  }
}

async function cmdCommit() {
  const msg = arg('m') || arg('message') || 'snapshot';
  fs.mkdirSync(path.join(DIR, 'shots'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(DIR, 'shots', `${stamp}.zip`);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const zip = new archiver.ZipArchive({ zlib: { level: 6 } });
    out.on('close', resolve);
    zip.on('error', reject);
    zip.pipe(out);
    for (const rel of walk(process.cwd())) zip.file(path.join(process.cwd(), rel), { name: rel });
    zip.finalize();
  });
  const snaps = fs.existsSync(SNAPS) ? JSON.parse(fs.readFileSync(SNAPS, 'utf8')) : [];
  snaps.push({ file: path.basename(file), msg, at: new Date().toISOString() });
  fs.writeFileSync(SNAPS, JSON.stringify(snaps.slice(-20), null, 2));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`commit: ${path.basename(file)} (${kb} KB) — "${msg}"`);
}

async function latestShot() {
  const d = path.join(DIR, 'shots');
  if (!fs.existsSync(d)) return '';
  const zips = fs.readdirSync(d).filter((f) => f.endsWith('.zip')).sort();
  return zips.length ? path.join(d, zips[zips.length - 1]) : '';
}

async function cmdPush() {
  const cfg = loadCfg();
  if (!cfg) throw new Error('sem init. Rode: node cli/deploy.js init');
  let shot = await latestShot();
  if (!shot) { console.log('sem snapshot — criando commit automático...'); await cmdCommit(); shot = await latestShot(); }
  console.log(`enviando ${path.basename(shot)}...`);
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(shot)]), 'projeto.zip');
  const up = await api('/apps/upload-zip', { method: 'POST', form: fd });
  console.log(`pacote validado: ${up.files} arquivos.`);
  let appId = cfg.appId;
  if (!appId) {
    const created = await api('/apps', { method: 'POST', body: { name: cfg.appName, source: 'upload', flags: { node: true, pm2: true }, dbProvider: 'none', port: Number(arg('port', '3000')) } });
    appId = created.id;
    saveCfg({ ...cfg, appId });
    console.log(`app criado: ${created.name}`);
  }
  const dep = await api(`/deploy/${appId}`, { method: 'POST', body: { source: 'upload', zipId: up.zipId } });
  console.log(`deploy ${dep.deployId} iniciado. Log ao vivo:`);
  for (const m of dep.fixes || []) console.log(`[auto] ${m}`);
  await streamLogs(dep.deployId);
}

async function streamLogs(deployId) {
  const cfg = loadCfg();
  const base = cfg.api.replace(/\/$/, '');
  const seen = new Set();
  const show = (m) => {
    if (m.line && !seen.has(m.line)) { seen.add(m.line); console.log(m.line); }
  };
  const r = await fetch(`${base}/deploy/${deployId}/logs?token=${encodeURIComponent(cfg.token)}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let status = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const p of parts) {
      const line = p.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const m = JSON.parse(line.slice(6));
        show(m);
        if (m.done) status = m.status;
      } catch {}
    }
    if (status) break;
  }
  // Completa o que o SSE perdeu (deploy relâmpago): busca a ficha integral.
  try {
    const rec = await api(`/deploy/record/${deployId}`);
    for (const line of rec.log || []) show({ line });
  } catch {}
  console.log(`== ${(status || 'done').toUpperCase()} ==`);
}

async function cmdLogs() {
  const h = await api('/deploy');
  if (!h.length) { console.log('sem deploys ainda.'); return; }
  for (const d of h.slice(0, 10)) console.log(`● ${d.appName} — ${d.status} (${d.startedAt || ''})`);
}

const cmd = process.argv[2];
try {
  if (cmd === 'init') await cmdInit();
  else if (cmd === 'add') cmdAdd();
  else if (cmd === 'commit') await cmdCommit();
  else if (cmd === 'push') await cmdPush();
  else if (cmd === 'logs') await cmdLogs();
  else console.log('uso: init | add | commit -m "msg" | push | logs');
} catch (e) {
  console.error('erro:', e.message);
  process.exit(1);
}
