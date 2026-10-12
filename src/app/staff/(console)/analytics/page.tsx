import { HBars, Stat, VBars } from '@/components/staff/Charts';
import { Card, PageTitle } from '@/components/staff/ui';
import { report } from '@/lib/analytics';
import { withOrg } from '@/lib/db';
import { dayIn } from '@/lib/time';
import { requireAdmin } from '@/lib/session';

export const metadata = { title: 'Analytics' };

const hrs = (n: number | null) => (n == null ? '—' : n < 1 ? `${Math.round(n * 60)} min` : `${n} h`);

export default async function Analytics({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const tz = (await withOrg(s.orgId, (q) => q<{ timezone: string }>('select timezone from organizations')))[0].timezone;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : dayIn(tz, 30);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to! : dayIn(tz);
  const bucket = sp.bucket === 'week' || sp.bucket === 'month' ? sp.bucket : 'day';
  const r = await report(s, { from, to, bucket, locationId: sp.location, categoryId: sp.category });
  const opts = await withOrg(s.orgId, async (q) => ({
    categories: await q<{ id: string; name: string }>('select id, name from categories order by sort, name'),
    locations: await q<{ id: string; name: string }>('select id, name from locations order by name'),
  }));
  const qs = new URLSearchParams({ from, to, bucket, ...(sp.location ? { location: sp.location } : {}), ...(sp.category ? { category: sp.category } : {}) }).toString();
  const sel = 'input !py-1.5 text-sm';
  return (
    <div className="space-y-4">
      <PageTitle>Analytics</PageTitle>
      <p className="-mt-2 text-sm text-slate-700">Days follow your program&apos;s time zone ({tz.replace('_', ' ')}). Change it in Settings.</p>
      <form method="get" className="card grid grid-cols-2 items-end gap-3 md:grid-cols-6">
        <label className="text-xs font-semibold">From<input type="date" name="from" defaultValue={from} className={sel} /></label>
        <label className="text-xs font-semibold">To<input type="date" name="to" defaultValue={to} className={sel} /></label>
        <label className="text-xs font-semibold">Group by
          <select name="bucket" defaultValue={bucket} className={sel}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select>
        </label>
        <label className="text-xs font-semibold">Location
          <select name="location" defaultValue={sp.location ?? ''} className={sel}><option value="">All</option>{opts.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </label>
        <label className="text-xs font-semibold">Category
          <select name="category" defaultValue={sp.category ?? ''} className={sel}><option value="">All</option>{opts.categories.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </label>
        <button className="btn btn-primary !min-h-9">Apply</button>
      </form>

      <div className="flex flex-wrap gap-2">
        <a className="btn !min-h-9 text-sm" href={`/staff/export?format=csv&${qs}`}>Export CSV</a>
        <a className="btn !min-h-9 text-sm" href={`/staff/export?format=pdf&${qs}`}>Export PDF</a>
        <span className="self-center text-xs text-slate-600">Exports are recorded in the audit log.</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tips received" value={r.totals.tips} />
        <Stat label="Still open" value={r.totals.open} />
        <Stat label="Closed" value={r.totals.closed} />
        <Stat label="Marked urgent" value={r.totals.urgent} />
        <Stat label="First response" value={hrs(r.timings.firstResponseMedianH)} sub={`median · average ${hrs(r.timings.firstResponseAvgH)}`} />
        <Stat label="Time to closure" value={hrs(r.timings.closureMedianH)} sub={`median · average ${hrs(r.timings.closureAvgH)}`} />
        <Stat label="Rewards paid" value={`$${(r.rewards.paidCents / 100).toFixed(2)}`} sub={`${r.rewards.claimed} claimed in period`} />
        <Stat label="Reward-eligible tips" value={r.rewards.eligible} />
      </div>

      <Card title={`Tip volume by ${bucket}`}><VBars rows={r.volume.map((v) => ({ label: v.bucket, value: v.count }))} /></Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="By category"><HBars rows={r.categories.map((c) => ({ label: c.name, value: c.count }))} /></Card>
        <Card title="Closure reasons"><HBars rows={r.closures.map((c) => ({ label: c.reason ?? 'unknown', value: c.count }))} empty="No closed tips in this range." /></Card>
      </div>
      <p className="text-xs text-slate-600">Aggregates only. Nothing on this page identifies a tipster.</p>
    </div>
  );
}
