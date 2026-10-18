import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getOrg } from '@/lib/org';
import { readiness } from '@/lib/readiness';
import { requireStaff } from '@/lib/session';
import { logoutAction } from '../actions';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const s = await requireStaff();
  const org = await getOrg();
  if (!org) redirect('/setup');
  const admin = s.role === 'admin';
  const problems = admin ? readiness().filter((c) => !c.ok && c.critical) : [];
  const nav: [string, string, boolean][] = [
    ['/staff', 'Queue', true],
    ['/staff/rewards', 'Rewards', true],
    ['/staff/bulletins', 'Bulletins', admin],
    ['/staff/analytics', 'Analytics', admin],
    ['/staff/materials', 'Materials', admin],
    ['/staff/settings', 'Settings', admin],
    ['/staff/audit', 'Audit log', admin],
  ];
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2 focus:shadow">Skip to content</a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/staff" className="font-bold" style={{ color: 'var(--brand)' }}>{org.name} · Console</Link>
          <nav className="flex flex-wrap gap-4 text-sm" aria-label="Console">
            {nav.filter((n) => n[2]).map(([href, label]) => <Link key={href} href={href} className="link no-underline">{label}</Link>)}
          </nav>
          <form action={logoutAction} className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/staff/account" className="link">{s.name}{admin ? ' (admin)' : ''}</Link>
            <button className="btn !min-h-9 !py-1">Sign out</button>
          </form>
        </div>
      </header>
      {problems.length > 0 && (
        <div className="bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-950" role="alert">
          Setup needs attention: {problems.map((p) => p.label).join('; ')}. <Link href="/staff/settings" className="link">See details</Link>
        </div>
      )}
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl p-4 outline-none">{children}</main>
    </div>
  );
}
