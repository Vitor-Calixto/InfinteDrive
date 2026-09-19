# Pendências — Deploy Center v10

> Atualizado em 11/09/2026 (commit `45616ef`).

## 🔴 Travando uso real
- [x] Popup Google (Firefox) → redirect OAuth + refresh persistido.
- [x] Import Drive e2e (26/26) · Fotos Picker e2e (`/v1/mediaItems?sessionId=`, `/autoclose`).
- [ ] **HEIC: capas quebradas no navegador** (pipeline OK, bytes OK — falta o Status da request `thumb/` no Network do usuário: 401 = relogar, 200 = investigar decode).
- [ ] **Verificação do app no Google** — modo Teste + test user hoje; submissão (privacidade, vídeo demo) só p/ terceiros.

## 🟡 Segurança (revisar antes da VPS)
- [ ] Auditoria de código (isolamento por dono, force-download, quota, 2FA, limits, XSS).
- [ ] `.env` da VPS: `ALLOW_EXECUTABLES`, `CRYPTO_KEY`, `JWT_SECRET` (fora do repo).

## 🟢 Validar em volume (código pronto)
- [ ] Retry 429 + reconcile em lote 200+ (novo código ainda não apanhou de verdade).
- [ ] Recompressão ♻ e2e · DlQueue bulk 242 (ordem/dedup/resume) · busca PDF grande · 2FA com código reserva.

## 🔵 Frontend (falta pouco)
- [x] Player (seek, auto-next, MediaSession) · pages/ removidas · admin só p/ admin · vazios.
- [ ] mobileNav sem playlists/profiles/vault (só 5 itens).
- [ ] **Cloudflare: tela** (backend DNS/purge pronto, sem front).

## ⚙️ Produção (Contabo VPS)
- [ ] `COMPRESS_WORKERS` por vCPU · backup `data/` validado · HTTPS + `PUBLIC_URL`/`CLIENT_URL`.
- [x] Decisão AV1: **não fazer** (usuário não abre mão de qualidade; pipeline atual mantido).
