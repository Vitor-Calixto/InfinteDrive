// PM2: babá do backend (sobe sozinho, reinicia se cair, logs em arquivo).
// Uso: pm2 start ecosystem.config.cjs · pm2 monit · pm2 logs deploy-center
module.exports = {
  apps: [{
    name: 'deploy-center',
    cwd: './backend',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 20,
    min_uptime: '10s',
    max_memory_restart: '2G',
    env: { NODE_ENV: 'production', PORT: 4000 },
    error_file: './logs/pm2-err.log',
    out_file: './logs/pm2-out.log',
    time: true,
  }],
};
