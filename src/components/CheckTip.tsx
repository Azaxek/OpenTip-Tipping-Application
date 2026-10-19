'use client';
import { useEffect, useState } from 'react';
import { fmt, type Lang, type Messages } from '@/lib/i18n';
import { PushOptIn } from './PushOptIn';
import { useTurnstile } from './Turnstile';

type Status = { status: 'new' | 'under_review' | 'actioned' | 'closed'; created_at: string; category: string; reward_eligible: boolean; reward_amount_cents: number | null; claim_code_shown: boolean; claimed: boolean; note?: string; resources?: string };
type Msg = { seq: string; sender: 'tipster' | 'reviewer'; body: string; created_at: string };
type Ctx = { lang: Lang; m: Messages };

const TONE = { new: 'bg-blue-100 text-blue-900', under_review: 'bg-amber-100 text-amber-900', actioned: 'bg-green-100 text-green-900', closed: 'bg-slate-200 text-slate-800' } as const;
const TOKEN = 'ot_token';
const POLL_MS = 3000;

export function CheckTip({ siteKey, vapidKey, lang, m }: { siteKey?: string; vapidKey?: string } & Ctx) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [expired, setExpired] = useState(false);
  useEffect(() => { try { setToken(sessionStorage.getItem(TOKEN)); } catch { setToken(null); } }, []);
  if (token === undefined) return null;
  if (token) {
    return <TipStatus token={token} vapidKey={vapidKey} lang={lang} m={m} onEnd={(why) => { try { sessionStorage.removeItem(TOKEN); } catch {} setExpired(why === 'expired'); setToken(null); }} />;
  }
  return <Login siteKey={siteKey} expired={expired} m={m} onToken={(t) => { try { sessionStorage.setItem(TOKEN, t); } catch {} setExpired(false); setToken(t); }} />;
}

