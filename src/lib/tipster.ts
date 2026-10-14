import { afterResponse } from './after';
import { hashSecret, signToken, verifySecret, verifyToken } from './crypto';
import { withOrg } from './db';
import { canonicalTipId, newClaimCode, newTipId } from './ids';
import { localizeCategory, localizeOrgText, type Lang } from './i18n';
import { alertStaff } from './notify';
import type { Org } from './org';
import { ingest } from './uploads';
import { parseKeywords, watchHits } from './watch';

export const PASSCODE_MIN = 6;
export const TOKEN_TTL_SECONDS = 2 * 3600;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export class InputError extends Error {}

export type NewTip = {
  locationId?: string | null;
  categoryId: string;
  urgent?: boolean;
  description?: string;
  passcode: string;
  attachmentKeys?: string[];
  /** 'phone' = entered by staff from a call or walk-in; the caller still gets a TIP ID and passcode. */
  source?: 'web' | 'phone';
  /** The public case bulletin this tip is about (ignored if the bulletin has since been closed). */
  bulletinId?: string | null;
};

const tipToken = (orgId: string, tipUuid: string) => signToken({ k: 'tipster', t: tipUuid, o: orgId }, TOKEN_TTL_SECONDS);

/** Resolves a Bearer token to {orgId, tipUuid}. The token holds a random tip row id only - nothing identifying. */
export function tipsterFromRequest(req: Request): { orgId: string; tipUuid: string } | null {
  const p = verifyToken<{ k: string; t: string; o: string }>(req.headers.get('authorization')?.replace(/^Bearer /, ''));
  return p && p.k === 'tipster' ? { orgId: p.o, tipUuid: p.t } : null;
}

export async function createTip(org: Org, input: NewTip) {
  const description = (input.description ?? '').trim();
  const keys = input.attachmentKeys ?? [];
  if (description.length > 5000) throw new InputError('Description is too long (5,000 characters max).');
  if (!description && keys.length === 0) throw new InputError('Please describe what you know or attach evidence.');
  if (typeof input.passcode !== 'string' || input.passcode.length < PASSCODE_MIN || input.passcode.length > 128) {
    throw new InputError(`Passcode must be at least ${PASSCODE_MIN} characters.`);
  }
  const passcodeHash = await hashSecret(input.passcode);

  const created = await withOrg(org.id, async (q) => {
    const cat = await q('select id from categories where id = $1 and active', [input.categoryId]);
    if (!cat.length) throw new InputError('Please choose a category.');
    if (input.locationId) {
      if (!(await q('select 1 from locations where id = $1 and active', [input.locationId])).length) throw new InputError('Unknown location.');
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const tipId = newTipId();
      const row = await q<{ id: string }>(
        `insert into tips (org_id, tip_id, passcode_hash, location_id, category_id, urgent, description, source, watch_hits, waiting_since, bulletin_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), (select id from bulletins where id = $10::uuid and active)) on conflict (tip_id) do nothing returning id`,
        [org.id, tipId, passcodeHash, input.locationId || null, input.categoryId, !!input.urgent, description, input.source ?? 'web', watchHits(description, parseKeywords(org.watch_keywords ?? '')), input.bulletinId || null],
      );
      if (!row.length) continue;
      // Route to the category's teams, skipping any team scoped to other locations than this tip's.
      await q(
        `insert into tip_teams (org_id, tip_id, team_id)
         select $1, $2, ct.team_id from category_teams ct
          where ct.category_id = $3
            and (not exists (select 1 from team_locations tl where tl.team_id = ct.team_id)
                 or exists (select 1 from team_locations tl where tl.team_id = ct.team_id and tl.location_id = $4::uuid))`,
        [org.id, row[0].id, input.categoryId, input.locationId || null],
      );
      return { tipId, tipUuid: row[0].id };
    }
    throw new Error('Could not allocate a TIP ID');
  });

  const attachments = keys.length ? await ingest(org, created.tipUuid, keys) : { stored: 0, failed: 0 };
  afterResponse(() => alertStaff(org.id, created.tipUuid, 'new'));
  return { tipId: created.tipId, token: tipToken(org.id, created.tipUuid), attachments };
}

/** TIP ID + passcode -> session token. Uniform failure; per-TIP-ID lockout (no IP is involved or stored). */
export async function tipsterLogin(org: Org, tipIdInput: unknown, passcode: unknown): Promise<string | null> {
  const tipId = canonicalTipId(tipIdInput);
  const pass = typeof passcode === 'string' ? passcode.slice(0, 128) : '';
  const row = tipId
    ? (await withOrg(org.id, (q) => q<{ id: string; passcode_hash: string; locked: boolean }>('select id, passcode_hash, coalesce(locked_until > now(), false) as locked from tips where tip_id = $1', [tipId])))[0]
    : undefined;
  const ok = await verifySecret(row && !row.locked ? row.passcode_hash : null, pass);
  if (!row) return null;
  if (ok) {
    await withOrg(org.id, (q) => q('update tips set failed_attempts = 0, locked_until = null where id = $1 and failed_attempts > 0', [row.id]));
    return tipToken(org.id, row.id);
  }
  if (!row.locked) {
    await withOrg(org.id, (q) =>
      q(
        `update tips set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
         where id = $1`,
        [row.id, MAX_FAILS, LOCK_MINUTES],
      ),
    );
  }
  return null;
}

