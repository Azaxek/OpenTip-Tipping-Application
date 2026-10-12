'use server';
import { timingSafeEqual } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getOrg } from '@/lib/org';
import { rateLimit } from '@/lib/ratelimit';
import { headerRequest, setSessionCookie } from '@/lib/session';
import { createOrganization } from '@/lib/setup';
import { isTimeZone } from '@/lib/time';
import { staffLogin } from '@/lib/staff';

const Form = z.object({
  name: z.string().trim().min(2).max(120),
  orgType: z.enum(['crime_stoppers', 'campus']),
  hotline: z.string().trim().max(40).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  maxRewardDollars: z.coerce.number().min(0).max(1_000_000),
  retentionDays: z.coerce.number().int().min(1).max(3650),
  locationName: z.string().trim().max(200).optional(),
  timezone: z.string().trim().optional(),
  adminName: z.string().trim().min(1).max(120),
  adminEmail: z.string().trim().email().max(320),
  adminPassword: z.string().min(10).max(200),
});

/** One-time first-run setup, gated by the SETUP_TOKEN environment variable so a stranger can't claim a fresh deployment. */
export async function setupAction(_prev: { error?: string } | undefined, fd: FormData): Promise<{ error?: string }> {
  if (rateLimit(await headerRequest(), 'setup', 10, 3_600_000)) return { error: 'Too many attempts. Try again later.' };
  const want = process.env.SETUP_TOKEN;
  if (!want) return { error: 'SETUP_TOKEN is not set on the server. Add it to your environment variables and redeploy.' };
  const got = Buffer.from(String(fd.get('setupToken') ?? ''));
  const exp = Buffer.from(want);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) return { error: 'The setup token is not correct.' };
  if (await getOrg()) return { error: 'This deployment is already set up.' };

  const p = Form.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: 'Please check the form. The admin password needs at least 10 characters.' };
  const d = p.data;
  try {
    await createOrganization({
      name: d.name, orgType: d.orgType, hotline: d.hotline, primaryColor: d.primaryColor, maxRewardCents: Math.round(d.maxRewardDollars * 100),
      retentionDays: d.retentionDays, locationName: d.locationName, timezone: isTimeZone(d.timezone) ? d.timezone : 'UTC', adminName: d.adminName, adminEmail: d.adminEmail, adminPassword: d.adminPassword,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Setup failed.' };
  }
  const org = (await getOrg())!;
  const token = await staffLogin(org.id, d.adminEmail, d.adminPassword);
  if (token) await setSessionCookie(token);
  redirect('/staff/settings?welcome=1');
}
