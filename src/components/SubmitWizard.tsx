'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadTipCard } from '@/lib/card';
import { downscalePhoto } from '@/lib/client-image';
import { checkEvidence, mimeOf, type EvidenceLimits } from '@/lib/evidence-check';
import { fmt, localHref, type Lang, type Messages } from '@/lib/i18n';
import { newPassphrase } from '@/lib/passphrase';
import { EmergencyBanner } from './EmergencyBanner';
import { PushOptIn } from './PushOptIn';
import { useTurnstile } from './Turnstile';

type Cat = { id: string; name: string; description: string; high_risk: boolean };
type Loc = { id: string; name: string };
type Result = { tipId: string; token: string; passcode: string; attachments: { stored: number; failed: number } };

const DRAFT = 'ot_draft';

class SendError extends Error {}

export function SubmitWizard(props: {
  lang: Lang; m: Messages; orgName: string; hotline: string | null; note?: string; helpText?: string; categories: Cat[]; locations: Loc[]; limits: EvidenceLimits;
  accept: string; siteKey?: string; vapidKey?: string; bulletin?: { id: string; title: string; caseNumber: string | null } | null;
}) {
  const { categories, locations, limits, m, lang, bulletin } = props;

  /** Every network call goes through here so failures read the same way in either language. */
  async function post(path: string, body: unknown) {
    let r: Response;
    try {
      r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new SendError(m.errOffline);
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new SendError(r.status === 429 ? m.errRate : r.status === 403 ? m.errBot : r.status === 413 ? m.errTooBig : (lang === 'en' && j.error) || m.errGeneric);
    return j;
  }

  /** Upload with progress (fetch cannot report upload progress). */
  function put(url: string, headers: Record<string, string>, file: File, onProgress: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
      x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new SendError(m.errUpload)));
      x.onerror = () => reject(new SendError(m.errOffline));
      x.send(file);
    });
  }

  // Four short screens: what, details, evidence (if the program accepts files), passcode.
  const steps = useMemo(() => ['topic', 'details', ...(limits.maxFiles > 0 ? ['evidence'] : []), 'passcode'], [limits.maxFiles]);
  const [i, setI] = useState(0);
  const [locationId, setLocationId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<'auto' | 'own'>('auto');
  const [generated, setGenerated] = useState('');
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const { ref: tsRef, getToken } = useTurnstile(props.siteKey);
  const step = steps[i];

  useEffect(() => { setGenerated(newPassphrase()); }, []); // client-only so server and browser markup agree

  // Draft lives in sessionStorage only (cleared when the tab closes) - never localStorage, since devices can be shared.
  useEffect(() => {
    try {
      const d = JSON.parse(sessionStorage.getItem(DRAFT) || '{}');
      if (d.locationId) setLocationId(d.locationId);
      if (d.categoryId) setCategoryId(d.categoryId);
      if (typeof d.urgent === 'boolean') setUrgent(d.urgent);
      if (d.description) setDescription(d.description);
      // Come back to the same screen, but never past the last content step: files and the passcode are deliberately not saved.
      const lastContent = steps.indexOf(steps.includes('evidence') ? 'evidence' : 'details');
      if (typeof d.i === 'number') setI(Math.max(0, Math.min(d.i, lastContent)));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!result) try { sessionStorage.setItem(DRAFT, JSON.stringify({ locationId, categoryId, urgent, description, i })); } catch {}
  }, [locationId, categoryId, urgent, description, i, result]);
  useEffect(() => { if (locations.length === 1) setLocationId(locations[0].id); }, [locations]);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const next = [...files];
    let msg = '';
    for (const picked of Array.from(list)) {
      const f = await downscalePhoto(picked); // big phone photos shrink first, so they fit the limits and upload quickly on cellular
      const problem = checkEvidence(f, next, limits, m);
      if (problem) msg = problem;
      else next.push(f);
    }
    setError(msg);
    setFiles(next);
  }

  // Keyboard and screen-reader users: move focus to the new step so it is announced.
  const stepRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    stepRef.current?.focus();
  }, [i]);

  const [pct, setPct] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  function canAdvance(): string {
    if (step === 'topic' && !categoryId) return m.errCategory;
    // Catch an empty tip on the last content step, not after the passcode has been chosen.
    const lastContentStep = steps.includes('evidence') ? 'evidence' : 'details';
    if (step === lastContentStep && !description.trim() && files.length === 0) return steps.includes('evidence') ? m.errEmpty : m.errEmptyNoEvidence;
    return '';
  }

  async function submit() {
    setError('');
    const code = mode === 'auto' ? generated : passcode;
    if (!description.trim() && files.length === 0) return setError(m.errEmpty);
    if (code.length < 6) return setError(m.errPassShort);
    if (mode === 'own' && code !== confirm) return setError(m.errPassMismatch);
    try {
      let attachmentKeys: string[] = [];
      if (files.length) {
        setBusy(m.preparing);
        const init = await post('/api/upload/init', { files: files.map((f) => ({ mime: mimeOf(f), size: f.size })), turnstileToken: await getToken() });
        for (const [n, u] of (init.uploads as { key: string; url: string; headers: Record<string, string> }[]).entries()) {
          setBusy(fmt(m.uploadingFile, { n: n + 1, total: files.length }));
          setPct(0);
          await put(u.url, u.headers, files[n], setPct);
        }
        setPct(null);
        attachmentKeys = init.uploads.map((u: { key: string }) => u.key);
      }
      setBusy(m.submitting);
      const out = await post('/api/tips', { categoryId, locationId: locationId || null, urgent, description, passcode: code, attachmentKeys, bulletinId: bulletin?.id ?? null, turnstileToken: await getToken() });
      try { sessionStorage.setItem('ot_token', out.token); sessionStorage.removeItem(DRAFT); } catch {}
      setResult({ ...out, passcode: code });
    } catch (e) {
      setError(e instanceof SendError ? e.message : m.errGeneric);
    } finally {
      setBusy('');
      setPct(null);
    }
  }

  if (result) return <Receipt r={result} lang={lang} m={m} orgName={props.orgName} vapidKey={props.vapidKey} note={props.note} helpText={props.helpText} />;

  const selected = categories.find((c) => c.id === categoryId);
  return (
    <div className="space-y-4">
      <EmergencyBanner lang={lang} />
      <form
        noValidate // we show our own clear messages (announced to screen readers) instead of the browser's disappearing bubbles
        className="card space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const problem = canAdvance();
          if (problem) return setError(problem);
          setError('');
          if (i < steps.length - 1) setI(i + 1);
          else submit();
        }}
      >
        <h1 className="sr-only">{m.wizardH1}</h1>
        <div ref={stepRef} tabIndex={-1} role="group" aria-label={fmt(m.stepOf, { i: i + 1, n: steps.length })} className="space-y-5 outline-none">
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold text-slate-600" aria-live="polite">{fmt(m.stepOf, { i: i + 1, n: steps.length })}</p>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200" aria-hidden><div className="h-full rounded-full transition-all" style={{ width: `${((i + 1) / steps.length) * 100}%`, background: 'var(--brand)' }} /></div>
          </div>
          {bulletin && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm font-semibold text-sky-950" data-testid="case-banner">
              {fmt(m.caseBanner, { title: bulletin.title })}{bulletin.caseNumber ? ` (${fmt(m.caseNumber, { n: bulletin.caseNumber })})` : ''}
            </p>
          )}

          {step === 'topic' && (
            <>
              <fieldset className="space-y-2">
                <legend className="label text-xl">{m.qCategory}</legend>
                {categories.map((c) => (
                  <label key={c.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${categoryId === c.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
                    <input type="radio" name="category" className="mt-1 size-5" checked={categoryId === c.id} onChange={() => setCategoryId(c.id)} />
                    <span><span className="font-semibold">{c.name}</span><span className="block text-sm text-slate-600">{c.description}</span></span>
                  </label>
                ))}
              </fieldset>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <input type="checkbox" name="urgent" className="mt-1 size-5" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
                  <span className="font-semibold">{m.urgentLabel}</span>
                </label>
                {urgent && <EmergencyBanner strong lang={lang} />}
                <p className="hint">{m.urgentHint}</p>
              </div>
            </>
          )}

          {step === 'details' && (
            <div className="space-y-4">
              {locations.length > 1 && (
                <div>
                  <label className="label text-xl" htmlFor="loc">{m.qWhere}</label>
                  <select id="loc" className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">{m.locNotSure}</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label text-xl" htmlFor="desc">{selected ? fmt(m.qDetailsAbout, { topic: selected.name.toLowerCase() }) : m.qDetails}</label>
                <textarea id="desc" className="input min-h-48" maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={m.descPlaceholder} />
                <p className="hint">{description.length.toLocaleString()} / 5,000 · {m.descAnon}</p>
              </div>
            </div>
          )}

          {step === 'evidence' && (
            <div className="space-y-3">
              <p className="label text-xl">{m.evidenceTitle}</p>
              <p className="hint">{fmt(m.evidenceHint, { max: limits.maxFiles, img: limits.imageMb, doc: limits.docMb, av: limits.avMb, tip: limits.tipMb })}</p>
              <label
                data-dropzone
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
                className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-slate-900 ${dragging ? 'border-slate-900 bg-slate-100' : 'border-slate-300'}`}
              >
                <span className="font-semibold">{m.dropTitle}</span>
                <span className="text-sm text-slate-600">{m.dropSub}</span>
                <input aria-label={m.chooseFiles} type="file" multiple accept={props.accept} className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </label>
              <p className="hint">{m.photoShrunk}</p>
              <ul className="space-y-2">
                {files.map((f, n) => {
                  const mt = mimeOf(f);
                  return (
                    <li key={previews[n]} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
                      {mt.startsWith('image/') && /* eslint-disable-next-line @next/next/no-img-element */ <img src={previews[n]} alt={m.previewAlt} className="size-16 rounded object-cover" />}
                      {mt.startsWith('video/') && <video src={previews[n]} className="size-16 rounded object-cover" muted />}
                      {mt.startsWith('audio/') && <audio src={previews[n]} controls className="h-10 w-48" />}
                      {mt === 'application/pdf' && <span className="grid size-16 place-items-center rounded bg-slate-100 text-xs font-bold">PDF</span>}
                      <span className="flex-1 text-sm">{(f.size / 1048576).toFixed(1)} MB</span>
                      <button type="button" className="btn" onClick={() => setFiles(files.filter((_, k) => k !== n))}>{m.remove}</button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {step === 'passcode' && (
            <div className="space-y-4">
              <p className="label text-xl">{m.passTitle}</p>
              <p className="hint">{m.passIntro}</p>
              <fieldset className="space-y-2">
                <legend className="sr-only">{m.passTitle}</legend>
                {([['auto', m.passAuto], ['own', m.passOwn]] as const).map(([v, label]) => (
                  <label key={v} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${mode === v ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
                    <input type="radio" name="passmode" className="size-5" checked={mode === v} onChange={() => setMode(v)} />
                    <span className="font-semibold">{label}</span>
                  </label>
                ))}
              </fieldset>
              {mode === 'auto' ? (
                <div className="space-y-2 rounded-lg border-2 border-amber-500 bg-amber-50 p-4">
                  <p className="text-sm font-semibold">{m.passYours}</p>
                  <p className="break-all font-mono text-2xl font-bold" data-testid="generated-passcode">{generated}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(generated).then(() => setCopied(true))}>{copied ? m.passCopied : m.passCopy}</button>
                    <button type="button" className="btn" onClick={() => { setGenerated(newPassphrase()); setCopied(false); }}>{m.passAnother}</button>
                  </div>
                  <p className="hint">{m.passSaveHint}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="label" htmlFor="pc">{m.passLabel}</label>
                    <input id="pc" className="input" type={showPass ? 'text' : 'password'} autoComplete="off" minLength={6} maxLength={128} value={passcode} onChange={(e) => setPasscode(e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="pc2">{m.passAgain}</label>
                    <input id="pc2" className="input" type={showPass ? 'text' : 'password'} autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={showPass} onChange={(e) => setShowPass(e.target.checked)} /> {m.showPass}</label>
                </div>
              )}
            </div>
          )}
        </div>

        <div ref={tsRef} />
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
        {busy && (
          <div role="status" className="space-y-1 text-sm font-semibold text-slate-700">
            <p>{busy}{pct !== null ? ` ${pct}%` : ''}</p>
            {pct !== null && <progress className="h-2 w-full" max={100} value={pct} aria-label={m.uploadProgress} />}
          </div>
        )}

        <div className="flex gap-3">
          {i > 0 && <button type="button" className="btn" disabled={!!busy} onClick={() => { setError(''); setI(i - 1); }}>{m.back}</button>}
          <button type="submit" className="btn btn-primary flex-1" disabled={!!busy}>{i < steps.length - 1 ? m.next : m.submit}</button>
        </div>
      </form>
    </div>
  );
}

function Receipt({ r, lang, m, orgName, vapidKey, note, helpText }: { r: Result; lang: Lang; m: Messages; orgName: string; vapidKey?: string; note?: string; helpText?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card space-y-4">
      <h1 className="text-2xl font-extrabold">{m.receiptTitle}</h1>
      <div className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4">
        <p className="font-bold text-amber-900">{m.receiptSave}</p>
        <dl className="mt-3 space-y-2">
          <div><dt className="text-sm font-semibold">{m.tipIdLabel}</dt><dd className="font-mono text-3xl font-bold tracking-wider" data-testid="tip-id">{r.tipId}</dd></div>
          <div><dt className="text-sm font-semibold">{m.passcodeLabel}</dt><dd className="break-all font-mono text-xl font-bold" data-testid="receipt-passcode">{r.passcode}</dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => navigator.clipboard?.writeText(`${m.tipIdLabel}: ${r.tipId}\n${m.passcodeLabel}: ${r.passcode}`).then(() => setCopied(true))}>{copied ? m.copied : m.copy}</button>
          <button className="btn" onClick={() => downloadTipCard(orgName, r.tipId, m)}>{m.downloadCard}</button>
        </div>
        <p className="hint">{m.cardHint}</p>
      </div>
      {r.attachments.failed > 0 && <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{fmt(m.attachFailed, { n: r.attachments.failed })}</p>}
      <section className="rounded-lg bg-slate-50 p-3 text-sm" aria-labelledby="next-h">
        <h2 id="next-h" className="font-bold">{m.nextTitle}</h2>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>{m.next1}</li><li>{m.next2}</li><li>{m.next3}</li>
        </ol>
        {note && <p className="mt-2 border-t border-slate-200 pt-2 text-slate-700">{note}</p>}
      </section>
      {helpText && (
        <section className="rounded-lg border border-blue-200 bg-blue-50 p-3" aria-labelledby="help-r">
          <h2 id="help-r" className="font-bold text-blue-950">{m.helpTitle}</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-blue-950">{helpText}</p>
        </section>
      )}
      <PushOptIn vapidKey={vapidKey} token={r.token} m={m} />
      <div className="flex flex-wrap gap-3">
        <Link href={localHref(lang, '/check')} className="btn btn-primary">{m.openTip}</Link>
        <Link href={localHref(lang, '/')} className="btn">{m.done}</Link>
      </div>
    </div>
  );
}
