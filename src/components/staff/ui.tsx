import type { ReactNode } from 'react';
import { LocalTime } from './LocalTime';
import { Toast } from './Toast';

export const STATUS_LABEL: Record<string, string> = { new: 'New', under_review: 'Under review', actioned: 'Actioned', closed: 'Closed' };
const TONE: Record<string, string> = { new: 'bg-blue-100 text-blue-900', under_review: 'bg-amber-100 text-amber-900', actioned: 'bg-green-100 text-green-900', closed: 'bg-slate-200 text-slate-800' };

export const StatusBadge = ({ status }: { status: string }) => <span className={`badge ${TONE[status] ?? TONE.closed}`}>{STATUS_LABEL[status] ?? status}</span>;

export const PageTitle = ({ children }: { children: ReactNode }) => <h1 className="mb-4 text-2xl font-extrabold">{children}</h1>;

export const UrgentBadge = () => <span className="badge bg-red-700 text-white">URGENT</span>;

/** Red/green banners driven by ?e= and ?ok= so server actions can report problems without crashing. */
export function Flash({ e, ok }: { e?: string; ok?: string }) {
  return (
    <>
      {e && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{e}</p>}
      {ok && <Toast>{ok}</Toast>}
    </>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2 className="mb-3 font-bold">{title}</h2>}
      {children}
    </section>
  );
}

/** "12m", "5h", "3d" */
export function dur(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
}

/** How long staff have owed this tip a reply, turning red once past the organization's response target. */
export function Waiting({ since, targetHours }: { since: Date | string; targetHours: number }) {
  const h = (Date.now() - new Date(since).getTime()) / 3_600_000;
  const over = h > targetHours;
  return <span className={`badge ${over ? 'bg-red-100 text-red-900' : 'bg-indigo-100 text-indigo-900'}`} title={`Reply target: ${targetHours}h`}>{over ? 'Overdue · ' : 'Awaiting reply · '}{dur(h)}</span>;
}

/** A date and time in the reader's own time zone (see LocalTime). */
export const when = (d: Date | string) => <LocalTime iso={new Date(d).toISOString()} />;

export function ago(d: Date | string) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
