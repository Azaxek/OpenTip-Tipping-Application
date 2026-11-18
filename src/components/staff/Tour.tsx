'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TourStep } from '@/lib/tour';

const SEEN = 'ot-tour-seen';
// A preference on this device, like Dismissable. If storage is blocked, never nag: the Tour button still works.
const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch {} };

type Box = { top: number; left: number; width: number; height: number };
const anchor = (t: string | null) => (t ? document.querySelector<HTMLElement>(`[data-tour="${t}"]`) : null);
const PAD = 6; // breathing room around the highlighted element
const GAP = 12;

/**
 * Guided tour of the console. Not a library: it highlights an element with a box-shadow, puts a card next to it, and walks the
 * steps whose anchor exists on the page (so a reviewer never sees the admin steps). A transparent layer swallows clicks while it
 * runs, so a stray click cannot navigate away mid-tour. Keys: Esc stops, arrows move, Tab stays inside the card.
 */
export function Tour({ steps }: { steps: TourStep[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const wanted = useSearchParams().get('tour') === '1';
  const [mode, setMode] = useState<'idle' | 'invite' | 'running'>('idle');
  const [live, setLive] = useState<TourStep[]>([]);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: 352, h: 220 });
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const step = live[i];

  const start = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLive(steps.filter((s) => !s.target || anchor(s.target)));
    setI(0);
    setMode('running');
  }, [steps]);

  const stop = useCallback(() => {
    markSeen();
    setMode('idle');
    opener.current?.focus();
  }, []);

  // Started from another page (Help links to /staff?tour=1): drop the parameter, then wait a frame so the new page is in the DOM.
  useEffect(() => {
    if (!wanted) return;
    router.replace(pathname);
    const frame = requestAnimationFrame(start);
    return () => cancelAnimationFrame(frame);
  }, [wanted, pathname, router, start]);

  // First visit to the queue: offer, never force.
  useEffect(() => {
    if (pathname === '/staff' && !wanted && !seen()) setMode((m) => (m === 'idle' ? 'invite' : m));
    else setMode((m) => (m === 'invite' ? 'idle' : m));
  }, [pathname, wanted]);

  useLayoutEffect(() => {
    if (mode !== 'running' || !step) return;
    const place = () => {
      const r = anchor(step.target)?.getBoundingClientRect();
      setBox(r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    };
    anchor(step.target)?.scrollIntoView({ block: 'center' }); // instant: no animation to wait for or to bother anyone
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [mode, step]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: measure and focus the card again whenever the step changes
  useLayoutEffect(() => {
    if (mode !== 'running' || !card.current) return;
    setSize({ w: card.current.offsetWidth, h: card.current.offsetHeight });
    card.current.focus(); // a screen reader reads the title and text of the focused dialog
  }, [mode, i]);

  // On the window, not the card, so Esc still works after a click on the dimmed page moved focus away.
  useEffect(() => {
    if (mode !== 'running') return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); stop(); }
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, live.length - 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
      else if (e.key === 'Tab' && card.current) {
        const items = [...card.current.querySelectorAll<HTMLElement>('button:not(:disabled)')];
        const at = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        items[e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, live.length, stop]);

  const go = (n: number) => (n >= live.length ? stop() : setI(Math.max(n, 0)));

  const launcher = (
    <button type="button" className="link py-1 no-underline" onClick={() => (pathname === '/staff' ? start() : router.push('/staff?tour=1'))}>
      Tour
    </button>
  );

  if (mode === 'invite') {
    return (
      <>
        {launcher}
        <section aria-label="Tour invitation" className="fixed inset-x-3 bottom-3 z-40 rounded-xl border border-slate-300 bg-white p-4 shadow-lg sm:left-auto sm:max-w-xs">
          <p className="text-sm font-semibold">New here? Take a one-minute tour of the queue.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-primary !min-h-9 text-sm" onClick={start}>Show me</button>
            <button type="button" className="btn !min-h-9 text-sm" onClick={() => { markSeen(); setMode('idle'); }}>No thanks</button>
          </div>
        </section>
      </>
    );
  }
  if (mode !== 'running' || !step) return launcher;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let place: CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }; // welcome card
  if (box) {
    const below = box.top + box.height + PAD + GAP;
    const above = box.top - PAD - GAP - size.h;
    const left = Math.min(Math.max(box.left, GAP), Math.max(GAP, vw - size.w - GAP));
    if (vw >= 640 && below + size.h <= vh - GAP) place = { top: below, left };
    else if (vw >= 640 && above >= GAP) place = { top: above, left };
    else place = { left: GAP, right: GAP, bottom: GAP }; // phones, or a target too big to sit beside: dock at the bottom
  }

  return (
    <>
      {launcher}
      <div className="fixed inset-0 z-[60]" aria-hidden /> {/* swallows clicks while the tour runs */}
      {box ? (
        <div aria-hidden className="pointer-events-none fixed z-[61] rounded-lg ring-2 ring-white"
          style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2, boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.62)' }} />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[61] bg-slate-900/60" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="fixed z-[62] w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl bg-white p-4 shadow-2xl outline-none"
        style={{ ...place, ...(place.left === GAP && place.right === GAP ? { width: 'auto', maxWidth: 'none' } : {}) }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Step {i + 1} of {live.length}</p>
        <h2 id="tour-title" className="mt-1 text-lg font-bold">{step.title}</h2>
        <p id="tour-body" className="mt-1 text-sm text-slate-800">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" className="btn !min-h-9 text-sm" disabled={i === 0} onClick={() => go(i - 1)}>Back</button>
          <button type="button" className="btn btn-primary !min-h-9 text-sm" onClick={() => go(i + 1)}>{i === live.length - 1 ? 'Done' : 'Next'}</button>
          <button type="button" className="link ml-auto text-sm" onClick={stop}>Skip tour</button>
        </div>
      </div>
    </>
  );
}
