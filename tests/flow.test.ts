import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { system, withOrg } from '@/lib/db';
import { escalate } from '@/lib/escalation';
import { getStorage } from '@/lib/storage';
import { getTipStatus, listTipsterMessages, postTipsterMessage, revealClaimCode, tipsterLogin, createTip } from '@/lib/tipster';
import { addNote, closeTip, getTipDetail, listQueue, redeemClaim, sendReviewerMessage, setReward, setTipTeams } from '@/lib/queue';
import { categoryId, makeOrg, makeReviewer, oneLocation } from './helpers';

afterEach(() => vi.unstubAllGlobals());

async function submit(org: any, category: string, extra: Record<string, unknown> = {}) {
  return createTip(org, { categoryId: await categoryId(org, category), locationId: await oneLocation(org), description: 'Saw something near the gym', passcode: 'hunter22', ...extra });
}

describe('tipster -> reviewer flow', () => {
  it('submits with evidence, logs in, chats both ways, and routes by category', async () => {
    const { org, admin } = await makeOrg('campus');
    const storage = getStorage();
    const key = `quarantine/${randomUUID()}`;
    const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#0a0' } }).jpeg().withExif({ IFD0: { Make: 'SecretCam' } }).toBuffer();
    await storage.put(key, jpeg, 'image/jpeg');

    const tip = await submit(org, 'Weapons', { urgent: true, attachmentKeys: [key] });
    expect(tip.tipId).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(tip.attachments).toEqual({ stored: 1, failed: 0 });
    expect(await storage.head(key)).toBeNull(); // raw upload is gone

    // stored evidence is sanitized and the file name/original is not kept
    const media = await system((q) => q<any>('select * from media'));
    const stored = media.find((m) => m.storage_key.includes(org.id))!;
    expect((await storage.get(stored.storage_key)).includes('SecretCam')).toBe(false);

    // returns with sloppy formatting of the TIP ID; wrong passcode fails
    expect(await tipsterLogin(org, tip.tipId.toLowerCase().replace(/-/g, ' '), 'hunter22')).toBeTruthy();
    expect(await tipsterLogin(org, tip.tipId, 'wrong-pass')).toBeNull();

    // routed to the categories' teams (Weapons -> SRO + catch-all Administration)
    const detail = await getTipDetail(admin, (await listQueue(admin))[0].id);
    expect(detail!.tip.high_risk).toBe(true);
    expect(detail!.tipTeamIds).toHaveLength(2);
    expect(detail!.tip.passcode_hash).toBeUndefined();

    const tipUuid = detail!.tip.id;
    await sendReviewerMessage(admin, tipUuid, 'Thanks - can you tell us more?');
    await postTipsterMessage(org.id, tipUuid, 'It was around 3pm');
    const msgs = await listTipsterMessages(org.id, tipUuid, 0);
    expect(msgs.map((m) => m.sender)).toEqual(['reviewer', 'tipster']);
    expect(msgs.every((m) => !('author' in m) && !('reviewer_id' in m))).toBe(true); // tipster never sees staff identity

    const after = (await getTipDetail(admin, tipUuid))!.tip;
    expect(after.status).toBe('under_review');
    expect(after.first_response_at).toBeTruthy();
    expect(after.needs_reply).toBe(true); // tipster spoke last
  });

  it('locks a TIP ID after repeated wrong passcodes, even against the right one', async () => {
    const { org } = await makeOrg('crime_stoppers');
    const tip = await submit(org, 'Fraud');
    for (let i = 0; i < 5; i++) expect(await tipsterLogin(org, tip.tipId, `nope-${i}`)).toBeNull();
    expect(await tipsterLogin(org, tip.tipId, 'hunter22')).toBeNull(); // locked
    await system((q) => q('update tips set locked_until = null'));
    expect(await tipsterLogin(org, tip.tipId, 'hunter22')).toBeTruthy();
  });

  it('enforces team routing: a team only sees tips routed to it', async () => {
    const { org, admin } = await makeOrg('campus');
    const counselor = await makeReviewer(org, ['Counseling']);
    await submit(org, 'Self-Harm/Suicide Concern'); // Counseling + Administration
    await submit(org, 'Theft'); // School Resource Officer + Administration
    expect((await listQueue(counselor)).map((t: any) => t.category)).toEqual(['Self-Harm/Suicide Concern']);
    expect(await listQueue(admin)).toHaveLength(2);
    const theft = (await listQueue(admin)).find((t: any) => t.category === 'Theft');
    expect(await getTipDetail(counselor, theft.id)).toBeNull();
    await expect(sendReviewerMessage(counselor, theft.id, 'hi')).rejects.toThrow('Tip not found');
    const counsel = await system((q) => q<any>("select id from teams where org_id = $1 and name = 'Counseling'", [org.id]));
    await setTipTeams(admin, theft.id, [counsel[0].id]); // route it -> now visible
    expect(await getTipDetail(counselor, theft.id)).not.toBeNull();
  });

  it('closure requires a reason; internal notes stay staff-only', async () => {
    const { org, admin } = await makeOrg('crime_stoppers');
    await submit(org, 'Vandalism');
    const [t] = await listQueue(admin);
    await expect(closeTip(admin, t.id, '')).rejects.toThrow('closure reason');
    await addNote(admin, t.id, 'internal only');
    await closeTip(admin, t.id, 'unfounded', 'checked cameras');
    const d = (await getTipDetail(admin, t.id))!;
    expect(d.tip.status).toBe('closed');
    expect(d.tip.closure_reason).toBe('unfounded');
    expect(d.notes).toHaveLength(1);
    expect(await listQueue(admin)).toHaveLength(0); // closed hidden from the default queue
    expect(await listQueue(admin, { status: 'all' })).toHaveLength(1);
  });
});

