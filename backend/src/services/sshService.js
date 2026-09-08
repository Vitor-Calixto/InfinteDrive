import { Client } from 'ssh2';

// server = { host, port=22, username, password?, privateKey? }
export function testConnection(server) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      try { conn.end(); } catch {}
      reject(new Error('Timeout SSH (10s): confira IP/porta/firewall da VPS'));
    }, 10_000);
    conn
      .on('ready', () => {
        clearTimeout(timeout);
        conn.exec('echo ok && hostname && cat /etc/os-release | head -2', (err, stream) => {
          if (err) { conn.end(); return reject(err); }
          let out = '';
          stream.on('data', (d) => (out += d)).on('close', () => { conn.end(); resolve(out.trim()); });
        });
      })
      .on('error', (e) => { clearTimeout(timeout); reject(e); })
      .connect({
        host: server.host,
        port: server.port || 22,
        username: server.username,
        password: server.password || undefined,
        privateKey: server.privateKey || undefined,
        readyTimeout: 9000,
      });
  });
}

// Envia um arquivo local para a VPS via SFTP, com progresso (0-100).
// Usado pelo deploy via .zip direto da máquina (sem GitHub).
export function putFile(server, localPath, remotePath, onProgress) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return reject(err); }
          sftp.fastPut(localPath, remotePath, {
            step: (sent, chunk, total) => onProgress?.(Math.round((sent / total) * 100)),
          }, (err2) => {
            conn.end();
            err2 ? reject(err2) : resolve(true);
          });
        });
      })
      .on('error', reject)
      .connect({
        host: server.host,
        port: server.port || 22,
        username: server.username,
        password: server.password || undefined,
        privateKey: server.privateKey || undefined,
        readyTimeout: 15000,
      });
  });
}

// Executa um script bash remoto e faz stream das linhas via onLine(line).
// Retorna { code, signal }.
export function runRemoteScript(server, script, onLine) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => {
        conn.exec(`bash -s`, (err, stream) => {
          if (err) { conn.end(); return reject(err); }
          let stderr = '';
          stream
            .on('data', (d) => String(d).split('\n').forEach((l) => l.trim() && onLine?.(l)))
            .stderr.on('data', (d) => {
              stderr += d;
              String(d).split('\n').forEach((l) => l.trim() && onLine?.(`[stderr] ${l}`));
            });
          stream.on('close', (code, signal) => { conn.end(); resolve({ code, signal, stderr }); });
          stream.end(script);
        });
      })
      .on('error', reject)
      .connect({
        host: server.host,
        port: server.port || 22,
        username: server.username,
        password: server.password || undefined,
        privateKey: server.privateKey || undefined,
        readyTimeout: 15000,
      });
  });
}

// Coleta rápida de saúde da VPS (CPU/RAM/disco/docker/pm2/nginx) em 1 conexão.
export async function collectStats(server) {
  const cmd = [
    'echo "---UPTIME---"; uptime',
    'echo "---MEM---"; free -m | head -3',
    'echo "---DISK---"; df -h / | tail -1',
    'echo "---DOCKER---"; (docker ps --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>/dev/null || echo "docker-off")',
    'echo "---PM2---"; (pm2 jlist 2>/dev/null | head -c 4000 || echo "pm2-off")',
    'echo "---NGINX---"; (systemctl is-active nginx 2>/dev/null || service nginx status 2>/dev/null | head -1 || echo "nginx-unknown")',
    'echo "---APPS---"; ls -1 /opt/apps 2>/dev/null || echo "no-apps-dir"',
  ].join('; ');
  let out = '';
  await runRemoteScript(server, cmd, (l) => (out += l + '\n'));
  return out;
}
