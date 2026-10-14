import { audit } from './audit';
import { verifySecret } from './crypto';
import { withOrg, type Q } from './db';
import { canonicalClaimCode, canonicalTipId } from './ids';
import { notifyTipster } from './push';
import { visible, type Staff } from './staff';

export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export class StaffInputError extends Error {}

/** A tip is priority when the tipster said urgent, its category is high-risk, or it matched the keyword watch list. */
export const PRIORITY = '(t.urgent or c.high_risk or cardinality(t.watch_hits) > 0)';

/** Every staff action on a tip loads it through here first, so team routing is enforced in one place. */
async function guard(q: Q, s: Staff, tipId: string) {
  if (!isUuid(tipId)) return null;
  const rows = await q<{ id: string; tip_id: string; status: string; urgent: boolean; reward_eligible: boolean; claimed_at: Date | null }>(
    `select t.id, t.tip_id, t.status, t.urgent, t.reward_eligible, t.claimed_at from tips t where t.id = $1 and ${visible(s, 2)}`,
    [tipId, s.id],
  );
  return rows[0] ?? null;
}
async function need(q: Q, s: Staff, tipId: string) {
  const t = await guard(q, s, tipId);
  if (!t) throw new StaffInputError('Tip not found');
  return t;
}

export type QueueFilter = {
  status?: string;
  categoryId?: string;
  locationId?: string;
  teamId?: string;
  assignee?: string; // 'me' | 'unassigned' | reviewer uuid
  urgent?: boolean;
  /** Only tips where the tipster wrote last and staff owe a reply. */
  needsReply?: boolean;
  /** Free text: matches a TIP ID, the description, chat messages and internal notes. */
  search?: string;
  sort?: 'priority' | 'newest' | 'oldest';
};

export async function listQueue(s: Staff, f: QueueFilter = {}) {
  const params: unknown[] = [s.id];
  const where = [visible(s, 1)];
  const add = (sql: string, v: unknown) => (params.push(v), where.push(sql.replace('?', `$${params.length}`)));
  if (f.status === 'all') { /* no status filter */ }
  else if (f.status && f.status !== 'open') add('t.status = ?', f.status);
  else where.push("t.status <> 'closed'");
  if (isUuid(f.categoryId)) add('t.category_id = ?', f.categoryId);
  if (isUuid(f.locationId)) add('t.location_id = ?', f.locationId);
  if (isUuid(f.teamId)) add('exists (select 1 from tip_teams x where x.tip_id = t.id and x.team_id = ?)', f.teamId);
  if (f.assignee === 'me') where.push('t.assigned_reviewer_id = $1');
  else if (f.assignee === 'unassigned') where.push('t.assigned_reviewer_id is null');
  else if (isUuid(f.assignee)) add('t.assigned_reviewer_id = ?', f.assignee);
  if (f.urgent) where.push(PRIORITY);
  if (f.needsReply) where.push("(t.needs_reply and t.status <> 'closed')");
  const term = (f.search ?? '').trim().slice(0, 100);
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
    const p = `$${params.length}`;
    where.push(`(t.tip_id ilike ${p} or t.description ilike ${p} or exists (select 1 from messages m where m.tip_id = t.id and m.body ilike ${p}) or exists (select 1 from internal_notes n where n.tip_id = t.id and n.body ilike ${p}))`);
  }
  const order =
    f.sort === 'newest' ? 't.created_at desc' : f.sort === 'oldest' ? 't.created_at asc'
    : `(t.status <> 'closed') desc, ${PRIORITY} desc, t.needs_reply desc, t.created_at desc`;
  return withOrg(s.orgId, (q) =>
    q(
      `select t.id, t.tip_id, t.status, t.urgent, c.high_risk, ${PRIORITY} as priority, t.needs_reply, t.waiting_since, t.assigned_reviewer_id, t.source, cardinality(t.watch_hits) > 0 as watch,
              t.created_at, c.name as category, l.name as location, r.name as assignee,
              (select string_agg(tm.name, ', ' order by tm.name) from tip_teams tt join teams tm on tm.id = tt.team_id where tt.tip_id = t.id) as teams
         from tips t join categories c on c.id = t.category_id
         left join locations l on l.id = t.location_id
         left join reviewers r on r.id = t.assigned_reviewer_id
        where ${where.join(' and ')}
        order by ${order} limit 300`,
      params,
    ),
  );
}

/** True while the tip is still visible to this staff member (routing or assignment changes can remove access). */
export const canView = (s: Staff, tipId: string) => withOrg(s.orgId, async (q) => !!(await guard(q, s, tipId)));

