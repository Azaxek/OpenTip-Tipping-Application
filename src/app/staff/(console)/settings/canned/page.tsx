import { SettingsNav } from '@/components/staff/SettingsNav';
import { Card, Flash } from '@/components/staff/ui';
import { withOrg } from '@/lib/db';
import type { CannedRow } from '@/lib/queue';
import { requireAdmin } from '@/lib/session';
import { deleteCannedAction, saveCannedAction } from '../../../admin-actions';

export const metadata = { title: 'Canned responses' };

export default async function Canned({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const { rows, cats } = await withOrg(s.orgId, async (q) => ({
    rows: await q<CannedRow>('select id, title, body, category_id from canned_responses order by title'),
    cats: await q<{ id: string; name: string }>('select id, name from categories order by sort, name'),
  }));
  const catSelect = (v: string | null) => (
    <select name="categoryId" defaultValue={v ?? ''} className="input !py-1.5 text-sm" aria-label="Category">
      <option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
  return (
    <div className="space-y-4">
      <SettingsNav current="/staff/settings/canned" />
      <Flash e={sp.e} ok={sp.ok} />
      <Card title="Canned responses">
        <p className="mb-3 text-sm text-slate-600">One-click replies reviewers can insert into chat. Tie one to a category (for example a crisis-line list for self-harm) or leave it for all. This app never provides crisis counseling itself; these are static resources.</p>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 p-3">
              <form action={saveCannedAction} className="space-y-2">
                <input type="hidden" name="id" value={r.id} />
                <div className="grid gap-2 sm:grid-cols-2"><input name="title" defaultValue={r.title} className="input !py-1.5 text-sm" aria-label="Title" required maxLength={120} />{catSelect(r.category_id)}</div>
                <textarea name="body" defaultValue={r.body} className="input min-h-24 text-sm" required maxLength={5000} aria-label="Text" />
                <button className="btn !min-h-8 text-xs">Save</button>
              </form>
              <form action={deleteCannedAction} className="mt-2"><input type="hidden" name="id" value={r.id} /><button className="btn !min-h-8 text-xs">Delete</button></form>
            </div>
          ))}
          {rows.length === 0 && <p className="text-sm text-slate-600">None yet.</p>}
        </div>
        <form action={saveCannedAction} className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="font-semibold">New response</p>
          <div className="grid gap-2 sm:grid-cols-2"><input name="title" placeholder="Title, e.g. Thanks - looking into it" className="input !py-1.5 text-sm" required maxLength={120} />{catSelect(null)}</div>
          <textarea name="body" className="input min-h-24 text-sm" required maxLength={5000} placeholder="Text inserted into the reply box" />
          <button className="btn btn-primary !min-h-8 text-xs">Add response</button>
        </form>
      </Card>
    </div>
  );
}
