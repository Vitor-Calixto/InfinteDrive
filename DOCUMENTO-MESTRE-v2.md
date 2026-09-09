# CONTABO DEPLOY CENTER v2.0 UNIFIED - ROCKET EDITION — Documento Mestre

> Local: `F:\workspace\contabo-deploy-dashboard` | Tagline: 1 VPS. 1 Painel. Deploy, Drive Spotify, GitHub Storage e Terminal. | v2.0 2026-09-06
> Status: v1 Deploy pronto. v2 Storage/Spotify/Terminal/Obsidian planejado e especificado aqui.

## SUMÁRIO

1. Objetivo unificado
2. Estado atual v1 vs alvo v2
3. Stack tecnológica definitiva
4. Estrutura de pastas final
5. Modelo de dados — store JSON atômico
6. Segurança
7. M1 Contabo API
8. M2 SSH + Stats + Terminal WS
9. M3 Detector GitHub + GitHub Files View
10. M4 Deploy 1-clique + logs SSE
11. M5 Storage híbrido + compressão por MIME
12. M5-UI Spotify — pastas-playlists, arquivos-músicas + inspiração spotify-fs
13. M6 Obsidian Vault + busca inteligente
14. Frontend — 4 abas
15. API Contract unificado
16. Fluxos ponta a ponta
17. Modelo de negócio — como passar o Google 5TB/R$97
18. Checklist de lançamento + roadmap
19. Operação

## ÍNDICE DETALHADO

- Cap. 3: backend Node+Express, frontend Tailwind+Vanilla, mídia sharp+ffmpeg, Google Drive, WS
- Cap. 7-11: 1 service por capítulo com entradas, saídas e lógica
- Cap. 15: todos os endpoints REST + WS + SSE
- Cap. 17: contas reais Contabo vs Google One AI Pro 5TB

---

## 1. OBJETIVO UNIFICADO

Acabar com 4 assinaturas/ferramentas: Vercel (deploy), Google Drive/Terabox (arquivos), GitHub web (browse de código na VPS), Putty (SSH).
Um motor, duas visões:
- `userRole=dev`: GitHub File Tree + terminal xterm.js + logs SSE.
- `userRole=leigo`: Drive com cara de Spotify. Pasta=Playlist, arquivo=Música, capa, waveform, player embaixo. Arrasta e solta, sem saber o que é VPS/Nginx/Docker.

Mesmo endpoint, mesmo `/opt/apps` e `/opt/storage`, só muda `?view=github|spotify`.

## 2. ESTADO ATUAL v1 vs ALVO v2

Pronto (verificado em disco):
- `backend/src/server.js:18-25` monta 4 routers + static frontend + `/api/health`.
- `backend/src/services/contaboService.js:10` getAccessToken cache 5min + x-request-id.
- `backend/src/services/sshService.js:34` runRemoteScript com stream, `:65` collectStats.
- `backend/src/services/detectorService.js:27` detectStack via GitHub API sem clonar.
- `backend/src/services/deployService.js:9` buildDeployScript bash set -e + PM2/Docker/Nginx.
- `backend/src/config/crypto.js:1` AES-256-GCM iv:tag:enc + `backend/src/config/store.js:21` JSON.
- `backend/src/routes/contaboRoutes.js:43`, `serverRoutes.js:49`, `appRoutes.js:21`, `deployRoutes.js:53` SSE.
- `frontend/index.html:1`, `frontend/js/app.js:171` deployNow+EventSource, `frontend/css/style.css:1`.

Falta (v2, especificado nos caps abaixo):
- `backend/src/services/storageService.js`, `googleDriveService.js`, `obsidianService.js`, `spotifyMetaService.js` (parte do storage).
- `backend/src/routes/storageRoutes.js`, `spotifyRoutes.js`, `obsidianRoutes.js`, `+ WS /api/servers/:id/terminal` em `serverRoutes.js`.
- `frontend`: abas Drive Spotify, GitHub Files, Terminal xterm.js, Vault search.

## 3. STACK TECNOLÓGICA DEFINITIVA

