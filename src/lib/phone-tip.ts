import { audit } from './audit';
import { withOrg } from './db';
import { orgInTx } from './org';
import { newPassphrase } from './passphrase';
import { StaffInputError } from './queue';
import type { Staff } from './staff';
import { InputError, createTip } from './tipster';

export type PhoneTipInput = { categoryId: string; locationId?: string | null; urgent?: boolean; description: string };

/**
 * A staff member types in a tip taken by phone or in person. The caller still gets a TIP ID and a generated passcode
 * (shown once, to be read out) so they can call back, chat and claim a reward exactly like a web tipster. Nothing about
 * the caller is recorded: there is no field for it, and the audit trail records only that staff entered a tip.
 */
export async function logPhoneTip(s: Staff, input: PhoneTipInput): Promise<{ tipId: string; passcode: string }> {
  const org = await withOrg(s.orgId, (q) => orgInTx(q));
  const passcode = newPassphrase();
  try {
    const r = await createTip(org, { ...input, passcode, source: 'phone' });
    await withOrg(s.orgId, async (q) => {
      // The caller has not written anything in the chat, so nobody "owes them a reply". Without this the tip would show as
      // "Awaiting reply" and turn red as overdue a day later, which is noise: it is triaged through its New status instead.
      await q('update tips set needs_reply = false, waiting_since = null where tip_id = $1', [r.tipId]);
      await audit(q, s, 'tip.manual', r.tipId);
    });
    return { tipId: r.tipId, passcode };
  } catch (e) {
    if (e instanceof InputError) throw new StaffInputError(e.message);
    throw e;
  }
}
