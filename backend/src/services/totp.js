import crypto from 'node:crypto';

// TOTP RFC 6238 na mão (HMAC-SHA1, 30s, 6 dígitos): sem plugin maze,
// auditável em 1 tela. Secrets sempre base32.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(bytes = 20) {
  const rnd = crypto.randomBytes(bytes);
  let out = '';
  let bits = 0;
  let val = 0;
  for (const b of rnd) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export function base32ToBytes(s) {
  const clean = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out = [];
  let bits = 0;
  let val = 0;
  for (const ch of clean) {
    val = (val << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const key = base32ToBytes(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

// Janela ±1 passo (relógio do celular ±30s não trava ninguém).
export function verifyTotp(secret, token, windowSteps = 1) {
  const t = String(token || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(t) || !secret) return false;
  const now = Math.floor(Date.now() / 30000);
  for (let d = -windowSteps; d <= windowSteps; d++) {
    const a = hotp(secret, now + d);
    if (a.length === t.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(t))) return true;
  }
  return false;
}

export function otpauthUri({ issuer, label, secret }) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

export function newBackupCodes(n = 8) {
  return Array.from({ length: n }, () => crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,4}/g).join('-'));
}

export function hashCode(s) {
  return crypto.createHash('sha256').update(`backup:${s}`).digest('hex');
}
