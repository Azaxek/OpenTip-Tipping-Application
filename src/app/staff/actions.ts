'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { escalate } from '@/lib/escalation';
import { getOrg } from '@/lib/org';
import { logPhoneTip } from '@/lib/phone-tip';
import {
  StaffInputError, addNote, canView, assignTip, closeTip, redeemClaim, reissueClaimCode, sendReviewerMessage, setReward, setStatus, setTipTeams, setUrgent,
} from '@/lib/queue';
import { rateLimit } from '@/lib/ratelimit';
import { clearSessionCookie, headerRequest, requireStaff, sessionCookieValue, setSessionCookie } from '@/lib/session';
import { staffLogout, staffSignIn, type Staff } from '@/lib/staff';
import { verifyTurnstile } from '@/lib/turnstile';

export async function loginAction(email: string, password: string, turnstileToken: string, code?: string): Promise<{ error?: string; needCode?: boolean }> {
  // Generous per address because an office shares one; the real brake is the per-account lockout below.
  if (rateLimit(await headerRequest(), 'staff-login', 30, 15 * 60_000)) return { error: 'Too many attempts. Please wait 15 minutes.' };
  if (!(await verifyTurnstile(turnstileToken))) return { error: 'Bot check failed. Reload the page and try again.' };
  const org = await getOrg();
  if (!org) redirect('/setup');
  const r = await staffSignIn(org.id, email, password, code);
  if (r && 'needCode' in r) return { needCode: true };
  if (!r) return { error: `${code ? 'That email, password or code was not accepted.' : 'Wrong email or password.'} Accounts lock for 15 minutes after 5 wrong tries.` };
  await setSessionCookie(r.token);
  redirect('/staff');
}

/** A staff member types in a tip taken by phone or in person. The TIP ID and generated passcode come back to the screen only, never in a URL. */
export async function logPhoneTipAction(_prev: unknown, fd: FormData): Promise<{ error?: string; tipId?: string; passcode?: string }> {
  const s = await requireStaff();
  if (rateLimit(await headerRequest(), 'phone-tip', 100, 3_600_000, s.id)) return { error: 'You are entering tips very quickly. Please wait a few minutes.' };
  try {
    const id = String(fd.get('locationId') ?? '');
    return await logPhoneTip(s, { categoryId: String(fd.get('categoryId') ?? ''), locationId: id || null, urgent: fd.get('urgent') === 'on', description: String(fd.get('description') ?? '') });
  } catch (e) {
    if (e instanceof StaffInputError) return { error: e.message };
    throw e;
  }
}

export async function logoutAction() {
  const t = await sessionCookieValue();
  if (t) await staffLogout(t);
  await clearSessionCookie();
  redirect('/staff/login');
}

/** Runs a staff mutation, then refreshes the page; a validation problem comes back as a ?e= banner instead of a crash. */
async function run(back: string, fn: (s: Staff) => Promise<unknown>, ok?: string) {
  const s = await requireStaff();
  let err = '';
  try {
    await fn(s);
  } catch (e) {
    if (e instanceof StaffInputError) err = e.message;
    else throw e;
  }
  revalidatePath(back);
  if (err) redirect(`${back}?e=${encodeURIComponent(err)}`);
  if (ok) redirect(`${back}?ok=${encodeURIComponent(ok)}`); // a short confirmation, so no action ever succeeds silently
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const tipPath = (fd: FormData) => `/staff/tips/${str(fd, 'tipId')}`;

export async function sendMessageAction(tipId: string, body: string): Promise<{ error?: string }> {
  const s = await requireStaff();
  try {
    await sendReviewerMessage(s, tipId, body);
    return {};
  } catch (e) {
    if (e instanceof StaffInputError) return { error: e.message };
    throw e;
  }
}

export const noteAction = async (fd: FormData) => run(tipPath(fd), (s) => addNote(s, str(fd, 'tipId'), str(fd, 'body')), 'Note added. Only staff can see it.');
export const statusAction = async (fd: FormData) =>
  run(tipPath(fd), (s) => setStatus(s, str(fd, 'tipId'), str(fd, 'status') as 'under_review' | 'actioned'), str(fd, 'status') === 'actioned' ? 'Marked as actioned.' : 'Marked as under review.');
export const closeAction = async (fd: FormData) => run(tipPath(fd), (s) => closeTip(s, str(fd, 'tipId'), str(fd, 'reason'), str(fd, 'note')), 'Tip closed. The tipster will see it as closed if they check.');
export const urgentAction = async (fd: FormData) =>
  run(tipPath(fd), (s) => setUrgent(s, str(fd, 'tipId'), str(fd, 'urgent') === '1'), str(fd, 'urgent') === '1' ? 'Flagged urgent. It is now pinned at the top of everyone’s queue.' : 'Urgent flag removed.');
/** After a change that can remove your own access (unrouting, reassigning), say so instead of leaving a bare 404. */
async function leftQueueIfNoAccess(fd: FormData, what: string) {
  const s = await requireStaff();
  if (!(await canView(s, str(fd, 'tipId')))) redirect(`/staff?ok=${encodeURIComponent(`${what} You no longer have access to that tip, so it has left your queue.`)}`);
  redirect(`${tipPath(fd)}?ok=${encodeURIComponent(what)}`);
}
export async function assignAction(fd: FormData) {
  await run(tipPath(fd), (s) => assignTip(s, str(fd, 'tipId'), str(fd, 'reviewerId') || null));
  await leftQueueIfNoAccess(fd, 'Assignment saved.');
}
export async function routeAction(fd: FormData) {
  await run(tipPath(fd), (s) => setTipTeams(s, str(fd, 'tipId'), fd.getAll('teamId').map(String)));
  await leftQueueIfNoAccess(fd, 'Routing saved.');
}
export const rewardAction = async (fd: FormData) =>
  run(tipPath(fd), (s) => setReward(s, str(fd, 'tipId'), str(fd, 'eligible') === '1', Math.round(Number(str(fd, 'amount') || 0) * 100)),
    str(fd, 'eligible') === '1' ? 'Reward saved. The tipster is notified and can now see their one-time claim code.' : 'Reward eligibility removed.');
export const reissueAction = async (fd: FormData) => run(tipPath(fd), (s) => reissueClaimCode(s, str(fd, 'tipId')), 'Claim code reissued. The tipster can view the new one once.');

export async function escalateAction(fd: FormData) {
  const s = await requireStaff();
  const id = str(fd, 'tipId');
  let qs: string;
  try {
    const r = await escalate(s, id);
    qs = r.email === 'simulated' ? `?esc=sim&n=${r.recipients}` : r.delivered ? '?esc=ok' : `?esc=fail&em=${r.email}&wh=${r.webhook}`;
  } catch (e) {
    if (!(e instanceof StaffInputError)) throw e;
    qs = `?e=${encodeURIComponent(e.message)}`;
  }
  redirect(`/staff/tips/${id}${qs}`);
}

export async function redeemAction(fd: FormData) {
  const s = await requireStaff();
  const r = await redeemClaim(s, str(fd, 'tipId'), str(fd, 'code'));
  revalidatePath('/staff/rewards');
  redirect(`/staff/rewards?${r.ok ? 'ok' : 'e'}=${encodeURIComponent(r.message)}`);
}
