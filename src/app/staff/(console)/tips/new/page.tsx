import Link from 'next/link';
import { PhoneTipForm } from '@/components/staff/PhoneTipForm';
import { PageTitle } from '@/components/staff/ui';
import { withOrg } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { appUrl } from '@/lib/url';

export const metadata = { title: 'Log a phone or walk-in tip' };

export default async function NewPhoneTip() {
  const s = await requireStaff();
  const { categories, locations } = await withOrg(s.orgId, async (q) => ({
    categories: await q<{ id: string; name: string; high_risk: boolean }>('select id, name, high_risk from categories where active order by sort, name'),
    locations: await q<{ id: string; name: string }>('select id, name from locations where active order by name'),
  }));
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/staff" className="link text-sm">← Queue</Link>
      <PageTitle>Log a phone or walk-in tip</PageTitle>
      <p className="-mt-2 text-sm text-slate-700">
        Taking a tip by phone or in person? Type it in here. It joins the queue like any other tip, and the caller gets a TIP ID and passcode so they can check back and chat anonymously, or claim a reward.
      </p>
      <PhoneTipForm categories={categories} locations={locations} checkUrl={`${appUrl()}/check`} />
    </div>
  );
}