describe('rewards', () => {
  it('claim code is shown once, only hashed at rest, and redeemable once by staff', async () => {
    const { org, admin } = await makeOrg('crime_stoppers');
    const tip = await submit(org, 'Robbery');
    const [q0] = await listQueue(admin);
    expect((await revealClaimCode(org.id, q0.id)).notEligible).toBe(true);
    await expect(setReward(admin, q0.id, true, 999999)).rejects.toThrow('Amount must be');
    await setReward(admin, q0.id, true, 25000);

    const first = await revealClaimCode(org.id, q0.id);
    expect(first.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    expect((await revealClaimCode(org.id, q0.id)).alreadyShown).toBe(true);
    const row = (await system((q) => q<any>('select claim_code_hash from tips where id = $1', [q0.id])))[0];
    expect(row.claim_code_hash).toMatch(/^\$argon2/);
    expect(JSON.stringify(row)).not.toContain(first.code!);
    expect((await getTipStatus(org.id, q0.id))!.claim_code_shown).toBe(true);

    expect((await redeemClaim(admin, tip.tipId, 'AAAA-AAAA-AAAA-AAAA')).ok).toBe(false);
    const ok = await redeemClaim(admin, tip.tipId, first.code!.toLowerCase());
    expect(ok).toMatchObject({ ok: true, amountCents: 25000 });
    expect((await redeemClaim(admin, tip.tipId, first.code!)).ok).toBe(false); // one-time
    const log = await system((q) => q<any>("select actor, detail from audit_log where action = 'reward.claimed'"));
    expect(log).toHaveLength(1);
  });

  it('locks claim redemption after repeated wrong codes', async () => {
    const { org, admin } = await makeOrg('crime_stoppers');
    const tip = await submit(org, 'Robbery');
    const [t] = await listQueue(admin);
    await setReward(admin, t.id, true, 100);
    const { code } = await revealClaimCode(org.id, t.id);
    for (let i = 0; i < 5; i++) expect((await redeemClaim(admin, tip.tipId, 'BBBB-BBBB-BBBB-BBBB')).ok).toBe(false);
    expect((await redeemClaim(admin, tip.tipId, code!)).ok).toBe(false); // locked out even with the right code
  });
});

describe('escalation', () => {
  it('alerts on-call staff by email and webhook, without tip content, and writes the audit trail', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('RESEND_FROM', 'OpenTip <alerts@example.org>');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    // new-tip alerts are covered in alerts-watchlist.test.ts; switched off here so only the escalation's own calls are counted
    const { org, admin } = await makeOrg('campus', { escalation_webhook_url: 'https://hooks.example.org/x', new_tip_alerts: 'off' });
    await makeReviewer(org, ['Counseling'], { onCall: true });
    await submit(org, 'Self-Harm/Suicide Concern', { description: 'SENSITIVE-DESCRIPTION-TEXT' });
    const [t] = await listQueue(admin);

    const r = await escalate(admin, t.id);
    expect(r).toMatchObject({ delivered: true, email: 'sent', webhook: 'sent', recipients: 2 }); // admin + Rita (both on call)
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => new URL(c[0]).host).sort()).toEqual(['api.resend.com', 'hooks.example.org']);
    for (const [, init] of calls) expect(String(init.body)).not.toContain('SENSITIVE-DESCRIPTION-TEXT');

    const log = await system((q) => q<any>("select actor, tip_ref, detail, created_at from audit_log where action = 'tip.escalate'"));
    expect(log).toHaveLength(1);
    expect(log[0].actor).toContain(admin.email);
    expect(log[0].detail.delivered).toBe(true);
  });

  it('reports failure loudly when no channel is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const { org, admin } = await makeOrg('campus', { escalation_webhook_url: 'https://hooks.example.org/x', escalation_email_mode: 'off' });
    await submit(org, 'Weapons');
    const [t] = await listQueue(admin);
    const r = await escalate(admin, t.id);
    expect(r.delivered).toBe(false);
    expect(r.webhook).toBe('failed');
    const log = await system((q) => q<any>("select detail from audit_log where action = 'tip.escalate' and org_id = $1", [org.id]));
    expect(log[0].detail.delivered).toBe(false); // failure is recorded too
  });
});

