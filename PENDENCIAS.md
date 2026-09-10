# Pendências — Deploy Center v10

> Estado em 09/09/2026. Commitado como está; resolver na sequência.

## 🔴 Travando uso real
- [x] **Popup de permissão do Google (Firefox)** — resolvido por **redirect OAuth** + refresh persistido criptografado. Console feito (secret, redirect URI, Drive API, Picker API, escopos, test user).
- [x] **Import Drive e2e** — validado 26/26 (após fix `downloadTo` web stream).
- [x] **Google Fotos Picker e2e** — validado (endpoint correto `/v1/mediaItems?sessionId=`, `/autoclose`). Doc em `DOCS-GOOGLE.md`.
- [ ] **Google Fotos Picker e2e** — código pronto (sessão → escolha → job), falta validar de ponta a ponta (bloqueado pelo item acima). Falta no Console: ativar **Google Photos Picker API** + escopo `photospicker.mediaitems.readonly`.
- [ ] **Import Drive e2e** — pipeline pronto, falta teste real com conta (isola se o problema é só Fotos ou o popup em geral).
- [ ] **Verificação do app no Google** — "DriveSpotify não verificado". Hoje: modo Teste + e-mail em usuários de teste. Produção p/ terceiros exige submissão (privacidade, vídeo demo).

## 🟡 Segurança (revisar antes da VPS)
- [ ] Auditoria: nunca dedup/compartilhar entre usuários (só dono), force-download de HTML/JS/SVG, quota pessimista no upload, 2FA TOTP + backups 1 uso, rate limits (login 10 intacto), XSS em nomes (`esc()`).
- [ ] Confirmar `ALLOW_EXECUTABLES`, `CRYPTO_KEY` e `JWT_SECRET` na VPS (fora do repo — `.env` não versionado).

## 🟢 Funcional pronto, falta validar em volume
- [ ] Retry 429 + reconcile de fatias em lote 200+ arquivos.
- [ ] Recompressão (♻) no vídeo 1.73GB com CRF 30 + denoise.
- [ ] DlQueue bulk (242 arquivos): ordem, dedup, resume, pastas por tipo.
- [ ] Busca servidor com PDFs grandes (snippet) + 2FA login com código reserva.

## 🔵 Frontend (lapidar)
- [ ] Player: testar áudio/vídeo longos, próxima/faixa.
- [ ] Mobile (mobileNav sem vault/admin; player compacto).
- [ ] `pages/` legadas (login/register/forgot standalone) — remover ou alinhar.
- [ ] Revisar telas vazias (playlists sem capa, vault vazio, admin sem usuários).

## ⚙️ Produção (Contabo VPS)
- [ ] `COMPRESS_WORKERS` conforme vCPU (S=2, M=3, L=4).
- [ ] Backup `data/` validado (gerar + restaurar em staging).
- [ ] HTTPS + `PUBLIC_URL` + `CLIENT_URL` finais.
