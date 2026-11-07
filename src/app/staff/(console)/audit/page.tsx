import { Card, PageTitle, when } from '@/components/staff/ui';
import { withOrg } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

type AuditRow = { id: string; actor: string; action: string; tip_ref: string | null; detail: Record<string, unknown> | null; created_at: Date };

export const metadata = { title: 'Audit log' };

export default async function Audit() {
  const s = await requireAdmin();
  const rows = await withOrg(s.orgId, (q) =>
    q<AuditRow>("select id, actor, action, tip_ref, detail, created_at from audit_log where action <> 'tip.view' or created_at > now() - interval '7 days' order by id desc limit 300"),
  );
  return (
    <>
    <PageTitle>Audit log</PageTitle>
    <Card title="Newest 300 staff actions">
      <p className="mb-3 text-sm text-slate-600">Records who did what to which TIP ID. It never contains anything about tipsters, and it cannot be edited or deleted from inside the app.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-600"><tr><th className="py-2">When</th><th>Staff</th><th>Action</th><th>Tip</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${r.action === 'tip.escalate' ? 'bg-red-50' : ''}`}>
                <td className="py-2 whitespace-nowrap">{when(r.created_at)}</td>
                <td>{r.actor}</td>
                <td className="font-mono text-xs">{r.action}</td>
                <td className="font-mono text-xs">{r.tip_ref ?? '—'}</td>
                <td className="font-mono text-xs">{r.detail ? JSON.stringify(r.detail) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
    </>
  );
}
