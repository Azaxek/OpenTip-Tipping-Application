import { CheckPage } from '@/components/pages/CheckPage';
import { getMessages } from '@/lib/i18n';
import { translated } from '@/lib/i18n/route';

type P = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: P) {
  return { title: getMessages(await translated(params)).navCheck };
}

export default async function Page({ params }: P) {
  return <CheckPage lang={await translated(params)} />;
}
