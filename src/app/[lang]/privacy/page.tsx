import { PrivacyPage } from '@/components/pages/PrivacyPage';
import { getMessages } from '@/lib/i18n';
import { translated } from '@/lib/i18n/route';

type P = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: P) {
  return { title: getMessages(await translated(params)).privacyTitle };
}

export default async function Page({ params }: P) {
  return <PrivacyPage lang={await translated(params)} />;
}