export async function getTipStatus(orgId: string, tipUuid: string, lang: Lang = 'en') {
  const rows = await withOrg(orgId, (q) =>
    q(
      `select t.status, t.created_at, c.name as category, c.description as category_description, t.reward_eligible, t.reward_amount_cents,
              (t.claim_code_revealed_at is not null) as claim_code_shown, (t.claimed_at is not null) as claimed,
              o.tipster_note as note, o.help_text as resources, o.tipster_note_es, o.help_text_es, o.org_type
         from tips t join categories c on c.id = t.category_id join organizations o on o.id = t.org_id where t.id = $1`,
      [tipUuid],
    ),
  );
  const r = rows[0];
  if (!r) return null;
  const { tipster_note_es, help_text_es, org_type, category_description, ...out } = r;
  const cat = localizeCategory({ name: out.category as string, description: category_description as string }, lang, org_type);
  return {
    ...out,
    category: cat.name,
    note: localizeOrgText('note', out.note, tipster_note_es, lang, org_type),
    resources: localizeOrgText('help', out.resources, help_text_es, lang, org_type),
  };
}

export const listTipsterMessages = (orgId: string, tipUuid: string, since: number) =>
  withOrg(orgId, (q) =>
    q<{ seq: string; sender: 'tipster' | 'reviewer'; body: string; created_at: Date }>(
      'select seq::text, sender, body, created_at from messages where tip_id = $1 and seq > $2 order by seq limit 200',
      [tipUuid, since],
    ),
  );

export async function postTipsterMessage(orgId: string, tipUuid: string, body: unknown) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text || text.length > 5000) throw new InputError('Message must be 1-5,000 characters.');
  const wasWaiting = await withOrg(orgId, async (q) => {
    const tip = (await q<{ needs_reply: boolean }>('select needs_reply from tips where id = $1', [tipUuid]))[0];
    if (!tip) throw new InputError('This tip no longer exists.');
    const recent = await q<{ n: number }>("select count(*)::int as n from messages where tip_id = $1 and sender = 'tipster' and created_at > now() - interval '1 hour'", [tipUuid]);
    if (recent[0].n >= 60) throw new InputError('You are sending messages too quickly. Please wait a while.');
    await q("insert into messages (org_id, tip_id, sender, body) values ($1, $2, 'tipster', $3)", [orgId, tipUuid, text]);
    // A watch-list word in a follow-up flags the tip too; waiting_since only restarts when staff had already replied.
    const kw = parseKeywords((await q<{ watch_keywords: string }>('select watch_keywords from organizations'))[0].watch_keywords);
    await q(
      `update tips set waiting_since = case when needs_reply then waiting_since else now() end, needs_reply = true, updated_at = now(),
              watch_hits = (select coalesce(array_agg(distinct w), '{}') from unnest(watch_hits || $2::text[]) as w) where id = $1`,
      [tipUuid, watchHits(text, kw)],
    );
    return tip.needs_reply;
  });
  if (!wasWaiting) afterResponse(() => alertStaff(orgId, tipUuid, 'reply')); // only when staff were caught up, so a chatty tipster cannot flood anyone
}

/**
 * Shows the reward claim code exactly once. Only its argon2 hash is stored, so it cannot be shown again;
 * if it is lost, a reviewer reissues it (which invalidates the old one).
 */
export async function revealClaimCode(orgId: string, tipUuid: string): Promise<{ code?: string; alreadyShown?: boolean; notEligible?: boolean }> {
  const code = newClaimCode();
  const hash = await hashSecret(code);
  return withOrg(orgId, async (q) => {
    const t = (await q<{ reward_eligible: boolean; claim_code_revealed_at: Date | null; claimed_at: Date | null }>('select reward_eligible, claim_code_revealed_at, claimed_at from tips where id = $1', [tipUuid]))[0];
    if (!t?.reward_eligible) return { notEligible: true };
    if (t.claim_code_revealed_at || t.claimed_at) return { alreadyShown: true };
    // Atomic: two simultaneous requests can't both win.
    const won = await q('update tips set claim_code_hash = $2, claim_code_revealed_at = now() where id = $1 and claim_code_revealed_at is null returning id', [tipUuid, hash]);
    return won.length ? { code } : { alreadyShown: true };
  });
}

