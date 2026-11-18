import { CopyButton } from '@/components/staff/CopyButton';
import { Card, PageTitle } from '@/components/staff/ui';
import { announcements, defaultLetter, submitUrl } from '@/lib/materials';
import { getOrg } from '@/lib/org';
import { requireAdmin } from '@/lib/session';
import { appUrl } from '@/lib/url';

export const metadata = { title: 'Rollout materials' };

export default async function Materials() {
  await requireAdmin();
  const org = (await getOrg())!;
  return (
    <div className="space-y-4">
      <PageTitle>Rollout materials</PageTitle>
      {/^https?:\/\/(localhost|127\.|\[::1\])/.test(appUrl()) && (
        <p role="alert" className="rounded-lg border-2 border-red-800 bg-red-50 p-3 text-sm font-bold text-red-900">
          Do not print yet: your site address is set to {appUrl()}, so every QR code would point at a computer nobody else can reach. Set APP_URL to your real website address in your hosting settings and redeploy.
        </p>
      )}
      <p className="text-sm text-slate-700">Everything you need to announce the tip line, generated from your settings. Points at <span className="font-mono">{submitUrl()}</span>. If that address is wrong, set APP_URL and redeploy.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Poster / flyer (PDF)">
          <p className="mb-3 text-sm text-slate-700">Letter-size poster with your name, brand color, hotline, a large QR code and the 911 notice. Print and post.</p>
          <a className="btn btn-primary" href="/staff/materials/poster">Download poster</a>
        </Card>
        <Card title="QR code (PNG)">
          <p className="mb-3 text-sm text-slate-700">High-resolution QR linking straight to the submission page, for slides, newsletters and social posts.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/staff/materials/qr" alt="QR code to the tip form" className="mb-3 size-40 rounded border border-slate-200" />
          <a className="btn" href="/staff/materials/qr">Download PNG</a>
        </Card>
      </div>
      <Card title="Parent / community letter (PDF)">
        <form action="/staff/materials/letter" method="post" className="space-y-3">
          <p className="text-sm text-slate-700">Pre-filled with your name and hotline. Edit freely before downloading.</p>
          <textarea name="body" aria-label="Letter text" defaultValue={defaultLetter(org)} className="input min-h-96 font-mono text-sm" maxLength={8000} />
          <button className="btn btn-primary">Download letter</button>
        </form>
      </Card>
      <Card title="Announcement texts">
        <p className="mb-4 text-sm text-slate-700">Ready to paste. Fill in what is in [square brackets] first.</p>
        <div className="space-y-6">
          {announcements(org).map((a) => (
            <section key={a.id} aria-labelledby={`ann-${a.id}`}>
              <h3 id={`ann-${a.id}`} className="font-semibold">{a.title}</h3>
              <p className="text-sm text-slate-700">{a.use}</p>
              <textarea readOnly aria-labelledby={`ann-${a.id}`} defaultValue={a.text} className="input mt-2 min-h-48 font-mono text-sm" />
              <div className="mt-2"><CopyButton text={a.text} /></div>
            </section>
          ))}
        </div>
      </Card>
    </div>
  );
}
