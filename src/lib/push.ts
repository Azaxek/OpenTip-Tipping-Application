import webpush from 'web-push';
import { withOrg } from './db';

// Push services only. The server later POSTs to whatever endpoint is stored, so an open allowlist would be an SSRF vector.
const PUSH_HOSTS = ['googleapis.com', 'mozilla.com', 'push.apple.com', 'notify.windows.com', 'mozaws.net'];

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Accepts only a well-formed push subscription whose endpoint belongs to a known push service (an open endpoint would be an SSRF vector). */
export function validSubscription(input: unknown): input is Subscription {
  if (typeof input !== 'object' || input === null) return false;
  const { endpoint, keys } = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return false;
  const { p256dh, auth } = keys ?? {};
  return typeof p256dh === 'string' && typeof auth === 'string' && p256dh.length < 200 && auth.length < 100;
}

/** Store ONLY the opaque subscription object, keyed to the tip. Nothing else about the browser or device is kept. */
export async function saveSubscription(orgId: string, tipUuid: string, s: Subscription) {
  await withOrg(orgId, async (q) => {
    const have = await q<{ n: number }>('select count(*)::int as n from push_subscriptions where tip_id = $1', [tipUuid]);
    if (have[0].n >= 5) return;
    await q(
      'insert into push_subscriptions (org_id, tip_id, subscription) values ($1, $2, $3) on conflict do nothing',
      [orgId, tipUuid, JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } })],
    );
  });
}

export const removeSubscription = (orgId: string, tipUuid: string, endpoint: string) =>
  withOrg(orgId, (q) => q("delete from push_subscriptions where tip_id = $1 and subscription ->> 'endpoint' = $2", [tipUuid, endpoint]));

export const pushConfigured = () => !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

/**
 * Wake the tipster's browser. The push carries NO payload at all - the service worker shows a fixed generic
 * notification - so message content can never appear in an OS notification preview on a shared device.
 */
export async function notifyTipster(orgId: string, tipUuid: string): Promise<void> {
  if (!pushConfigured()) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@localhost', process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const subs = await withOrg(orgId, (q) => q<{ id: string; subscription: Subscription }>('select id, subscription from push_subscriptions where tip_id = $1', [tipUuid]));
  const dead: string[] = [];
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, undefined, { TTL: 86400, timeout: 8000 });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode; // 404/410 = the browser unsubscribed; anything else is retried next time
        if (status === 404 || status === 410) dead.push(s.id);
      }
    }),
  );
  if (dead.length) await withOrg(orgId, (q) => q('delete from push_subscriptions where id = any($1::uuid[])', [dead]));
}
