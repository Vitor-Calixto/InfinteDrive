import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import 'dotenv/config';
import { globalLimiter, requireAuth, requireDev } from './middlewares/auth.js';
import { ensureAdminBootstrap } from './config/users.js';
import { startWorker } from './services/compressService.js';
import { purgeTrash } from './services/fileGuard.js';
import authRoutes from './routes/authRoutes.js';
import contaboRoutes from './routes/contaboRoutes.js';
import serverRoutes from './routes/serverRoutes.js';
import appRoutes from './routes/appRoutes.js';
import deployRoutes from './routes/deployRoutes.js';
import storageRoutes from './routes/storageRoutes.js';
import playlistRoutes from './routes/playlistRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import systemRoutes from './routes/systemRoutes.js';
import chunkRoutes from './routes/chunkRoutes.js';
import cloudflareRoutes from './routes/cloudflareRoutes.js';
import importRoutes from './routes/importRoutes.js';
import { shareApi, sharePublic } from './routes/shareRoutes.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.disable('x-powered-by');
app.set('trust proxy', 1);
// Painel usa onclick inline em todo o HTML: libera script-src-attr.
// Scripts externos continuam restritos ao padrão do helmet.
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", 'https://accounts.google.com'],
      'script-src-attr': ["'unsafe-inline'"],
      'frame-src': ["'self'", 'https://accounts.google.com'],
      'connect-src': ["'self'", 'https://accounts.google.com'],
    },
  },
}));
// CORS restrito (padrão Gym): CLIENT_URL + localhost dev. Nunca origin:true em produção.
// Inclui :4000 porque o próprio backend serve o painel (same-origin também valida).
const allowed = (process.env.CLIENT_URL || 'http://localhost:4000,http://127.0.0.1:4000,http://localhost:5500,http://127.0.0.1:5500')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl / EventSource / apps nativas
    if (allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Origem não permitida.'));
  },
}));
app.use(express.json({ limit: '256kb' }));
// Gzip em texto (HTML/CSS/JS/JSON): -70% no tráfego do painel e da API.
// Mídia (webp/mp4/ogg/zip/bin) já é comprimida: pular economiza CPU.
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const t = String(res.getHeader('Content-Type') || '');
    if (/^(audio|video|image)\//.test(t)) return false;
    if (/zip|octet-stream|webp|mp4|ogg|webm/.test(t)) return false;
    return compression.filter(req, res);
  },
}));
app.use(globalLimiter);

app.get('/api/health', (req, res) => res.json({ status: 'OK', system: 'contabo-deploy-dashboard' }));
// Link público de compartilhamento: fora do guard de login de propósito.
app.use('/s', sharePublic);
// Auth local (offline): registro-bootstrap e login são públicos;
// todo o resto de /api exige JWT ou token mestre.
// Aceita Bearer ou ?token= para EventSource/WS/download direto.
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
// Infra de programador trancada: leigo nem na API encosta.
app.use('/api/contabo', requireDev, contaboRoutes);
app.use('/api/servers', requireDev, serverRoutes);
app.use('/api/apps', requireDev, appRoutes);
app.use('/api/deploy', requireDev, deployRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/chunks', chunkRoutes);
app.use('/api/cloudflare', cloudflareRoutes);
app.use('/api/import', importRoutes);
app.use('/api/share', shareApi);

// serve o frontend estático quando colocado em ../frontend (opcional)
import path from 'node:path';
import fs from 'node:fs';
const FE = path.join(process.cwd(), '..', 'frontend');
if (fs.existsSync(path.join(FE, 'index.html'))) {
  app.use(express.static(FE));
}

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// Erros nunca vazam stack em produção. Multer vira 400 com mensagem segura.
app.use((err, req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Arquivo excede o limite (MAX_UPLOAD_MB no Drive, 500MB no zip de deploy).' });
  if (err) return res.status(400).json({ error: String(err.message || 'Requisição inválida.').slice(0, 200) });
  return res.status(500).json({ error: 'Erro interno.' });
});

ensureAdminBootstrap();
startWorker(); // fila de compressão (imagens) em background
try { purgeTrash(); } catch {} // faxina da lixeira 30d no boot
setInterval(() => { try { purgeTrash(); } catch {} }, 6 * 60 * 60 * 1000);
app.listen(PORT, () => console.log(`🚀 deploy-dashboard backend :${PORT} -> /api/health`));
