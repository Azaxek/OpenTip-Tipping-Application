import { rateLimit } from './ratelimit';
import { withoutNul } from './text';
import { verifyTurnstile } from './turnstile';

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export const fail = (error: string, status = 400) => json({ error }, status);

/**
 * Standard front door for every public POST: rate limit -> size cap -> JSON parse -> Turnstile.
 * Returns the parsed body or a ready-made error Response.
 */
export async function publicPost(
  req: Request,
  name: string,
  max: number,
  windowMs: number,
  opts: { turnstile?: boolean; maxBytes?: number } = {},
): Promise<{ body: Record<string, unknown> } | { res: Response }> {
  const limited = rateLimit(req, name, max, windowMs);
  if (limited) return { res: limited };
  const text = await req.text();
  if (text.length > (opts.maxBytes ?? 100_000)) return { res: fail('Request too large', 413) };
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text || '{}', (_key, value) => (typeof value === 'string' ? withoutNul(value) : value));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch {
    return { res: fail('Invalid request') };
  }
  if (opts.turnstile !== false && !(await verifyTurnstile(body.turnstileToken))) {
    return { res: fail('Bot check failed. Please reload the page and try again.', 403) };
  }
  return { body };
}