### 3.1 Backend — o motor
- Node 20+ ESM + Express 5 (`backend/package.json:11`). `helmet`, `cors`, `dotenv`, `ssh2`, `uuid`. Rodar: `:4000`.
- Novos para v2: `ws` (terminal, sem `node-pty` — pty local quebra no Windows, usar `ssh2.shell()` remoto), `multer` (upload), `sharp` (imagem/WebP/AVIF/thumb), `fluent-ffmpeg` + binário `ffmpeg` (vídeo/áudio/thumb/waveform), `music-metadata` (duration), `googleapis` (Drive v3), `gray-matter` + `flexsearch` ou `sqlite FTS` (vault search).
- Proibido: Postgres externo, MinIO, ORM no v2-MVP. Mantém JSON atômico.

### 3.2 Frontend — o rosto
- 1 `frontend/index.html` + Tailwind CDN + Vanilla JS + `frontend/css/style.css:1` (`#121212` Spotify + `#0d1117` GitHub Dark + `#10b981` ação).
- `frontend/js/app.js:6` jget/jpost, `:171` EventSource logs, futuro `initXterm()->WebSocket`, `initSpotifyPlayer()`, `initGitHubFileTree()`.
- Player: `<audio>/<video>` nativo com `Range`. Waveform: 100 picos JSON. Sem framework SPA.

### 3.3 Infra VPS
- Cloud VPS M (apps): `/opt/apps/<slug>`, PM2, Nginx `/etc/nginx/sites-available/<slug>`, certbot.
- Storage VPS L (arquivos): `/opt/storage/store|thumbs|tmp`, montado via sshfs/S3 no app-server. Tráfego Contabo ilimitado fair-use, egress Object Storage free.

## 4. ESTRUTURA DE PASTAS FINAL

```
contabo-deploy-dashboard/
├── backend/src/
│ ├── config/crypto.js + store.js
│ ├── routes/contaboRoutes.js [M1] /api/contabo
│ │ ├── serverRoutes.js [M2] /api/servers + /:id/stats + /:id/terminal [WS]
│ │ ├── appRoutes.js [M3] /api/apps + /detect + /preview + /:id/files
│ │ ├── deployRoutes.js [M4] /api/deploy/:appId + /:deployId/logs [SSE]
│ │ ├── storageRoutes.js [M5] /api/storage/list|upload|download|rm|quota
│ │ ├── spotifyRoutes.js [M5-UI] /api/spotify/auth? (só se usar API oficial p/ capa) + /detect
│ │ └── obsidianRoutes.js [M6] /api/vault/search|note|backlinks
│ ├── services/contaboService.js + sshService.js + detectorService.js + deployService.js
│ │ ├── storageService.js + googleDriveService.js + spotifyMetaService.js + obsidianService.js
│ └── server.js
├── frontend/index.html [4 ABAS] + css/style.css + js/app.js
├── backend/data/ [GITIGNORE] contabo.json servers.json apps.json deploys.json storage.json vault-index.json
└── docs/ [Obsidian Vault] 01-arquitetura.md 02-storage.md 03-terminal.md deploys/<app>-<data>.md
```

## 5. MODELO DE DADOS — STORE JSON ATÔMICO

`backend/src/config/store.js:21` write tmp->rename. Coleções:
- `contabo.json`: `{id,label,clientId,apiUser,clientSecretEnc,apiPasswordEnc}` — nunca retorna Enc, ver `backend/src/routes/contaboRoutes.js:19`.
- `servers.json`: `{id,label,host,port,username,passwordEnc,privateKeyEnc}`.
- `apps.json`: `{id,name,githubUrl,domain,port,envVars,flags,dbProvider,serverId}`. flags: node|build|pm2|docker|prisma|postgres|mysql|mongo|redis|static|python|php|nextjs|vite.
- `deploys.json`: `{id,appId,appName,server,status,startedAt,finishedAt,log[]}`.
- `storage.json` [v2]: `{id,ownerId,sha256,name,mime,sizeOrig,sizeFinal,tier:local|drive,driveId,cover,duration,waveform,appId,createdAt}`.
- Regra: <10k arquivos mantém JSON. Acima migra só `storage.json`+vault-index pra SQLite FTS, blobs intactos.

## 6. SEGURANÇA

- `CRYPTO_KEY=64 hex` em `backend/.env.example:4`. `backend/src/config/crypto.js:13` encrypt/`decryptSecret`. Segredos nunca em claro, nunca no git (`backend/data/*.json` + `.env` no `.gitignore`).
- `helmet` + `cors` em `backend/src/server.js:13`. v2 adicionar: `express-rate-limit` 10/min em login/upload/detect, `multer` limits 500MB + allowlist MIME + `helmet.crossOriginResourcePolicy:false` p/ stream.
- Por arquivo não criptografar blob com AES — quebra dedup e Range. Criptografa só metadado sensível.

