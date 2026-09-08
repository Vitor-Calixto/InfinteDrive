import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readCollection, upsertRow } from '../config/store.js';
import { buildDeployScript } from '../services/deployService.js';
import { runRemoteScript, putFile } from '../services/sshService.js';
import { deployLimiter } from '../middlewares/auth.js';
import { assertGithubUrl, assertPort, assertDomain } from '../middlewares/validate.js';
import { getServerDecrypted } from './serverRoutes.js';

const r = Router();
const clients = new Map(); // deployId -> Set(res)
const ZIP_DIR = path.join(process.cwd(), 'data', 'tmp-zip');

// POST /api/deploy/:appId -> inicia deploy, retorna { deployId }. Logs via GET /api/deploy/:deployId/logs (SSE)
r.post('/:appId', deployLimiter, async (req, res) => {
  try {
    const app = readCollection('apps').find((a) => a.id === req.params.appId);
    if (!app) return res.status(404).json({ error: 'App não encontrado.' });
    // permite overrides de última hora vindos do painel (checkboxes)
    const merged = { ...app, source: req.body.source || app.source || 'github', flags: { ...app.flags, ...(req.body.flags || {}) }, dbProvider: req.body.dbProvider || app.dbProvider, port: req.body.port || app.port, domain: req.body.domain ?? app.domain, envVars: req.body.envVars ?? app.envVars };
    // Revalida tudo que vira comando SSH (anti-injeção): o save validou, o override precisa validar de novo.
    // Fonte .zip da máquina não tem githubUrl — pula essa checagem nesse modo.
    if (merged.source !== 'upload') merged.githubUrl = assertGithubUrl(merged.githubUrl);
    merged.port = assertPort(merged.port);
    merged.domain = assertDomain(merged.domain);
    merged.envVars = String(merged.envVars || '').slice(0, 20000);
    const srv = getServerDecrypted(merged.serverId || req.body.serverId);
    const { name, script, fixes } = buildDeployScript(merged);
    // Fonte .zip: localiza o pacote validado antes de responder.
    let zipLocal = '';
    if (merged.source === 'upload') {
      const zipId = String(req.body.zipId || '');
      if (!/^[0-9a-f-]{36}$/.test(zipId)) return res.status(400).json({ error: 'Envie o .zip primeiro.' });
      zipLocal = path.join(ZIP_DIR, `${zipId}.zip`);
      if (!fs.existsSync(zipLocal)) return res.status(400).json({ error: 'Pacote expirado. Envie o .zip de novo.' });
    }
    const deployId = randomUUID();
    const record = { id: deployId, appId: app.id, appName: name, server: srv.host, status: 'running', startedAt: new Date().toISOString(), log: [] };
    upsertRow('deploys', record);

    const emit = (line) => {
      record.log.push(line);
      upsertRow('deploys', record); // persiste toda linha: replay do SSE sempre completo
      clients.get(deployId)?.forEach((resSse) => resSse.write(`data: ${JSON.stringify({ line })}\n\n`));
    };

    res.json({ deployId, appName: name, fixes, preview: script.split('\n').slice(0, 8).join('\n') + '\n...' });

    // roda em background (não trava a resposta)
    // Correções automáticas primeiro: replay do SSE entrega mesmo p/ quem conectar depois.
    fixes.forEach((m) => emit(`[auto] ${m}`));
    (async () => {
      if (zipLocal) {
        // Envia o pacote via SFTP antes de rodar o script (progresso a cada 25%).
        emit(`[zip] enviando pacote para a VPS...`);
        let last = 0;
        await putFile(srv, zipLocal, `/tmp/deploy-${name}.zip`, (pct) => {
          if (pct - last >= 25 || pct === 100) { last = pct; emit(`[zip] ${pct}% enviado...`); }
        });
        try { fs.unlinkSync(zipLocal); } catch {}
        emit(`[zip] pacote entregue.`);
      }
      emit(`$ conectando em ${srv.username}@${srv.host} ...`);
      return runRemoteScript(srv, script, emit);
    })()
      .then(({ code }) => {
        record.status = code === 0 ? 'success' : 'failed';
        record.finishedAt = new Date().toISOString();
        upsertRow('deploys', record);
        clients.get(deployId)?.forEach((s) => { s.write(`data: ${JSON.stringify({ done: true, status: record.status })}\n\n`); s.end(); });
        clients.delete(deployId);
      })
      .catch((e) => {
        record.status = 'failed';
        record.log.push(`[erro] ${e.message}`);
        record.finishedAt = new Date().toISOString();
        upsertRow('deploys', record);
        clients.get(deployId)?.forEach((s) => { s.write(`data: ${JSON.stringify({ done: true, status: 'failed' })}\n\n`); s.end(); });
        clients.delete(deployId);
      });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

r.get('/:deployId/logs', (req, res) => {
  const { deployId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const rec = readCollection('deploys').find((d) => d.id === deployId);
  (rec?.log || []).forEach((line) => res.write(`data: ${JSON.stringify({ line })}\n\n`));
  if (rec && rec.status !== 'running') {
    res.write(`data: ${JSON.stringify({ done: true, status: rec.status })}\n\n`);
    return res.end();
  }
  if (!clients.has(deployId)) clients.set(deployId, new Set());
  clients.get(deployId).add(res);
  req.on('close', () => clients.get(deployId)?.delete(res));
});

r.get('/', (req, res) => res.json(readCollection('deploys').reverse().slice(0, 50)));

// Ficha completa de 1 deploy, com log integral (o SSE pode perder linhas
// se o deploy falhar antes do navegador/CLI conectar).
r.get('/record/:deployId', (req, res) => {
  const rec = readCollection('deploys').find((d) => d.id === req.params.deployId);
  if (!rec) return res.status(404).json({ error: 'Deploy não encontrado.' });
  res.json(rec);
});

export default r;
