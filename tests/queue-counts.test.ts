import { describe, expect, it } from 'vitest';
import { system } from '@/lib/db';
import { QUEUE_LIMIT, listQueue, queueCounts } from '@/lib/queue';
import { logPhoneTip } from '@/lib/phone-tip';
import { categoryId, makeOrg, makeReviewer } from './helpers';

/** Inserts tips directly: creating hundreds through createTip would spend the test's time hashing passcodes. */
async function bulkTips(orgId: string, categoryUuid: string, n: number, over = '') {
  await system((q) =>
    q(
      `insert into tips (org_id, tip_id, passcode_hash, category_id, description, needs_reply, waiting_since ${over ? `, ${over.split('=')[0]}` : ''})
       select $1, 'T' || lpad(g::text, 7, '0') || substr(md5(random()::text), 1, 4), 'x', $2, 'bulk', true, now() ${over ? `, ${over.split('=')[1]}` : ''}
         from generate_series(1, $3) g`,
      [orgId, categoryUuid, n],
    ),
  );
}

describe('queue counts', () => {
  it('count every open tip exactly, even when the list itself is cut off at the display limit', async () => {
    const { org, admin } = await makeOrg('crime_stoppers');
    await bulkTips(org.id, await categoryId(org, 'Fraud'), QUEUE_LIMIT + 25);
    expect(await listQueue(admin)).toHaveLength(QUEUE_LIMIT); // the list is capped...
    expect(await queueCounts(admin)).toEqual({ open: QUEUE_LIMIT + 25, needsReply: QUEUE_LIMIT + 25, priority: 0, mine: 0 }); // ...the counts are not
  });

  it('counts only what the person may see, and separates priority, awaiting-reply and assigned-to-me', async () => {
    const { org, admin } = await makeOrg('campus');
    const counselor = await makeReviewer(org, ['Counseling']);
    await bulkTips(org.id, await categoryId(org, 'Self-Harm/Suicide Concern'), 3); // high-risk, routed to nobody yet (bulk insert skips routing)
    await system((q) => q("insert into tip_teams (org_id, tip_id, team_id) select $1, t.id, tm.id from tips t, teams tm where t.org_id = $1 and tm.org_id = $1 and tm.name = 'Counseling'", [org.id]));
    await bulkTips(org.id, await categoryId(org, 'Theft'), 2); // not routed to Counseling
    // Specific tips, chosen by ordering, so the expected numbers below do not depend on row order.
    const ofCategory = "category_id = (select id from categories where org_id = $1 and name = $2)";
    await system((q) => q(`update tips set assigned_reviewer_id = $3 where id = (select id from tips where org_id = $1 and ${ofCategory} order by tip_id limit 1)`, [org.id, 'Self-Harm/Suicide Concern', counselor.id]));
    await system((q) => q(`update tips set needs_reply = false where id = (select id from tips where org_id = $1 and ${ofCategory} order by tip_id desc limit 1)`, [org.id, 'Self-Harm/Suicide Concern']));
    await system((q) => q(`update tips set status = 'closed' where id = (select id from tips where org_id = $1 and ${ofCategory} order by tip_id limit 1)`, [org.id, 'Theft']));

    expect(await queueCounts(admin)).toEqual({ open: 4, needsReply: 3, priority: 3, mine: 0 }); // 5 tips, 1 closed; admin sees all
    expect(await queueCounts(counselor)).toEqual({ open: 3, needsReply: 2, priority: 3, mine: 1 }); // only the 3 routed to Counseling
  });
});

describe('phone tips', () => {
  it('start with nobody owing the caller a reply, so they never show as awaiting or overdue', async () => {
    const { org, admin } = await makeOrg('crime_stoppers');
    await logPhoneTip(admin, { categoryId: await categoryId(org, 'Fraud'), description: 'Caller reports a scam.' });
    const [row] = await listQueue(admin);
    expect(row).toMatchObject({ source: 'phone', needs_reply: false, waiting_since: null });
    expect((await queueCounts(admin)).needsReply).toBe(0);
    expect((await queueCounts(admin)).open).toBe(1);
  });
});
