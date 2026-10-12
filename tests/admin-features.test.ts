import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { report } from '@/lib/analytics';
import { staffFromToken, staffLogin, staffLogout } from '@/lib/staff';
import { reportCsv, reportPdf } from '@/lib/export';
import { defaultLetter, letterPdf, posterPdf, qrPng } from '@/lib/materials';
import { listQueue } from '@/lib/queue';
import { SisError, csvConnector, syncLocations } from '@/lib/sis';
import { getStorage } from '@/lib/storage';
import { system, withOrg } from '@/lib/db';
import { createTip } from '@/lib/tipster';
import { ingest, planUploads } from '@/lib/uploads';
import { categoryId, makeOrg, makeReviewer } from './helpers';

describe('staff authentication', () => {
  it('logs in with a session, locks after 5 wrong passwords, and logs out', async () => {
    const { org, adminEmail } = await makeOrg('campus');
    for (let i = 0; i < 5; i++) expect(await staffLogin(org.id, adminEmail, `wrong-${i}`)).toBeNull();
    expect(await staffLogin(org.id, adminEmail, 'correct horse battery')).toBeNull(); // locked
    await system((q) => q('update reviewers set locked_until = null where org_id = $1', [org.id]));
    const token = await staffLogin(org.id, adminEmail.toUpperCase(), 'correct horse battery');
    expect(token).toBeTruthy();
    const s = await staffFromToken(token!);
    expect(s).toMatchObject({ orgId: org.id, role: 'admin', email: adminEmail });
    const stored = (await system((q) => q<any>('select token_hash from sessions where org_id = $1', [org.id])))[0];
    expect(stored.token_hash).not.toContain(token!); // only a hash of the session token is stored
    await staffLogout(token!);
    expect(await staffFromToken(token!)).toBeNull();
  });

  it('deactivated staff and unknown emails cannot sign in; passwords are argon2 hashes', async () => {
    const { org } = await makeOrg('campus');
    const r = await makeReviewer(org, []);
    await system((q) => q('update reviewers set active = false where id = $1', [r.id]));
    expect(await staffLogin(org.id, r.email, 'reviewer-password-1')).toBeNull();
    expect(await staffLogin(org.id, 'nobody@example.org', 'x')).toBeNull();
    expect((await system((q) => q<any>('select password_hash from reviewers where id = $1', [r.id])))[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it('expired sessions no longer authenticate', async () => {
    const { org, adminEmail } = await makeOrg('campus');
    const token = (await staffLogin(org.id, adminEmail, 'correct horse battery'))!;
    await system((q) => q("update sessions set expires_at = now() - interval '1 minute' where org_id = $1", [org.id]));
    expect(await staffFromToken(token)).toBeNull();
  });
});

describe('analytics & exports', () => {
  it('reports aggregates: volume, categories, closures, response/closure times, rewards paid by claim date', async () => {
    const { org, admin } = await makeOrg('campus');
    const mk = async (cat: string) => (await createTip(org, { categoryId: await categoryId(org, cat), description: 'x', passcode: 'hunter22' })).tipId;
    await mk('Theft'); await mk('Theft'); await mk('Weapons');
    const rows = await system((q) => q<any>('select id from tips where org_id = $1 order by created_at', [org.id]));
    await system(async (q) => {
      await q("update tips set first_response_at = created_at + interval '2 hours', status = 'closed', closure_reason = 'actioned', closed_at = created_at + interval '10 hours', urgent = true where id = $1", [rows[0].id]);
      await q("update tips set first_response_at = created_at + interval '4 hours', status = 'closed', closure_reason = 'unfounded', closed_at = created_at + interval '20 hours' where id = $1", [rows[1].id]);
      await q("update tips set reward_eligible = true, reward_amount_cents = 25000, claimed_at = now() where id = $1", [rows[2].id]);
    });
    const today = new Date().toISOString().slice(0, 10);
    const r = await report(admin, { from: today, to: today });
    expect(r.totals).toEqual({ tips: 3, open: 1, closed: 2, urgent: 1 });
    expect(r.categories).toEqual([{ name: 'Theft', count: 2 }, { name: 'Weapons', count: 1 }]);
    expect(r.closures.sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([{ reason: 'actioned', count: 1 }, { reason: 'unfounded', count: 1 }]);
    expect(r.timings).toMatchObject({ firstResponseMedianH: 3, firstResponseAvgH: 3, closureMedianH: 15, closureAvgH: 15 });
    expect(r.rewards).toEqual({ eligible: 1, claimed: 1, paidCents: 25000 });
    expect(r.volume).toEqual([{ bucket: today, count: 3 }]);
    // a range that excludes today shows nothing
    expect((await report(admin, { from: '2020-01-01', to: '2020-01-31' })).totals.tips).toBe(0);
    // non-admins are refused
    await expect(report({ ...admin, role: 'reviewer' }, { from: today, to: today })).rejects.toThrow('administrators');
    await expect(report(admin, { from: "x'; drop table tips;--", to: today })).rejects.toThrow('Invalid date range');
    // exports
    const csv = reportCsv(r);
    expect(csv).toContain('Theft,2');
    expect(csv).toContain('paid in period (USD),250.00');
    const pdf = await reportPdf(r, 'Test Org');
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('CSV export neutralizes spreadsheet formula injection', () => {
    const csv = reportCsv({ filter: { from: 'a', to: 'b', bucket: 'day' }, totals: { tips: 0, open: 0, closed: 0, urgent: 0 }, volume: [], categories: [{ name: '=HYPERLINK("http://evil","x")', count: 1 }], closures: [], timings: { firstResponseMedianH: null, firstResponseAvgH: null, closureMedianH: null, closureAvgH: null }, rewards: { eligible: 0, claimed: 0, paidCents: 0 } });
    expect(csv).not.toMatch(/^=/m);
    expect(csv).toContain(`"'=HYPERLINK`);
  });
});

describe('SIS CSV connector (locations only)', () => {
  it('imports, updates, and deactivates missing locations; keeps manual ones', async () => {
    const { org, admin } = await makeOrg('campus');
    const first = await syncLocations(admin, csvConnector('external_id,name\r\nS1,"Lincoln High, North"\nS2,Roosevelt Elementary\n'));
    expect(first).toEqual({ added: 2, updated: 0, deactivated: 0 });
    const second = await syncLocations(admin, csvConnector('﻿external_id,name\nS1,Lincoln High North\nS3,Adams Middle\n'));
    expect(second).toEqual({ added: 1, updated: 1, deactivated: 1 });
    const locs = await withOrg(org.id, (q) => q<any>('select name, active, external_id from locations order by name'));
    expect(locs.find((l) => l.external_id === 'S1')).toMatchObject({ name: 'Lincoln High North', active: true });
    expect(locs.find((l) => l.external_id === 'S2')!.active).toBe(false);
    expect(locs.find((l) => l.external_id === null)!.active).toBe(true); // the manually-created one is untouched
  });

  it('rejects any file that carries more than the two location columns (no student data ever)', async () => {
    const { admin } = await makeOrg('campus');
    await expect(syncLocations(admin, csvConnector('external_id,name,student_name\nS1,Lincoln,Jane Doe\n'))).rejects.toBeInstanceOf(SisError);
    await expect(syncLocations(admin, csvConnector('student_id,student_name,school\n1,Jane,Lincoln\n'))).rejects.toBeInstanceOf(SisError);
    await expect(syncLocations(admin, csvConnector('external_id,name\n'))).rejects.toBeInstanceOf(SisError);
    await expect(syncLocations({ ...admin, role: 'reviewer' }, csvConnector('external_id,name\nS1,X\n'))).rejects.toBeInstanceOf(SisError);
  });
});

describe('rollout materials', () => {
  it('generates a poster PDF, a QR PNG and a letter PDF (even with characters standard fonts cannot draw)', async () => {
    const { org } = await makeOrg('campus');
    const poster = await posterPdf(org);
    expect((await PDFDocument.load(poster)).getPageCount()).toBe(1);
    const png = await qrPng('http://localhost:3000/submit');
    expect((await sharp(png).metadata()).format).toBe('png');
    const letter = await letterPdf(org, `${defaultLetter(org)}\n\nEmoji and CJK: 😀 你好`);
    expect(Buffer.from(letter).subarray(0, 5).toString()).toBe('%PDF-');
    expect(defaultLetter(org)).toContain(org.name);
    expect(defaultLetter(org)).toContain('555-0100');
  });
});

describe('evidence upload limits', () => {
  it('validates count, type, per-kind size and total size before issuing upload URLs', async () => {
    const { org } = await makeOrg('campus', { max_files: 3, image_mb: 5, av_mb: 20, tip_mb: 22 });
    const ok = (files: unknown) => planUploads(org, files);
    expect('uploads' in (await ok([{ mime: 'image/jpeg', size: 1_000_000 }]))).toBe(true);
    expect(await ok([{ mime: 'image/jpeg', size: 6 * 1048576 }])).toHaveProperty('error');
    expect(await ok([{ mime: 'application/x-msdownload', size: 10 }])).toHaveProperty('error');
    expect(await ok([{ mime: 'image/jpeg', size: -1 }])).toHaveProperty('error');
    expect(await ok(Array(4).fill({ mime: 'image/png', size: 10 }))).toHaveProperty('error');
    expect(await ok([{ mime: 'video/mp4', size: 20 * 1048576 }, { mime: 'audio/mpeg', size: 5 * 1048576 }])).toHaveProperty('error'); // 25 MB > 22 MB total
  });

  it('never stores an upload it cannot sanitize, and always deletes the raw original', async () => {
    const { org } = await makeOrg('campus', { image_mb: 1 });
    const t = await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'x', passcode: 'hunter22' });
    const tipUuid = (await system((q) => q<any>('select id from tips where tip_id = $1', [t.tipId])))[0].id;
    const storage = getStorage();
    const good = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123' } }).png().toBuffer();
    const keys = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'].map((u) => `quarantine/${u}`);
    await storage.put(keys[0], good, 'image/png');
    await storage.put(keys[1], Buffer.from('MZ this is an executable pretending to be a photo'), 'image/jpeg');
    await storage.put(keys[2], Buffer.alloc(2 * 1048576, 1), 'image/jpeg'); // over the 1 MB image cap (and not an image)
    const r = await ingest(org, tipUuid, [...keys, '../../etc/passwd', 'media/x']);
    expect(r).toEqual({ stored: 1, failed: 4 });
    for (const k of keys) expect(await storage.head(k)).toBeNull();
    expect(await withOrg(org.id, (q) => q('select 1 from media where tip_id = $1', [tipUuid]))).toHaveLength(1);
  });
});

describe('queue filters', () => {
  it('filters by category, urgency and assignee, and sorts urgent first', async () => {
    const { org, admin } = await makeOrg('campus');
    await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'a', passcode: 'hunter22' });
    await createTip(org, { categoryId: await categoryId(org, 'Vandalism'), description: 'b', passcode: 'hunter22', urgent: true });
    const all = await listQueue(admin);
    expect(all[0].category).toBe('Vandalism'); // urgent first
    expect(await listQueue(admin, { urgent: true })).toHaveLength(1);
    expect(await listQueue(admin, { categoryId: await categoryId(org, 'Theft') })).toHaveLength(1);
    expect(await listQueue(admin, { assignee: 'unassigned' })).toHaveLength(2);
    expect(await listQueue(admin, { assignee: 'me' })).toHaveLength(0);
    expect((await listQueue(admin, { sort: 'oldest' }))[0].category).toBe('Theft');
  });
});

describe('analytics days follow the program\'s own time zone', () => {
  it('counts a 9:30 pm Central tip on that Central day, not on the next UTC day, and shows it in the right bucket', async () => {
    const { org, admin } = await makeOrg('crime_stoppers', { timezone: 'America/Chicago' });
    await createTip(org, { categoryId: await categoryId(org, 'Fraud'), description: 'x', passcode: 'hunter22' });
    // 2026-03-05 03:30 UTC is 2026-03-04 21:30 in Chicago (CST, UTC-6)
    await system((q) => q("update tips set created_at = '2026-03-05T03:30:00Z' where org_id = $1", [org.id]));
    const chicagoDay = await report(admin, { from: '2026-03-04', to: '2026-03-04' });
    expect(chicagoDay.totals.tips).toBe(1);
    expect(chicagoDay.volume).toEqual([{ bucket: '2026-03-04', count: 1 }]);
    expect((await report(admin, { from: '2026-03-05', to: '2026-03-05' })).totals.tips).toBe(0);
    // The same instant in a UTC program belongs to the 5th.
    await system((q) => q("update organizations set timezone = 'UTC' where id = $1", [org.id]));
    expect((await report(admin, { from: '2026-03-05', to: '2026-03-05' })).totals.tips).toBe(1);
    expect((await report(admin, { from: '2026-03-04', to: '2026-03-04' })).totals.tips).toBe(0);
  });
});