describe('location-based routing', () => {
  it('a team scoped to a location only receives tips submitted for that location', async () => {
    const { org, admin } = await makeOrg('campus');
    const [north, south] = await system(async (q) => [
      (await q<{ id: string }>("insert into locations (org_id, name) values ($1, 'North HS') returning id", [org.id]))[0].id,
      (await q<{ id: string }>("insert into locations (org_id, name) values ($1, 'South HS') returning id", [org.id]))[0].id,
    ]);
    await system((q) => q("insert into team_locations (org_id, team_id, location_id) select $1, id, $2 from teams where org_id = $1 and name = 'School Resource Officer'", [org.id, north]));
    const cat = await categoryId(org, 'Theft'); // routes to School Resource Officer + Administration
    const teamsOf = async (tip: { tipId: string }) =>
      (await system((q) => q<{ name: string }>('select tm.name from tips t join tip_teams tt on tt.tip_id = t.id join teams tm on tm.id = tt.team_id where t.tip_id = $1 order by tm.name', [tip.tipId]))).map((r) => r.name);

    expect(await teamsOf(await createTip(org, { categoryId: cat, locationId: north, description: 'n', passcode: 'hunter22' }))).toEqual(['Administration', 'School Resource Officer']);
    expect(await teamsOf(await createTip(org, { categoryId: cat, locationId: south, description: 's', passcode: 'hunter22' }))).toEqual(['Administration']);
    expect(await teamsOf(await createTip(org, { categoryId: cat, description: 'none', passcode: 'hunter22' }))).toEqual(['Administration']);
    expect(await listQueue(admin)).toHaveLength(3);
  });
});
