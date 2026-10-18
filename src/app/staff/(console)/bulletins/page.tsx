/* eslint-disable @next/next/no-img-element */
import { BulletinForm } from '@/components/staff/BulletinForm';
import { Card, Flash, PageTitle, when } from '@/components/staff/ui';
import { listAllBulletins } from '@/lib/bulletins';
import { withOrg } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { deleteBulletinAction } from '../../admin-actions';

export const metadata = { title: 'Bulletins' };

export default async function Bulletins({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const items = await listAllBulletins(s);
  const max = (await withOrg(s.orgId, (q) => q<{ max_reward_cents: number }>('select max_reward_cents from organizations')))[0].max_reward_cents / 100;
  return (
    <div className="space-y-4">
      <PageTitle>Wanted &amp; case bulletins</PageTitle>
      <p className="-mt-2 text-sm text-slate-700">Publish cases you want the public to help with. Each gets a button, “I have information”, that opens the anonymous tip form already linked to the case. They appear on your public <a className="link" href="/wanted">/wanted</a> page.</p>
      <Flash e={sp.e} ok={sp.ok} />
      <Card title="Add a bulletin"><BulletinForm maxRewardDollars={max} /></Card>
      {items.length === 0 && <p className="text-sm text-slate-600">No bulletins yet.</p>}
      {items.map((b) => (
        <Card key={b.id}>
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              {b.has_image && <img src={`/wanted/${b.id}/image`} alt="" className="size-14 rounded object-cover" />}
              <span className="font-bold">{b.title}</span>
              <span className={`badge ${b.active ? 'bg-green-100 text-green-900' : 'bg-slate-200 text-slate-800'}`}>{b.active ? 'Published' : 'Hidden'}</span>
              <span className="text-xs text-slate-600">{b.case_number ? `Case ${b.case_number} · ` : ''}{b.tips} tip{b.tips === 1 ? '' : 's'} · added {when(b.created_at)}</span>
            </summary>
            <div className="mt-4 border-t border-slate-200 pt-4"><BulletinForm b={b} maxRewardDollars={max} /></div>
            <form action={deleteBulletinAction} className="mt-3 border-t border-slate-100 pt-3">
              <input type="hidden" name="id" value={b.id} />
              <button className="btn btn-danger !min-h-9 text-sm">Delete this bulletin</button>
              <span className="ml-2 text-xs text-slate-600">Tips already sent about it are kept.</span>
            </form>
          </details>
        </Card>
      ))}
    </div>
  );
}
