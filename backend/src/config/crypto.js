import crypto from 'node:crypto';

// AES-256-GCM no formato iv:tag:enc (hex), mesmo padrão do Calixto OmniSystem.
// CRYPTO_KEY deve ser 32 bytes em hex (64 chars).
function getKey() {
  const hex = process.env.CRYPTO_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('CRYPTO_KEY inválida: gere 32 bytes em hex e coloque no .env (veja .env.example)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plainText) {
  if (!plainText) return '';
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(payload) {
  if (!payload) return '';
  // Compat: se não estiver no formato iv:tag:enc, devolve como está (valor legado em texto)
  if (typeof payload !== 'string' || payload.split(':').length !== 3) return payload;
  const key = getKey();
  const [ivHex, tagHex, encHex] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
