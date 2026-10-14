import { describe, expect, it } from 'vitest';
import { system } from '@/lib/db';
import { newPassphrase } from '@/lib/passphrase';
import { logPhoneTip } from '@/lib/phone-tip';
import { StaffInputError } from '@/lib/queue';
import { tipsterLogin } from '@/lib/tipster';
import { WORDS } from '@/lib/wordlist';
import { categoryId, makeOrg, makeReviewer } from './helpers';

describe('generated passphrases', () => {
  it('uses 512 distinct, plain lowercase words so a random index is unbiased', () => {
    expect(WORDS).toHaveLength(512);
    expect(new Set(WORDS).size).toBe(512);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]{3,8}$/);
  });

  it('is four hyphenated words, long enough to be a passcode, and different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newPassphrase()));
    expect(seen.size).toBe(200);
    for (const p of seen) {
      expect(p).toMatch(/^[a-z]+(-[a-z]+){3}$/);
      expect(p.length).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('phone / walk-in tips', () => {
  it('creates a normal tip whose generated passcode works, marks the source, routes it, and audits it without any caller data', async () => {
    const { org, admin } = await makeOrg('crime_stoppers');
    const r = await logPhoneTip(admin, { categoryId: await categoryId(org, 'Fraud'), description: 'Caller says a neighbor is cashing stolen checks.' });
    expect(r.tipId).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(await tipsterLogin(org, r.tipId, r.passcode)).toBeTruthy(); // the caller can call back / chat / claim a reward
    expect(await tipsterLogin(org, r.tipId, 'wrong-wrong-wrong-wrong')).toBeNull();
    const t = (await system((q) => q<any>('select * from tips where tip_id = $1', [r.tipId])))[0];
    expect(t.source).toBe('phone');
    expect((await system((q) => q<any>('select count(*)::int as n from tip_teams where tip_id = $1', [t.id])))[0].n).toBeGreaterThan(0);
    const log = (await system((q) => q<any>("select actor, detail, tip_ref from audit_log where action = 'tip.manual' and org_id = $1", [org.id])))[0];
    expect(log.tip_ref).toBe(r.tipId);
    expect(JSON.stringify(log)).not.toContain(r.passcode);
  });

  it('turns validation problems into a staff-facing message', async () => {
    const { org, admin } = await makeOrg('campus');
    await expect(logPhoneTip(admin, { categoryId: await categoryId(org, 'Theft'), description: '   ' })).rejects.toBeInstanceOf(StaffInputError);
    await expect(logPhoneTip(admin, { categoryId: '00000000-0000-4000-8000-000000000000', description: 'x' })).rejects.toThrow('Please choose a category.');
  });

  it('works for any reviewer, not just admins', async () => {
    const { org } = await makeOrg('campus');
    const rev = await makeReviewer(org, ['Counseling']);
    const r = await logPhoneTip(rev, { categoryId: await categoryId(org, 'Self-Harm/Suicide Concern'), description: 'A student told me in person.', urgent: true });
    expect(r.passcode.split('-')).toHaveLength(4);
  });
});
