import { z } from 'zod';
import { fail, json, publicPost } from '@/lib/http';
import { getOrg } from '@/lib/org';
import { InputError, createTip } from '@/lib/tipster';

export const maxDuration = 60; // evidence is sanitized (metadata stripped) before the response

const Body = z.object({
  categoryId: z.uuid(),
  locationId: z.uuid().nullish(),
  urgent: z.boolean().optional(),
  description: z.string().max(5000).optional(),
  passcode: z.string().min(6).max(128),
  attachmentKeys: z.array(z.string().max(100)).max(30).optional(),
  bulletinId: z.uuid().nullish(),
});

export async function POST(req: Request) {
  const r = await publicPost(req, 'submit', 60, 3_600_000, { maxBytes: 30_000 });
  if ('res' in r) return r.res;
  const parsed = Body.safeParse(r.body);
  if (!parsed.success) return fail('Please check the form and try again. Passcodes need at least 6 characters.');
  const org = await getOrg();
  if (!org) return fail('This tip line is not set up yet.', 503);
  try {
    return json(await createTip(org, parsed.data));
  } catch (e) {
    if (e instanceof InputError) return fail(e.message);
    throw e;
  }
}
