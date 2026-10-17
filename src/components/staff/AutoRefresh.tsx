'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement;

/**
 * Keeps a page current without anyone pressing reload: re-fetches every few seconds while the tab is visible and nobody is
 * typing, and shows how many tips await a reply in the browser tab title, so a reviewer can work in another window.
 */
export function AutoRefresh({ seconds = 20, badge = 0 }: { seconds?: number; badge?: number }) {
  const router = useRouter();
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = badge ? `(${badge}) ${base}` : base;
  }); // every render: a refresh can reset the title
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible' && !typing()) router.refresh(); };
    const id = setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [router, seconds]);
  return null;
}
