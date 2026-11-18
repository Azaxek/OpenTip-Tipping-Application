import { audit } from '@/lib/audit';
import { withOrg } from '@/lib/db';
import { fail } from '@/lib/http';
import { letterPdf } from '@/lib/materials';
import { getOrg } from '@/lib/org';
import { currentStaff } from '@/lib/session';

export async function POST(req: Request) {
  const s = await currentStaff();
  const org = await getOrg();
  if (s?.role !== 'admin' || !org) return fail('Unauthorized', 401);
  await withOrg(s.orgId, (q) => audit(q, s, 'materials.download', null, { kind: 'letter' }));
  const body = String((await req.formData()).get('body') ?? '');
  return new Response(Buffer.from(await letterPdf(org, body)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="parent-community-letter.pdf"' } });
}
