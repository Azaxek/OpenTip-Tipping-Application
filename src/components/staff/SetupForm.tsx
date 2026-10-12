'use client';
import { startTransition, useActionState, useEffect, useState } from 'react';
import { setupAction } from '@/app/setup/actions';

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, undefined);
  const [type, setType] = useState('campus');
  const [tz, setTz] = useState('');
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || ''), []); // the browser knows where the person is; Settings can change it later
  return (
    <form
      // Submitting through startTransition (instead of the form's action prop) stops React from clearing every field when the server reports a problem.
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}
      className="card space-y-5"
    >
      <div>
        <label className="label" htmlFor="setupToken">Setup token</label>
        <input id="setupToken" name="setupToken" type="password" className="input" required autoComplete="off" />
        <p className="hint">The SETUP_TOKEN value you set in your hosting environment variables. It stops strangers from claiming a new deployment.</p>
      </div>

      <input type="hidden" name="timezone" value={tz} />
      <fieldset className="space-y-2">
        <legend className="label">What kind of program is this?</legend>
        {[['campus', 'School or district', 'Campus categories: bullying, threats, self-harm, abuse, and more. Teams for counseling, SRO and administration.'], ['crime_stoppers', 'Crime Stoppers / community', 'Crime categories: theft, assault, drugs, fraud, and more.']].map(([v, t, d]) => (
          <label key={v} className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3">
            <input type="radio" name="orgType" value={v} checked={type === v} onChange={() => setType(v)} className="mt-1 size-5" />
            <span><span className="font-semibold">{t}</span><span className="block text-sm text-slate-600">{d}</span></span>
          </label>
        ))}
        <p className="hint">These are starting points. Every category, team and location stays editable afterwards.</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label" htmlFor="name">Organization name</label><input id="name" name="name" className="input" required maxLength={120} /></div>
        <div><label className="label" htmlFor="hotline">Hotline (optional)</label><input id="hotline" name="hotline" className="input" maxLength={40} placeholder="555-0100" /></div>
        <div><label className="label" htmlFor="primaryColor">Brand color</label><input id="primaryColor" name="primaryColor" type="color" defaultValue="#1d4ed8" className="input h-11 p-1" /></div>
        <div><label className="label" htmlFor="locationName">First location</label><input id="locationName" name="locationName" className="input" placeholder={type === 'campus' ? 'Main Campus' : 'All Areas'} /></div>
        <div><label className="label" htmlFor="maxRewardDollars">Max reward (USD, 0 = none)</label><input id="maxRewardDollars" name="maxRewardDollars" type="number" min="0" step="1" defaultValue="0" className="input" /></div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="retentionDays">Delete tips after this many idle days</label>
          <input id="retentionDays" name="retentionDays" type="number" min="1" max="3650" defaultValue="365" className="input" />
          <p className="hint">Enforced daily, including uploaded files. Shown to tipsters in the privacy notice.</p>
        </div>
      </div>

      <fieldset className="space-y-3 rounded-lg bg-slate-50 p-4">
        <legend className="label">Your administrator account</legend>
        <div><label className="label" htmlFor="adminName">Your name</label><input id="adminName" name="adminName" className="input" required maxLength={120} /></div>
        <div><label className="label" htmlFor="adminEmail">Email</label><input id="adminEmail" name="adminEmail" type="email" className="input" required /></div>
        <div><label className="label" htmlFor="adminPassword">Password (10+ characters)</label><input id="adminPassword" name="adminPassword" type="password" className="input" required minLength={10} autoComplete="new-password" /></div>
      </fieldset>

      {state?.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? 'Setting up…' : 'Create my tip line'}</button>
    </form>
  );
}
