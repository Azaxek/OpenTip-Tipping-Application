'use client';

/** One-tap reward amounts (a quarter, half and all of the program's maximum) that fill the amount field next to them. */
export function AmountChips({ targetId, values }: { targetId: string; values: number[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick amounts">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className="btn !min-h-8 !px-2 text-xs"
          onClick={() => {
            const el = document.getElementById(targetId) as HTMLInputElement | null;
            if (el) { el.value = v.toFixed(2); el.focus(); }
          }}
        >
          ${v}
        </button>
      ))}
    </div>
  );
}
