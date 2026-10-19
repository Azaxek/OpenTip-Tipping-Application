import { bulletinImage } from '@/lib/bulletins';
import { getOrg } from '@/lib/org';

/** Public by design: the photo of an active bulletin, already re-encoded and stripped of metadata when it was saved. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const org = await getOrg();
  const img = org && (await bulletinImage(org.id, (await params).id));
  if (!img) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(img), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}
