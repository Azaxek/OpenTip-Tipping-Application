import Link from 'next/link';
import { AutoRefresh } from '@/components/staff/AutoRefresh';
import { Flash, PageTitle, StatusBadge, UrgentBadge, Waiting, ago } from '@/components/staff/ui';
import { withOrg } from '@/lib/db';
import { orgInTx } from '@/lib/org';
import { listQueue, type QueueFilter } from '@/lib/queue';
import { requireStaff } from '@/lib/session';

export const metadata = { title: 'Queue' };

type SP = Record<string, string | undefined>;

export default async function Queue({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireStaff();
  const sp = await searchParams;
  const f: QueueFilter = {
    status: sp.status, categoryId: sp.category, locationId: sp.location, teamId: sp.team, assignee: sp.assignee, search: sp.q,
    urgent: sp.urgent === '1', needsReply: sp.needs === '1', sort: (['newest', 'oldest'] as const).find((x) => x === sp.sort) ?? 'priority',
  };
  const tips = await listQueue(s, f);
  const everyOpen = await listQueue(s, {}); // unfiltered, for the tab counts
  const count = {
    open: everyOpen.length,
    needs: everyOpen.filter((t: any) => t.needs_reply).length,
    urgent: everyOpen.filter((t: any) => t.priority).length,
    mine: everyOpen.filter((t: any) => t.assigned_reviewer_id === s.id).length,
  };
  const { opts, org } = await withOrg(s.orgId, async (q) => ({
    org: await orgInTx(q),
    opts: {
      categories: await q<{ id: string; name: string }>('select id, name from categories order by sort, name'),
      locations: await q<{ id: string; name: string }>('select id, name from locations order by name'),
      teams: await q<{ id: string; name: string }>('select id, name from teams order by name'),
      reviewers: await q<{ id: string; name: string }>('select id, name from reviewers where active order by name'),
    },
  }));

  // One row of quick views replaces eight dropdowns; the rest live under "More filters".
  const tab = sp.needs === '1' ? 'needs' : sp.urgent === '1' ? 'urgent' : sp.assignee === 'me' ? 'mine' : sp.status === 'closed' ? 'closed' : sp.status === 'all' ? 'all' : 'open';
  const tabs: [string, string, string, number | null][] = [
    ['open', 'Open', '', count.open],
    ['needs', 'Needs reply', '?needs=1', count.needs],
    ['urgent', 'Urgent', '?urgent=1', count.urgent],
    ['mine', 'Mine', '?assignee=me', count.mine],
    ['closed', 'Closed', '?status=closed', null],
    ['all', 'All', '?status=all', null],
  ];
  const moreActive = !!(sp.category || sp.location || sp.team || (sp.assignee && sp.assignee !== 'me') || (sp.sort && sp.sort !== 'priority'));
  const keep = Object.entries(sp).filter(([k, v]) => v && k !== 'q' && k !== 'e' && k !== 'ok');
  const sel = 'input !py-1.5 text-sm';

  const badges = (t: any) => (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {t.priority && t.status !== 'closed' && <UrgentBadge />}
      {t.watch && t.status !== 'closed' && <span className="badge bg-orange-100 text-orange-900" title="Matched your keyword watch list">Watch list</span>}
      {t.needs_reply && t.status !== 'closed' && t.waiting_since && <Waiting since={t.waiting_since} targetHours={org.response_target_hours} />}
      {t.source === 'phone' && <span className="badge bg-slate-100 text-slate-800" title="Entered by staff from a call or visit">Phone</span>}
    </span>
  );

  return (
    <div className="space-y-4">
      <AutoRefresh badge={count.needs} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Queue</PageTitle>
        <Link href="/staff/tips/new" className="btn !min-h-9 text-sm" data-tour="phone-tip">+ Log a phone or walk-in tip</Link>
      </div>
      <Flash e={sp.e} ok={sp.ok} />

      <form method="get" role="search" className="flex gap-2" data-tour="search">
        {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="q" defaultValue={sp.q ?? ''} type="search" maxLength={100} aria-label="Search tips" placeholder="Search TIP ID, or words in the tip, chat or notes" className="input" />
        <button className="btn btn-primary">Search</button>
      </form>

      <nav className="flex flex-wrap gap-2" aria-label="Queue views" data-tour="tabs">
        {tabs.map(([id, label, qs, n]) => (
          <Link key={id} href={`/staff${qs}`} aria-current={tab === id ? 'page' : undefined}
            className={`btn !min-h-9 text-sm ${tab === id ? '!border-slate-900 !bg-slate-900 !text-white' : ''}`}>
            {label}{n !== null && <span className={`ml-1.5 rounded-full px-1.5 text-xs font-bold ${tab === id ? 'bg-white/25' : id === 'urgent' && n ? 'bg-red-100 text-red-800' : id === 'needs' && n ? 'bg-indigo-100 text-indigo-900' : 'bg-slate-100 text-slate-700'}`}>{n}</span>}
          </Link>
        ))}
      </nav>

      <details className="card !py-3" open={moreActive}>
        <summary className="cursor-pointer text-sm font-semibold">More filters{moreActive ? ' (active)' : ''}</summary>
        <form method="get" className="mt-3 grid grid-cols-2 items-end gap-3 md:grid-cols-5">
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          {sp.urgent && <input type="hidden" name="urgent" value={sp.urgent} />}
          {sp.needs && <input type="hidden" name="needs" value={sp.needs} />}
          <label className="text-xs font-semibold">Category
            <select name="category" defaultValue={sp.category ?? ''} className={sel}><option value="">Any</option>{opts.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="text-xs font-semibold">Location
            <select name="location" defaultValue={sp.location ?? ''} className={sel}><option value="">Any</option>{opts.locations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="text-xs font-semibold">Team
            <select name="team" defaultValue={sp.team ?? ''} className={sel}><option value="">Any</option>{opts.teams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="text-xs font-semibold">Assigned to
            <select name="assignee" defaultValue={sp.assignee ?? ''} className={sel}>
              <option value="">Anyone</option><option value="me">Me</option><option value="unassigned">Unassigned</option>
              {opts.reviewers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Sort
            <select name="sort" defaultValue={f.sort} className={sel}><option value="priority">Urgent first</option><option value="newest">Newest</option><option value="oldest">Oldest</option></select>
          </label>
          <div className="col-span-2 flex gap-2 md:col-span-5"><button className="btn btn-primary !min-h-9">Apply</button><Link href="/staff" className="btn !min-h-9">Clear all</Link></div>
        </form>
      </details>

      <div data-tour="list">
        {tips.length === 0 && (
          <div className="card text-center text-slate-700">
            {sp.q ? <>No tips match “{sp.q}”. Try fewer words, or part of a TIP ID.</> : tab === 'open' ? <>Nothing is waiting. New tips appear here by themselves.</> : <>No tips in this view.</>}
          </div>
        )}

        {tips.length > 0 && (
          <>
            <div className="card hidden overflow-x-auto !p-0 md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                  <tr><th scope="col" className="p-3">Tip</th><th scope="col" className="p-3">Category</th><th scope="col" className="p-3">Location</th><th scope="col" className="p-3">Assigned</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3">Received</th></tr>
                </thead>
                <tbody>
                  {tips.map((t: any) => (
                    <tr key={t.id} className={`border-b border-slate-100 hover:bg-slate-50 ${t.priority && t.status !== 'closed' ? 'bg-red-50/60' : ''}`}>
                      <td className="p-3"><Link href={`/staff/tips/${t.id}`} className="link font-mono">{t.tip_id}</Link> {badges(t)}</td>
                      <td className="p-3">{t.category}</td>
                      <td className="p-3">{t.location ?? '—'}</td>
                      <td className="p-3">{t.assignee ?? '—'}</td>
                      <td className="p-3"><StatusBadge status={t.status} /></td>
                      <td className="whitespace-nowrap p-3">{ago(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="space-y-2 md:hidden">
              {tips.map((t: any) => (
                <li key={t.id}>
                  <Link href={`/staff/tips/${t.id}`} className={`card block !p-3 no-underline ${t.priority && t.status !== 'closed' ? 'border-red-300 bg-red-50/60' : ''}`}>
                    <span className="flex items-center justify-between gap-2"><span className="font-mono font-bold text-blue-800">{t.tip_id}</span><StatusBadge status={t.status} /></span>
                    <span className="mt-1 block text-sm text-slate-800">{t.category}{t.location ? ` · ${t.location}` : ''}</span>
                    <span className="mt-1 block">{badges(t)}</span>
                    <span className="mt-1 block text-xs text-slate-600">{ago(t.created_at)}{t.assignee ? ` · ${t.assignee}` : ' · unassigned'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="text-xs text-slate-600">
        {tips.length >= 300 ? 'Showing the first 300 tips. Use search or filters to narrow down. ' : ''}
        You see tips routed to your teams or assigned to you{s.role === 'admin' || s.allTips ? ' — and all tips, because you have broader access' : ''}. This page updates by itself.
      </p>
    </div>
  );
}
