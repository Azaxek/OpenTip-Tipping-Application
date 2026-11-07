import { SettingsNav } from '@/components/staff/SettingsNav';
import { Card, Flash } from '@/components/staff/ui';
import { withOrg } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { deleteTeamAction, importLocationsAction, saveCategoryAction, saveLocationAction, saveTeamAction } from '../../../admin-actions';

type CategoryRow = { id: string; name: string; description: string; sort: number; active: boolean; high_risk: boolean };
type LocationRow = { id: string; name: string; external_id: string | null; active: boolean };

export const metadata = { title: 'Categories & teams' };

export default async function Taxonomy({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const data = await withOrg(s.orgId, async (q) => ({
    categories: await q<CategoryRow>('select id, name, description, sort, active, high_risk from categories order by sort, name'),
    links: await q<{ category_id: string; team_id: string }>('select category_id, team_id from category_teams'),
    teams: await q<{ id: string; name: string }>('select id, name from teams order by name'),
    locations: await q<LocationRow>('select id, name, external_id, active from locations order by active desc, name'),
    teamLocs: await q<{ team_id: string; location_id: string }>('select team_id, location_id from team_locations'),
  }));
  const teamChecks = (catId: string | null) =>
    data.teams.map((t) => (
      <label key={t.id} className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" name="teamId" value={t.id} defaultChecked={catId ? data.links.some((l) => l.category_id === catId && l.team_id === t.id) : false} className="size-4" />{t.name}
      </label>
    ));
  return (
    <div className="space-y-4">
      <SettingsNav current="/staff/settings/taxonomy" />
      <Flash e={sp.e} ok={sp.ok} />

      <Card title="Categories">
        <p className="mb-3 text-sm text-slate-600">What tipsters pick from. <strong>High-risk</strong> categories are pinned to the top of the queue and can be escalated. Checked teams receive tips in that category.</p>
        <div className="space-y-3">
          {data.categories.map((c) => (
            <form key={c.id} action={saveCategoryAction} className={`grid gap-2 rounded-lg border border-slate-200 p-3 lg:grid-cols-12 ${c.active ? '' : 'opacity-60'}`}>
              <input type="hidden" name="id" value={c.id} />
              <input name="name" defaultValue={c.name} className="input !py-1.5 text-sm lg:col-span-3" aria-label="Category name" required />
              <input name="description" defaultValue={c.description} className="input !py-1.5 text-sm lg:col-span-4" aria-label="Helper description" maxLength={500} />
              <input name="sort" type="number" defaultValue={c.sort} className="input !py-1.5 text-sm lg:col-span-1" aria-label="Sort order" />
              <div className="flex flex-col gap-1 lg:col-span-2">
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="high_risk" defaultChecked={c.high_risk} className="size-4" />High-risk</label>
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="active" defaultChecked={c.active} className="size-4" />Shown to tipsters</label>
              </div>
              <div className="flex flex-col gap-1 lg:col-span-2">{teamChecks(c.id)}</div>
              <div className="lg:col-span-12"><button className="btn !min-h-8 text-xs">Save</button></div>
            </form>
          ))}
        </div>
        <form action={saveCategoryAction} className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 lg:grid-cols-12">
          <input name="name" placeholder="New category name" className="input !py-1.5 text-sm lg:col-span-3" required />
          <input name="description" placeholder="Helper text tipsters see" className="input !py-1.5 text-sm lg:col-span-4" maxLength={500} />
          <input name="sort" type="number" defaultValue={100} className="input !py-1.5 text-sm lg:col-span-1" aria-label="Sort order" />
          <label className="flex items-center gap-1.5 text-xs lg:col-span-2"><input type="checkbox" name="high_risk" className="size-4" />High-risk</label>
          <div className="flex flex-col gap-1 lg:col-span-2">{teamChecks(null)}</div>
          <div className="lg:col-span-12"><button className="btn btn-primary !min-h-8 text-xs">Add category</button></div>
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Teams">
          <p className="mb-3 text-sm text-slate-600">Each team sees only tips routed to it. Put people on teams under People.</p>
          <ul className="space-y-3">
            {data.teams.map((t) => (
              <li key={t.id} className="rounded-lg border border-slate-200 p-2">
                <form action={saveTeamAction} className="space-y-2">
                  <input type="hidden" name="id" value={t.id} />
                  <div className="flex gap-2"><input name="name" defaultValue={t.name} className="input !py-1.5 text-sm" aria-label="Team name" required /><button className="btn !min-h-8 text-xs">Save</button></div>
                  {data.locations.length > 1 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-slate-600">{data.teamLocs.some((l) => l.team_id === t.id) ? 'Only some locations' : 'All locations'} (change)</summary>
                      <p className="my-1 text-slate-600">Tick locations to limit this team to tips from them. Tick none for all.</p>
                      {data.locations.filter((l) => l.active).map((l) => (
                        <label key={l.id} className="flex items-center gap-1.5"><input type="checkbox" name="locationId" value={l.id} defaultChecked={data.teamLocs.some((x) => x.team_id === t.id && x.location_id === l.id)} className="size-4" />{l.name}</label>
                      ))}
                    </details>
                  )}
                </form>
                <form action={deleteTeamAction} className="mt-1"><input type="hidden" name="id" value={t.id} /><button className="btn !min-h-8 text-xs">Delete team</button></form>
              </li>
            ))}
          </ul>
          <form action={saveTeamAction} className="mt-3 flex gap-2"><input name="name" placeholder="New team" className="input !py-1.5 text-sm" required /><button className="btn btn-primary !min-h-8 text-xs">Add team</button></form>
        </Card>

        <Card title="Locations">
          <ul className="space-y-2">
            {data.locations.map((l) => (
              <li key={l.id}>
                <form action={saveLocationAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <input name="name" defaultValue={l.name} className="input !py-1.5 text-sm" aria-label="Location name" required />
                  <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" name="active" defaultChecked={l.active} className="size-4" />Active</label>
                  <button className="btn !min-h-8 text-xs">Save</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={saveLocationAction} className="mt-3 flex gap-2"><input name="name" placeholder="New location" className="input !py-1.5 text-sm" required /><button className="btn btn-primary !min-h-8 text-xs">Add</button></form>
          <form action={importLocationsAction} className="mt-4 space-y-2 border-t border-slate-200 pt-3">
            <p className="label">Import schools from a CSV (SIS connector)</p>
            <p className="hint">Two columns only: <span className="font-mono">external_id,name</span>. Re-importing updates names and deactivates schools missing from the file. Files with any other column (for example student data) are rejected.</p>
            <input type="file" name="file" aria-label="CSV file with external_id and name columns" accept=".csv,text/csv" className="input text-sm" required />
            <button className="btn !min-h-8 text-xs">Import locations</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
