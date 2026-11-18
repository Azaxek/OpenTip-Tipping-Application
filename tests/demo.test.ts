import { afterEach, describe, expect, it, vi } from 'vitest';
import { report } from '@/lib/analytics';
import { DEMO, demoStatus, resetDemo } from '@/lib/demo';
import { system } from '@/lib/db';
import { escalate } from '@/lib/escalation';
import { listQueue } from '@/lib/queue';
import { staffFromToken, staffLogin } from '@/lib/staff';
import { getStorage } from '@/lib/storage';
import { getTipStatus, revealClaimCode, tipsterLogin, createTip } from '@/lib/tipster';
import { categoryId, makeOrg } from './helpers';

afterEach(() => vi.unstubAllEnvs());

describe('demo mode', () => {
  it('refuses to seed or use db storage unless DEMO_MODE=1', async () => {
    await expect(resetDemo()).rejects.toThrow('DEMO_MODE=1');
    vi.stubEnv('STORAGE_DRIVER', 'db');
    expect(() => getStorage()).toThrow('demos only');
  });

  it('seeds a fully populated Crime Stoppers program that a presenter can sign in to', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    vi.stubEnv('STORAGE_DRIVER', 'db');
    expect((await demoStatus()).loaded).toBe(false);
    await resetDemo();
    expect((await demoStatus()).loaded).toBe(true);

    const org = (await system((q) => q<any>('select * from organizations where slug = $1', [DEMO.slug])))[0];
    expect(org).toMatchObject({ org_type: 'crime_stoppers', name: DEMO.orgName });

    // documented logins all work
    const adminToken = await staffLogin(org.id, DEMO.admin.email, DEMO.admin.password);
    const admin = (await staffFromToken(adminToken!))!;
    expect(admin.role).toBe('admin');
    const reviewer = (await staffFromToken((await staffLogin(org.id, DEMO.reviewer.email, DEMO.reviewer.password))!))!;
    expect(reviewer.role).toBe('reviewer');
    const tipToken = await tipsterLogin(org, DEMO.tipster.tipId.toLowerCase(), DEMO.tipster.passcode);
    expect(tipToken).toBeTruthy();

    // queue: urgent weapons tip pinned first, unanswered; plenty of history; a non-admin reviewer sees the same work
    const all = await listQueue(admin, { status: 'all' });
    expect(all).toHaveLength(7 + 72);
    const open = await listQueue(admin);
    expect(open[0]).toMatchObject({ category: 'Weapons', urgent: true, needs_reply: true });
    expect((await listQueue(reviewer, { status: 'all' })).length).toBe(all.length);

    // evidence went through the real pipeline: sanitized, no fake camera/GPS/author left
    const media = await system((q) => q<any>('select kind, storage_key from media where org_id = $1', [org.id]));
    expect(media.map((m) => m.kind).sort()).toEqual(['document', 'image', 'image', 'image']);
    for (const m of media) {
      const bytes = await getStorage().get(m.storage_key);
      expect(bytes.includes('DemoCam'), m.kind).toBe(false);
      expect(bytes.includes('Demo Person'), m.kind).toBe(false);
    }
    expect((await getStorage().list('quarantine/')).length).toBe(0);

    // the reward story: eligible, code not yet viewed, then shown exactly once
    const tip = (await system((q) => q<any>('select id from tips where tip_id = $1', [DEMO.tipster.tipId])))[0];
    expect(await getTipStatus(org.id, tip.id)).toMatchObject({ status: 'actioned', reward_eligible: true, reward_amount_cents: 25000, claim_code_shown: false });
    expect((await revealClaimCode(org.id, tip.id)).code).toBeTruthy();
    expect((await revealClaimCode(org.id, tip.id)).alreadyShown).toBe(true);

    // analytics has a believable history
    const today = new Date();
    const r = await report(admin, { from: new Date(today.getTime() - 90 * 86400_000).toISOString().slice(0, 10), to: today.toISOString().slice(0, 10), bucket: 'week' });
    expect(r.totals.tips).toBe(79);
    expect(r.totals.closed).toBeGreaterThan(20);
    expect(r.volume.length).toBeGreaterThan(8);
    expect(r.categories.length).toBeGreaterThan(6);
    expect(r.timings.firstResponseMedianH).toBeGreaterThan(0);
    expect(r.rewards.eligible).toBeGreaterThan(0);
  });

  it('reset is repeatable: one demo org, same shape, fresh data', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    vi.stubEnv('STORAGE_DRIVER', 'db');
    await resetDemo();
    await resetDemo();
    expect(await system((q) => q('select 1 from organizations where slug = $1', [DEMO.slug]))).toHaveLength(1);
    expect(await system((q) => q('select 1 from tips t join organizations o on o.id = t.org_id where o.slug = $1', [DEMO.slug]))).toHaveLength(79);
    expect(await system((q) => q("select 1 from storage_objects where key like 'media/%'"))).toHaveLength(4); // old files were removed
  });
});

describe('simulated escalation (demo only)', () => {
  it('shows the workflow as delivered-but-simulated in demo mode, and is recorded as such', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    const { org, admin } = await makeOrg('crime_stoppers');
    await createTip(org, { categoryId: await categoryId(org, 'Weapons'), description: 'x', passcode: 'hunter22', urgent: true });
    const [t] = await listQueue(admin);
    const r = await escalate(admin, t.id);
    expect(r).toMatchObject({ delivered: true, email: 'simulated', webhook: 'simulated' });
    const log = (await system((q) => q<any>("select detail from audit_log where action = 'tip.escalate' and org_id = $1", [org.id])))[0];
    expect(log.detail.simulated).toBe(true);
  });

  it('never simulates outside demo mode: no channel means NOT delivered', async () => {
    const { org, admin } = await makeOrg('crime_stoppers');
    await createTip(org, { categoryId: await categoryId(org, 'Weapons'), description: 'x', passcode: 'hunter22' });
    const [t] = await listQueue(admin);
    expect((await escalate(admin, t.id)).delivered).toBe(false);
  });

  it('will not load demo logins into a database that holds a real program', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    vi.stubEnv('STORAGE_DRIVER', 'db');
    await makeOrg('campus');
    await expect(resetDemo()).rejects.toThrow('real program');
  });
});
