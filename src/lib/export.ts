import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Report } from './analytics';

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  // Neutralize spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function reportCsv(r: Report): string {
  const rows: unknown[][] = [
    ['OpenTip report', `${r.filter.from} to ${r.filter.to}`],
    [],
    ['Totals'], ['tips', r.totals.tips], ['open', r.totals.open], ['closed', r.totals.closed], ['urgent', r.totals.urgent],
    [],
    [`Volume by ${r.filter.bucket}`, 'count'], ...r.volume.map((v) => [v.bucket, v.count]),
    [],
    ['Category', 'count'], ...r.categories.map((c) => [c.name, c.count]),
    [],
    ['Closure reason', 'count'], ...r.closures.map((c) => [c.reason, c.count]),
    [],
    ['Timing (hours)', 'value'],
    ['first response, median', r.timings.firstResponseMedianH], ['first response, average', r.timings.firstResponseAvgH],
    ['closure, median', r.timings.closureMedianH], ['closure, average', r.timings.closureAvgH],
    [],
    ['Rewards', 'value'], ['eligible tips', r.rewards.eligible], ['claimed in period', r.rewards.claimed], ['paid in period (USD)', (r.rewards.paidCents / 100).toFixed(2)],
  ];
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export async function reportPdf(r: Report, orgName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 740;
  const line = (t: string, b = false, size = 11) => {
    if (y < 60) { page = doc.addPage([612, 792]); y = 740; }
    page.drawText(t.replace(/[^\x20-\x7E]/g, '?'), { x: 60, y, size, font: b ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= size + 6;
  };
  const hrs = (n: number | null) => (n == null ? 'n/a' : `${n} h`);
  line(`${orgName} - tip report`, true, 18);
  line(`${r.filter.from} to ${r.filter.to}`);
  y -= 8;
  line('Totals', true, 13);
  line(`Tips: ${r.totals.tips}   Open: ${r.totals.open}   Closed: ${r.totals.closed}   Urgent: ${r.totals.urgent}`);
  y -= 6;
  line('Response times', true, 13);
  line(`First response - median ${hrs(r.timings.firstResponseMedianH)}, average ${hrs(r.timings.firstResponseAvgH)}`);
  line(`Time to closure - median ${hrs(r.timings.closureMedianH)}, average ${hrs(r.timings.closureAvgH)}`);
  y -= 6;
  line('Tips by category', true, 13);
  for (const c of r.categories) line(`${c.name}: ${c.count}`);
  y -= 6;
  line('Closure reasons', true, 13);
  for (const c of r.closures) line(`${c.reason}: ${c.count}`);
  y -= 6;
  line('Rewards', true, 13);
  line(`Eligible tips: ${r.rewards.eligible}   Claimed in period: ${r.rewards.claimed}   Paid in period: $${(r.rewards.paidCents / 100).toFixed(2)}`);
  y -= 6;
  line(`Tip volume by ${r.filter.bucket}`, true, 13);
  for (const v of r.volume) line(`${v.bucket}: ${v.count}`);
  return doc.save();
}