export async function getTipDetail(s: Staff, tipId: string) {
  return withOrg(s.orgId, async (q) => {
    const base = await guard(q, s, tipId);
    if (!base) return null;
    const [tip] = await q(
      `select t.*, c.name as category, c.high_risk, l.name as location, r.name as assignee_name, b.title as bulletin_title, b.case_number as bulletin_case
         from tips t join categories c on c.id = t.category_id
         left join locations l on l.id = t.location_id left join reviewers r on r.id = t.assigned_reviewer_id
         left join bulletins b on b.id = t.bulletin_id
        where t.id = $1`,
      [tipId],
    );
    delete tip.passcode_hash;
    delete tip.claim_code_hash;
    const media = await q('select id, kind, mime, size_bytes, created_at from media where tip_id = $1 order by created_at', [tipId]);
    const notes = await q('select n.id, n.body, n.created_at, r.name as author from internal_notes n left join reviewers r on r.id = n.reviewer_id where n.tip_id = $1 order by n.created_at', [tipId]);
    const teams = await q('select id, name from teams order by name');
    const tipTeams = await q('select team_id from tip_teams where tip_id = $1', [tipId]);
    const reviewers = await q('select id, name from reviewers where active order by name');
    const canned = await q('select id, title, body, category_id from canned_responses where category_id is null or category_id = $1 order by title', [tip.category_id]);
    await audit(q, s, 'tip.view', tip.tip_id);
    return { tip, media, notes, teams, tipTeamIds: tipTeams.map((r: any) => r.team_id as string), reviewers, canned };
  });
}

export const listStaffMessages = (s: Staff, tipId: string, since: number) =>
  withOrg(s.orgId, async (q) => {
    if (!(await guard(q, s, tipId))) return null;
    return q<{ seq: string; sender: string; body: string; created_at: Date; author: string | null }>(
      `select m.seq::text, m.sender, m.body, m.created_at, r.name as author
         from messages m left join reviewers r on r.id = m.reviewer_id where m.tip_id = $1 and m.seq > $2 order by m.seq limit 200`,
      [tipId, since],
    );
  });

export async function sendReviewerMessage(s: Staff, tipId: string, body: string) {
  const text = body.trim();
  if (!text || text.length > 5000) throw new StaffInputError('Message must be 1-5,000 characters.');
  await withOrg(s.orgId, async (q) => {
    await need(q, s, tipId);
    await q("insert into messages (org_id, tip_id, sender, reviewer_id, body) values ($1, $2, 'reviewer', $3, $4)", [s.orgId, tipId, s.id, text]);
    await q(
      `update tips set needs_reply = false, waiting_since = null, updated_at = now(),
              first_response_at = coalesce(first_response_at, now()),
              status = case when status = 'new' then 'under_review' else status end
        where id = $1`,
      [tipId],
    );
  });
  await notifyTipster(s.orgId, tipId).catch(() => {});
}

export const addNote = (s: Staff, tipId: string, body: string) =>
  withOrg(s.orgId, async (q) => {
    const text = body.trim();
    if (!text || text.length > 5000) throw new StaffInputError('Note must be 1-5,000 characters.');
    await need(q, s, tipId);
    await q('insert into internal_notes (org_id, tip_id, reviewer_id, body) values ($1, $2, $3, $4)', [s.orgId, tipId, s.id, text]);
  });

export const CLOSURE_REASONS = ['actioned', 'unfounded', 'referred', 'other'] as const;

export const setStatus = (s: Staff, tipId: string, status: 'under_review' | 'actioned') =>
  withOrg(s.orgId, async (q) => {
    if (status !== 'under_review' && status !== 'actioned') throw new StaffInputError('Invalid status');
    const t = await need(q, s, tipId);
    await q("update tips set status = $2, closure_reason = null, closure_note = null, closed_at = null, updated_at = now() where id = $1", [tipId, status]);
    await audit(q, s, 'tip.status', t.tip_id, { from: t.status, to: status });
  });

export const closeTip = (s: Staff, tipId: string, reason: string, note?: string) =>
  withOrg(s.orgId, async (q) => {
    if (!(CLOSURE_REASONS as readonly string[]).includes(reason)) throw new StaffInputError('A closure reason is required.');
    const t = await need(q, s, tipId);
    await q("update tips set status = 'closed', closure_reason = $2, closure_note = $3, closed_at = now(), updated_at = now() where id = $1", [tipId, reason, note?.trim().slice(0, 2000) || null]);
    await audit(q, s, 'tip.close', t.tip_id, { reason });
  });

export const setUrgent = (s: Staff, tipId: string, urgent: boolean) =>
  withOrg(s.orgId, async (q) => {
    const t = await need(q, s, tipId);
    await q('update tips set urgent = $2, updated_at = now() where id = $1', [tipId, urgent]);
    await audit(q, s, urgent ? 'tip.flag_urgent' : 'tip.unflag_urgent', t.tip_id);
  });

export const assignTip = (s: Staff, tipId: string, reviewerId: string | null) =>
  withOrg(s.orgId, async (q) => {
    const t = await need(q, s, tipId);
    if (reviewerId && !(isUuid(reviewerId) && (await q('select 1 from reviewers where id = $1 and active', [reviewerId])).length)) throw new StaffInputError('Unknown reviewer');
    await q('update tips set assigned_reviewer_id = $2, updated_at = now() where id = $1', [tipId, reviewerId || null]);
    await audit(q, s, 'tip.assign', t.tip_id, { to: reviewerId });
  });

