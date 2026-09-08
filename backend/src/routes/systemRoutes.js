import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { readCollection } from '../config/store.js';
import { requireAuth, requireDev } from '../middlewares/auth.js';

const r = Router();
r.use(requireAuth, requireDev);

// GET /api/system/disk — disco real (statfs) + uso do app (soma sizeFinal).
// Alerta em 70%: hora de assinar o Object Storage.
r.get('/disk', (req, res) => {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const st = fs.statfsSync(dataDir);
    const totalB = st.blocks * st.bsize;
    const freeB = st.bfree * st.bsize;
    const usedB = totalB - freeB;
    const mine = readCollection('storage').filter((m) => req.user.role === 'admin' ? true : m.ownerId === req.user.id);
    const appB = mine.reduce((a, m) => a + (Number(m.sizeFinal ?? m.sizeOrig) || 0), 0);
    const pct = totalB > 0 ? Number(((usedB / totalB) * 100).toFixed(1)) : 0;
    if (pct >= 70) console.warn(`[disco] ${pct}% ocupado — hora do Object Storage.`);
    const MB = (b) => b / (1024 * 1024);
    return res.json({
      diskTotalMB: MB(totalB), diskFreeMB: MB(freeB), diskUsedMB: MB(usedB), pct,
      appMB: MB(appB), files: mine.length,
      alert: pct >= 70 ? 'Disco acima de 70%. Hora de plugar o Object Storage.' : '',
    });
  } catch (e) { return res.status(500).json({ error: 'Falha ao ler disco.' }); }
});

export default r;
