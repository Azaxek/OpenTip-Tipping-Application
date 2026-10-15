import QRCode from 'qrcode';
import { audit } from './audit';
import { seal, unseal, verifySecret } from './crypto';
import { withOrg } from './db';
import { StaffInputError, isUuid } from './queue';
import type { Staff } from './staff';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp';

export type TwoStepState = { enabled: boolean; pending?: { secret: string; qr: string } };

/** What the account page shows: on, off, or "started" (a secret exists but no code has confirmed it yet). */
export async function twoStepState(s: Staff, orgName: string): Promise<TwoStepState> {
  const r = (await withOrg(s.orgId, (q) => q<{ totp_enabled: boolean; totp_secret: string | null }>('select totp_enabled, totp_secret from reviewers where id = $1', [s.id])))[0];
  if (r?.totp_enabled) return { enabled: true };
  const secret = r?.totp_secret ? unseal(r.totp_secret) : null;
  return secret ? { enabled: false, pending: { secret, qr: await QRCode.toDataURL(otpauthUri(secret, s.email, orgName), { margin: 1, width: 220 }) } } : { enabled: false };
}

/** Creates (or replaces) a not-yet-active secret. Two-step is only switched on once a real code proves the app is set up. */
export const startTwoStep = (s: Staff) =>
  withOrg(s.orgId, async (q) => {
    await q('update reviewers set totp_secret = $2, totp_enabled = false, totp_last_step = 0 where id = $1 and not totp_enabled', [s.id, seal(newTotpSecret())]);
  });

export const confirmTwoStep = (s: Staff, code: string) =>
  withOrg(s.orgId, async (q) => {
    const r = (await q<{ totp_enabled: boolean; totp_secret: string | null }>('select totp_enabled, totp_secret from reviewers where id = $1', [s.id]))[0];
    const secret = r?.totp_secret && !r.totp_enabled ? unseal(r.totp_secret) : null;
    const step = secret && verifyTotp(secret, code);
    if (!step) throw new StaffInputError('That code did not match. Check that your phone shows the code for this account and try the newest one.');
    await q('update reviewers set totp_enabled = true, totp_last_step = $2 where id = $1', [s.id, step]);
    await audit(q, s, 'auth.two_step_on');
  });

/** Turning it off needs the password, so someone at an unlocked laptop cannot quietly remove it. */
export const disableTwoStep = (s: Staff, password: string) =>
  withOrg(s.orgId, async (q) => {
    const r = (await q<{ password_hash: string }>('select password_hash from reviewers where id = $1', [s.id]))[0];
    if (!(await verifySecret(r?.password_hash, password))) throw new StaffInputError('Your password is not correct.');
    await q('update reviewers set totp_enabled = false, totp_secret = null, totp_last_step = 0 where id = $1', [s.id]);
    await audit(q, s, 'auth.two_step_off');
  });

/** Admin: someone lost their phone. Clears their two-step and signs them out; they sign in with their password and set it up again. */
export const resetTwoStep = (admin: Staff, reviewerId: string) =>
  withOrg(admin.orgId, async (q) => {
    if (admin.role !== 'admin') throw new StaffInputError('Admins only');
    if (!isUuid(reviewerId)) throw new StaffInputError('Unknown reviewer');
    const r = await q('update reviewers set totp_enabled = false, totp_secret = null, totp_last_step = 0 where id = $1 returning id', [reviewerId]);
    if (!r.length) throw new StaffInputError('Unknown reviewer');
    await q('delete from sessions where reviewer_id = $1', [reviewerId]);
    await audit(q, admin, 'auth.two_step_reset', null, { reviewer: reviewerId });
  });
