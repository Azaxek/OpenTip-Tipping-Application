import type { ReactNode } from 'react';
import { HtmlLang } from '@/components/HtmlLang';
import { isLang } from '@/lib/i18n';

/**
 * The page content already declares its language (TipsterShell). The <html> element comes from the root layout shared with the English
 * pages, so this sets it too once the page runs: the tab title, the browser's "translate this page?" prompt and spell-check follow it.
 */
export default async function LangLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return (
    <>
      <HtmlLang lang={isLang(lang) ? lang : 'en'} />
      {children}
    </>
  );
}
