import { SubmitPage } from '@/components/pages/SubmitPage';
import { getMessages } from '@/lib/i18n';
import { translated } from '@/lib/i18n/route';

type P = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: P) {
  return { title: getMessages(await translated(params)).navSubmit };
}

export default async function Page({ params, searchParams }: P & { searchParams: Promise<{ case?: string }> }) {
  return <SubmitPage lang={await translated(params)} caseId={(await searchParams).case} />;
}
