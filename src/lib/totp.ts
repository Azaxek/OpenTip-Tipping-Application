import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s): what Google Authenticator, Microsoft Authenticator, Authy and 1Password all speak.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_MS = 30_000;

/** 160 random bits as 32 base32 characters. */
export function newTotpSecret(): string {
  let bits = 0, acc = 0, out = '';
  for (const byte of randomBytes(20)) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(acc >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out;
}

const fromBase32 = (s: string) => {
  let bits = 0, acc = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[\s=-]/g, '')) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('bad base32');
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', fromBase32(secret)).update(msg).digest();
  const o = h[19] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0');
}

export const stepOf = (ms = Date.now()) => Math.floor(ms / PERIOD_MS);

/**
 * Returns the 30-second step the code belongs to, or null. Allows one step either side for clock drift, and refuses any
 * step at or before `afterStep` so a code that was already used (or one older than the last accepted) never works twice.
 */
export function verifyTotp(secret: string, code: string, afterStep = 0, now = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = stepOf(now);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (step <= afterStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(c))) return step;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
