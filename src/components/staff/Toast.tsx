'use client';
import { useEffect, useState, type ReactNode } from 'react';

/** A green confirmation that clears itself after a few seconds and removes ?ok= from the address, so reloading does not repeat it. */
export function Toast({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const u = new URL(location.href);
    if (u.searchParams.has('ok')) { u.searchParams.delete('ok'); history.replaceState(history.state, '', u); }
    const t = setTimeout(() => setShown(false), 9000);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <p role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-900">
      <span>{children}</span>
      <button type="button" onClick={() => setShown(false)} className="-m-1 min-h-8 min-w-8 rounded text-green-900 hover:bg-green-100" aria-label="Dismiss">✕</button>
    </p>
  );
}
