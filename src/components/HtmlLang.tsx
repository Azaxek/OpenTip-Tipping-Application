'use client';
import { useEffect } from 'react';

/** Sets <html lang> for this page and restores it when the visitor leaves (a client-side navigation keeps the same <html>). */
export function HtmlLang({ lang }: { lang: string }) {
  useEffect(() => {
    const before = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = before; };
  }, [lang]);
  return null;
}
