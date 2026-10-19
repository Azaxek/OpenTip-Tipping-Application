import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmergencyBanner } from '@/components/EmergencyBanner';
import { TipsterShell } from '@/components/TipsterShell';
import { fmt, getMessages, localHref, type Lang } from '@/lib/i18n';
import { getOrg } from '@/lib/org';

export async function HomePage({ lang }: { lang: Lang }) {
  const org = await getOrg();
  if (!org) redirect('/setup');
  const m = getMessages(lang);
  const campus = org.org_type === 'campus';
  return (
    <TipsterShell org={org} lang={lang} path="/">
      <div className="space-y-6">
        <EmergencyBanner lang={lang} />
        <section className="card space-y-4 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">{campus ? m.homeTitleCampus : m.homeTitleCs}</h1>
          <p className="text-slate-700">{fmt(campus ? m.homeIntroCampus : m.homeIntroCs, { org: org.name })}</p>
          <Link href={localHref(lang, '/submit')} className="btn btn-primary w-full !min-h-14 text-lg">{m.homeSubmit}</Link>
          <Link href={localHref(lang, '/check')} className="btn w-full">{m.homeCheck}</Link>
          {org.hotline && (
            <p className="text-sm text-slate-700">
              {m.homeCall.split('{phone}')[0]}
              <a className="link" href={`tel:${org.hotline.replace(/[^+\d]/g, '')}`}>{org.hotline}</a>
              {m.homeCall.split('{phone}')[1]}
            </p>
          )}
        </section>
        <section className="card text-sm text-slate-700">
          <h2 className="mb-2 font-bold text-slate-900">{m.howTitle}</h2>
          <ol className="list-decimal space-y-1 pl-5"><li>{m.how1}</li><li>{m.how2}</li><li>{m.how3}</li></ol>
          <p className="mt-2 text-slate-600">{m.howTime}</p>
        </section>
      </div>
    </TipsterShell>
  );
}
