import Link from 'next/link';
import { gettingStarted } from '@/lib/onboarding';
import type { Staff } from '@/lib/staff';
import { Dismissable } from './Dismissable';

/** Progress card for administrators. Disappears by itself once every step is done, and can be hidden earlier. */
export async function GettingStarted({ staff }: { staff: Staff }) {
  if (staff.role !== 'admin') return null;
  const { steps, done } = await gettingStarted(staff);
  if (done === steps.length) return null;
  return (
    <Dismissable id="getting-started" label="Hide this checklist">
      <section className="card border-blue-200 bg-blue-50/50" aria-labelledby="gs-h" data-testid="getting-started">
        <h2 id="gs-h" className="pr-8 text-lg font-bold">Getting started <span className="font-normal text-slate-700">· {done} of {steps.length} done</span></h2>
        <progress className="my-2 h-2 w-full" max={steps.length} value={done} aria-label="Setup progress" />
        <ol className="space-y-2">
          {steps.map((x) => (
            <li key={x.id} className="flex gap-3">
              <span aria-hidden className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-xs font-bold ${x.done ? 'border-green-700 bg-green-700 text-white' : 'border-slate-400 bg-white'}`}>{x.done ? '✓' : ''}</span>
              <span className={x.done ? 'text-slate-600' : ''}>
                <Link href={x.href} className={`font-semibold ${x.done ? 'text-slate-600 line-through' : 'link'}`}>{x.title}</Link>
                <span className="sr-only">{x.done ? ' (done)' : ' (not done yet)'}</span>
                {!x.done && <span className="block text-sm text-slate-700">{x.why}</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-700">Ticks come from what the system has recorded, not from a button. New to this? Read <Link href="/staff/help" className="link">Help</Link>.</p>
      </section>
    </Dismissable>
  );
}
