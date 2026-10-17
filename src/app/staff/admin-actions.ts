'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { deleteBulletin, saveBulletin } from '@/lib/bulletins';
import { sendTestAlert } from '@/lib/escalation';
import { storageSelfTest } from '@/lib/storage';
import { describeZodError } from '@/lib/form-errors';
import { hashSecret, verifySecret } from '@/lib/crypto';
import { withOrg, type Q } from '@/lib/db';
import { StaffInputError, isUuid } from '@/lib/queue';
import { SisError, csvConnector, syncLocations } from '@/lib/sis';
import { isTimeZone } from '@/lib/time';
import { parseKeywords } from '@/lib/watch';
import { confirmTwoStep, disableTwoStep, resetTwoStep, startTwoStep } from '@/lib/two-step';
import { requireAdmin, requireStaff } from '@/lib/session';
import type { Staff } from '@/lib/staff';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const flag = (fd: FormData, k: string) => fd.get(k) === 'on' || fd.get(k) === '1';
const ids = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(isUuid);

/** Admin-only mutation in one org-scoped transaction, audited, with problems surfaced as a ?e= banner. */
async function adminRun(back: string, action: string, fn: (s: Staff, q: Q) => Promise<object | void>, ok?: string) {
  const s = await requireAdmin();
  let err = '';
  try {
    await withOrg(s.orgId, async (q) => {
      const detail = await fn(s, q);
      await audit(q, s, action, null, detail || null);
    });
  } catch (e: any) {
    if (e instanceof StaffInputError || e instanceof z.ZodError) err = e instanceof z.ZodError ? describeZodError(e, LABELS) : e.message;
    else if (e?.code === '23505') err = 'That name or email is already in use.';
    else if (e?.code === '23503') err = 'That item is still in use and cannot be removed. Deactivate it instead.';
    else throw e;
  }
  revalidatePath('/staff', 'layout');
  redirect(`${back}?${err ? `e=${encodeURIComponent(err)}` : ok ? `ok=${encodeURIComponent(ok)}` : 'ok=Saved'}`);
}

const LABELS: Record<string, string> = {
  name: 'Name', hotline: 'Hotline', primary_color: 'Brand color', max_reward: 'Max reward', retention_days: 'Retention (days)',
  audit_retention_days: 'Audit log retention (days)', backup_retention_days: 'Backup window (days)', image_mb: 'Photo max (MB)', doc_mb: 'PDF max (MB)',
  av_mb: 'Video/audio max (MB)', tip_mb: 'Per-tip total (MB)', max_files: 'Max files per tip', escalation_email_mode: 'Email who',
  escalation_webhook_url: 'Webhook URL', tipster_note: 'What to expect text', help_text: 'Help resources text',
  new_tip_alerts: 'New-tip alerts', watch_keywords: 'Watch list', response_target_hours: 'Reply target (hours)',
  tipster_note_es: 'What to expect (Spanish)', help_text_es: 'Help resources (Spanish)', timezone: 'Time zone',
};

