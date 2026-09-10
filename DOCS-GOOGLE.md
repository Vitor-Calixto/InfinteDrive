# Integração Google (Drive + Photos) — Deploy Center

> ✅ Validado em produção local em 10/09/2026 (Drive 26/26 + Picker com autoclose).
> ⚠️ NÃO usar `photoslibrary.readonly` + `GET .../v1/mediaItems` para ler a biblioteca:
> a Library API morreu para leitura geral em 31/03/2025 (volta vazio/403).
> Fotos é **sempre** via Picker API (seção 3).

## 1. Cloud Console (projeto DriveSpotify)

1. **APIs e serviços → Biblioteca**, ativar as duas:
   - `Google Drive API`
   - `Google Photos Picker API`
2. **Google Auth Platform → Branding**: nome, e-mail de suporte.
3. **Público-alvo**: modo **Teste** + e-mail em **usuários de teste**.
4. **Acesso a dados**: adicionar (string completa):
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`
5. **Clientes** → cliente Web:
   - **URIs de redirecionamento autorizados**: `http://localhost:4000/api/auth/google/callback`
     (produção: trocar pela URL final antes de subir)
   - Copiar **ID do cliente** e **Segredo do cliente**.
6. **Central de verificação**: só quando terceiros forem usar (modo Teste basta p/ uso próprio).

## 2. `.env` (backend — nunca versionado)

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
PUBLIC_URL=http://localhost:4000   # produção: https://seu-dominio
```

## 3. Fluxos implementados (sem popup — redirect OAuth)

- `GET /api/auth/google/start?scope=drive|photos&token=JWT` → 302 p/ Google
  (`access_type=offline` + `prompt=consent` = refresh token sempre).
- `GET /api/auth/google/callback?code&state` → troca code por tokens,
  guarda **refresh criptografado (AES-GCM) em disco** → 302 p/ `/?import=`.
  Nonce de uso único (10min). Segredo nunca sai do servidor.
- Refresh: `ensureAccess()` renova o access sozinho (job de horas não morre).
  Se o Google revogar, apaga o vínculo e pede pra vincular de novo.

## 4. Drive (`drive.readonly`)

- Front volta com `?import=drive` → `POST /import/drive/start` → job lista tudo
  (`trashed=false`, pula Docs/Sheets nativos) e baixa com `?alt=media`.
- Paralelismo `IMPORT_WORKERS` (padrão 4). Cada arquivo entra na compressão.

## 5. Fotos (Picker API — único caminho vivo)

1. `POST /import/photos/session` → `{ sessionId, pickerUri }`.
2. Front abre `pickerUri + /autoclose` (janelinha fecha sozinha no Concluir).
3. Poll `GET /import/photos/session/:id` até `mediaItemsSet=true`
   (respeitar `pollingConfig`; sessão expira em dias, não minutos).
4. `POST /import/photos/session/:id/start` → job lista em
   **`GET /v1/mediaItems?sessionId=…&pageSize=100&pageToken=…`**
   (⚠️ NÃO é `/sessions/{id}/mediaItems` — esse caminho não existe, dá 404).
5. Download por item: `GET {baseUrl}=d` (baseUrl vale ~60min — baixar já).
6. Boa prática da doc: `DELETE` na sessão após concluir.

## 6. Troubleshooting (erros reais já vistos)

| Sintoma | Causa | Correção |
|---|---|---|
| `Acesso bloqueado: app não verificado` | Sem test user | Público-alvo → adicionar e-mail |
| `solicitação inválida` no Google | Redirect URI diferente | Cadastrar caractere por caractere (§1.5) |
| `Falta GOOGLE_CLIENT_ID/SECRET` | `.env` sem segredo (ou segredo colado na linha do ID!) | Conferir tamanhos: ID 72, secret 35 |
| Drive `Google 403` | Drive API desligada | Biblioteca → Ativar |
| Fotos pede `Ativar Picker API` | Picker API desligada | Biblioteca → Ativar |
| `Google Fotos 404` no start | Caminho de listagem errado ou sessão de outra aba | Usar §5.4; uma aba do app por vez |
| `GSI: origin not allowed` | Botão GIS fora das origins | Redirect não sofre disso; botão só em origin cadastrada |
| `r.body.on is not a function` | fetch nativo = web stream | `for await` (já corrigido em `downloadTo`) |
| Aba `about:blank` eterna | Popup GIS bloqueado (Firefox/ETP) | Fluxo redirect não usa popup |
| `Pronto: 0 arquivos` | Sessão escolhida em outra aba/sessão | Uma sessão por fluxo; retomar só <15min |

## 7. Diagnóstico

- `GET /api/health` inclui `build` (carimbo do código rodando).
- `data/picker-debug.log`: ciclo criar→polls→ready→start com timestamps.
- `POST /api/import/picklog { ev }`: front carimba passos (watch-ini/ready/start-fail).
