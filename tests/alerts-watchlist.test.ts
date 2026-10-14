import { afterEach, describe, expect, it, vi } from 'vitest';
import { system } from '@/lib/db';
import { alertStaff } from '@/lib/notify';
import { assignTip, listQueue, sendReviewerMessage } from '@/lib/queue';
import { createTip, postTipsterMessage } from '@/lib/tipster';
import { highlight, parseKeywords, watchHits } from '@/lib/watch';
import { categoryId, makeOrg, makeReviewer } from './helpers';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const mail = () => {
  vi.stubEnv('RESEND_API_KEY', 'k');
  vi.stubEnv('RESEND_FROM', 'OpenTip <a@example.org>');
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const sent = (m: ReturnType<typeof mail>) => m.mock.calls.map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init.body)) }));
const tipRow = async (orgId: string) => (await system((q) => q<any>('select * from tips where org_id = $1 order by created_at desc limit 1', [orgId])))[0];

describe('keyword watch list', () => {
  it('parses commas and lines, lowercases, dedupes and caps', () => {
    expect(parseKeywords('Gun, KNIFE\n  bomb threat ,gun,,x')).toEqual(['gun', 'knife', 'bomb threat']);
    expect(parseKeywords(Array.from({ length: 300 }, (_, i) => `word${i}`).join(','))).toHaveLength(100);
  });

  it('matches whole words and phrases only, in any case, across scripts', () => {
    const kw = ['gun', 'bomb threat', 'arma'];
    expect(watchHits('He had a GUN.', kw)).toEqual(['gun']);
    expect(watchHits('it has begun and the gunner left', kw)).toEqual([]);
    expect(watchHits('there was a Bomb   threat today', kw)).toEqual(['bomb threat']);
    expect(watchHits('tenía un arma', kw)).toEqual(['arma']);
    expect(watchHits('a.b (c) [d]', ['a.b', '(c)'].filter((k) => k !== '(c)'))).toEqual(['a.b']); // regex characters are literal
  });

  it('highlights the matching spans for display', () => {
    expect(highlight('He had a gun, a Gun!', ['gun'])).toEqual([['He had a ', false], ['gun', true], [', a ', false], ['Gun', true], ['!', false]]);
    expect(highlight('nothing here', [])).toEqual([['nothing here', false]]);
  });

  it('flags a tip on submission, treats it as priority, and shows up under "urgent only"', async () => {
    const { org, admin } = await makeOrg('campus', { watch_keywords: 'gun, bomb threat' });
    await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'I saw a gun in a locker', passcode: 'hunter22' });
    await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'My bike was taken', passcode: 'hunter22' });
    const t = (await system((q) => q<any>("select * from tips where org_id = $1 and description like '%gun%'", [org.id])))[0];
    expect(t.watch_hits).toEqual(['gun']);
    const urgent = await listQueue(admin, { urgent: true });
    expect(urgent.map((r: any) => r.tip_id)).toEqual([t.tip_id]);
    expect(urgent[0].watch).toBe(true);
    const all = await listQueue(admin);
    expect(all[0].tip_id).toBe(t.tip_id); // pinned above the ordinary tip
  });

  it('a follow-up message that contains a watch word flags the tip too', async () => {
    const { org } = await makeOrg('campus', { watch_keywords: 'knife' });
    await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'something odd', passcode: 'hunter22' });
    const t = await tipRow(org.id);
    expect(t.watch_hits).toEqual([]);
    await postTipsterMessage(org.id, t.id, 'He also has a knife');
    await postTipsterMessage(org.id, t.id, 'a KNIFE, I am sure');
    expect((await tipRow(org.id)).watch_hits).toEqual(['knife']); // not duplicated
  });
});

