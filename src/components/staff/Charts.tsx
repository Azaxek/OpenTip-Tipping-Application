/** Dependency-free charts: plain SVG/CSS rendered on the server, aggregate numbers only. */

export function HBars({ rows, empty = 'No data in this range.' }: { rows: { label: string; value: number }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2 text-sm">
          <span className="truncate" title={r.label}>{r.label}</span>
          <span className="h-4 rounded bg-slate-100"><span className="block h-4 rounded" style={{ width: `${(r.value / max) * 100}%`, background: 'var(--brand)' }} /></span>
          <span className="text-right tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function VBars({ rows }: { rows: { label: string; value: number }[] }) {
  if (!rows.length) return <p className="text-sm text-slate-600">No tips in this range.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const w = Math.max(320, rows.length * 28);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} 160`} width={w} height={160} role="img" aria-label="Tip volume over time">
        {rows.map((r, i) => {
          const h = (r.value / max) * 110;
          return (
            <g key={r.label} transform={`translate(${i * 28 + 4} 0)`}>
              <title>{`${r.label}: ${r.value}`}</title>
              <rect y={125 - h} width={20} height={h} rx={2} fill="var(--brand)" />
              <text x={10} y={120 - h} textAnchor="middle" fontSize="9" fill="#334155">{r.value}</text>
              <text x={10} y={145} textAnchor="middle" fontSize="8" fill="#475569" transform={`rotate(-30 10 145)`}>{r.label.slice(5)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card !p-4">
      <p className="text-xs font-semibold uppercase text-slate-600">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-600">{sub}</p>}
    </div>
  );
}
