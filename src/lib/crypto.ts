import { hash, verify } from '@node-rs/argon2';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Passcodes, claim codes and staff passwords are only ever stored as argon2id hashes.
export const hashSecret = (plain: string) => hash(plain);

let dummy: Promise<string> | undefined;
/** Verifies even when there is no hash, so "no such TIP ID" costs the same time as "wrong passcode". */
export async function verifySecret(stored: string | null | undefined, plain: string): Promise<boolean> {
  try {
    const ok = await verify(stored ?? (await (dummy ??= hash('opentip-dummy'))), plain);
    return ok && !!stored;
  } catch {
    return false;
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

function secret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error('APP_SECRET must be set to 32+ characters (run: npm run keys)');
  return s;
}

/**
 * Reversible encryption (AES-256-GCM) for the few secrets that must be read back, such as staff two-step keys.
 * The key comes from APP_SECRET, which lives in the host's environment and not in the database, so a database-only leak is not enough.
 */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', createHash('sha256').update(`opentip-seal:${secret()}`).digest(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

/** Returns null if the value was tampered with or APP_SECRET changed. */
export function unseal(sealed: string): string | null {
  try {
    const [iv, tag, enc] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', createHash('sha256').update(`opentip-seal:${secret()}`).digest(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Stateless HMAC-signed token. Tipster sessions use this so nothing about a tipster is written server-side. */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, e: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: unknown): (T & { e: number }) | null {
  if (typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = createHmac('sha256', secret()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.e > Date.now() / 1000 ? p : null;
  } catch {
    return null;
  }
}
