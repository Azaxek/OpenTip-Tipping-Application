'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessageAction } from '@/app/staff/actions';

type Msg = { seq: string; sender: 'tipster' | 'reviewer'; body: string; created_at: string; author: string | null };
type Canned = { id: string; title: string; body: string };

export function ChatPanel({ tipId, canned, closed }: { tipId: string; canned: Canned[]; closed: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false); // a ref, so two taps in the same instant cannot both pass
  const since = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const poll = useCallback(async (force = false) => {
    if (document.hidden && !force) return; // pause while the tab is hidden, but always load once on open
    try {
      const r = await fetch(`/staff/api/tips/${tipId}/messages?since=${since.current}`, { cache: 'no-store' });
      if (!r.ok) return;
      const list: Msg[] = await r.json();
      if (list.length) {
        since.current = Math.max(since.current, Number(list[list.length - 1].seq));
        // Idempotent merge: overlapping polls (interval + an immediate poll after sending) must never duplicate a message.
        setMsgs((m) => {
          const seen = new Set(m.map((x) => x.seq));
          return [...m, ...list.filter((x) => !seen.has(x.seq))];
        });
      }
    } catch {}
  }, [tipId]);

  useEffect(() => {
    poll(true);
    const t = setInterval(() => poll(), 3000);
    return () => clearInterval(t);
  }, [poll]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the message count is the trigger, to keep the newest message in view
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return; // a double tap must not post the reply twice
    inFlight.current = true;
    setSending(true);
    setError('');
    try {
      const r = await sendMessageAction(tipId, text);
      if (r.error) return setError(r.error);
      setText('');
      poll();
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div ref={box} role="log" aria-live="polite" className="max-h-96 min-h-24 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
        {msgs.length === 0 && <p className="text-sm text-slate-600">No messages yet.</p>}
        {msgs.map((m) => (
          <div key={m.seq} className={`max-w-[85%] rounded-lg p-2 text-sm ${m.sender === 'reviewer' ? 'ml-auto bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-300'}`}>
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className="mt-1 text-[11px] opacity-70">{m.sender === 'reviewer' ? m.author ?? 'Reviewer' : 'Tipster (anonymous)'} · {new Date(m.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="space-y-2">
        {canned.length > 0 && (
          <select className="input !py-1.5 text-sm" value="" aria-label="Insert a canned response" onChange={(e) => { const c = canned.find((x) => x.id === e.target.value); if (c) setText((t) => (t ? `${t}\n\n${c.body}` : c.body)); }}>
            <option value="">Insert canned response…</option>
            {canned.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
        <textarea className="input min-h-24" maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} placeholder={closed ? 'This tip is closed. Replying will not reopen it.' : 'Write a reply. The tipster sees it live and can answer anonymously.'} aria-label="Reply" />
        {error && <p role="alert" className="text-sm font-semibold text-red-800">{error}</p>}
        <button className="btn btn-primary" disabled={!text.trim() || sending}>{sending ? 'Sending…' : 'Send reply'}</button>
      </form>
    </div>
  );
}
