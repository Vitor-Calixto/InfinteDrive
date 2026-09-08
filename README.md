# Deploy Center — Livro-Mestre do Projeto

> **Tese em uma linha:** seu Drive com cara de Spotify (foto, música, vídeo, playlist, cofre) + deploy de apps com 1 clique, tudo na sua VPS, 100% offline-first.
> **Estado:** funcionando local. Deploy em VPS, loja e pagamentos: roadmap.

---

## Sumário

* Prefácio — o que é e pra quem é
* Cap. 1 — Stacks (backend, frontend, mídia, infra)
* Cap. 2 — Estrutura de pastas
* Cap. 3 — Os módulos, um por um
  * 3.1 Auth — conta, sessão e recuperação
  * 3.2 Perfis — Netflix em casa
  * 3.3 Cofre — pasta com senha
  * 3.4 Storage — o Drive
  * 3.5 Compressão — o espremedor
  * 3.6 Busca — full-text
  * 3.7 Playlists — pastas que tocam
  * 3.8 Chunks — upload gigante com resume
  * 3.9 Deploy — GitHub e .zip viram app no ar (módulo interno, fora da UI)
  * 3.10 Contabo + SSH — olhos na VPS (interno)
  * 3.11 Sistema — disco e admin
  * 3.12 E-mail — recuperação de senha
  * 3.13 CLI — git push da casa
  * 3.14 Compartilhar — link público com prazo
  * 3.15 Importar Google — Drive + Fotos em lote
  * 3.16 Lixeira — 30 dias + restaurar
  * 3.17 Cloudflare — DNS e purge sem dashboard (interno)
* Cap. 4 — Segurança (o juramento anti-vazamento)
* Cap. 5 — Modelo de negócio (por que 20GB valem 200GB)
* Cap. 6 — Rodando local + variáveis de ambiente
* Cap. 7 — Roadmap (o que falta)

---

## Prefácio

Drive bonito pra todo mundo: arrasta foto, toca música, organiza em playlist, tranca cofre com senha, importa do Google. Deploy/SSH/Contabo seguem no motor (é como operamos), fora da vitrine do cliente. A mesma API, um produto só.

---

## Cap. 1 — Stacks

**Backend — o motor** (`backend/`, Node 20+ ESM + Express 5, porta 4000):
`ssh2` (deploy + SFTP), `bcryptjs` (senhas e PINs em hash), `jsonwebtoken` (sessão 12h, offline), `google-auth-library` (login com Google), `multer` (uploads), `sharp` (imagem/WebP/thumb), `ffmpeg-static` (áudio/vídeo, binário local), `music-metadata` (duração/capa do álbum), `pdf-parse` (texto do PDF p/ busca), `yauzl` (valida zip), `archiver` (CLI), `nodemailer` (reset de senha), `express-rate-limit` + `helmet` (blindagem), `uuid`.

**Frontend — o rosto** (`frontend/`, 1 `index.html` + `css/style.css` + `js/app.js`): HTML + CSS próprio estilo Spotify (zero CDN, 100% offline) + Vanilla JS. Views Início/Planos/Lixeira/Admin, `<audio>/<video>` nativo, modal com PDF embutido, menu ⋮ por card, `EventSource` pros logs, `fetch` com JWT, PWA (`manifest.json` + `sw.js` + ícones), gzip no servidor (-70% texto).

**Persistência:** arquivos JSON atômicos em `backend/data/` (tmp+rename + lock por coleção). Sem Postgres: `users, storage, playlists, profiles, search-index, apps, deploys, servers, contabo, queue, audit`. Blobs em `data/files/<userId>/<uuid>.bin` (sem extensão, nunca executável).

**Infra:** qualquer VPS Ubuntu (testado local; Contabo Cloud VPS 10: 4vCPU/8GB/75GB). `ffmpeg` via npm, sem apt. Tier S3 futuro pro frio.

---

## Cap. 2 — Estrutura de pastas

