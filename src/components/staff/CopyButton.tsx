'use client';
import { useState } from 'react';

/** Copies text to the clipboard. If the browser refuses (an insecure page, a locked-down device) it says so instead of pretending. */
export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 3000);
  };
  return (
    <>
      <button type="button" className="btn !min-h-9 text-sm" onClick={copy}>Copy text</button>
      <span role="status" className="ml-3 text-sm text-slate-700">{state === 'done' ? 'Copied.' : state === 'failed' ? 'Your browser would not allow that. Select the text and copy it.' : ''}</span>
    </>
  );
}
