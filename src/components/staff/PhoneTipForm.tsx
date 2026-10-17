'use client';
import Link from 'next/link';
import { startTransition, useActionState, useState } from 'react';
import { logPhoneTipAction } from '@/app/staff/actions';

type Opt = { id: string; name: string; description?: string; high_risk?: boolean };

export function PhoneTipForm({ categories, locations, checkUrl }: { categories: Opt[]; locations: Opt[]; checkUrl: string }) {
  const [state, action, pending] = useActionState(logPhoneTipAction, undefined);
  const [copied, setCopied] = useState(false);

  if (state?.tipId) {
    const text = `TIP ID: ${state.tipId}\nPasscode: ${state.passcode}\nCheck on your tip at: ${checkUrl}`;
    return (
      <div className="card space-y-4 border-2 border-green-600">
        <h2 className="text-xl font-extrabold text-green-900">Tip saved. Give the caller these two things now.</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-4"><dt className="text-xs font-semibold uppercase text-slate-600">TIP ID</dt><dd className="select-all font-mono text-2xl font-bold" data-testid="phone-tip-id">{state.tipId}</dd></div>
          <div className="rounded-lg bg-slate-50 p-4"><dt className="text-xs font-semibold uppercase text-slate-600">Passcode</dt><dd className="select-all font-mono text-2xl font-bold" data-testid="phone-passcode">{state.passcode}</dd></div>
        </dl>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
          <li>Read both out slowly and ask the caller to write them down. <strong>This passcode is shown only once</strong> and cannot be recovered.</li>
          <li>Tell them they can check for replies, add details or ask about a reward at <strong>{checkUrl}</strong>, without ever giving a name.</li>
          <li>Do not write the caller&apos;s name or number anywhere in the tip unless they chose to include it.</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy to clipboard'}</button>
          <Link href="/staff/tips/new" className="btn" onClick={() => setCopied(false)} prefetch={false}>Log another</Link>
          <Link href="/staff" className="btn btn-primary">Back to the queue</Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}
      className="card space-y-4"
    >
      <div>
        <label className="label" htmlFor="cat">What is it about?</label>
        <select id="cat" name="categoryId" required defaultValue="" className="input">
          <option value="" disabled>Choose a category…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.high_risk ? ' (high-risk)' : ''}</option>)}
        </select>
      </div>
      {locations.length > 1 && (
        <div>
          <label className="label" htmlFor="loc">Where? (optional)</label>
          <select id="loc" name="locationId" defaultValue="" className="input"><option value="">Not sure / not applicable</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </div>
      )}
      <div>
        <label className="label" htmlFor="desc">What did the caller say?</label>
        <textarea id="desc" name="description" required maxLength={5000} rows={7} className="input" placeholder="Who, what, where, when. Include vehicle, plate, description, anything they could see." />
        <p className="hint">Write what they know, in their words. Leave out the caller&apos;s own name, number and anything else that could identify them.</p>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="urgent" className="mt-0.5 size-5" /><span><strong>Urgent:</strong> someone may be in danger right now. (Make sure the caller has already contacted 911 if so.)</span></label>
      {state?.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{state.error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save tip and get the caller’s TIP ID'}</button>
    </form>
  );
}
