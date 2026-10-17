import { SettingsNav } from '@/components/staff/SettingsNav';
import { Card, Flash } from '@/components/staff/ui';
import { withOrg } from '@/lib/db';
import { orgInTx } from '@/lib/org';
import { readiness } from '@/lib/readiness';
import { requireAdmin } from '@/lib/session';
import { allTimeZones } from '@/lib/time';
import { saveOrgAction, testAlertAction, testStorageAction } from '../../admin-actions';

export const metadata = { title: 'Settings' };

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const org = await withOrg(s.orgId, (q) => orgInTx(q));
  const checks = readiness();
  const f = (label: string, name: string, value: string | number, extra: Record<string, unknown> = {}, hint?: string) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={value} className="input" {...extra} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
  const section = (title: string, intro: string, body: React.ReactNode, id?: string) => (
    <section className="card space-y-4" id={id}>
      <div><h2 className="text-lg font-bold">{title}</h2><p className="text-sm text-slate-700">{intro}</p></div>
      {body}
    </section>
  );
  return (
    <div>
      <SettingsNav current="/staff/settings" />
      <Flash e={sp.e} ok={sp.ok} />
      {sp.welcome && (
        <div className="mb-4 rounded-lg bg-green-50 p-4 text-sm text-green-900">
          <p className="font-bold">Your tip line is live.</p>
          <p>The <a className="link" href="/staff">Getting started checklist</a> on the Queue page walks you through the rest, one step at a time.</p>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <form action={saveOrgAction} className="space-y-4 lg:col-span-2">
          {section('About your program', 'Shown to the public on the tip form and printed materials.', (
            <div className="grid gap-4 sm:grid-cols-2">
              {f('Name', 'name', org.name, { required: true, maxLength: 120 })}
              {f('Hotline (optional)', 'hotline', org.hotline ?? '', { maxLength: 40 }, 'Shown as “Prefer to talk? Call…”.')}
              {f('Brand color', 'primary_color', org.primary_color, { type: 'color', className: 'input h-11 p-1' })}
              {f('Time zone', 'timezone', org.timezone, { list: 'tzlist', required: true, autoComplete: 'off' }, 'Analytics count days in this time zone. Start typing, e.g. America/Chicago.')}
              <datalist id="tzlist">{allTimeZones().map((z) => <option key={z} value={z} />)}</datalist>
              {f('Max reward (USD)', 'max_reward', (org.max_reward_cents / 100).toFixed(2), { type: 'number', min: 0, step: '0.01' }, '0 turns rewards off.')}
            </div>
          ))}

          {section('When a tip arrives', 'Keeps your team from having to watch the queue. Messages name the tip and link to it, but never contain what the tipster wrote.', (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="new_tip_alerts">Alert staff about</label>
                  <select id="new_tip_alerts" name="new_tip_alerts" defaultValue={org.new_tip_alerts} className="input">
                    <option value="all">Every new tip</option><option value="urgent">Urgent, high-risk and watch-list tips only</option><option value="off">Nothing (staff watch the queue)</option>
                  </select>
                  <p className="hint">Each person chooses to get these emails under People → “Email me new tips”. The chat webhook below also receives new tips.</p>
                </div>
                {f('Reply target (hours)', 'response_target_hours', org.response_target_hours, { type: 'number', min: 1, max: 720 }, 'Tips waiting longer than this turn red (“Overdue”) in the queue.')}
              </div>
              <div>
                <label className="label" htmlFor="watch_keywords">Keyword watch list</label>
                <textarea id="watch_keywords" name="watch_keywords" defaultValue={org.watch_keywords} maxLength={2000} className="input min-h-20" placeholder="gun, knife, bomb threat, suicide, tonight" />
                <p className="hint">Words or phrases, separated by commas. A tip containing one (whole word, any capitals) is pinned as a priority and staff are alerted. Matching happens on the server; the words are never shown to tipsters or put in alerts.</p>
              </div>
            </>
          ), 'alerts')}

          {section('Urgent alerts (Escalate)', 'What happens when a reviewer presses “Escalate now” on a tip.', (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="escalation_email_mode">Email who?</label>
                <select id="escalation_email_mode" name="escalation_email_mode" defaultValue={org.escalation_email_mode} className="input">
                  <option value="on_call">Reviewers marked on-call</option><option value="admins">Administrators</option><option value="off">Nobody by email</option>
                </select>
                <p className="hint">Choose who is on call under People. Needs an email service (see the checklist on the right).</p>
              </div>
              {f('Slack / Discord webhook URL', 'escalation_webhook_url', org.escalation_webhook_url ?? '', { type: 'url', placeholder: 'https://hooks.slack.com/…' }, 'Optional. Posts at the same time as email.')}
            </div>
          ), 'escalation')}

          {section('What tipsters read after they submit', 'Be honest about when a real person reads tips.', (
            <>
              <div>
                <label className="label" htmlFor="tipster_note">What to expect (reply times, hours)</label>
                <textarea id="tipster_note" name="tipster_note" defaultValue={org.tipster_note} maxLength={600} className="input min-h-20" />
                <p className="hint">Shown above the chat on the status page.</p>
              </div>
              <div>
                <label className="label" htmlFor="help_text">Help resources (shown on the receipt and status page)</label>
                <textarea id="help_text" name="help_text" defaultValue={org.help_text} maxLength={1200} className="input min-h-24" />
                <p className="hint">Crisis lines, victim assistance, local numbers. Replace the sample text with resources for your area.</p>
              </div>
              <details className="rounded-lg border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-semibold">Spanish versions (optional)</summary>
                <p className="hint">Shown to people who choose Español. Leave blank to use the built-in Spanish text (while the English is still the default) or the English text.</p>
                <div className="mt-2 space-y-3">
                  <div><label className="label" htmlFor="tipster_note_es">What to expect (Spanish)</label><textarea id="tipster_note_es" name="tipster_note_es" defaultValue={org.tipster_note_es} maxLength={600} className="input min-h-20" /></div>
                  <div><label className="label" htmlFor="help_text_es">Help resources (Spanish)</label><textarea id="help_text_es" name="help_text_es" defaultValue={org.help_text_es} maxLength={1200} className="input min-h-24" /></div>
                </div>
              </details>
            </>
          ))}

          {section('Evidence limits', 'How much tipsters can attach. Larger files cost more storage.', (
            <div className="grid gap-4 sm:grid-cols-3">
              {f('Photo max (MB)', 'image_mb', org.image_mb, { type: 'number', min: 1, max: 100 })}
              {f('PDF max (MB)', 'doc_mb', org.doc_mb, { type: 'number', min: 1, max: 100 })}
              {f('Video / audio max (MB)', 'av_mb', org.av_mb, { type: 'number', min: 1, max: 500 })}
              {f('Per-tip total (MB)', 'tip_mb', org.tip_mb, { type: 'number', min: 1, max: 500 })}
              {f('Max files per tip', 'max_files', org.max_files, { type: 'number', min: 0, max: 30 }, '0 turns file uploads off.')}
            </div>
          ))}

          {section('Retention', 'Old tips are deleted automatically, including their files.', (
            <div className="grid gap-4 sm:grid-cols-3">
              {f('Delete idle tips after (days)', 'retention_days', org.retention_days, { type: 'number', min: 1, max: 3650 }, 'Counted from the last activity on the tip.')}
              {f('Keep audit log (days)', 'audit_retention_days', org.audit_retention_days, { type: 'number', min: 30, max: 3650 })}
              {f('Provider backup window (days)', 'backup_retention_days', org.backup_retention_days, { type: 'number', min: 0, max: 365 }, 'How long your database provider keeps backups. Shown in the privacy notice; check it in their dashboard.')}
            </div>
          ))}
          <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
            <button className="btn btn-primary">Save settings</button>
            <span className="text-xs text-slate-600">Saves every section on this page.</span>
          </div>
        </form>

        <div className="space-y-4">
          <Card title="Test your connections">
            <p className="mb-3 text-sm text-slate-700"><strong>Alerts:</strong> sends a clearly-labelled test through email (to on-call staff) and your chat webhook, and tells you what actually got through.</p>
            <form action={testAlertAction}><button className="btn btn-primary">Send a test alert</button></form>
            <p className="mb-3 mt-4 border-t border-slate-200 pt-3 text-sm text-slate-700"><strong>Evidence storage:</strong> saves, reads back and deletes a tiny file so wrong storage keys show up here, not on a tipster&apos;s last step.</p>
            <form action={testStorageAction}><button className="btn">Test evidence storage</button></form>
          </Card>
          <Card title="Server checklist">
            <ul className="space-y-3 text-sm">
              {checks.map((c) => (
                <li key={c.label} className="flex gap-2">
                  <span aria-hidden>{c.ok ? '✅' : c.critical ? '❌' : '⚠️'}</span>
                  <span><span className="font-semibold">{c.label}</span>{!c.ok && <span className="block text-slate-600">{c.fix}</span>}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-950">
              <strong>24/7 coverage is a staffing decision, not a feature.</strong> This app can alert people instantly; it cannot guarantee someone answers. Define an on-call rotation (ESCALATION-PROTOCOL.md) and keep the 911 notice on the form.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
