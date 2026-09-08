// Gera o script bash executado via SSH a partir do GitHub + flags (auto-detect + overrides manuais).
// app = { name, githubUrl, domain?, port, envVars?, flags: {node,build,prisma,postgres,mysql,mongo,redis,docker,pm2,...}, dbProvider }
import path from 'node:path';

function slug(s) {
  return String(s || 'app').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
}

// Deploy inteligente: corrige esquecimentos antes de gerar o script.
// Toda correção vira linha "[auto]" no log — nada acontece em silêncio.
export function normalizeFlags(app) {
  const f = { ...(app.flags || {}) };
  const db = app.dbProvider || 'none';
  const fixes = [];
  if (f.static && (f.node || f.pm2 || f.docker || f.build)) {
    f.node = false; f.pm2 = false; f.docker = false; f.build = false;
    fixes.push('Estático: runtimes desligados (só Nginx servindo HTML).');
  }
  if (f.docker && f.pm2) {
    f.pm2 = false;
    fixes.push('Docker ligado: PM2 desligado (container já gerencia o processo).');
  }
  if (f.node && !f.docker && !f.pm2) {
    f.pm2 = true;
    fixes.push('PM2 ligado sozinho: Node sem Docker nem PM2 cai no reboot.');
  }
  if (!f.node && !f.docker && !f.static && !f.python && !f.php) {
    f.node = true; f.pm2 = true;
    fixes.push('Nada marcado: assumi Node + PM2 (padrão). Confira a detecção.');
  }
  if (db === 'postgresql' && !f.postgres) { f.postgres = true; fixes.push('Postgres ligado sozinho (banco=postgresql).'); }
  if (db === 'mysql' && !f.mysql) { f.mysql = true; fixes.push('MySQL ligado sozinho (banco=mysql).'); }
  if (db === 'mongodb' && !f.mongo) { f.mongo = true; fixes.push('Mongo ligado sozinho (banco=mongodb).'); }
  if (f.prisma && db === 'none' && !f.postgres && !f.mysql && !f.mongo) {
    fixes.push('Atenção: Prisma marcado sem banco — confira DATABASE_URL no ENV.');
  }
  return { flags: f, fixes };
}