## 7. M1 CONTABO API

`backend/src/services/contaboService.js:10` OAuth password grant, cache token -30s, `x-request-id` uuid.
`listInstances|getInstance|instanceAction(start|restart|stop|shutdown)|listAudits|listSnapshots|listImages|listStorages`.
Lógica: infra read-only + power actions. Deploy real é SSH, não Contabo API. Erro padrão `Contabo METHOD path -> status: trecho`.

## 8. M2 SSH + STATS + TERMINAL WS

- `testConnection` em `backend/src/services/sshService.js:4` timeout 10s.
- `runRemoteScript(server,script,onLine)` em `:34`: `bash -s`, split `\n`, prefixo `[stderr]`, resolve `{code,signal}`.
- `collectStats` em `:65`: `uptime; free -m; df -h /; docker ps; pm2 jlist; nginx; ls /opt/apps` em 1 conexão.
- Terminal v2: `GET /api/servers/:id/terminal` upgrade WS -> `ssh2.conn.shell({term:'xterm-256color',cols,rows})` com `cd /opt/apps/<nome> && bash`. `xterm.js` onData->WS->shell.stdin, shell.stdout->WS. Resize via `{type:'resize'}`. Sem `node-pty`. 1 WS = 1 conn SSH, fecha em close, timeout 15min idle.

## 9. M3 DETECTOR GITHUB + GITHUB FILES VIEW

- `parseGithubUrl` + `detectStack(url)` em `backend/src/services/detectorService.js:6,27`: `GET /repos/{o}/{r}/contents/` + `package.json` + `docker-compose.yml/compose.yaml` + `Dockerfile` + `prisma/schema.prisma` + `requirements.txt`. Usa `GITHUB_TOKEN` se houver. Retorna `{flags,dbProvider,hints}`. `GET /api/apps/detect?url=` em `backend/src/routes/appRoutes.js:21`, `POST /api/apps/preview` em `:27`.
- Files view v2: `GET /api/apps/:id/files?path=/src` -> `runRemoteScript ls -la + git log -1` em `/opt/apps/<slug>` -> `[{name,type,size,lastCommit}]`. Mesmo dado do storage list, formato GitHub Dark.

## 10. M4 DEPLOY 1-CLIQUE + LOGS SSE

`buildDeployScript(app)` em `backend/src/services/deployService.js:9`: slug, `mkdir -p /opt/apps`, `git pull --rebase` ou `clone`, `.env` via heredoc, network+containers por app (`postgres:16|mysql:8|mongo:7|redis:7`), `npm ci|install`, `prisma generate+push`, `npm run build||true`, `pm2 restart|start`, Nginx vhost + `certbot --nginx||true`.
`POST /api/deploy/:appId` em `backend/src/routes/deployRoutes.js:12`: merge flags do body, `upsertRow deploys running`, responde `{deployId}` imediato, roda em background emitindo por `clients Map` + `GET /:deployId/logs` SSE em `:53` com replay + `{done,status}`.

## 11. M5 STORAGE HÍBRIDO + COMPRESSÃO POR MIME

### 11.1 Layout
`/opt/storage/store/<aa>/<bb>/<sha256>` content-addressable + `thumbs/<sha>-300.webp` + `tmp/` + `meta/storage.json`. Dedup por SHA256 economiza 20-30%.

### 11.2 Pipeline upload
`multer tmp` -> mime -> sha256 -> existe? referencia -> fila background (não trava request) -> comprime -> tier -> meta. Retorna `processing`, avisa via SSE.

### 11.3 Compressão máxima por tipo
- `image/*`: `sharp` -> AVIF q60 / WebP q70 + strip EXIF + thumb 300px. -60/70%.
- `video/*`: `ffmpeg` preview 720p H.265 crf28 local + original -> Drive + thumb `-ss 1 -vframes 1`. -70/80%.
- `audio/*`: `ffmpeg` Opus 96k + `music-metadata` duration + waveform 100 picos. -50/60%.
- PDF/docs: `ghostscript /ebook` + brotli texto. -40/60%.
- texto/código/CSV/JSON: brotli11 / zstd19. -70/85%.
- genérico/zip/apk: só zstd rápido, já comprimido não ganha.

