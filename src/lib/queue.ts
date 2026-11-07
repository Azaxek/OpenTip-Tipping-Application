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

export type TipStatus = 'new' | 'under_review' | 'actioned' | 'closed';

/** One line of the reviewer queue. Mirrors the select list in listQueue. */
export type QueueRow = {
  id: string;
  tip_id: string;
  status: TipStatus;
  urgent: boolean;
  high_risk: boolean;
  /** urgent, high-risk category, or matched the keyword watch list (see PRIORITY). */
  priority: boolean;
  needs_reply: boolean;
  waiting_since: Date | null;
  assigned_reviewer_id: string | null;
  source: 'web' | 'phone';
  watch: boolean;
  created_at: Date;
  category: string;
  location: string | null;
  assignee: string | null;
  teams: string | null;
};

/** Rows shown in the queue at most; the page says so when the list is cut off. Counts are computed separately (queueCounts). */
export const QUEUE_LIMIT = 300;

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

export async function listQueue(s: Staff, f: QueueFilter = {}): Promise<QueueRow[]> {
  const params: unknown[] = [s.id];
  const where = [visible(s, 1)];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
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
    q<QueueRow>(
      `select t.id, t.tip_id, t.status, t.urgent, c.high_risk, ${PRIORITY} as priority, t.needs_reply, t.waiting_since, t.assigned_reviewer_id, t.source, cardinality(t.watch_hits) > 0 as watch,
              t.created_at, c.name as category, l.name as location, r.name as assignee,
              (select string_agg(tm.name, ', ' order by tm.name) from tip_teams tt join teams tm on tm.id = tt.team_id where tt.tip_id = t.id) as teams
         from tips t join categories c on c.id = t.category_id
         left join locations l on l.id = t.location_id
         left join reviewers r on r.id = t.assigned_reviewer_id
        where ${where.join(' and ')}
        order by ${order} limit ${QUEUE_LIMIT}`,
      params,
    ),
  );
}

export type QueueCounts = { open: number; needsReply: number; priority: number; mine: number };

/** Exact tab counts for the people-visible open tips. A separate aggregate, so a busy queue is not undercounted by the row limit above. */
export const queueCounts = (s: Staff): Promise<QueueCounts> =>
  withOrg(s.orgId, async (q) => {
    const [row] = await q<QueueCounts>(
      `select count(*)::int as open,
              (count(*) filter (where t.needs_reply))::int as "needsReply",
              (count(*) filter (where ${PRIORITY}))::int as priority,
              (count(*) filter (where t.assigned_reviewer_id = $1))::int as mine
         from tips t join categories c on c.id = t.category_id
        where ${visible(s, 1)} and t.status <> 'closed'`,
      [s.id],
    );
    return row ?? { open: 0, needsReply: 0, priority: 0, mine: 0 };
  });

/** The tip as a reviewer sees it. Columns are listed explicitly so the passcode and claim-code hashes are never even loaded. */
export type TipDetailRow = {
  id: string;
  org_id: string;
  tip_id: string;
  location_id: string | null;
  category_id: string;
  urgent: boolean;
  description: string;
  status: TipStatus;
  needs_reply: boolean;
  assigned_reviewer_id: string | null;
  closure_reason: 'actioned' | 'unfounded' | 'referred' | 'other' | null;
  closure_note: string | null;
  closed_at: Date | null;
  first_response_at: Date | null;
  reward_eligible: boolean;
  reward_amount_cents: number | null;
  claim_code_revealed_at: Date | null;
  claimed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  source: 'web' | 'phone';
  watch_hits: string[];
  waiting_since: Date | null;
  bulletin_id: string | null;
  category: string;
  high_risk: boolean;
  location: string | null;
  assignee_name: string | null;
  bulletin_title: string | null;
  bulletin_case: string | null;
};
export type MediaRow = { id: string; kind: 'image' | 'video' | 'audio' | 'document'; mime: string; size_bytes: string; created_at: Date };
export type NoteRow = { id: string; body: string; created_at: Date; author: string | null };
export type NamedRow = { id: string; name: string };
export type CannedRow = { id: string; title: string; body: string; category_id: string | null };

const TIP_DETAIL_COLUMNS = `t.id, t.org_id, t.tip_id, t.location_id, t.category_id, t.urgent, t.description, t.status, t.needs_reply, t.assigned_reviewer_id,
  t.closure_reason, t.closure_note, t.closed_at, t.first_response_at, t.reward_eligible, t.reward_amount_cents, t.claim_code_revealed_at, t.claimed_at,
  t.created_at, t.updated_at, t.source, t.watch_hits, t.waiting_since, t.bulletin_id`;

/** True while the tip is still visible to this staff member (routing or assignment changes can remove access). */
export const canView = (s: Staff, tipId: string) => withOrg(s.orgId, async (q) => !!(await guard(q, s, tipId)));

export async function getTipDetail(s: Staff, tipId: string) {
  return withOrg(s.orgId, async (q) => {
    const base = await guard(q, s, tipId);
    if (!base) return null;
    const [tip] = await q<TipDetailRow>(
      `select ${TIP_DETAIL_COLUMNS}, c.name as category, c.high_risk, l.name as location, r.name as assignee_name, b.title as bulletin_title, b.case_number as bulletin_case
         from tips t join categories c on c.id = t.category_id
         left join locations l on l.id = t.location_id left join reviewers r on r.id = t.assigned_reviewer_id
         left join bulletins b on b.id = t.bulletin_id
        where t.id = $1`,
      [tipId],
    );
    if (!tip) return null; // vanished between the guard and the read (deleted by the retention purge)
    const media = await q<MediaRow>('select id, kind, mime, size_bytes, created_at from media where tip_id = $1 order by created_at', [tipId]);
    const notes = await q<NoteRow>('select n.id, n.body, n.created_at, r.name as author from internal_notes n left join reviewers r on r.id = n.reviewer_id where n.tip_id = $1 order by n.created_at', [tipId]);
    const teams = await q<NamedRow>('select id, name from teams order by name');
    const tipTeams = await q<{ team_id: string }>('select team_id from tip_teams where tip_id = $1', [tipId]);
    const reviewers = await q<NamedRow>('select id, name from reviewers where active order by name');
    const canned = await q<CannedRow>('select id, title, body, category_id from canned_responses where category_id is null or category_id = $1 order by title', [tip.category_id]);
    await audit(q, s, 'tip.view', tip.tip_id);
    return { tip, media, notes, teams, tipTeamIds: tipTeams.map((r) => r.team_id), reviewers, canned };
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
export async function redeemClaim(s: Staff, tipIdInput: string, codeInput: string): Promise<{ ok: boolean; message: string; amountCents?: number | null }> {
  const tipId = canonicalTipId(tipIdInput);
  const code = canonicalClaimCode(codeInput);
  if (!tipId || !code) return { ok: false, message: 'Enter a valid TIP ID and claim code.' };
  return withOrg(s.orgId, async (q) => {
    const t = (
      await q<{ id: string; claim_code_hash: string | null; claimed_at: Date | null; reward_amount_cents: number | null; reward_eligible: boolean; locked: boolean }>(
        `select t.id, t.claim_code_hash, t.claimed_at, t.reward_amount_cents, t.reward_eligible, coalesce(t.claim_locked_until > now(), false) as locked
           from tips t where t.tip_id = $1 and ${visible(s, 2)}`,
        [tipId, s.id],
      )
    )[0];
    const usable = t?.reward_eligible && !t.claimed_at && !t.locked;
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

