import { redirect } from 'next/navigation';
import { CheckTip } from '@/components/CheckTip';
import { EmergencyBanner } from '@/components/EmergencyBanner';
import { TipsterShell } from '@/components/TipsterShell';
import { getMessages, type Lang } from '@/lib/i18n';
import { getOrg } from '@/lib/org';
import { pushConfigured } from '@/lib/push';

export async function CheckPage({ lang }: { lang: Lang }) {
  const org = await getOrg();
  if (!org) redirect('/setup');
  return (
    <TipsterShell org={org} lang={lang} path="/check">
      <div className="space-y-4">
        <EmergencyBanner lang={lang} />
        <CheckTip lang={lang} m={getMessages(lang)} siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} vapidKey={pushConfigured() ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY : undefined} />
      </div>
    </TipsterShell>
  );
}
