import { redirect } from 'next/navigation';
import { SubmitWizard } from '@/components/SubmitWizard';
import { TipsterShell } from '@/components/TipsterShell';
import { getPublicBulletin } from '@/lib/bulletins';
import { withOrg } from '@/lib/db';
import { getMessages, localizeCategory, localizeOrgText, type Lang } from '@/lib/i18n';
import { ACCEPT } from '@/lib/media';
import { getOrg } from '@/lib/org';
import { pushConfigured } from '@/lib/push';
import { storageConfigured } from '@/lib/storage';

export async function SubmitPage({ lang, caseId }: { lang: Lang; caseId?: string }) {
  const org = await getOrg();
  if (!org) redirect('/setup');
  const { categories, locations } = await withOrg(org.id, async (q) => ({
    categories: await q<{ id: string; name: string; description: string; high_risk: boolean }>('select id, name, description, high_risk from categories where active order by sort, name'),
    locations: await q<{ id: string; name: string }>('select id, name from locations where active order by name'),
  }));
  const bulletin = caseId ? await getPublicBulletin(org.id, caseId) : null;
  return (
    <TipsterShell org={org} lang={lang} path="/submit">
      <SubmitWizard
        lang={lang}
        m={getMessages(lang)}
        orgName={org.name}
        hotline={org.hotline}
        note={localizeOrgText('note', org.tipster_note, org.tipster_note_es, lang, org.org_type)}
        helpText={localizeOrgText('help', org.help_text, org.help_text_es, lang, org.org_type)}
        categories={categories.map((c) => localizeCategory(c, lang, org.org_type))}
        locations={locations}
        bulletin={bulletin ? { id: bulletin.id, title: bulletin.title, caseNumber: bulletin.case_number } : null}
        // Evidence needs a private bucket; until one is configured the form simply does not offer uploads instead of failing at the end.
        limits={{ imageMb: org.image_mb, docMb: org.doc_mb, avMb: org.av_mb, tipMb: org.tip_mb, maxFiles: storageConfigured() ? org.max_files : 0 }}
        accept={ACCEPT.join(',')}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        vapidKey={pushConfigured() ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY : undefined}
      />
    </TipsterShell>
  );
}
