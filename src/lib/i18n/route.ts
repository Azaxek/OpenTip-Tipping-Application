import { notFound } from 'next/navigation';
import { isLang, type Lang } from './index';

/** For the /es/... routes: the language from the address, or a 404 for anything that is not a supported non-English language. */
export async function translated(params: Promise<{ lang: string }>): Promise<Lang> {
  const { lang } = await params;
  if (!isLang(lang) || lang === 'en') notFound();
  return lang;
}
