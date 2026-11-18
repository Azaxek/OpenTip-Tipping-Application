import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { system } from '@/lib/db';
import { escalate } from '@/lib/escalation';
import {
  addNote, assignTip, canView, closeTip, getMediaFor, getTipDetail, listQueue, listStaffMessages, redeemClaim, reissueClaimCode,
  sendReviewerMessage, setReward, setStatus, setTipTeams, setUrgent,
} from '@/lib/queue';
import { createTip } from '@/lib/tipster';
import { categoryId, makeOrg, makeReviewer } from './helpers';

/**
 * The most important rule on the staff side: a reviewer only ever touches tips routed to their teams (or assigned to them).
 * Every action is run here as someone OUTSIDE the tip's teams, and must be refused without changing anything.
 */
async function setup() {
  const { org, admin } = await makeOrg('campus');
  const outsider = await makeReviewer(org, ['Counseling']); // a Theft tip goes to School Resource Officer + Administration
  await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'a stolen bike', passcode: 'hunter22' });
  const tip = (await system((q) => q<{ id: string; tip_id: string }>('select id, tip_id from tips where org_id = $1', [org.id])))[0];
  const media = (
    await system((q) =>
      q<{ id: string }>("insert into media (org_id, tip_id, kind, mime, size_bytes, storage_key) values ($1, $2, 'image', 'image/jpeg', 10, 'media/x/y.jpg') returning id", [org.id, tip.id]),
    )
  )[0];
  return { org, admin, outsider, tip, media };
}

describe('every staff action refuses a reviewer who is outside the tip\'s teams', () => {
  it('reads: detail, messages, evidence and the queue show nothing', async () => {
    const { admin, outsider, tip, media } = await setup();
    expect(await canView(outsider, tip.id)).toBe(false);
    expect(await getTipDetail(outsider, tip.id)).toBeNull();
    expect(await listStaffMessages(outsider, tip.id, 0)).toBeNull();
    expect(await getMediaFor(outsider, media.id)).toBeNull();
    expect(await listQueue(outsider)).toEqual([]);
    // ...while someone allowed to see it can (so the refusals above are about routing, not about bad test data)
    expect(await canView(admin, tip.id)).toBe(true);
    expect(await getMediaFor(admin, media.id)).not.toBeNull();
  });

  it('writes: each one throws "Tip not found" and leaves the tip exactly as it was', async () => {
    const { org, outsider, tip } = await setup();
    const attempts: [string, () => Promise<unknown>][] = [
      ['reply in chat', () => sendReviewerMessage(outsider, tip.id, 'hello')],
      ['add a note', () => addNote(outsider, tip.id, 'my note')],
      ['change status', () => setStatus(outsider, tip.id, 'actioned')],
      ['close', () => closeTip(outsider, tip.id, 'unfounded', 'x')],
      ['flag urgent', () => setUrgent(outsider, tip.id, true)],
      ['assign', () => assignTip(outsider, tip.id, outsider.id)],
      ['route to my team', () => setTipTeams(outsider, tip.id, [])],
      ['set a reward', () => setReward(outsider, tip.id, true, 100)],
      ['reissue a claim code', () => reissueClaimCode(outsider, tip.id)],
      ['escalate', () => escalate(outsider, tip.id)],
    ];
    for (const [name, attempt] of attempts) await expect(attempt(), name).rejects.toThrow('Tip not found');

    const [after] = await system((q) => q<Record<string, unknown>>('select status, urgent, assigned_reviewer_id, reward_eligible, closed_at from tips where id = $1', [tip.id]));
    expect(after).toMatchObject({ status: 'new', urgent: false, assigned_reviewer_id: null, reward_eligible: false, closed_at: null });
    expect((await system((q) => q<{ n: number }>('select count(*)::int as n from messages where tip_id = $1', [tip.id])))[0].n).toBe(0);
    expect((await system((q) => q<{ n: number }>('select count(*)::int as n from internal_notes where tip_id = $1', [tip.id])))[0].n).toBe(0);
    expect((await system((q) => q<{ n: number }>('select count(*)::int as n from tip_teams where tip_id = $1', [tip.id])))[0].n).toBe(2); // routing untouched
    expect((await system((q) => q<{ n: number }>("select count(*)::int as n from audit_log where org_id = $1 and action not in ('tip.view')", [org.id])))[0].n).toBe(0); // and nothing was audited as done
  });

  it('claim redemption cannot be used to probe a tip the reviewer cannot see', async () => {
    const { outsider, tip } = await setup();
    const r = await redeemClaim(outsider, tip.tip_id, 'AAAA-AAAA-AAAA-AAAA');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/do not match, or the reward is not claimable/); // same answer as for a tip that does not exist
  });

  it('assignment alone grants access (the one deliberate exception), and removing it takes it away again', async () => {
    const { admin, outsider, tip } = await setup();
    await assignTip(admin, tip.id, outsider.id);
    expect(await canView(outsider, tip.id)).toBe(true);
    await assignTip(admin, tip.id, null);
    expect(await canView(outsider, tip.id)).toBe(false);
  });
});

describe('the guard cannot be skipped by adding a new action', () => {
  // Structural check: every function exported from queue.ts that takes a tip (or media) id must load it through guard()/need(), or, for
  // redeemClaim which finds a tip by the TIP ID a tipster reads aloud, apply the same visible() rule in its own query.
  // A new staff action that forgets the guard fails here, before it can ship.
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/queue.ts'), 'utf8').replace(/\r\n/g, '\n');
  const blocks = source.split(/\n(?=export )/).filter((b) => /^export (async function|const) \w+/.test(b));
  const takesATip = blocks.filter((b) => /\((?:s: Staff, )?(tipId|mediaId)\b|\(s: Staff, (tipId|mediaId)/.test(b.split('\n')[0] + (b.split('\n')[1] ?? '')));

  it('finds the staff actions it is meant to protect', () => {
    const names = takesATip.map((b) => b.match(/^export (?:async function|const) (\w+)/)?.[1]);
    for (const expected of ['getTipDetail', 'sendReviewerMessage', 'addNote', 'setStatus', 'closeTip', 'setUrgent', 'assignTip', 'setTipTeams', 'setReward', 'reissueClaimCode', 'getMediaFor', 'listStaffMessages', 'canView']) {
      expect(names, expected).toContain(expected);
    }
  });

  it('every one of them applies the visibility rule (guard(), need() or visible())', () => {
    for (const b of takesATip) {
      const name = b.match(/^export (?:async function|const) (\w+)/)?.[1];
      expect(/\b(guard|need|visible)\(/.test(b), `${name} must load the tip through guard(), need() or visible()`).toBe(true);
    }
  });
});
