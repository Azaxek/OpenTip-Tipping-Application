import { timingSafeEqual } from 'node:crypto';
import { fail, json } from '@/lib/http';
import { realProgramExists, resetDemo } from '@/lib/demo';
import { purge } from '@/lib/purge';
import { demoMode } from '@/lib/url';

export const maxDuration = 60; // fits every Vercel plan; a very large backlog simply finishes over several nightly runs

/** Daily retention purge. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail('CRON_SECRET is not configured', 503);
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return fail('Unauthorized', 401);
  // A demo deployment re-creates its sample program every night instead of running the retention purge, but never when a real program
  // shares the database: DEMO_MODE left on there must not stop real tips from being deleted on schedule.
  return json(demoMode() && !(await realProgramExists()) ? { demo: await resetDemo() } : await purge());
}