/** Route a tip to one or more teams; each team then sees it in its queue. */
export const setTipTeams = (s: Staff, tipId: string, teamIds: string[]) =>
  withOrg(s.orgId, async (q) => {
    const t = await need(q, s, tipId);
    const ids = teamIds.filter(isUuid);
    await q('delete from tip_teams where tip_id = $1', [tipId]);
    if (ids.length) await q('insert into tip_teams (org_id, tip_id, team_id) select $1, $2, id from teams where id = any($3::uuid[])', [s.orgId, tipId, ids]);
    await audit(q, s, 'tip.route', t.tip_id, { teams: ids.length });
  });

export const getMediaFor = (s: Staff, mediaId: string) =>
  withOrg(s.orgId, async (q) => {
    if (!isUuid(mediaId)) return null;
    const m = (await q<{ storage_key: string; mime: string; tip_id: string }>('select storage_key, mime, tip_id from media where id = $1', [mediaId]))[0];
    if (!m || !(await guard(q, s, m.tip_id))) return null;
    return m;
  });

// ---- Rewards ----

export const setReward = (s: Staff, tipId: string, eligible: boolean, amountCents: number) =>
  withOrg(s.orgId, async (q) => {
    const t = await need(q, s, tipId);
    const org = (await q<{ max_reward_cents: number }>('select max_reward_cents from organizations'))[0];
    if (eligible) {
      if (!Number.isInteger(amountCents) || amountCents < 0 || amountCents > org.max_reward_cents) {
        throw new StaffInputError(`Amount must be between $0 and $${(org.max_reward_cents / 100).toFixed(2)}.`);
      }
      if (t.claimed_at) throw new StaffInputError('This reward has already been claimed.');
    }
    await q('update tips set reward_eligible = $2, reward_amount_cents = $3, updated_at = now() where id = $1', [tipId, eligible, eligible ? amountCents : null]);
    await audit(q, s, eligible ? 'reward.set' : 'reward.clear', t.tip_id, eligible ? { amountCents } : null);
    return !t.reward_eligible && eligible; // newly eligible -> caller pings the tipster
  }).then(async (newlyEligible) => {
    if (newlyEligible) await notifyTipster(s.orgId, tipId).catch(() => {});
  });

export const reissueClaimCode = (s: Staff, tipId: string) =>
  withOrg(s.orgId, async (q) => {
    const t = await need(q, s, tipId);
    if (t.claimed_at) throw new StaffInputError('Already claimed.');
    await q('update tips set claim_code_hash = null, claim_code_revealed_at = null where id = $1', [tipId]);
    await audit(q, s, 'reward.reissue', t.tip_id);
  });

const CLAIM_MAX_FAILS = 5;
const CLAIM_LOCK_MINUTES = 15;

/** Staff enters the TIP ID + code the tipster read out. Failed guesses lock the tip for a while. */
export async function redeemClaim(s: Staff, tipIdInput: string, codeInput: string): Promise<{ ok: boolean; message: string; amountCents?: number }> {
  const tipId = canonicalTipId(tipIdInput);
  const code = canonicalClaimCode(codeInput);
  if (!tipId || !code) return { ok: false, message: 'Enter a valid TIP ID and claim code.' };
  return withOrg(s.orgId, async (q) => {
    const t = (
      await q<any>(
        `select t.id, t.claim_code_hash, t.claimed_at, t.reward_amount_cents, t.reward_eligible, coalesce(t.claim_locked_until > now(), false) as locked
           from tips t where t.tip_id = $1 and ${visible(s, 2)}`,
        [tipId, s.id],
      )
    )[0];
    const usable = t && t.reward_eligible && !t.claimed_at && !t.locked;
    const ok = await verifySecret(usable ? t.claim_code_hash : null, code);
    if (ok) {
      const won = await q('update tips set claimed_at = now(), claim_failed_attempts = 0 where id = $1 and claimed_at is null returning id', [t.id]);
      if (won.length) {
        await audit(q, s, 'reward.claimed', tipId, { amountCents: t.reward_amount_cents });
        return { ok: true, message: 'Claim code accepted. Process the payout through your normal channel.', amountCents: t.reward_amount_cents };
      }
    }
    if (usable) {
      await q(
        `update tips set claim_failed_attempts = claim_failed_attempts + 1,
           claim_locked_until = case when claim_failed_attempts + 1 >= $2 then now() + make_interval(mins => $3) else claim_locked_until end where id = $1`,
        [t.id, CLAIM_MAX_FAILS, CLAIM_LOCK_MINUTES],
      );
    }
    return { ok: false, message: 'That TIP ID and claim code do not match, or the reward is not claimable. Repeated wrong codes lock the tip for 15 minutes.' };
  });
}

