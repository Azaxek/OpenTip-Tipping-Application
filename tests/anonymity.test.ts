import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EMERGENCY_TEXT, EmergencyBanner } from '@/components/EmergencyBanner';
import { system } from '@/lib/db';
import { canonicalTipId, newClaimCode, newTipId } from '@/lib/ids';
import { IDENTIFYING_COLUMN, TIPSTER_DATA } from '@/lib/transparency';
import { createTip } from '@/lib/tipster';
import { categoryId, makeOrg } from './helpers';

const columns = async (table: string) =>
  (await system((q) => q<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table]))).map((r) => r.column_name).sort();

describe('tipster-facing tables hold no identifying data', () => {
  for (const table of Object.keys(TIPSTER_DATA)) {
    it(`${table}: columns match the published privacy notice exactly (CI drift check)`, async () => {
      expect(await columns(table)).toEqual(Object.keys(TIPSTER_DATA[table]).sort());
    });
    it(`${table}: no column name identifies a person or device`, async () => {
      for (const c of await columns(table)) expect(c, `${table}.${c}`).not.toMatch(IDENTIFYING_COLUMN);
    });
  }

  it('push_subscriptions stores only the opaque subscription, keyed to the tip', async () => {
    expect(await columns('push_subscriptions')).toEqual(['id', 'org_id', 'subscription', 'tip_id']);
  });

  it('audit_log records staff identity only (no tipster columns) and is append-only for the app role', async () => {
    expect(await columns('audit_log')).toEqual(['action', 'actor', 'created_at', 'detail', 'id', 'org_id', 'reviewer_id', 'tip_ref']);
    const { org } = await makeOrg('crime_stoppers');
    await expect(
      system(async (q) => {
        await q('set local role opentip_app');
        await q("select set_config('app.org_id', $1, true)", [org.id]);
        await q("update audit_log set actor = 'x'");
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('no request metadata is captured', () => {
  const root = path.resolve(process.cwd(), 'src');
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(root).filter((f) => /\.(ts|tsx)$/.test(f));
  const rel = (f: string) => path.relative(root, f).replace(/\\/g, '/');
  const read = (f: string) => fs.readFileSync(f, 'utf8');

  it('only the in-memory rate limiter reads IP/UA headers, and it never persists them', () => {
    const offenders = files.filter((f) => /user-agent|x-forwarded-for|x-real-ip|cf-connecting-ip|remoteip|userAgent\(|request\.ip|req\.ip/i.test(read(f)));
    expect(offenders.map(rel)).toEqual(['lib/ratelimit.ts', 'lib/turnstile.ts']); // turnstile only mentions remoteip to say it is NOT sent
    const limiter = read(path.join(root, 'lib/ratelimit.ts'));
    expect(limiter).not.toMatch(/from '\.\/db'|node:fs|console\.|fetch\(/);
    expect(read(path.join(root, 'lib/turnstile.ts'))).not.toMatch(/remoteip['"]?\s*:/);
  });

  it('tipster API routes and services never log', () => {
    const tipsterFiles = files.filter((f) => /^(app\/api|lib\/(tipster|uploads|push|media|storage|http))/.test(rel(f)));
    expect(tipsterFiles.length).toBeGreaterThan(8);
    for (const f of tipsterFiles) expect(read(f), rel(f)).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });

  it('no third-party scripts, analytics or trackers on tipster pages', () => {
    const pages = files.filter((f) => /^(components\/(?!staff)|app\/(page|submit|check|privacy|wanted|layout|\[lang\]))/.test(rel(f)));
    for (const f of pages) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(/gtag|google-analytics|googletagmanager|segment\.|mixpanel|hotjar|plausible|posthog|fbq\(|clarity\.ms|@vercel\/analytics|next\/script/i);
      const hosts = [...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]).filter((h) => !/^(localhost|www\.w3\.org)$/.test(h));
      // Turnstile is the only third party that loads. www.weather.com is only where the Quick Exit button navigates when tapped.
      for (const h of hosts) expect(['challenges.cloudflare.com', ...(rel(f) === 'components/QuickExit.tsx' ? ['www.weather.com'] : [])], `${rel(f)} -> ${h}`).toContain(h);
    }
  });
});

describe('secrets and identifiers', () => {
  it('passcodes are stored only as argon2id hashes', async () => {
    const { org } = await makeOrg('crime_stoppers');
    await createTip(org, { categoryId: await categoryId(org, 'Fraud'), description: 'x', passcode: 'plain-text-passcode' });
    const row = (await system((q) => q<any>('select passcode_hash from tips where org_id = $1', [org.id])))[0];
    expect(row.passcode_hash).toMatch(/^\$argon2id\$/);
    expect(row.passcode_hash).not.toContain('plain-text-passcode');
  });

  it('TIP IDs and claim codes are random, well-formed, unique and non-sequential', () => {
    const ids = Array.from({ length: 2000 }, newTipId);
    expect(new Set(ids).size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/);
    // consecutive IDs share no ordering: sorted order should differ from generation order
    expect([...ids].sort()).not.toEqual(ids);
    expect(new Set(Array.from({ length: 500 }, newClaimCode)).size).toBe(500);
    expect(canonicalTipId('abcd efgh jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(canonicalTipId('too-short')).toBeNull();
  });
});

describe('911 safety banner', () => {
  it('renders the fixed emergency text and takes no way to reword or hide it', () => {
    const html = renderToStaticMarkup(createElement(EmergencyBanner));
    expect(html).toContain('call 911 now');
    expect(html).toContain(EMERGENCY_TEXT.replace(/'/g, '&#x27;'));
    // @ts-expect-error - there is deliberately no `text`, `hidden` or `onDismiss` prop
    renderToStaticMarkup(createElement(EmergencyBanner, { text: 'nothing', hidden: true }));
    expect(renderToStaticMarkup(createElement(EmergencyBanner, { strong: true }))).toContain('call 911 now');
  });

  it('is present on the landing page, the tip form and the tip-check page', () => {
    const src = (p: string) => fs.readFileSync(path.resolve(process.cwd(), 'src', p), 'utf8');
    for (const p of ['components/pages/HomePage.tsx', 'components/SubmitWizard.tsx', 'components/pages/CheckPage.tsx', 'components/pages/WantedPage.tsx']) expect(src(p), p).toContain('<EmergencyBanner');
    // ...and the pages at the public addresses (English and Spanish) are the ones that render those components
    for (const [p, c] of [['app/page.tsx', 'HomePage'], ['app/check/page.tsx', 'CheckPage'], ['app/submit/page.tsx', 'SubmitPage'], ['app/[lang]/page.tsx', 'HomePage'], ['app/[lang]/check/page.tsx', 'CheckPage'], ['app/[lang]/submit/page.tsx', 'SubmitPage']]) expect(src(p), p).toContain(`<${c}`);
  });
});
