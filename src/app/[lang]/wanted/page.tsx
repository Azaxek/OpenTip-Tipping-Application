import { WantedPage } from '@/components/pages/WantedPage';
import { getMessages } from '@/lib/i18n';
import { translated } from '@/lib/i18n/route';

type P = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: P) {
  return { title: getMessages(await translated(params)).wantedTitle };
}

export default async function Page({ params }: P) {
  return <WantedPage lang={await translated(params)} />;
}
