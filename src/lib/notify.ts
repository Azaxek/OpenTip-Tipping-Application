import { withOrg } from './db';
import { sendEmail, sendWebhook, type ChannelResult } from './escalation';
import { appUrl } from './url';

export type AlertResult = { email: ChannelResult; webhook: ChannelResult; recipients: number } | null;

/**
 * Tells staff a tip needs eyes. Like escalation, the message carries the TIP ID, category and a link, never tip content
 * and never which watch-list words matched (chat and email are less private than the console).
 * 'reply' = a tipster wrote back on an existing tip; it goes to the assigned reviewer, or the tip's team if unassigned.
 */
export async function alertStaff(orgId: string, tipUuid: string, kind: 'new' | 'reply'): Promise<AlertResult> {
  const ctx = await withOrg(orgId, async (q) => {
    const t = (
      await q<any>(
        `select t.tip_id, t.urgent, t.assigned_reviewer_id, t.source, cardinality(t.watch_hits) > 0 as watch, c.name as category, c.high_risk, l.name as location
           from tips t join categories c on c.id = t.category_id left join locations l on l.id = t.location_id where t.id = $1`,
        [tipUuid],
      )
    )[0];
    if (!t) return null;
    const org = (await q<{ name: string; new_tip_alerts: string; escalation_webhook_url: string | null }>('select name, new_tip_alerts, escalation_webhook_url from organizations'))[0];
    const priority = !!(t.urgent || t.high_risk || t.watch);
    if (org.new_tip_alerts === 'off' || (org.new_tip_alerts === 'urgent' && !priority)) return null;
    // Only people who opted in AND are allowed to see this tip (admins, all-tips staff, members of a team it is routed to).
    const people = await q<{ email: string }>(
      `select r.email from reviewers r
        where r.active and r.notify_new
          and ($2::uuid is null or r.id = $2::uuid)
          and (r.role = 'admin' or r.all_tips or r.id = $2::uuid
               or exists (select 1 from tip_teams tt join team_members tm on tm.team_id = tt.team_id where tt.tip_id = $1 and tm.reviewer_id = r.id))`,
      [tipUuid, kind === 'reply' ? t.assigned_reviewer_id : null],
    );
    return { t, org, priority, to: people.map((p) => p.email) };
  });
  if (!ctx) return null;
  const { t, org, priority, to } = ctx;
  const what = kind === 'new' ? (t.source === 'phone' ? 'New phone/walk-in tip' : 'New tip') : 'New message on tip';
  const flags = [priority ? 'URGENT / priority' : '', t.watch ? 'matched your watch list' : ''].filter(Boolean).join(', ');
  const text = `${org.name}: ${what} ${t.tip_id} (${t.category}${t.location ? `, ${t.location}` : ''}${flags ? `; ${flags}` : ''}). Open the console: ${appUrl()}/staff/tips/${tipUuid}`;
  const [email, webhook] = await Promise.all([
    sendEmail(to, `[OpenTip] ${priority ? 'URGENT ' : ''}${what} ${t.tip_id}`, text),
    // Chat gets new tips only, not every reply, so a busy channel stays readable.
    kind === 'new' ? sendWebhook(org.escalation_webhook_url, text) : Promise.resolve('not_configured' as ChannelResult),
  ]);
  return { email, webhook, recipients: to.length };
}

