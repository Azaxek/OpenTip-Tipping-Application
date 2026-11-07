import { report } from '@/lib/analytics';
import { audit } from '@/lib/audit';
import { withOrg } from '@/lib/db';
import { getOrg } from '@/lib/org';
import { fail } from '@/lib/http';
import { reportCsv, reportPdf } from '@/lib/export';
import { currentStaff } from '@/lib/session';

export async function GET(req: Request) {
  const s = await currentStaff();
  if (s?.role !== 'admin') return fail('Unauthorized', 401);
  const u = new URL(req.url).searchParams;
  const format = u.get('format') === 'pdf' ? 'pdf' : 'csv';
  const filter = { from: u.get('from') ?? '', to: u.get('to') ?? '', bucket: (u.get('bucket') as 'day' | 'week' | 'month') ?? 'day', locationId: u.get('location') ?? undefined, categoryId: u.get('category') ?? undefined };
  let r: Awaited<ReturnType<typeof report>>;
  try { r = await report(s, filter); } catch { return fail('Invalid date range'); }
  await withOrg(s.orgId, (q) => audit(q, s, 'report.export', null, { format, from: filter.from, to: filter.to }));
  const name = `opentip-report-${filter.from}-to-${filter.to}.${format}`;
  const headers = { 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' };
  if (format === 'pdf') return new Response(Buffer.from(await reportPdf(r, (await getOrg())?.name ?? 'OpenTip')), { headers: { ...headers, 'Content-Type': 'application/pdf' } });
  return new Response(reportCsv(r), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
}
