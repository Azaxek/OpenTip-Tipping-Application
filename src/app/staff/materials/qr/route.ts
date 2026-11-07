import { fail } from '@/lib/http';
import { qrPng, submitUrl } from '@/lib/materials';
import { currentStaff } from '@/lib/session';

export async function GET() {
  const s = await currentStaff();
  if (s?.role !== 'admin') return fail('Unauthorized', 401);
  return new Response(new Uint8Array(await qrPng(submitUrl())), { headers: { 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="tip-line-qr.png"' } });
}
