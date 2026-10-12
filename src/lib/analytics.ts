import { withOrg } from './db';
import { isUuid } from './queue';
import type { Staff } from './staff';

export type ReportFilter = { from: string; to: string; locationId?: string; categoryId?: string; bucket?: 'day' | 'week' | 'month' };

export type Report = {
  filter: Required<Pick<ReportFilter, 'from' | 'to' | 'bucket'>>;
  totals: { tips: number; open: number; closed: number; urgent: number };
  volume: { bucket: string; count: number }[];
  categories: { name: string; count: number }[];
  closures: { reason: string; count: number }[];
  timings: { firstResponseMedianH: number | null; firstResponseAvgH: number | null; closureMedianH: number | null; closureAvgH: number | null };
  rewards: { eligible: number; claimed: number; paidCents: number };
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Aggregates only. There is deliberately no row-level tipster data anywhere in a report. Admins only. */
export async function report(s: Staff, f: ReportFilter): Promise<Report> {
  if (s.role !== 'admin') throw new Error('Reports are for administrators');
  if (!DATE.test(f.from) || !DATE.test(f.to)) throw new Error('Invalid date range');
  const bucket = f.bucket === 'week' || f.bucket === 'month' ? f.bucket : 'day';
  const tz = (await withOrg(s.orgId, (q) => q<{ timezone: string }>('select timezone from organizations')))[0].timezone;
  const params: unknown[] = [f.from, f.to, tz]; // $3 is the program's time zone: "a day" means a day there, not in UTC
  const extra: string[] = [];
  if (isUuid(f.locationId)) { params.push(f.locationId); extra.push(`t.location_id = $${params.length}`); }
  if (isUuid(f.categoryId)) { params.push(f.categoryId); extra.push(`t.category_id = $${params.length}`); }
  const inRange = (col: string) => [`${col} >= $1::date::timestamp at time zone $3`, `${col} < ($2::date + 1)::timestamp at time zone $3`, ...extra].join(' and ');
  const w = inRange('t.created_at');
  const hours = (expr: string) => `round((${expr} / 3600)::numeric, 2)::float`;

  return withOrg(s.orgId, async (q) => {
    const [totals] = await q<any>(
      `select count(*)::int as tips, count(*) filter (where t.status <> 'closed')::int as open,
              count(*) filter (where t.status = 'closed')::int as closed, count(*) filter (where t.urgent)::int as urgent
         from tips t where ${w}`,
      params,
    );
    const volume = await q<any>(`select to_char(date_trunc('${bucket}', t.created_at at time zone $3), 'YYYY-MM-DD') as bucket, count(*)::int as count from tips t where ${w} group by 1 order by 1`, params);
    const categories = await q<any>(`select c.name, count(*)::int as count from tips t join categories c on c.id = t.category_id where ${w} group by c.name order by count desc, c.name`, params);
    const closures = await q<any>(`select t.closure_reason as reason, count(*)::int as count from tips t where ${w} and t.status = 'closed' group by 1 order by count desc`, params);
    const [timings] = await q<any>(
      `select ${hours("percentile_cont(0.5) within group (order by extract(epoch from t.first_response_at - t.created_at))")} as "firstResponseMedianH",
              ${hours('avg(extract(epoch from t.first_response_at - t.created_at))')} as "firstResponseAvgH",
              ${hours("percentile_cont(0.5) within group (order by extract(epoch from t.closed_at - t.created_at))")} as "closureMedianH",
              ${hours('avg(extract(epoch from t.closed_at - t.created_at))')} as "closureAvgH"
         from tips t where ${w}`,
      params,
    );
    // "Paid" is by claim date, so the total matches what staff actually paid out in the period.
    const [rewards] = await q<any>(
      `select count(*) filter (where t.reward_eligible)::int as eligible,
              (select count(*)::int from tips t where t.claimed_at is not null and ${inRange('t.claimed_at')}) as claimed,
              (select coalesce(sum(t.reward_amount_cents), 0)::int from tips t where t.claimed_at is not null and ${inRange('t.claimed_at')}) as "paidCents"
         from tips t where ${w}`,
      params,
    );
    return { filter: { from: f.from, to: f.to, bucket }, totals, volume, categories, closures, timings, rewards };
  });
}
