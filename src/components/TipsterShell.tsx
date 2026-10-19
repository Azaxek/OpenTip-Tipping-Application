import Link from 'next/link';
import type { ReactNode } from 'react';
import { withOrg } from '@/lib/db';
import { getMessages, localHref, type Lang } from '@/lib/i18n';
import type { Org } from '@/lib/org';
import { QuickExit } from './QuickExit';

/** Chrome for tipster-facing pages. Deliberately free of analytics, trackers and third-party scripts. `path` is this page's own address (e.g. "/submit"), used for the language switch. */
export async function TipsterShell({ org, lang = 'en', path = '/', children }: { org: Org; lang?: Lang; path?: string; children: ReactNode }) {
  const m = getMessages(lang);
  const other: Lang = lang === 'en' ? 'es' : 'en';
  const hasWanted = (await withOrg(org.id, (q) => q<{ x: number }>('select 1 as x from bulletins where active limit 1')).catch(() => [])).length > 0;
  return (
    <div lang={lang} className="mx-auto flex min-h-screen max-w-2xl flex-col px-4">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2 focus:shadow">{m.skipToContent}</a>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
        <Link href={localHref(lang, '/')} className="inline-flex min-h-11 items-center text-lg font-bold" style={{ color: 'var(--brand)' }}>
          {org.name}
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label={m.navMain}>
          <Link href={localHref(lang, '/submit')} className="link inline-flex min-h-11 items-center px-2">{m.navSubmit}</Link>
          <Link href={localHref(lang, '/check')} className="link inline-flex min-h-11 items-center px-2">{m.navCheck}</Link>
          {hasWanted && <Link href={localHref(lang, '/wanted')} className="link inline-flex min-h-11 items-center px-2">{m.navWanted}</Link>}
          <Link href={localHref(other, path)} lang={other} hrefLang={other} className="link inline-flex min-h-11 items-center px-2">{m.otherLangLabel}</Link>
          <QuickExit label={m.quickExit} title={m.quickExitTitle} />
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 pb-10 outline-none">{children}</main>
      <footer className="border-t border-slate-200 py-4 text-xs text-slate-600">
        <Link href={localHref(lang, '/privacy')} className="link inline-flex min-h-11 items-center">{m.footerPrivacy}</Link>
        <span className="mx-2">·</span>
        {m.footerTagline}
      </footer>
    </div>
  );
}
