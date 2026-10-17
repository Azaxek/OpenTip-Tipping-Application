import { SettingsNav } from '@/components/staff/SettingsNav';
import { Card, Flash } from '@/components/staff/ui';
import { withOrg } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { createReviewerAction, resetPasswordAction, resetTwoStepAction, saveReviewerAction } from '../../../admin-actions';

export const metadata = { title: 'People' };

export default async function People({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const { people, teams, members } = await withOrg(s.orgId, async (q) => ({
    people: await q<any>('select id, name, email, role, all_tips, on_call, notify_new, totp_enabled, active from reviewers order by active desc, name'),
    teams: await q<{ id: string; name: string }>('select id, name from teams order by name'),
    members: await q<{ team_id: string; reviewer_id: string }>('select team_id, reviewer_id from team_members'),
  }));
  const onCall = people.filter((p: any) => p.active && p.on_call).length;
  return (
    <div className="space-y-4">
      <SettingsNav current="/staff/settings/people" />
      <Flash e={sp.e} ok={sp.ok} />
      {onCall === 0 && <p role="alert" className="rounded-lg bg-amber-100 p-3 text-sm font-semibold text-amber-950">Nobody is marked on-call. Escalation emails go to on-call staff, so no email would be sent. Mark at least one person on-call or switch escalation to administrators.</p>}

      <Card title="Staff">
        <div className="space-y-3">
          {people.map((p: any) => (
            <div key={p.id} className={`rounded-lg border border-slate-200 p-3 ${p.active ? '' : 'opacity-60'}`}>
              <form action={saveReviewerAction} className="grid gap-2 md:grid-cols-12">
                <input type="hidden" name="id" value={p.id} />
                <div className="md:col-span-3"><p className="font-semibold">{p.name}</p><p className="text-xs text-slate-600">{p.email}</p>{p.totp_enabled && <span className="badge mt-1 bg-green-100 text-green-900">Two-step on</span>}</div>
                <select name="role" defaultValue={p.role} className="input !py-1.5 text-sm md:col-span-2" aria-label="Role"><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select>
                <div className="flex flex-col gap-1 md:col-span-2">
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="on_call" defaultChecked={p.on_call} className="size-4" />On call</label>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="all_tips" defaultChecked={p.all_tips} className="size-4" />See all tips</label>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="notify_new" defaultChecked={p.notify_new} className="size-4" />Email me new tips</label>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="active" defaultChecked={p.active} className="size-4" />Active</label>
                </div>
                <div className="flex flex-col gap-1 md:col-span-3">
                  {teams.map((t) => <label key={t.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="teamId" value={t.id} defaultChecked={members.some((m) => m.team_id === t.id && m.reviewer_id === p.id)} className="size-4" />{t.name}</label>)}
                </div>
                <div className="md:col-span-2"><button className="btn !min-h-8 text-xs">Save</button></div>
              </form>
              <form action={resetPasswordAction} className="mt-2 flex gap-2 border-t border-slate-100 pt-2">
                <input type="hidden" name="id" value={p.id} />
                <input name="password" type="password" minLength={10} placeholder="New temporary password" className="input !py-1.5 text-sm" autoComplete="new-password" />
                <button className="btn !min-h-8 text-xs whitespace-nowrap">Reset password</button>
              </form>
              {p.totp_enabled && (
                <form action={resetTwoStepAction} className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                  <input type="hidden" name="id" value={p.id} />
                  Lost their phone?
                  <button className="btn !min-h-8 text-xs">Reset two-step sign-in</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Add a staff member">
        <form action={createReviewerAction} className="grid gap-3 md:grid-cols-2">
          <div><label className="label" htmlFor="n">Name</label><input id="n" name="name" className="input" required /></div>
          <div><label className="label" htmlFor="e">Email</label><input id="e" name="email" type="email" className="input" required /></div>
          <div><label className="label" htmlFor="p">Temporary password (10+ characters)</label><input id="p" name="password" type="password" minLength={10} className="input" required autoComplete="new-password" /></div>
          <div><label className="label" htmlFor="r">Role</label><select id="r" name="role" className="input"><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select></div>
          <div className="flex flex-wrap gap-4 md:col-span-2">
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="on_call" className="size-4" />On call</label>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="all_tips" className="size-4" />See all tips</label>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="notify_new" className="size-4" />Email me new tips</label>
            {teams.map((t) => <label key={t.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="teamId" value={t.id} className="size-4" />{t.name}</label>)}
          </div>
          <div className="md:col-span-2"><button className="btn btn-primary">Add staff member</button></div>
        </form>
        <p className="hint">Send the temporary password privately. They can change it on their account page.</p>
      </Card>
    </div>
  );
}
