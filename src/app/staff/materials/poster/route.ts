import { audit } from '@/lib/audit';
import { withOrg } from '@/lib/db';
import { fail } from '@/lib/http';
import { posterPdf } from '@/lib/materials';
import { getOrg } from '@/lib/org';
import { currentStaff } from '@/lib/session';

export async function GET() {
  const s = await currentStaff();
  const org = await getOrg();
  if (s?.role !== 'admin' || !org) return fail('Unauthorized', 401);
  await withOrg(s.orgId, (q) => audit(q, s, 'materials.download', null, { kind: 'poster' }));
  return new Response(Buffer.from(await posterPdf(org)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="tip-line-poster.pdf"' } });
}