### 11.4 Tiering
`<50MB` e quente = `tier:local`, serve com `Range` pra seek. `>50MB` ou frio 30d = `drive.files.create` + salva `driveId+thumbnailLink`, apaga blob, mantém thumb. `GET /api/storage/download?id=` faz proxy Drive ou redirect `alt=media`.

### 11.5 Quota
Soma `sizeFinal` por `ownerId` antes de salvar. Estoura -> 402. Monitor `df -h` via `collectStats` trava upload global a 90%.

## 12. M5-UI SPOTIFY + INSPIRAÇÃO spotify-fs

Metáfora, não storage real no Spotify (PoC Xelckis/spotify-fs mapeia 1 byte=1 track, 10KB=10k músicas, linked-list via description, `WriterWorker/ReaderWorker` 3 workers + retry 429/502, `_Decoder.gob` + senha seed. Viola ToS, 1M x ineficiente — não copiar como disco).
Copiar: Pasta=Playlist, Arquivo=Música, description=`nextId` pra shard, decoder sidecar `{cover,waveform,duration}` criptografado, workers+backoff na compressão/upload. `GET /api/storage/list?view=spotify` -> `[{id,cover,duration,waveform}]`, `?view=github` -> tree. Player embaixo com audio/video + capa.

## 13. M6 OBSIDIAN VAULT + BUSCA INTELIGENTE

Vault = `docs/` markdown, sem servidor Obsidian (não existe API oficial).
- Auto-doc por deploy/upload/terminal: frontmatter `{app,tipo,status,tags,links:[[01-arquitetura]]}` + logs. Git versiona, desktop Obsidian abre com backlinks/graph grátis.
- `GET /api/vault/search?q=` v2-básico: `gray-matter` + ripgrep full-text + `tag:` + `[[link]]`. Cobre 80%.
- Médio: `flexsearch/sqlite-FTS` + backlinks `mencionado em`. Avançado: embeddings em chunks, só acima de 2k notas.

## 14. FRONTEND — 4 ABAS

`frontend/index.html`: 1 Deploy Center (conta SSH + cola GitHub + 10 checkboxes + SUBIR + `previewBox` + `logs` SSE) | 2 Drive Spotify (grid capas + player) | 3 GitHub Files (tree + preview código + histórico + editar) | 4 Terminal (xterm.js WS) + Vault search input. `frontend/js/app.js` mantém `saveContabo,saveServer,testServer,loadStats,autoDetect,previewDeploy,saveApp,deployNow->EventSource` + novos `initXterm,initSpotifyPlayer,initGitHubFileTree`.

## 15. API CONTRACT UNIFICADO

```
GET /api/health
GET|POST|DELETE /api/contabo + /instances + /instances/:id/:action + /audits|snapshots|images
GET|POST|DELETE /api/servers + POST /:id/test + GET /:id/stats + WS /:id/terminal
GET|POST|DELETE /api/apps + GET /detect?url= + POST /preview + GET /:id/files?path=
POST /api/deploy/:appId + GET /:deployId/logs [SSE] + GET /api/deploy
GET /api/storage/list?path=&view=spotify|github + POST /upload + GET /download?id= + DELETE /:id + GET /quota
GET /api/vault/search?q= + POST /vault/note + GET /vault/backlinks?note=
```

## 16. FLUXOS PONTA A PONTA

Dev: cola GitHub -> `detect` -> checkboxes -> SUBIR -> `buildDeployScript` -> `runRemoteScript /opt/apps/<slug>` -> EventSource logs + WS terminal -> OK -> md em `docs/deploys/` -> aparece em Files tree.
Leigo: arrasta arquivo -> upload -> hash/comprime/thumb -> lista Spotify -> play com Range -> grande vai pro Drive transparente -> vira nota Obsidian.

## 17. MODELO DE NEGÓCIO — COMO PASSAR O GOOGLE 5TB/R$97

Google One AI Pro 5TB R$96,99 = R$19,40/TB, subsidiado, imbatível no cru. Contabo Object 5TB €49,80 ~R$270 = R$54/TB. Storage VPS 1,4TB €29,60 ~R$160 = R$114/TB.
Não vender TB, vender plano+assento: Free 20GB/1app isca, Starter 100GB/5apps R$19,90, Creator 400GB/20apps R$49,90, Studio 1TB/ilimitado R$129,90. 10x Creator com uso médio 120GB = 1,2TB em 1,6TB VPS L R$137. Receita R$499, lucro R$362, margem 72%. Alternativa margem 95%: BYOS, cliente pluga Drive/S3 dele, cobra R$29,90 só pelo software.

