import { getOrg } from '@/lib/org';
import { rateLimit } from '@/lib/ratelimit';
import { appUrl } from '@/lib/url';

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Text-to-tip: point a Twilio (or compatible) number's "incoming message" webhook here. Anyone who texts the number gets a
 * reply with the link to the anonymous form. The body and sender of the text are never read or stored by this app. Note that
 * the phone carrier and the SMS provider necessarily see the sender's number; the tip itself is still written on the
 * anonymous website, so a tipster who wants no phone trail should use the link from a different device or the hotline.
 */
export async function POST(req: Request) {
  // Every text arrives from the provider's servers, so this is a flood guard rather than a per-person limit.
  const limited = rateLimit(req, 'sms', 5000, 3_600_000);
  if (limited) return limited;
  const org = await getOrg();
  const reply = org
    ? `${org.name}: to send an anonymous tip, open ${appUrl()}/submit - we do not collect your name or number. If someone is in danger now, call 911.`
    : 'This tip line is not set up yet.';
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(reply)}</Message></Response>`, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
