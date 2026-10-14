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
    await withOrg(s.orgId, (q) => audit(q, s, 'tip.manual', r.tipId));
    return { tipId: r.tipId, passcode };
  } catch (e) {
    if (e instanceof InputError) throw new StaffInputError(e.message);
    throw e;
  }
}
