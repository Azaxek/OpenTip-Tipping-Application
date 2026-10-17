/* eslint-disable @next/next/no-img-element */
import { Card, Flash, PageTitle } from '@/components/staff/ui';
import { getOrg } from '@/lib/org';
import { requireStaff } from '@/lib/session';
import { twoStepState } from '@/lib/two-step';
import { changePasswordAction, confirmTwoStepAction, disableTwoStepAction, startTwoStepAction } from '../../admin-actions';

export const metadata = { title: 'My account' };

export default async function Account({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff();
  const sp = await searchParams;
  const org = await getOrg();
  const two = await twoStepState(s, org?.name ?? 'OpenTip');
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>My account</PageTitle>
      <p className="-mt-2 text-sm text-slate-700">{s.name} · {s.email} · {s.role === 'admin' ? 'Administrator' : 'Reviewer'}</p>
      <Flash e={sp.e} ok={sp.ok} />

      <Card title="Two-step sign-in">
        {two.enabled ? (
          <>
            <p className="mb-3 text-sm"><span className="badge bg-green-100 text-green-900">On</span> Signing in needs your password and a 6-digit code from your authenticator app.</p>
            <form action={disableTwoStepAction} className="flex flex-wrap items-end gap-2">
              <div className="grow"><label className="label" htmlFor="off-pw">Password (to turn it off)</label><input id="off-pw" name="password" type="password" className="input" required autoComplete="current-password" /></div>
              <button className="btn">Turn off</button>
            </form>
          </>
        ) : two.pending ? (
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy or 1Password all work).</li>
            <li>
              In the app choose <em>Add account → Scan a QR code</em> and scan this:
              <img src={two.pending.qr} alt="QR code to add this account to your authenticator app" width={220} height={220} className="mt-2 rounded border border-slate-200" />
              <details className="mt-2"><summary className="cursor-pointer text-slate-700">Can&apos;t scan? Type the key instead</summary><p className="mt-1 select-all break-all rounded bg-slate-100 p-2 font-mono text-xs">{two.pending.secret}</p></details>
            </li>
            <li>
              Type the 6-digit code the app now shows, to prove it works:
              <form action={confirmTwoStepAction} className="mt-2 flex gap-2">
                <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} aria-label="6-digit code" className="input w-40 text-center font-mono text-lg tracking-widest" required />
                <button className="btn btn-primary">Turn on</button>
              </form>
            </li>
          </ol>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-700">Adds a second lock to your account: even if someone learns your password, they cannot sign in without your phone. Strongly recommended for administrators.</p>
            <form action={startTwoStepAction}><button className="btn btn-primary">Set up two-step sign-in</button></form>
          </>
        )}
      </Card>

      <Card title="Change password">
        <form action={changePasswordAction} className="space-y-3">
          <div><label className="label" htmlFor="cur">Current password</label><input id="cur" name="current" type="password" className="input" required autoComplete="current-password" /></div>
          <div><label className="label" htmlFor="nw">New password (10+ characters)</label><input id="nw" name="next" type="password" minLength={10} className="input" required autoComplete="new-password" /></div>
          <button className="btn btn-primary">Change password</button>
        </form>
      </Card>
    </div>
  );
}