export function buildDeployScript(app) {
  const name = slug(app.name);
  const dir = `/opt/apps/${name}`;
  const port = Number(app.port) || 3000;
  const { flags: f, fixes } = normalizeFlags(app);
  const db = app.dbProvider || 'none';
  const L = [];

  L.push(`set -e`, `echo "== DEPLOY ${name} =="`, `mkdir -p /opt/apps`, `cd /opt`);
  fixes.forEach((m) => L.push(`echo "[auto] ${m}"`));

  // 1. Código: GitHub (clone/pull) ou .zip enviado da máquina (SFTP).
  if (app.source === 'upload') {
    const zip = `/tmp/deploy-${name}.zip`;
    L.push(
      `if [ ! -f "${zip}" ]; then echo "[zip] ERRO: pacote não chegou na VPS."; exit 1; fi`,
      `command -v unzip >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq unzip) || true`,
      `echo "[zip] extraindo pacote da máquina..."`,
      `mkdir -p "${dir}"`,
      // Extrai por cima (update) preservando .env e data locais do app.
      `unzip -q -o "${zip}" -d "${dir}"`,
      `rm -f "${zip}"`,
      `cd "${dir}"`,
    );
  } else {
    L.push(
      `if [ -d "${dir}/.git" ]; then echo "[git] pull..."; cd "${dir}" && git pull --rebase; else echo "[git] clone..."; rm -rf "${dir}"; git clone "${app.githubUrl}" "${dir}"; cd "${dir}"; fi`,
    );
  }

  // 2. .env do app
  if (app.envVars) {
    L.push(`echo "[env] gravando .env..."`, `cat > "${dir}/.env" <<'APPENV'\n${app.envVars}\nAPPENV`);
  }

  // 3. Bancos auxiliares via docker (1 container por serviço, rede isolada por app)
  const net = `${name}-net`;
  const needNet = f.postgres || f.mysql || f.mongo || f.redis || ['postgresql', 'mysql', 'mongodb'].includes(db);
  if (needNet) L.push(`docker network inspect ${net} >/dev/null 2>&1 || docker network create ${net}`);
  if (f.postgres || db === 'postgresql') {
    L.push(
      `echo "[db] postgres..."`,
      `docker rm -f ${name}-db-postgres 2>/dev/null || true`,
      `docker run -d --name ${name}-db-postgres --network ${net} --restart unless-stopped -e POSTGRES_PASSWORD=${name}123 -e POSTGRES_DB=${name} -v ${name}-pgdata:/var/lib/postgresql/data postgres:16`,
    );
  }
  if (f.mysql || db === 'mysql') {
    L.push(
      `echo "[db] mysql..."`,
      `docker rm -f ${name}-db-mysql 2>/dev/null || true`,
      `docker run -d --name ${name}-db-mysql --network ${net} --restart unless-stopped -e MYSQL_ROOT_PASSWORD=${name}123 -e MYSQL_DATABASE=${name} -v ${name}-mysqldata:/var/lib/mysql mysql:8`,
    );
  }
  if (f.mongo || db === 'mongodb') {
    L.push(
      `echo "[db] mongo..."`,
      `docker rm -f ${name}-db-mongo 2>/dev/null || true`,
      `docker run -d --name ${name}-db-mongo --network ${net} --restart unless-stopped -v ${name}-mongodata:/data/db mongo:7`,
    );
  }
  if (f.redis) {
    L.push(
      `echo "[db] redis..."`,
      `docker rm -f ${name}-redis 2>/dev/null || true`,
      `docker run -d --name ${name}-redis --network ${net} --restart unless-stopped redis:7`,
    );
  }

  // 4. Build / dependências
  if (f.docker) {
    L.push(`echo "[docker] compose up..."`, `cd "${dir}"`, `(docker compose up -d --build || docker-compose up -d --build)`, `docker ps --filter name=${name} --format "{{.Names}} {{.Status}}"`);
  } else if (f.node) {
    L.push(`echo "[node] install..."`, `cd "${dir}"`, `if [ -f package-lock.json ]; then npm ci --omit=dev || npm install; else npm install; fi`);
    if (f.prisma) {
      L.push(`echo "[prisma] generate + push..."`, `npx prisma generate || true`, `npx prisma db push --accept-data-loss || npx prisma migrate deploy || true`);
    }
    if (f.build) L.push(`echo "[node] build..."`, `npm run build || true`);
    if (f.pm2) {
      L.push(
        `echo "[pm2] restart..."`,
        `npm i -g pm2 >/dev/null 2>&1 || true`,
        `(pm2 describe ${name} >/dev/null 2>&1 && pm2 restart ${name} --update-env) || (PORT=${port} pm2 start npm --name "${name}" -- start || PORT=${port} pm2 start src/server.js --name "${name}")`,
        `pm2 save || true`,
      );
    } else {
      // sem pm2: roda com systemd simples via nohup? Preferimos pm2 mesmo assim
      L.push(`echo "[run] pm2 fallback..."`, `npm i -g pm2 >/dev/null 2>&1 || true`, `PORT=${port} pm2 start npm --name "${name}" -- start || true`, `pm2 save || true`);
    }
  } else if (f.python) {
    L.push(`echo "[python] venv + deps..."`, `cd "${dir}"`, `python3 -m venv .venv || true`, `. .venv/bin/activate; pip install -r requirements.txt || pip install flask gunicorn || true`, `npm i -g pm2 >/dev/null 2>&1 || true`, `pm2 delete ${name} 2>/dev/null || true`, `. .venv/bin/activate; PORT=${port} pm2 start ".venv/bin/python app.py" --name "${name}" || . .venv/bin/activate; PORT=${port} pm2 start ".venv/bin/python main.py" --name "${name}" || true`);
  } else if (f.php) {
    L.push(`echo "[php] composer + permissões..."`, `cd "${dir}"`, `composer install --no-dev --optimize-autoloader || true`, `mkdir -p storage bootstrap/cache || true`, `chmod -R 775 storage bootstrap/cache 2>/dev/null || true`, `php artisan migrate --force || true`);
  } else if (f.static) {
    L.push(`echo "[static] publicando em /var/www/${name}..."`, `mkdir -p /var/www/${name}`, `WEB="."; for d in frontend public dist build; do if [ -f "${dir}/$d/index.html" ]; then WEB="$d"; break; fi; done; echo "[static] pasta web: $WEB"`, `cp -r "${dir}/$WEB/"* /var/www/${name}/`);
  }

  // 5. Nginx reverso (se tiver domínio e toggle ligado) + SSL opcional
  const wantNginx = app.domain && f.nginx !== false;
  const wantSsl = wantNginx && f.ssl !== false;
  if (wantNginx) {
    const rootOrProxy = f.static
      ? `root /var/www/${name};\n    index index.html;`
      : f.php
        ? `root ${dir}/public;\n    index index.php index.html;\n    location / { try_files $uri $uri/ /index.php?$query_string; }\n    location ~ \\.php$ { include snippets/fastcgi-php.conf; fastcgi_pass unix:/run/php/php8.3-fpm.sock; }`
        : `proxy_pass http://127.0.0.1:${port};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;`;
    L.push(
      `echo "[nginx] ${app.domain}..."`,
      `cat > /etc/nginx/sites-available/${name} <<'NGINX'\nserver {\n  listen 80;\n  server_name ${app.domain};\n  location / {\n    ${rootOrProxy}\n  }\n}\nNGINX`,
      `ln -sf /etc/nginx/sites-available/${name} /etc/nginx/sites-enabled/${name}`,
      `nginx -t && systemctl reload nginx`,
    );
    if (wantSsl) {
      L.push(`certbot --nginx -d ${app.domain} --non-interactive --agree-tos -m admin@${app.domain} || echo "[ssl] rode certbot manualmente depois"`);
    } else {
      L.push(`echo "[ssl] pulado (toggle desligado)."`);
    }
  } else if (app.domain) {
    L.push(`echo "[nginx] pulado (toggle desligado). App na porta ${port}."`);
  } else {
    L.push(`echo "[ok] App no ar na porta ${port}. Configure um domínio depois para SSL."`);
  }

  L.push(`echo "== DEPLOY OK: ${name} =="`);
  return { name, dir, script: L.join('\n'), fixes };
}
