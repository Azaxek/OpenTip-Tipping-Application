import { fail, json, publicPost } from '@/lib/http';
import { isLang } from '@/lib/i18n';
import { rateLimit } from '@/lib/ratelimit';
import { InputError, getTipStatus, listTipsterMessages, postTipsterMessage, tipsterFromRequest } from '@/lib/tipster';

/** Live-chat poll: new messages since a cursor, plus the current status. Cheap when nothing changed. */
export async function GET(req: Request) {
  const who = tipsterFromRequest(req);
  if (!who) return fail('Please sign in again.', 401);
  const limited = rateLimit(req, 'tip-poll', 60, 60_000, who.tipUuid);
  if (limited) return limited;
  const q = new URL(req.url).searchParams;
  const since = Math.max(0, parseInt(q.get('since') ?? '0', 10) || 0);
  const lang = q.get('lang');
  const status = await getTipStatus(who.orgId, who.tipUuid, isLang(lang) ? lang : 'en');
  if (!status) return fail('Please sign in again.', 401);
  return json({ status, messages: await listTipsterMessages(who.orgId, who.tipUuid, since) });
}

export async function POST(req: Request) {
  const r = await publicPost(req, 'tip-message', 300, 10 * 60_000, { turnstile: false, maxBytes: 12_000 });
  if ('res' in r) return r.res;
  const who = tipsterFromRequest(req);
  if (!who) return fail('Please sign in again.', 401);
  const limited = rateLimit(req, 'tip-message', 30, 10 * 60_000, who.tipUuid);
  if (limited) return limited;
  try {
    await postTipsterMessage(who.orgId, who.tipUuid, r.body.body);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof InputError) return fail(e.message);
    throw e;
  }
}
