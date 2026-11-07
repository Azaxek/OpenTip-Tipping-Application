import Link from 'next/link';
import { Card, Flash, PageTitle, when } from '@/components/staff/ui';
import { withOrg } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { visible } from '@/lib/staff';
import { redeemAction } from '../../actions';

type RewardRow = { id: string; tip_id: string; reward_amount_cents: number | null; claim_code_revealed_at: Date | null; claimed_at: Date | null };

export const metadata = { title: 'Rewards' };

export default async function Rewards({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff();
  const sp = await searchParams;
  const rows = await withOrg(s.orgId, (q) =>
    q<RewardRow>(
      `select t.id, t.tip_id, t.reward_amount_cents, t.claim_code_revealed_at, t.claimed_at
         from tips t where t.reward_eligible and ${visible(s, 1)} order by t.claimed_at nulls first, t.updated_at desc limit 200`,
      [s.id],
    ),
  );
  return (
    <div className="space-y-4">
      <PageTitle>Rewards</PageTitle>
      <Flash e={sp.e} ok={sp.ok} />
      <Card title="Redeem a claim code">
        <form action={redeemAction} className="grid gap-3 sm:grid-cols-3">
          <div><label className="label" htmlFor="tipId">TIP ID</label><input id="tipId" name="tipId" className="input font-mono uppercase" placeholder="XXXX-XXXX-XXXX" required autoComplete="off" /></div>
          <div><label className="label" htmlFor="code">Claim code</label><input id="code" name="code" className="input font-mono uppercase" placeholder="XXXX-XXXX-XXXX-XXXX" required autoComplete="off" /></div>
          <div className="flex items-end"><button className="btn btn-primary w-full">Verify &amp; mark claimed</button></div>
        </form>
        <p className="hint">The tipster reads you their TIP ID and claim code. A match is logged with your name and the time. Payout itself (cash, gift card…) happens outside this app. Five wrong codes lock a tip for 15 minutes.</p>
      </Card>
      <Card title="Reward-eligible tips">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-600"><tr><th className="py-2">Tip</th><th>Amount</th><th>Code viewed by tipster</th><th>Claimed</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="py-4 text-slate-600">No reward-eligible tips yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2"><Link className="link font-mono" href={`/staff/tips/${r.id}`}>{r.tip_id}</Link></td>
                  <td>${((r.reward_amount_cents ?? 0) / 100).toFixed(2)}</td>
                  <td>{r.claim_code_revealed_at ? when(r.claim_code_revealed_at) : 'Not yet'}</td>
                  <td>{r.claimed_at ? <span className="badge bg-green-100 text-green-900">Claimed {when(r.claimed_at)}</span> : <span className="badge bg-amber-100 text-amber-900">Unclaimed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