```
contabo-deploy-dashboard/
├── backend/
│   ├── cli/deploy.js            # CLI estilo git (init/add/commit/push/logs)
│   ├── src/
│   │   ├── server.js            # monta tudo: helmet, CORS, JWT, rotas, erros
│   │   ├── config/crypto.js     # AES-256-GCM p/ segredos reutilizáveis (SSH)
│   │   ├── config/store.js      # JSON atômico + lock (anti-perda em corrida)
│   │   ├── config/users.js      # contas: hash, JWT, reset, dev, plano/quota, Google
│   │   ├── middlewares/auth.js  # requireAuth, requireDev, limiters
│   │   ├── middlewares/validate.js # anti-injeção, anti-traversal, sanitize
│   │   ├── middlewares/upload.js   # multer seguro + ALLOW_EXECUTABLES
│   │   ├── middlewares/zipcheck.js # anti-zip-slip do .zip de deploy
│   │   ├── services/sshService.js      # testConnection, runRemoteScript, putFile SFTP, collectStats
│   │   ├── services/contaboService.js  # OAuth Contabo + instâncias/ações
│   │   ├── services/detectorService.js # detecta stack via GitHub API sem clonar
│   │   ├── services/deployService.js   # buildDeployScript + normalizeFlags ([auto])
│   │   ├── services/fileGuard.js       # isolamento por dono, quota, auditoria, wipe, faxina 30d
│   │   ├── services/vault.js           # estado do cofre (sessão, memória)
│   │   ├── services/compressService.js # pool 2 workers + sharp/ffmpeg + thumb + progresso + auto-cura
│   │   ├── services/searchService.js   # índice full-text + extractPdfText + backfill
│   │   ├── services/importService.js   # jobs Drive/Fotos (4 paralelos, token só em RAM)
│   │   ├── services/cloudflareService.js # zonas, DNS, purge (interno)
│   │   ├── services/mailer.js          # nodemailer (ou log em dev)
│   │   └── routes/ authRoutes, profileRoutes, playlistRoutes, storageRoutes,
│   │       chunkRoutes, searchRoutes, shareRoutes (/s público), importRoutes,
│   │       appRoutes, deployRoutes (SSE), serverRoutes, contaboRoutes,
│   │       systemRoutes, cloudflareRoutes (tudo dev gated; UI cliente não mostra)
│   └── data/ (gitignore)        # JSONs + files/ + chunks/ + tmp/
└── frontend/
    ├── index.html               # auth tela cheia + sidebar + views (Início/Planos/Lixeira/Admin) + player + modal
    ├── css/style.css            # tema Spotify + responsivo + PWA-safe (sem CDN)
    ├── js/app.js                # sessão, drive, player, playlists, deploy, planos
    ├── manifest.json + sw.js + icons/
```

---

## Cap. 3 — Os módulos, um por um

### 3.1 Auth — conta, sessão e recuperação
`config/users.js` + `routes/authRoutes.js`. Registro aberto só com base vazia (primeiro vira admin); depois, admin cria. Senha só em hash bcrypt; JWT 12h com versão (logout global derruba tudo). Recuperação: token 64 chars, 1h, uso único, guardado como SHA256; resposta idêntica exista ou não o e-mail. Login com Google opcional (`GOOGLE_CLIENT_ID`): ID token verificado no servidor, conta sem senha local.

### 3.2 Perfis — Netflix em casa
`routes/profileRoutes.js`. 1 conta (login, quota, arquivos), N perfis (até 8) com PIN opcional em hash. Playlists podem pertencer a um perfil; apagar perfil devolve as pastas pra conta. Trocar de perfil não desloga.

### 3.3 Cofre — pasta com senha
`services/vault.js` + pontas em playlists/storage/search. Senha do usuário (bcrypt) por playlist; arquivos do cofre somem de lista, busca, download, thumb e capa até o unlock da sessão (memória — restart tranca). Apagar pasta trancada exige abrir antes. Admin passa (dono da máquina).

### 3.4 Storage — o Drive
`routes/storageRoutes.js` + `services/fileGuard.js`. Upload 10GB (`MAX_UPLOAD_MB`), quota por conta (padrão 20GB), nome em disco = uuid, dono em tudo, 404 genérico pra inexistente/alheio/trancado. Download com `Range` (seek), executável como anexo, auditoria em `audit.json`.

### 3.5 Compressão — o espremedor
`services/compressService.js`. Fila 1-por-vez: foto→WebP q70 + thumb (gif: só thumb), áudio→Opus 96k + capa do álbum + waveform 100pts, vídeo→thumb primeiro + H.264 720p/30fps (`ultrafast` >500MB) com % no meta. Se sair maior, mantém original. Falha nunca perde arquivo. Quota conta o final.

### 3.6 Busca — full-text
`services/searchService.js` + `routes/searchRoutes.js`. Normaliza acento/caixa, AND entre termos, ranqueia nome > tipo/duração > corpo do PDF (extraído no worker + backfill, teto 100MB). Trechinho de contexto no card. Isolada por dono; cofre some; apagar limpa o índice.

### 3.7 Playlists — pastas que tocam
`routes/playlistRoutes.js`. Criar, capa própria (WebP 600), adicionar (1 ou 2000 de uma vez), tirar, apagar (arquivos ficam). Cabeçalho com mosaico + play geral. Filtros por tipo combinam.

### 3.8 Chunks — upload gigante com resume
`routes/chunkRoutes.js`. Acima de 64MB o frontend fatia em 8MB (3 juntas): servidor guarda fatias, monta por stream no destino (sem 2x em disco), valida tamanho/SHA/extensão. Caiu no 99%? Retoma as que faltam.

### 3.9 Deploy — GitHub e .zip viram app no ar (módulo interno, fora da UI do cliente)
`detectorService` (detecta stack sem clonar) + `deployService` (`normalizeFlags` corrige esquecimento e avisa `[auto]` no log; script `set -e`: git ou unzip, `.env`, bancos docker por app, npm/prisma/build, PM2, Nginx + certbot opcional) + `deployRoutes` (SFTP do zip, SSE com replay + ficha integral). Toggles: node/build/pm2/docker/prisma/postgres/mysql/mongo/redis/static/python/php/nginx/ssl.

