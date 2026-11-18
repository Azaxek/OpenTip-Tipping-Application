import { describe, expect, it } from 'vitest';
import { audit } from '@/lib/audit';
import { system, withOrg } from '@/lib/db';
import { gettingStarted } from '@/lib/onboarding';
import { createTip } from '@/lib/tipster';
import { categoryId, makeOrg, makeReviewer } from './helpers';

const doneIds = async (s: Parameters<typeof gettingStarted>[0]) => (await gettingStarted(s)).steps.filter((x) => x.done).map((x) => x.id);

describe('Getting started checklist', () => {
  it('starts with nothing ticked and has a reason and a link for every step', async () => {
    const { admin } = await makeOrg('crime_stoppers');
    const { steps, done } = await gettingStarted(admin);
    expect(done).toBe(0);
    expect(steps.map((x) => x.id)).toEqual(['team', 'wording', 'alert', 'twostep', 'poster', 'practice']);
    for (const x of steps) {
      expect(x.why.length, x.id).toBeGreaterThan(20);
      expect(x.href, x.id).toMatch(/^\//);
    }
  });

  it('ticks each step only from what actually happened', async () => {
    const { org, admin } = await makeOrg('crime_stoppers');
    await makeReviewer(org, []);
    expect(await doneIds(admin)).toEqual(['team']);

    await withOrg(org.id, (q) => audit(q, admin, 'settings.org'));
    expect(await doneIds(admin)).toEqual(['team', 'wording']);

    // A test alert that reached nobody must NOT count: that is exactly the situation the step exists to catch.
    await withOrg(org.id, (q) => audit(q, admin, 'alert.test', null, { delivered: false }));
    expect(await doneIds(admin)).not.toContain('alert');
    await withOrg(org.id, (q) => audit(q, admin, 'alert.test', null, { delivered: true }));
    expect(await doneIds(admin)).toContain('alert');

    await withOrg(org.id, (q) => audit(q, admin, 'materials.download', null, { kind: 'poster' }));
    expect(await doneIds(admin)).toContain('poster');

    await createTip(org, { categoryId: await categoryId(org, 'Fraud'), description: 'practice', passcode: 'hunter22' });
    expect(await doneIds(admin)).toContain('practice');

    expect(await doneIds(admin)).not.toContain('twostep');
    await system((q) => q('update reviewers set totp_enabled = true where id = $1', [admin.id]));
    const final = await gettingStarted(admin);
    expect(final.done).toBe(final.steps.length); // the card hides itself at this point
  });

  it('two-step is about the person looking, not the organization', async () => {
    const { org, admin } = await makeOrg('campus');
    const other = await makeReviewer(org, []);
    await system((q) => q('update reviewers set totp_enabled = true where id = $1', [other.id]));
    expect(await doneIds(admin)).not.toContain('twostep');
    expect(await doneIds(other)).toContain('twostep');
  });

  it('keeps one organization\'s progress out of another\'s', async () => {
    const a = await makeOrg('crime_stoppers');
    const b = await makeOrg('crime_stoppers');
    await withOrg(a.org.id, (q) => audit(q, a.admin, 'settings.org'));
    expect(await doneIds(a.admin)).toContain('wording');
    expect(await doneIds(b.admin)).not.toContain('wording');
  });
});
