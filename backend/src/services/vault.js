import { readCollection, upsertRow } from '../config/store.js';

// Cofre: playlist com senha do usuário. Arquivos do cofre somem da lista,
// busca, download e thumb até desbloquear na sessão (memória; restart tranca).
const unlocked = new Map(); // userId -> Set(playlistId)

export function vaultOf(ownerId, vaultId) {
  if (!vaultId) return null;
  return readCollection('playlists').find((p) => p.id === vaultId && p.ownerId === ownerId) || null;
}

export function isVaultLocked(ownerId, vaultId) {
  const pl = vaultOf(ownerId, vaultId);
  if (!pl || !pl.vaultHash) return false;
  return !(unlocked.get(ownerId)?.has(vaultId));
}

export function unlockVault(ownerId, vaultId) {
  if (!unlocked.has(ownerId)) unlocked.set(ownerId, new Set());
  unlocked.get(ownerId).add(vaultId);
}

export function lockAllVaults(ownerId) {
  unlocked.delete(ownerId);
}

// Arquivo some de tudo (lista/busca/download/thumb) se o cofre tá trancado.
export function visibleFile(ownerId, meta) {
  if (!meta) return null;
  if (meta.ownerId !== ownerId) return null;
  if (meta.vaultId && isVaultLocked(ownerId, meta.vaultId)) return null;
  return meta;
}

// Liga/desliga o vínculo arquivo<->cofre (chamado ao entrar/sair de playlist).
export function setFileVault(fileId, ownerId, vaultId) {
  const rows = readCollection('storage');
  const m = rows.find((x) => x.id === fileId && x.ownerId === ownerId);
  if (!m) return;
  m.vaultId = vaultId || null;
  upsertRow('storage', m);
}

export function clearFileVaultEverywhere(fileId, ownerId, exceptVaultId) {
  const rows = readCollection('storage');
  const m = rows.find((x) => x.id === fileId && x.ownerId === ownerId);
  if (!m || m.vaultId !== exceptVaultId) return;
  const still = readCollection('playlists').some((p) =>
    p.ownerId === ownerId && p.vaultHash && p.id !== exceptVaultId && (p.fileIds || []).includes(fileId));
  if (!still) {
    m.vaultId = null;
    upsertRow('storage', m);
  }
}
