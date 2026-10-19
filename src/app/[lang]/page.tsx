import { HomePage } from '@/components/pages/HomePage';
import { getMessages } from '@/lib/i18n';
import { translated } from '@/lib/i18n/route';

type P = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: P) {
  return { title: getMessages(await translated(params)).homeSubmit };
}

export default async function Page({ params }: P) {
  return <HomePage lang={await translated(params)} />;
}
