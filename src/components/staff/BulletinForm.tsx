'use client';
import { startTransition, useActionState } from 'react';
import { saveBulletinAction } from '@/app/staff/admin-actions';
import { downscalePhoto } from '@/lib/client-image';

type B = { id?: string; title?: string; body?: string; case_number?: string | null; reward_cents?: number | null; active?: boolean; has_image?: boolean };

export function BulletinForm({ b = {}, maxRewardDollars }: { b?: B; maxRewardDollars: number }) {
  const [state, action, pending] = useActionState(saveBulletinAction, undefined);
  const id = b.id ?? 'new';
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}
      className="grid gap-3 sm:grid-cols-2"
    >
      {b.id && <input type="hidden" name="id" value={b.id} />}
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`t-${id}`}>Headline</label>
        <input id={`t-${id}`} name="title" defaultValue={b.title} required maxLength={160} className="input" placeholder="Man wanted for armed robbery at Main St. market" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`b-${id}`}>Details</label>
        <textarea id={`b-${id}`} name="body" defaultValue={b.body} maxLength={3000} rows={5} className="input" placeholder="What happened, when and where, and a description. Say what you want the public to look out for." />
        <p className="hint">Public. Only include what is safe and accurate to publish; do not name private individuals who have not been charged.</p>
      </div>
      <div>
        <label className="label" htmlFor={`c-${id}`}>Case number (optional)</label>
        <input id={`c-${id}`} name="caseNumber" defaultValue={b.case_number ?? ''} maxLength={60} className="input" />
      </div>
      <div>
        <label className="label" htmlFor={`r-${id}`}>Reward (USD, optional)</label>
        <input id={`r-${id}`} name="reward" type="number" min={0} max={maxRewardDollars} step="1" defaultValue={b.reward_cents != null ? b.reward_cents / 100 : ''} className="input" />
        <p className="hint">Up to your program maximum (${maxRewardDollars.toLocaleString()}).</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`p-${id}`}>Photo (optional)</label>
        <input
          id={`p-${id}`} name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="input"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const small = await downscalePhoto(f);
            if (small !== f) { const dt = new DataTransfer(); dt.items.add(small); e.target.files = dt.files; }
          }}
        />
        <p className="hint">{b.has_image ? 'A photo is already attached; choose another to replace it. ' : ''}It is shrunk and its camera and location data removed before it is saved. Public.</p>
        {b.has_image && <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" name="removePhoto" className="size-4" />Remove the current photo</label>}
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="active" defaultChecked={b.active ?? true} className="size-4" />Published (visible to the public)</label>
      {state?.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2"><button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : b.id ? 'Save changes' : 'Publish bulletin'}</button></div>
    </form>
  );
}
