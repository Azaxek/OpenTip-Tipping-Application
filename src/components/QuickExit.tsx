'use client';
import { useEffect } from 'react';

const SAFE_SITE = 'https://www.weather.com/';

function leave() {
  try { sessionStorage.clear(); } catch {}
  // replace(), not assign(): the Back button must not return to the tip line.
  window.location.replace(SAFE_SITE);
}

/**
 * For anyone who is not alone (abuse, coercion, a monitored device): one tap, or Esc twice, wipes this tab's saved
 * draft and session and jumps to a harmless site with no history entry back. Nothing is loaded until it is used.
 */
export function QuickExit({ label = 'Quick exit', title = 'Clears this tab and opens a weather site. You can also press Esc twice.' }: { label?: string; title?: string }) {
  useEffect(() => {
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (Date.now() - last < 900) leave();
      last = Date.now();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <button type="button" onClick={leave} className="btn !min-h-11 !border-slate-400 !bg-slate-100 text-xs" title={title}>
      {label}
    </button>
  );
}