describe('waiting_since (response-time clock)', () => {
  it('starts at submission, clears on a staff reply, restarts on the next tipster message, and does not reset while still waiting', async () => {
    const { org, admin } = await makeOrg('campus');
    await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'x', passcode: 'hunter22' });
    const t0 = await tipRow(org.id);
    expect(t0.waiting_since).not.toBeNull();
    await sendReviewerMessage(admin, t0.id, 'Thanks, tell me more');
    expect((await tipRow(org.id)).waiting_since).toBeNull();
    await postTipsterMessage(org.id, t0.id, 'ok here it is');
    const first = (await tipRow(org.id)).waiting_since;
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await postTipsterMessage(org.id, t0.id, 'and another thing');
    expect((await tipRow(org.id)).waiting_since).toEqual(first);
  });
});

describe('new-tip alerts to staff', () => {
  it('emails only people who opted in AND may see the tip; never includes tip text or watch words', async () => {
    const m = mail();
    const { org, admin } = await makeOrg('campus', { watch_keywords: 'secretword' });
    await system((q) => q('update reviewers set notify_new = true where id = $1', [admin.id]));
    const inTeam = await makeReviewer(org, ['Counseling']);
    const outsider = await makeReviewer(org, ['School Resource Officer']);
    const optedOut = await makeReviewer(org, ['Counseling']);
    await system((q) => q('update reviewers set notify_new = true where id = any($1::uuid[])', [[inTeam.id, outsider.id]]));
    await createTip(org, { categoryId: await categoryId(org, 'Self-Harm/Suicide Concern'), description: 'private text secretword here', passcode: 'hunter22' });
    await vi.waitFor(() => expect(m).toHaveBeenCalled());
    const [email] = sent(m).filter((c) => c.url.includes('resend'));
    expect(email.body.to.sort()).toEqual(expect.arrayContaining([(await emailOf(admin.id)), (await emailOf(inTeam.id))]));
    expect(email.body.to).not.toContain(await emailOf(optedOut.id)); // did not opt in
    expect(email.body.to).not.toContain(await emailOf(outsider.id)); // opted in, but this tip is not routed to their team
    expect(email.body.subject).toMatch(/URGENT New tip/);
    const everything = JSON.stringify(email.body);
    expect(everything).not.toMatch(/private text|secretword/);
    expect(everything).toMatch(/matched your watch list/);
    expect(everything).toMatch(/\/staff\/tips\//);
  });

  it('respects the org mode: off sends nothing, urgent-only skips ordinary tips', async () => {
    const m = mail();
    const off = await makeOrg('campus', { new_tip_alerts: 'off' });
    await system((q) => q('update reviewers set notify_new = true where id = $1', [off.admin.id]));
    await createTip(off.org, { categoryId: await categoryId(off.org, 'Theft'), description: 'x', passcode: 'hunter22' });
    const t = await tipRow(off.org.id);
    expect(await alertStaff(off.org.id, t.id, 'new')).toBeNull();

    const urgentOnly = await makeOrg('campus', { new_tip_alerts: 'urgent' });
    await system((q) => q('update reviewers set notify_new = true where id = $1', [urgentOnly.admin.id]));
    await createTip(urgentOnly.org, { categoryId: await categoryId(urgentOnly.org, 'Theft'), description: 'x', passcode: 'hunter22' });
    expect(await alertStaff(urgentOnly.org.id, (await tipRow(urgentOnly.org.id)).id, 'new')).toBeNull();
    await createTip(urgentOnly.org, { categoryId: await categoryId(urgentOnly.org, 'Weapons'), description: 'x', passcode: 'hunter22' });
    expect(await alertStaff(urgentOnly.org.id, (await tipRow(urgentOnly.org.id)).id, 'new')).toMatchObject({ email: 'sent', recipients: 1 });
    expect(m).toHaveBeenCalled();
  });

  it('posts new tips (not replies) to the chat webhook, and reports a phone tip as such', async () => {
    const m = mail();
    const { org } = await makeOrg('crime_stoppers', { escalation_webhook_url: 'https://hooks.example.org/x' });
    await createTip(org, { categoryId: await categoryId(org, 'Fraud'), description: 'x', passcode: 'hunter22', source: 'phone' });
    const t = await tipRow(org.id);
    expect(t.source).toBe('phone');
    const r = await alertStaff(org.id, t.id, 'new');
    expect(r?.webhook).toBe('sent');
    const hook = sent(m).find((c) => c.url.startsWith('https://hooks.example.org'))!;
    expect(hook.body.text).toMatch(/New phone\/walk-in tip/);
    const reply = await alertStaff(org.id, t.id, 'reply');
    expect(reply?.webhook).toBe('not_configured');
  });

  it('a tipster reply alerts the assigned reviewer only when staff were caught up', async () => {
    const m = mail();
    const { org, admin } = await makeOrg('campus', { new_tip_alerts: 'all' });
    const rev = await makeReviewer(org, ['Counseling']);
    await system((q) => q('update reviewers set notify_new = true where id = any($1::uuid[])', [[admin.id, rev.id]]));
    await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'x', passcode: 'hunter22' });
    const t = await tipRow(org.id);
    await vi.waitFor(() => expect(m).toHaveBeenCalled());
    m.mockClear();
    await assignTip(admin, t.id, rev.id);
    await postTipsterMessage(org.id, t.id, 'still waiting on you'); // staff never replied yet: no alert
    await new Promise((r) => setTimeout(r, 50));
    expect(m).not.toHaveBeenCalled();
    await sendReviewerMessage(admin, t.id, 'On it');
    await postTipsterMessage(org.id, t.id, 'one more detail');
    await vi.waitFor(() => expect(m).toHaveBeenCalledTimes(1));
    expect(sent(m)[0].body.to).toEqual([await emailOf(rev.id)]);
  });
});

