import { audit } from './audit';
import { withOrg } from './db';
import { orgInTx } from './org';
import { StaffInputError, isUuid } from './queue';
import { visible, type Staff } from './staff';
import { appUrl, demoMode } from './url';

export type ChannelResult = 'sent' | 'failed' | 'not_configured' | 'no_recipients' | 'simulated';
export type EscalationResult = { delivered: boolean; email: ChannelResult; webhook: ChannelResult; recipients: number };

/**
 * One-click escalation: alert humans through every configured channel at once, and log it.
 * The message names the tip and links to the console but never includes tip content, because Slack/email are
 * less private than the console. The software's job is to get a person alerted fast - not to handle the emergency.
 */
export async function escalate(s: Staff, tipId: string): Promise<EscalationResult> {
  if (!isUuid(tipId)) throw new StaffInputError('Tip not found');
  const ctx = await withOrg(s.orgId, async (q) => {
    const t = (
      await q<any>(
        `select t.tip_id, t.urgent, t.status, c.name as category, c.high_risk, cardinality(t.watch_hits) > 0 as watch from tips t join categories c on c.id = t.category_id
          where t.id = $1 and ${visible(s, 2)}`,
        [tipId, s.id],
      )
    )[0];
    if (!t) throw new StaffInputError('Tip not found');
    if (t.status === 'closed') throw new StaffInputError('This tip is closed.');
    const org = await orgInTx(q);
    const recipients =
      org.escalation_email_mode === 'off'
        ? []
        : (await q<{ email: string }>(`select email from reviewers where active and ${org.escalation_email_mode === 'admins' ? "role = 'admin'" : 'on_call'}`)).map((r) => r.email);
    return { t, org, recipients };
  });

  const { t, org, recipients } = ctx;
  const link = `${appUrl()}/staff/tips/${tipId}`;
  const text = `ESCALATION - ${org.name}: tip ${t.tip_id} (${t.category}${t.urgent || t.high_risk || t.watch ? ', urgent/high-risk' : ''}) was escalated by ${s.name}. Open the console: ${link}`;

  let [email, webhook] = await Promise.all([sendEmail(recipients, `[OpenTip] Escalation: tip ${t.tip_id}`, text), sendWebhook(org.escalation_webhook_url, text)]);
  // A DEMO_MODE deployment has no real channels: simulate delivery so the workflow can be shown, labelled as simulated everywhere.
  const simulated = demoMode() && email === 'not_configured' && webhook === 'not_configured';
  if (simulated) email = webhook = 'simulated';
  const delivered = simulated || email === 'sent' || webhook === 'sent';

  await withOrg(s.orgId, (q) => audit(q, s, 'tip.escalate', t.tip_id, { email, webhook, recipients: recipients.length, delivered, ...(simulated ? { simulated: true } : {}) }));
  return { delivered, email, webhook, recipients: recipients.length };
}

const recipientsOf = async (q: import('./db').Q, mode: string) =>
  mode === 'off' ? [] : (await q<{ email: string }>(`select email from reviewers where active and ${mode === 'admins' ? "role = 'admin'" : 'on_call'}`)).map((r) => r.email);

/** Sends a clearly-labelled test through every configured channel so an admin can prove alerts arrive before an emergency. */
export async function sendTestAlert(s: Staff): Promise<EscalationResult> {
  if (s.role !== 'admin') throw new StaffInputError('Admins only');
  const { org, recipients } = await withOrg(s.orgId, async (q) => {
    const org = await orgInTx(q);
    return { org, recipients: await recipientsOf(q, org.escalation_email_mode) };
  });
  const text = `TEST ALERT - ${org.name}: ${s.name} is testing escalation alerts. No action is needed. If you can read this, urgent alerts will reach you.`;
  let [email, webhook] = await Promise.all([sendEmail(recipients, '[OpenTip] TEST alert (no action needed)', text), sendWebhook(org.escalation_webhook_url, text)]);
  const simulated = demoMode() && email === 'not_configured' && webhook === 'not_configured';
  if (simulated) email = webhook = 'simulated';
  const delivered = simulated || email === 'sent' || webhook === 'sent';
  await withOrg(s.orgId, (q) => audit(q, s, 'alert.test', null, { email, webhook, recipients: recipients.length, delivered, ...(simulated ? { simulated: true } : {}) }));
  return { delivered, email, webhook, recipients: recipients.length };
}

export async function sendEmail(to: string[], subject: string, text: string): Promise<ChannelResult> {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return 'not_configured';
  if (!to.length) return 'no_recipients';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to, subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function sendWebhook(url: string | null, text: string): Promise<ChannelResult> {
  if (!url) return 'not_configured';
  try {
    // `text` is Slack's field, `content` is Discord's; each ignores the other.
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(10_000) });
    return r.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