function Login({ siteKey, onToken, expired, m }: { siteKey?: string; onToken: (t: string) => void; expired?: boolean; m: Messages }) {
  const [tipId, setTipId] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { ref, getToken } = useTurnstile(siteKey);
  return (
    <form
      className="card space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          let r: Response;
          try {
            r = await fetch('/api/tip/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipId, passcode, turnstileToken: await getToken() }) });
          } catch {
            throw new Error(m.errOffline);
          }
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(r.status === 429 ? m.errRate : r.status === 403 ? m.errBot : r.status === 401 ? m.errLogin : m.errGeneric);
          onToken(j.token);
        } catch (err) {
          setError(err instanceof Error ? err.message : m.errGeneric);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="text-2xl font-extrabold">{m.checkTitle}</h1>
      {expired && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{m.checkExpired}</p>}
      <div>
        <label className="label" htmlFor="tid">{m.tipIdLabel}</label>
        <input id="tid" className="input font-mono uppercase tracking-wider" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder={m.tipIdPlaceholder} value={tipId} onChange={(e) => setTipId(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="pc">{m.passcodeLabel}</label>
        <input id="pc" className="input" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={passcode} onChange={(e) => setPasscode(e.target.value)} required />
      </div>
      <div ref={ref} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? m.checking : m.checkBtn}</button>
      <p className="hint">{m.checkLost}</p>
    </form>
  );
}

function TipStatus({ token, vapidKey, onEnd, lang, m }: { token: string; vapidKey?: string; onEnd: (why?: 'expired') => void } & Ctx) {
  const [status, setStatus] = useState<Status | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [poke, setPoke] = useState(0);
  const auth = { Authorization: `Bearer ${token}` };
  const money = (cents: number | null) => `$${((cents ?? 0) / 100).toFixed(2)}`;
  const label = { new: m.statusNew, under_review: m.statusUnderReview, actioned: m.statusActioned, closed: m.statusClosed } as const;

  // Live chat: short polling through our own server (no third-party realtime service sees the connection).
  useEffect(() => {
    let stop = false;
    let since = 0;
    let timer: ReturnType<typeof setTimeout>;
    let first = true; // always load once, even in a background tab; later polls pause while hidden
    const tick = async () => {
      if (stop) return;
      if (first || !document.hidden) {
        first = false;
        try {
          const r = await fetch(`/api/tip/messages?since=${since}&lang=${lang}`, { headers: auth, cache: 'no-store' });
          if (r.status === 401) return onEnd('expired');
          if (r.ok && !stop) {
            const j = await r.json();
            setStatus(j.status);
            if (j.messages.length) {
              since = Math.max(since, Number(j.messages[j.messages.length - 1].seq));
              // Idempotent merge: overlapping polls (effect restarts, a send during a poll) must never duplicate a message.
              setMsgs((cur) => {
                const seen = new Set(cur.map((x) => x.seq));
                return [...cur, ...(j.messages as Msg[]).filter((x) => !seen.has(x.seq))];
              });
            }
          }
        } catch {}
      }
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    const wake = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', wake);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, poke]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setError('');
    try {
      const r = await fetch('/api/tip/messages', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }) });
      if (r.ok) { setText(''); setPoke((n) => n + 1); } // restart polling now so the reply shows immediately
      else setError(r.status === 429 ? m.errRate : (lang === 'en' && (await r.json().catch(() => ({}))).error) || m.sendFail);
    } catch {
      setError(m.errOffline);
    }
  }

  async function reveal() {
    const r = await fetch('/api/tip/claim', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json().catch(() => ({}));
    if (j.code) setCode(j.code);
    else setError(m.claimGone);
  }

  if (!status) return <p className="card text-slate-600" role="status">{m.loading}</p>;
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">{m.yourTip}</h1>
          <p className="text-sm text-slate-600">{fmt(m.submittedOn, { category: status.category, date: new Date(status.created_at).toLocaleDateString(lang) })}</p>
        </div>
        <span className={`badge text-sm ${TONE[status.status]}`} data-testid="status">{label[status.status]}</span>
      </div>

      {status.reward_eligible && (
        <div className="card border-green-300 bg-green-50">
          <h2 className="font-bold text-green-900">{m.rewardTitle}</h2>
          {status.claimed ? (
            <p className="text-sm">{m.rewardClaimed}</p>
          ) : code ? (
            <>
              <p className="text-sm">{m.claimOnce}</p>
              <p className="my-2 font-mono text-2xl font-bold tracking-wider" data-testid="claim-code">{code}</p>
              <p className="hint">{fmt(m.claimHint, { amt: money(status.reward_amount_cents) })}</p>
            </>
          ) : status.claim_code_shown ? (
            <p className="text-sm">{m.claimShown}</p>
          ) : (
            <>
              <p className="text-sm">{fmt(m.claimEligible, { amt: money(status.reward_amount_cents) })}</p>
              <button className="btn btn-primary mt-2" onClick={reveal}>{m.claimShow}</button>
            </>
          )}
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="font-bold">{m.chatTitle}</h2>
        {status.note && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{status.note}</p>}
        <div role="log" aria-live="polite" className="max-h-96 min-h-24 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
          {msgs.length === 0 && <p className="text-sm text-slate-600">{m.chatEmpty}</p>}
          {msgs.map((x) => (
            <div key={x.seq} className={`max-w-[85%] rounded-lg p-2 text-sm ${x.sender === 'tipster' ? 'ml-auto bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-200'}`}>
              <p className="whitespace-pre-wrap">{x.body}</p>
              <p className="mt-1 text-[11px] opacity-70">{x.sender === 'tipster' ? m.you : m.reviewer} · {new Date(x.created_at).toLocaleString(lang)}</p>
            </div>
          ))}
        </div>
        <form onSubmit={send} className="space-y-2">
          <label className="label" htmlFor="msg">{m.yourMessage}</label>
          <textarea id="msg" className="input min-h-20" maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
          {error && <p role="alert" className="text-sm font-semibold text-red-800">{error}</p>}
          <button className="btn btn-primary" disabled={!text.trim()}>{m.send}</button>
        </form>
      </div>

      {status.resources && (
        <section className="card border-blue-200 bg-blue-50" aria-labelledby="help-h">
          <h2 id="help-h" className="font-bold text-blue-950">{m.helpTitle}</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-blue-950">{status.resources}</p>
        </section>
      )}

      <PushOptIn vapidKey={vapidKey} token={token} m={m} />
      <button className="btn w-full" onClick={() => onEnd()}>{m.forget}</button>
    </div>
  );
}
