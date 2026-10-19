/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmergencyBanner } from '@/components/EmergencyBanner';
import { TipsterShell } from '@/components/TipsterShell';
import { listPublicBulletins } from '@/lib/bulletins';
import { fmt, getMessages, localHref, type Lang } from '@/lib/i18n';
import { getOrg } from '@/lib/org';

export async function WantedPage({ lang }: { lang: Lang }) {
  const org = await getOrg();
  if (!org) redirect('/setup');
  const m = getMessages(lang);
  const items = await listPublicBulletins(org.id);
  return (
    <TipsterShell org={org} lang={lang} path="/wanted">
      <div className="space-y-5">
        <EmergencyBanner lang={lang} />
        <h1 className="text-3xl font-extrabold tracking-tight">{m.wantedTitle}</h1>
        <p className="text-slate-700">{fmt(m.wantedIntro, { org: org.name })}</p>
        {items.length === 0 && <p className="card text-slate-700">{m.wantedNone} <Link href={localHref(lang, '/submit')} className="link">{m.navSubmit}</Link></p>}
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((b) => (
            <li key={b.id} className="card flex flex-col gap-3 overflow-hidden !p-0">
              {b.has_image && <img src={`/wanted/${b.id}/image`} alt="" className="aspect-[4/3] w-full bg-slate-100 object-cover" loading="lazy" />}
              <div className="flex flex-1 flex-col gap-2 p-4">
                {b.case_number && <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{fmt(m.caseNumber, { n: b.case_number })}</p>}
                <h2 className="text-lg font-bold leading-snug">{b.title}</h2>
                {b.reward_cents ? <p className="badge self-start bg-green-100 text-green-900">{fmt(m.wantedReward, { amt: `$${(b.reward_cents / 100).toLocaleString()}` })}</p> : null}
                {b.body && <p className="whitespace-pre-wrap text-sm text-slate-800">{b.body}</p>}
                <Link href={`${localHref(lang, '/submit')}?case=${b.id}`} className="btn btn-primary mt-auto w-full">{m.wantedCta}</Link>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </TipsterShell>
  );
}
