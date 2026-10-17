'use client';
import { useState, useTransition } from 'react';
import { loginAction } from '@/app/staff/actions';
import { useTurnstile } from '../Turnstile';

export function LoginForm({ siteKey }: { siteKey?: string }) {
  const [error, setError] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [pending, start] = useTransition();
  const { ref, getToken } = useTurnstile(siteKey);
  return (
    <form
      className="card space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          setError('');
          const r = await loginAction(String(fd.get('email')), String(fd.get('password')), await getToken(), needCode ? String(fd.get('code') ?? '') : undefined);
          if (r?.needCode) setNeedCode(true);
          else if (r?.error) setError(r.error);
        });
      }}
    >
      <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" required autoComplete="username" readOnly={needCode} /></div>
      <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" className="input" required autoComplete="current-password" readOnly={needCode} /></div>
      {needCode && (
        <div>
          <label className="label" htmlFor="code">Authenticator code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} className="input text-center font-mono text-xl tracking-widest" required autoFocus />
          <p className="hint">Open your authenticator app and type the 6-digit code for this account. Lost your phone? Ask an administrator to reset your two-step sign-in.</p>
        </div>
      )}
      <div ref={ref} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? 'Signing in…' : needCode ? 'Verify and sign in' : 'Sign in'}</button>
    </form>
  );
}