const Org = z.object({
  name: z.string().trim().min(1).max(120),
  hotline: z.string().trim().max(40),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  max_reward: z.coerce.number().min(0).max(1_000_000),
  retention_days: z.coerce.number().int().min(1).max(3650),
  audit_retention_days: z.coerce.number().int().min(30).max(3650),
  backup_retention_days: z.coerce.number().int().min(0).max(365),
  image_mb: z.coerce.number().int().min(1).max(100),
  doc_mb: z.coerce.number().int().min(1).max(100),
  av_mb: z.coerce.number().int().min(1).max(500),
  tip_mb: z.coerce.number().int().min(1).max(500),
  max_files: z.coerce.number().int().min(0).max(30),
  escalation_email_mode: z.enum(['on_call', 'admins', 'off']),
  escalation_webhook_url: z.string().trim().max(500).refine((v) => v === '' || /^https:\/\//.test(v), 'Webhook must start with https://'),
  tipster_note: z.string().trim().max(600),
  help_text: z.string().trim().max(1200),
  tipster_note_es: z.string().trim().max(600),
  help_text_es: z.string().trim().max(1200),
  timezone: z.string().trim().refine(isTimeZone, 'Choose a time zone from the list, for example America/Chicago.'),
  new_tip_alerts: z.enum(['off', 'urgent', 'all']),
  watch_keywords: z.string().trim().max(2000),
  response_target_hours: z.coerce.number().int().min(1).max(720),
});

export async function saveOrgAction(fd: FormData) {
  await adminRun('/staff/settings', 'settings.org', async (s, q) => {
    const d = Org.parse(Object.fromEntries(fd));
    await q(
      `update organizations set name=$1, hotline=$2, primary_color=$3, max_reward_cents=$4, retention_days=$5, audit_retention_days=$6,
         backup_retention_days=$7, image_mb=$8, doc_mb=$9, av_mb=$10, tip_mb=$11, max_files=$12, escalation_email_mode=$13, escalation_webhook_url=$14, tipster_note=$15, help_text=$16,
         new_tip_alerts=$17, watch_keywords=$18, response_target_hours=$19, tipster_note_es=$20, help_text_es=$21, timezone=$22 where id=$23`,
      [d.name, d.hotline || null, d.primary_color, Math.round(d.max_reward * 100), d.retention_days, d.audit_retention_days, d.backup_retention_days,
        d.image_mb, d.doc_mb, d.av_mb, d.tip_mb, d.max_files, d.escalation_email_mode, d.escalation_webhook_url || null, d.tipster_note, d.help_text,
        d.new_tip_alerts, parseKeywords(d.watch_keywords).join(', '), d.response_target_hours, d.tipster_note_es, d.help_text_es, d.timezone, s.orgId],
    );
  });
}

const CHANNEL_WORDS: Record<string, string> = { sent: 'delivered', failed: 'FAILED', not_configured: 'not set up', no_recipients: 'nobody is marked on call', simulated: 'simulated (demo)' };

/** Admin-only: proves alerts reach people before a real emergency. */
export async function testAlertAction() {
  const s = await requireAdmin();
  const r = await sendTestAlert(s);
  const detail = `email: ${CHANNEL_WORDS[r.email]} (${r.recipients} on-call recipient${r.recipients === 1 ? '' : 's'}); chat webhook: ${CHANNEL_WORDS[r.webhook]}`;
  redirect(`/staff/settings?${r.delivered ? 'ok' : 'e'}=${encodeURIComponent(r.delivered ? `Test alert sent. ${detail}.` : `The test alert was NOT delivered anywhere. ${detail}. Fix this before you rely on Escalate.`)}`);
}

/** Admin-only: writes, reads and deletes a tiny test file so wrong storage keys are found before a tipster hits them. */
export async function testStorageAction() {
  await requireAdmin();
  const r = await storageSelfTest();
  redirect(`/staff/settings?${r.ok ? 'ok' : 'e'}=${encodeURIComponent(r.message)}`);
}

// ---- Taxonomy: categories, locations, teams ----

export async function saveCategoryAction(fd: FormData) {
  await adminRun('/staff/settings/taxonomy', 'settings.category', async (s, q) => {
    const id = str(fd, 'id');
    const name = str(fd, 'name');
    if (!name) throw new StaffInputError('A category needs a name.');
    const vals = [name, str(fd, 'description').slice(0, 500), Number(str(fd, 'sort')) || 0, flag(fd, 'high_risk'), id ? flag(fd, 'active') : true];
    let cid = id;
    if (id) {
      if (!isUuid(id)) throw new StaffInputError('Unknown category');
      await q('update categories set name=$1, description=$2, sort=$3, high_risk=$4, active=$5 where id=$6', [...vals, id]);
    } else {
      cid = (await q<{ id: string }>('insert into categories (name, description, sort, high_risk, active, org_id) values ($1,$2,$3,$4,$5,$6) returning id', [...vals, s.orgId]))[0].id;
    }
    await q('delete from category_teams where category_id = $1', [cid]);
    const teams = ids(fd, 'teamId');
    if (teams.length) await q('insert into category_teams (org_id, category_id, team_id) select $1, $2, id from teams where id = any($3::uuid[])', [s.orgId, cid, teams]);
    return { name };
  });
}

export async function saveLocationAction(fd: FormData) {
  await adminRun('/staff/settings/taxonomy', 'settings.location', async (s, q) => {
    const id = str(fd, 'id');
    const name = str(fd, 'name');
    if (!name) throw new StaffInputError('A location needs a name.');
    if (id) {
      if (!isUuid(id)) throw new StaffInputError('Unknown location');
      await q('update locations set name=$1, active=$2 where id=$3', [name, flag(fd, 'active'), id]);
    } else await q('insert into locations (org_id, name) values ($1, $2)', [s.orgId, name]);
    return { name };
  });
}

export async function importLocationsAction(fd: FormData) {
  const s = await requireAdmin();
  const file = fd.get('file');
  let msg: string;
  try {
    if (!(file instanceof File) || file.size === 0 || file.size > 1_000_000) throw new SisError('Choose a CSV file under 1 MB.');
    const r = await syncLocations(s, csvConnector(await file.text()));
    msg = `ok=${encodeURIComponent(`Imported: ${r.added} added, ${r.updated} updated, ${r.deactivated} deactivated.`)}`;
  } catch (e) {
    if (!(e instanceof SisError)) throw e;
    msg = `e=${encodeURIComponent(e.message)}`;
  }
  revalidatePath('/staff/settings/taxonomy');
  redirect(`/staff/settings/taxonomy?${msg}`);
}

export async function saveTeamAction(fd: FormData) {
  await adminRun('/staff/settings/taxonomy', 'settings.team', async (s, q) => {
    const id = str(fd, 'id');
    const name = str(fd, 'name');
    if (!name) throw new StaffInputError('A team needs a name.');
    let tid = id;
    if (id) {
      if (!isUuid(id)) throw new StaffInputError('Unknown team');
      await q('update teams set name=$1 where id=$2', [name, id]);
    } else tid = (await q<{ id: string }>('insert into teams (org_id, name) values ($1, $2) returning id', [s.orgId, name]))[0].id;
    // Optional scope: only receive tips from the ticked locations (none ticked = every location).
    await q('delete from team_locations where team_id = $1', [tid]);
    const locs = ids(fd, 'locationId');
    if (locs.length) await q('insert into team_locations (org_id, team_id, location_id) select $1, $2, id from locations where id = any($3::uuid[])', [s.orgId, tid, locs]);
    return { name };
  });
}

export async function deleteTeamAction(fd: FormData) {
  await adminRun('/staff/settings/taxonomy', 'settings.team_delete', async (_s, q) => {
    if (!isUuid(str(fd, 'id'))) throw new StaffInputError('Unknown team');
    await q('delete from teams where id = $1', [str(fd, 'id')]);
  }, 'Team removed. Tips routed only to it are now visible to admins and all-tips staff.');
}

// ---- Canned responses ----

export async function saveCannedAction(fd: FormData) {
  await adminRun('/staff/settings/canned', 'settings.canned', async (s, q) => {
    const id = str(fd, 'id');
    const title = str(fd, 'title');
    const body = str(fd, 'body');
    if (!title || !body) throw new StaffInputError('Both a title and text are required.');
    const cat = isUuid(str(fd, 'categoryId')) ? str(fd, 'categoryId') : null;
    if (id) await q('update canned_responses set title=$1, body=$2, category_id=$3 where id=$4', [title, body, cat, id]);
    else await q('insert into canned_responses (org_id, title, body, category_id) values ($1,$2,$3,$4)', [s.orgId, title, body, cat]);
    return { title };
  });
}

export async function deleteCannedAction(fd: FormData) {
  await adminRun('/staff/settings/canned', 'settings.canned_delete', async (_s, q) => {
    if (!isUuid(str(fd, 'id'))) throw new StaffInputError('Unknown response');
    await q('delete from canned_responses where id = $1', [str(fd, 'id')]);
  }, 'Removed');
}

// ---- People ----

export async function createReviewerAction(fd: FormData) {
  const email = z.string().email().safeParse(str(fd, 'email'));
  const password = str(fd, 'password');
  const pwHash = password.length >= 10 ? await hashSecret(password) : '';
  await adminRun('/staff/settings/people', 'settings.reviewer_create', async (s, q) => {
    if (!email.success || !str(fd, 'name')) throw new StaffInputError('Enter a name and a valid email.');
    if (!pwHash) throw new StaffInputError('The temporary password needs at least 10 characters.');
    const r = await q<{ id: string }>(
      'insert into reviewers (org_id, email, name, password_hash, role, all_tips, on_call, notify_new) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
      [s.orgId, email.data, str(fd, 'name'), pwHash, str(fd, 'role') === 'admin' ? 'admin' : 'reviewer', flag(fd, 'all_tips'), flag(fd, 'on_call'), flag(fd, 'notify_new')],
    );
    const teams = ids(fd, 'teamId');
    if (teams.length) await q('insert into team_members (org_id, team_id, reviewer_id) select $1, id, $2 from teams where id = any($3::uuid[])', [s.orgId, r[0].id, teams]);
    return { email: email.data };
  }, 'Reviewer created. Share the temporary password privately and ask them to change it.');
}

export async function saveReviewerAction(fd: FormData) {
  await adminRun('/staff/settings/people', 'settings.reviewer_update', async (s, q) => {
    const id = str(fd, 'id');
    if (!isUuid(id)) throw new StaffInputError('Unknown reviewer');
    const role = str(fd, 'role') === 'admin' ? 'admin' : 'reviewer';
    const active = flag(fd, 'active');
    await q('update reviewers set role=$1, all_tips=$2, on_call=$3, active=$4, notify_new=$5 where id=$6', [role, flag(fd, 'all_tips'), flag(fd, 'on_call'), active, flag(fd, 'notify_new'), id]);
    if ((await q<{ n: number }>("select count(*)::int as n from reviewers where role = 'admin' and active"))[0].n === 0) throw new StaffInputError('At least one active administrator is required.');
    if (!active) await q('delete from sessions where reviewer_id = $1', [id]);
    await q('delete from team_members where reviewer_id = $1', [id]);
    const teams = ids(fd, 'teamId');
    if (teams.length) await q('insert into team_members (org_id, team_id, reviewer_id) select $1, id, $2 from teams where id = any($3::uuid[])', [s.orgId, id, teams]);
    return { reviewer: id, role, active };
  });
}

export async function resetPasswordAction(fd: FormData) {
  const password = str(fd, 'password');
  const pwHash = password.length >= 10 ? await hashSecret(password) : '';
  await adminRun('/staff/settings/people', 'settings.reviewer_password_reset', async (_s, q) => {
    if (!pwHash) throw new StaffInputError('The new password needs at least 10 characters.');
    if (!isUuid(str(fd, 'id'))) throw new StaffInputError('Unknown reviewer');
    await q('update reviewers set password_hash=$1, failed_attempts=0, locked_until=null where id=$2', [pwHash, str(fd, 'id')]);
    await q('delete from sessions where reviewer_id = $1', [str(fd, 'id')]);
    return { reviewer: str(fd, 'id') };
  }, 'Password reset and that person was signed out.');
}

// ---- Bulletins ----

/** Returns {error} so the form keeps what was typed; redirects on success. */
export async function saveBulletinAction(_prev: unknown, fd: FormData): Promise<{ error?: string }> {
  const s = await requireAdmin();
  const file = fd.get('photo');
  try {
    if (file instanceof File && file.size > 4_000_000) throw new StaffInputError('That photo is over 4 MB. Choose a smaller one (photos from a phone are shrunk automatically in most browsers).');
    await saveBulletin(s, {
      id: str(fd, 'id') || undefined, title: str(fd, 'title'), body: str(fd, 'body'), caseNumber: str(fd, 'caseNumber'), rewardDollars: str(fd, 'reward'),
      active: flag(fd, 'active'), photo: file instanceof File && file.size ? Buffer.from(await file.arrayBuffer()) : null, removePhoto: flag(fd, 'removePhoto'),
    });
  } catch (e) {
    if (e instanceof StaffInputError) return { error: e.message };
    throw e;
  }
  revalidatePath('/wanted');
  redirect('/staff/bulletins?ok=' + encodeURIComponent('Bulletin saved.'));
}

export async function deleteBulletinAction(fd: FormData) {
  const s = await requireAdmin();
  let msg = 'ok=' + encodeURIComponent('Bulletin deleted.');
  try {
    await deleteBulletin(s, str(fd, 'id'));
  } catch (e) {
    if (!(e instanceof StaffInputError)) throw e;
    msg = 'e=' + encodeURIComponent(e.message);
  }
  revalidatePath('/wanted');
  redirect('/staff/bulletins?' + msg);
}

// ---- Two-step sign-in ----

const accountFlash = (kind: 'ok' | 'e', msg: string): never => redirect(`/staff/account?${kind}=${encodeURIComponent(msg)}`);

export async function startTwoStepAction() {
  await startTwoStep(await requireStaff());
  revalidatePath('/staff/account');
  redirect('/staff/account');
}

export async function confirmTwoStepAction(fd: FormData) {
  const s = await requireStaff();
  try {
    await confirmTwoStep(s, String(fd.get('code') ?? ''));
  } catch (e) {
    if (e instanceof StaffInputError) accountFlash('e', e.message);
    throw e;
  }
  accountFlash('ok', 'Two-step sign-in is on. From now on you will be asked for a code from your authenticator app.');
}

export async function disableTwoStepAction(fd: FormData) {
  const s = await requireStaff();
  try {
    await disableTwoStep(s, String(fd.get('password') ?? ''));
  } catch (e) {
    if (e instanceof StaffInputError) accountFlash('e', e.message);
    throw e;
  }
  accountFlash('ok', 'Two-step sign-in is off.');
}

export async function resetTwoStepAction(fd: FormData) {
  const s = await requireAdmin();
  let msg = 'ok=' + encodeURIComponent('Two-step sign-in cleared and that person was signed out. They sign in with their password and can set it up again.');
  try {
    await resetTwoStep(s, str(fd, 'id'));
  } catch (e) {
    if (!(e instanceof StaffInputError)) throw e;
    msg = 'e=' + encodeURIComponent(e.message);
  }
  revalidatePath('/staff/settings/people');
  redirect(`/staff/settings/people?${msg}`);
}

/** Any staff member can change their own password. */
export async function changePasswordAction(fd: FormData) {
  const s = await requireStaff();
  const next = String(fd.get('next') ?? '');
  let msg: string;
  if (next.length < 10) msg = 'e=' + encodeURIComponent('The new password needs at least 10 characters.');
  else {
    const nextHash = await hashSecret(next);
    const ok = await withOrg(s.orgId, async (q) => {
      const row = (await q<{ password_hash: string }>('select password_hash from reviewers where id = $1', [s.id]))[0];
      if (!(await verifySecret(row?.password_hash, String(fd.get('current') ?? '')))) return false;
      await q('update reviewers set password_hash = $1 where id = $2', [nextHash, s.id]);
      await audit(q, s, 'auth.password_change');
      return true;
    });
    msg = ok ? 'ok=' + encodeURIComponent('Password changed.') : 'e=' + encodeURIComponent('Your current password is not correct.');
  }
  redirect(`/staff/account?${msg}`);
}