describe('queue search', () => {
  it('finds a tip by TIP ID, description, chat and internal note, treats % and _ literally, and respects visibility', async () => {
    const { org, admin } = await makeOrg('campus');
    const rev = await makeReviewer(org, ['Counseling']);
    await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'Jordan Smith took a backpack', passcode: 'hunter22' });
    await createTip(org, { categoryId: await categoryId(org, 'Self-Harm/Suicide Concern'), description: '100% sure about the blue Honda', passcode: 'hunter22' });
    const [a, b] = ['Jordan Smith', 'blue Honda'].map(async (w) => (await listQueue(admin, { search: w }))[0]);
    const [ta, tb] = [await a, await b];
    expect(ta.tip_id).not.toBe(tb.tip_id);
    expect((await listQueue(admin, { search: ta.tip_id.slice(0, 4).toLowerCase() })).map((r: any) => r.tip_id)).toContain(ta.tip_id);
    await postTipsterMessage(org.id, ta.id, 'the zebra jacket was green');
    await sendReviewerMessage(admin, ta.id, 'noted');
    await system((q) => q("insert into internal_notes (org_id, tip_id, body) values ($1, $2, 'check the cafeteria camera')", [org.id, ta.id]));
    expect((await listQueue(admin, { search: 'zebra' })).map((r: any) => r.id)).toEqual([ta.id]);
    expect((await listQueue(admin, { search: 'cafeteria camera' })).map((r: any) => r.id)).toEqual([ta.id]);
    expect((await listQueue(admin, { search: '100%' })).map((r: any) => r.id)).toEqual([tb.id]);
    expect(await listQueue(admin, { search: '%' })).toHaveLength(1); // a lone % is a literal, not "match everything"
    expect(await listQueue(admin, { search: '_____' })).toHaveLength(0);
    expect(await listQueue(admin, { search: "x' or 1=1 --" })).toHaveLength(0);
    // The Counseling reviewer only sees what is routed to their team, even when searching for the other tip's words.
    const visible = (await listQueue(rev, { search: 'Honda' })).map((r: any) => r.id);
    expect(visible).toEqual([tb.id]);
    expect(await listQueue(rev, { search: 'zebra' })).toEqual([]);
  });
});

const emailOf = async (id: string) => (await system((q) => q<{ email: string }>('select email from reviewers where id = $1', [id])))[0].email;