## 18. CHECKLIST LANÇAMENTO + ROADMAP

v2-MVP: `CRYPTO_KEY`, `multer+sharp+ffmpeg+music-metadata+googleapis+ws+gray-matter`, `data/` gitignore, upload 10MB local + 100MB Drive, Range seek, quota 402, WS terminal `ssh.shell`, vault search básico.
Ordem: 1 storage local+Spotify UI 2 compressão/thumbs 3 Drive híbrido 4 terminal WS 5 Obsidian auto-doc. Depois: SQLite FTS, HLS, BYOS, seats.

## 19. OPERAÇÃO

```bash
cd backend; cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" # CRYPTO_KEY
npm install; npm run dev # :4000
npx serve ../frontend -l 5500
```
Conta: my.contabo.com > Account > Security & Access > API. SSH: IP+root+senha/chave -> Testar -> Saúde. Deploy: cola URL -> Detectar -> porta/domínio/.env -> SUBIR.

como fazemos a compressão de 90%?

1. O Desafio Numérico do Vídeo Cru
Para entender a necessidade de comprimir dados, basta calcular o volume bruto de um vídeo de alta resolução
:
Resolução 4K: Possui 3840 x 2160 pixels, totalizando 8.294.400 pixels por quadro
.
Modelo RGB (24 bits): Utiliza 1 byte para Vermelho, 1 byte para Verde e 1 byte para Azul (3 bytes por pixel no total)
.
Tamanho por Imagem: Multiplicando a quantidade de pixels por 3 bytes, uma única foto 4K sem compressão ocupa cerca de 24,88 MB
.
Taxa de Transmissão: Em um vídeo executado a 30 quadros por segundo (fps), são gerados aproximadamente 711 MB por segundo
.
Volume em 2 Horas: Um filme de duas horas sem compressão exigiria nada menos que 5 Terabytes de armazenamento
.
Como cortar bits diretamente do modelo RGB reduz drasticamente a paleta de 16 milhões de cores para apenas 4 mil (gerando uma perda visual inaceitável)
, a solução exige mudar a forma matemática de representar as cores e a imagem
.
2. Compressão Espacial e de Cores (Imagens e Quadros)
A) Conversão para YUV (YCbCr) e Subamostragem de Croma
Mudança de Espaço de Cor: O vídeo é convertido de RGB para YUV (YCbCr) por meio de multiplicação de matrizes de álgebra linear
. O componente Y (Luma) guarda a luminância/brilho (imagem em escala de cinza), enquanto U e V (Chroma) armazenam a informação de cor
.
Sensibilidade Humana: O olho humano é biologicamente muito mais sensível a variações de brilho (Luma) do que a variações sutis de cor (Chroma)
.
Subamostragem (Chroma Subsampling):
4:4:4: Preserva 100% das informações de Luma e Chroma sem compressão visual
.
4:2:2: Mantém a Luma intacta e reduz a informação de cor pela metade
.
4:2:0: Mantém os 4 pontos de Luma, mas reduz a cor para apenas 2 pontos na primeira linha e nenhum na segunda
. Isso economiza cerca de 40% de dados sem perda perceptível para o olho humano em vídeos em movimento, sendo o padrão de TVs, DVDs, Blu-rays e streaming (YouTube)
.
B) Transformada Discreta de Cosseno (DCT)
Divisão em Blocos: A imagem é dividida em blocos de 8x8 pixels
.
Ajuste de Escala: Subtrai-se 128 de cada valor de pixel para centralizar a escala entre -128 e 127
.
Decomposição em Frequências: A DCT decompõe cada bloco em uma soma ponderada de 64 funções de base de cosseno
. Isso isola os componentes de baixa frequência (estruturas gerais, no canto superior esquerdo do bloco) dos de alta frequência (detalhes minuciosos e ruídos, no canto inferior direito)
.
C) Quantização (Onde Ocorre a Perda Real)
Divisão por Matriz: Os coeficientes da DCT são divididos por uma matriz de quantização (ajustada pelo nível de qualidade escolhido) e arredondados para inteiros
.
Descarte de Altas Frequências: Como o olho humano não distingue variações finas de alta frequência, a divisão transforma a maioria desses coeficientes em zeros
. É nesta etapa que ocorre a compressão com perda (lossy)
.
D) Varredura em Zig-Zag
O bloco quantizado é reescrito em forma de vetor seguindo um padrão em zig-zag a partir do canto superior esquerdo
. Isso agrupa todos os zeros no final da sequência, facilitando a compressão subsequente
.
3. Algoritmos de Codificação Sem Perda (Lossless)
Após preparar a estrutura dos dados, aplicam-se algoritmos que reduzem o arquivo sem descartar nenhuma informação adicional
:
A) RLE (Run-Length Encoding)
Substitui sequências repetidas por uma contagem simples
. A longa sequência de zeros resultante do zig-zag é comprimida indicando apenas o valor e a quantidade de repetições
.
B) Codificação de Huffman (Huffman Coding)
Análise de Frequência e Árvore Binária: Conta a ocorrência de cada símbolo no arquivo e constrói uma árvore binária de frequências
.
Atribuição de Bits Variável: Símbolos mais frequentes recebem códigos binários curtos (ex: 2 bits); símbolos raros recebem códigos mais longos
. Em dados com alta repetição, isso reduz o tamanho do arquivo significativamente sem nenhuma perda
.
O Padrão JPEG: A união de subamostragem de croma 4:2:0, DCT, quantização, varredura em zig-zag, RLE e Huffman forma a base do formato JPEG, reduzindo uma foto de 20 MB para menos de 1 MB (compressão de 20:1 a 30:1)
.
C) A Família Lempel-Ziv e o Formato PNG
LZ77: Utiliza uma janela deslizante (sliding window) de memória para identificar padrões repetidos e os substitui por ponteiros que indicam a distância e o comprimento da repetição anterior
.
Deflate: Algoritmo criado por Phil Katz que combina o LZ77 com a Codificação de Huffman, servindo de base para o PKZIP, arquivos .zip, Gzip e imagens PNG
.
GIF vs. PNG: O GIF limita a paleta a 256 cores e usa o algoritmo LZW (que gerou controvérsias de patentes na década de 1990 com a Unisys)
. Isso motivou a criação do PNG, um formato aberto baseado em Deflate que suporta milhões de cores e transparência alfa de alta qualidade sem perda de informação (lossless)
.
4. Compressão Temporal de Vídeo
Apenas aplicar compressão de imagem quadro a quadro (como no formato Motion JPEG) reduz o filme de 5 TB para cerca de 256 GB, o que ainda exigiria cerca de 12 horas de download
. A solução definitiva é explorar a repetição no tempo
:
A) Quadros de Referência (Keyframes) e Deltas
Em um vídeo, o cenário de fundo costuma permanecer estático, alterando-se apenas os objetos ou pessoas em movimento
.
Inter-frames (Keyframes): Quadros completos gravados periodicamente
.
Intra-frames (Deltas): Quadros intermediários que armazenam apenas as alterações/diferenças em relação ao keyframe anterior
. Remover o cenário estático de milhares de quadros economiza um volume enorme de dados
.
B) Codecs de Consumo vs. Codecs Profissionais (Edição)
Codecs de Consumo (H.264 / AVC e H.265 / HEVC):
Combinam a compressão temporal por deltas com a subamostragem YUV 4:2:0
.
Reduzem o filme de 2 horas para cerca de 20 a 25 Gigabytes (35 a 45 Mbps), permitindo o streaming em tempo real
.
O H.265 (HEVC) gera arquivos até 50% menores que o H.264 com qualidade equivalente, mas exige mais capacidade de processamento para descomprimir
.
Desvantagem na Edição: Como os quadros intermediários dependem de keyframes anteriores, editores de vídeo precisam reprocessar constantemente vários quadros para exibir um único ponto da linha do tempo, tornando a edição pesada
.
Codecs Profissionais e de Edição (ProRes, DNxHR, REDCODE):
Gravam apenas quadros completos (keyframes), sem deltas temporais, preservando croma 4:2:2 ou 4:4:4
.
Geram arquivos bem maiores (cerca de 1 GB por minuto ou mais)
, mas oferecem navegação fluida na edição em tempo real, pois o computador lê cada quadro diretamente sem precisar recalcular diferenças
.

https://www.youtube.com/watch?v=j4a1SgUWh1c
