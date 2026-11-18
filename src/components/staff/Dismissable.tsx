'use client';
import { useEffect, useState, type ReactNode } from 'react';

/** Content the person can hide for good on this device (a preference, so localStorage is the right place). Hidden until we know, to avoid a flash. */
export function Dismissable({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(`ot-hide-${id}`) === '1');
    } catch {
      setHidden(false); // storage blocked: just show it
    }
  }, [id]);
  if (hidden) return null;
  return (
    <div className="relative">
      {children}
      <button
        type="button"
        aria-label={label}
        title={label}
        className="absolute right-2 top-2 min-h-8 min-w-8 rounded text-slate-600 hover:bg-slate-100"
        onClick={() => {
          try { localStorage.setItem(`ot-hide-${id}`, '1'); } catch {}
          setHidden(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}
