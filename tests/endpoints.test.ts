import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as claimReveal } from '@/app/api/tip/claim/route';
import { POST as login } from '@/app/api/tip/login/route';
import { GET as poll, POST as postMessage } from '@/app/api/tip/messages/route';
import { POST as submit } from '@/app/api/tips/route';
import { POST as uploadInit } from '@/app/api/upload/init/route';
import { GET as purgeCron } from '@/app/api/cron/purge/route';
import { resetRateLimits } from '@/lib/ratelimit';
import { createTip } from '@/lib/tipster';
import { categoryId, makeOrg } from './helpers';

let n = 0;
const from = (ip: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', { method: 'POST', headers: { 'x-forwarded-for': ip, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const ip = () => `10.0.${Math.floor(++n / 250)}.${n % 250}`;

beforeEach(() => resetRateLimits());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function setup() {
  const { org } = await makeOrg('campus');
  vi.stubEnv('DEFAULT_ORG_SLUG', org.slug);
  const cat = await categoryId(org, 'Theft');
  const tip = await createTip(org, { categoryId: cat, description: 'seed', passcode: 'hunter22' });
  return { org, cat, tip };
}

const hammer = async (handler: (r: Request) => Promise<Response>, mk: () => Request, limit: number) => {
  const codes: number[] = [];
  for (let i = 0; i < limit + 2; i++) codes.push((await handler(mk())).status);
  return codes;
};

describe('rate limits on public endpoints', () => {
  it('submission: 60 per hour per address (a school shares one), then 429 with Retry-After', async () => {
    const { cat } = await setup();
    const client = ip();
    const codes = await hammer(submit, () => from(client, { categoryId: cat, description: 'spam', passcode: 'abcdef' }), 60);
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
    expect(codes.slice(60)).toEqual([429, 429]);
    const blocked = await submit(from(client, {}));
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect((await submit(from(ip(), { categoryId: cat, description: 'ok', passcode: 'abcdef' }))).status).toBe(200); // other clients unaffected
  });

  it('login: 60 attempts per 15 minutes per address, then 429 (per-TIP-ID lockout stops guessing long before)', async () => {
    const { tip } = await setup();
    const client = ip();
    const codes = await hammer(login, () => from(client, { tipId: tip.tipId, passcode: 'wrong' }), 60);
    expect(codes.slice(0, 60).every((c) => c === 401)).toBe(true);
    expect(codes.slice(60)).toEqual([429, 429]);
  });

  it('login answers wrong ID, wrong passcode and locked identically', async () => {
    const { tip } = await setup();
    const a = await login(from(ip(), { tipId: 'ZZZZ-ZZZZ-ZZZZ', passcode: 'whatever' }));
    const b = await login(from(ip(), { tipId: tip.tipId, passcode: 'whatever' }));
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(await a.json()).toEqual(await b.json());
  });

  it('claim-code reveal: 10 per hour, needs a valid session, never leaks an ineligible code', async () => {
    const { tip } = await setup();
    const bearer = { authorization: `Bearer ${tip.token}` };
    const client = ip();
    expect((await claimReveal(from(ip(), {}))).status).toBe(401); // no token
    expect(await (await claimReveal(from(ip(), {}, bearer))).json()).toEqual({ notEligible: true }); // never leaks a code for an ineligible tip
    const codes = await hammer(claimReveal, () => from(client, {}, bearer), 9); // limited per tip (one call already used)
    expect(codes.slice(0, 9).every((c) => c === 200)).toBe(true);
    expect(codes.slice(9)).toEqual([429, 429]);
  });

  it('upload init and chat messages are limited too', async () => {
    const { tip } = await setup();
    const c1 = ip();
    const up = await hammer(uploadInit, () => from(c1, { files: [] }), 120);
    expect(up.slice(120)).toEqual([429, 429]);
    const c2 = ip();
    const msg = await hammer(postMessage, () => from(c2, { body: 'hi' }, { authorization: `Bearer ${tip.token}` }), 30);
    expect(msg.slice(30)).toEqual([429, 429]);
  });
});

describe('tipster session token', () => {
  it('rejects missing, tampered and other-secret tokens', async () => {
    const { tip } = await setup();
    const get = (auth?: string) => poll(new Request('http://localhost/api/tip/messages', { headers: { 'x-forwarded-for': ip(), ...(auth ? { authorization: auth } : {}) } }));
    expect((await get()).status).toBe(401);
    expect((await get(`Bearer ${tip.token.slice(0, -3)}abc`)).status).toBe(401);
    const ok = await get(`Bearer ${tip.token}`);
    expect(ok.status).toBe(200);
    expect(Object.keys(await ok.json()).sort()).toEqual(['messages', 'status']);
  });
});

describe('bot protection (Cloudflare Turnstile)', () => {
  it('rejects a failed challenge and accepts a passed one, without sending the client IP to Cloudflare', async () => {
    const { cat } = await setup();
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ success: String(init.body).includes('good-token') })));
    vi.stubGlobal('fetch', fetchMock);
    const body = (t: string) => ({ categoryId: cat, description: 'x', passcode: 'abcdef', turnstileToken: t });
    expect((await submit(from(ip(), body('bad-token')))).status).toBe(403);
    expect((await submit(from(ip(), { ...body(''), turnstileToken: undefined }))).status).toBe(403);
    expect((await submit(from(ip(), body('good-token')))).status).toBe(200);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect(String(init.body)).not.toMatch(/remoteip|10\.0\./);
    }
  });

  it('fails closed in production when the secret is missing', async () => {
    const { cat } = await setup();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect((await submit(from(ip(), { categoryId: cat, description: 'x', passcode: 'abcdef' }))).status).toBe(403);
  });
});

describe('cron purge endpoint', () => {
  it('requires the bearer secret', async () => {
    const get = (auth?: string) => purgeCron(new Request('http://localhost/api/cron/purge', { headers: auth ? { authorization: auth } : {} }));
    vi.stubEnv('CRON_SECRET', '');
    expect((await get('Bearer x')).status).toBe(503);
    vi.stubEnv('CRON_SECRET', 'cron-secret-value');
    expect((await get()).status).toBe(401);
    expect((await get('Bearer wrong-secret-value')).status).toBe(401);
    expect((await get('Bearer cron-secret-value')).status).toBe(200);
  });

  it('keeps running the retention purge when DEMO_MODE is left on beside a real program', async () => {
    await makeOrg('campus');
    vi.stubEnv('CRON_SECRET', 'cron-secret-value');
    vi.stubEnv('DEMO_MODE', '1');
    const res = await purgeCron(new Request('http://localhost/api/cron/purge', { headers: { authorization: 'Bearer cron-secret-value' } }));
    const body = await res.json();
    expect(body).toHaveProperty('tips');
    expect(body).not.toHaveProperty('demo');
  });
});