### 3.10 Contabo + SSH — olhos na VPS
`contaboService` (OAuth, instâncias, start/restart/stop, audits, snapshots) + `sshService` (`collectStats`: uptime, RAM, disco, docker, pm2, nginx). Credenciais AES-GCM, nunca em claro.

### 3.11 Sistema — disco e admin
`routes/systemRoutes.js` (disco real via statfs + alerta 70%) + overview em `authRoutes` (uso/quota/plano por usuário, troca de plano, exclusão com wipe total, último admin protegido).

### 3.12 E-mail — recuperação de senha
`services/mailer.js`. Com SMTP envia de verdade; sem, o link vai pro log (dev). Link carrega `PUBLIC_URL`.

### 3.13 CLI — git push da casa
`backend/cli/deploy.js`: `init` (login 1x, senha nunca salva), `add`, `commit -m` (zipa sem lixo), `push` (valida, deploya, log ao vivo), `logs`. Mesma API do painel, qualquer terminal/CI.

### 3.14 Compartilhar — link público com prazo
`routes/shareRoutes.js` (`/s/:token` público + `/api/share`). Token aleatório, 7 dias padrão, revogável; nunca de cofre/lixeira; `.exe` como anexo. Modal tem fileira WhatsApp/e-mail/Gmail/copiar/nativo; card tem menu ⋮.

### 3.15 Importar Google — Drive + Fotos em lote
`services/importService.js` + `routes/importRoutes.js`. Token com escopo pedido na hora, validado (audiência), só em RAM ~50min. Job com progresso, quota e compressão valendo; Drive pula Docs/Sheets. Modo teste do Google: só testadores.

### 3.16 Lixeira — 30 dias + restaurar
Delete move (`trashedAt`); some de lista/busca/download. Página própria com dias restantes, restaurar, excluir pra sempre, esvaziar. Faxina automática no boot + 6h.

### 3.17 Cloudflare — DNS e purge sem dashboard (interno)
`cloudflareService` + rota + card (fora da UI do cliente). Token escopado AES-GCM: zonas, DNS A/AAAA/CNAME/TXT com proxy, purge.

---

## Cap. 4 — Segurança (o juramento anti-vazamento)

* Senha e PIN: só hash. Segredo reutilizável (SSH): AES-GCM. Token de reset: só SHA256.
* Todo acesso confere dono; inexistente/alheio/trancado = mesmo 404 (sem oráculo).
* Hash sempre no servidor; sha nunca sai no `/list`; dedup global não existe (sem ataque de confirmação).
* Upload: MIME/extensão, 1GB→10GB configurável, zip-slip barrado (testado com zip malicioso real), executável opt-in sem extensão em disco.
* API: JWT ou master, rate-limit por rota, CORS allowlist, helmet com `onclick` liberado + escape de HTML em tudo renderizado.
* Store atômico + lock (multiseleção provada 10/10).

## Cap. 5 — Modelo de negócio (por que 20GB valem 200GB)

A 90% de compressão, 20GB reais guardam ~200GB de originais (medido: 2.51GB→172MB). Vende-se quota lógica: Leve 100GB R$9,90 · Família 500GB R$29,90 · Studio 2TB R$79,90. Custo: VPS €5,50 + Object 250GB €2,49 quando o disco bater 70%. Teto saudável: volume no Família (~R$30, faixa psicológica), nunca preço alto.

## Cap. 6 — Rodando local + variáveis de ambiente

```powershell
cd backend
cp .env.example .env   # preencha CRYPTO_KEY (64 hex) + JWT_SECRET (32+ chars)
npm install; npm run dev   # :4000
```
Painel em `http://localhost:4000/`. Primeiro cadastro vira admin. Variáveis: `PORT, CRYPTO_KEY, JWT_SECRET, ADMIN_TOKEN (recuperação), ADMIN_EMAIL/PASSWORD (bootstrap 1x), GOOGLE_CLIENT_ID, SMTP_*, PUBLIC_URL, ALLOW_EXECUTABLES, MAX_UPLOAD_MB, IMPORT_WORKERS, COMPRESS_WORKERS, CLIENT_URL, GITHUB_TOKEN`.

### Anexo A — Login com Google (não esquecer)
Criação do cliente: https://console.cloud.google.com/auth/clients/create?organizationId=0&project=drivespotify — projeto `DriveSpotify` → tipo **Aplicativo da Web** → origem `http://localhost:4000` → Criar → copiar o **ID do cliente** pra `GOOGLE_CLIENT_ID` no `.env` → reiniciar backend. Grátis pra sempre (só dispensar o banner de trial, sem ativar faturamento). Em produção, **adicionar** `https://seudominio.com` nas origens (lista, não troca). Botão aparece sozinho quando o ID está configurado; o seletor de contas é do Google (cada visitante entra com a sua).

## Cap. 7 — Roadmap (o que falta)

Pagamento (Pix + webhook→quota) · botão excluir conta · termos/LGPD · tier S3 · ghostscript p/ PDF · baixar playlist em zip · app nativo (Capacitor) + WebAuthn · upload fatiado no app mobile. Nada disso quebra o que existe.
