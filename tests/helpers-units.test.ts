import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { brandForeground } from '@/lib/brand';
import { databaseUrl } from '@/lib/db';
import { readiness } from '@/lib/readiness';
import { storageConfigured, storageSelfTest } from '@/lib/storage';
import { allTimeZones, dayIn, isTimeZone } from '@/lib/time';
import { appUrl, demoMode } from '@/lib/url';

afterEach(() => vi.unstubAllEnvs());

describe('time zones', () => {
  it('recognises real IANA zones and rejects everything else', () => {
    for (const ok of ['UTC', 'America/Chicago', 'Europe/Madrid', 'Asia/Kolkata']) expect(isTimeZone(ok), ok).toBe(true);
    for (const bad of ['', 'Mars/Phobos', 'America/Chicag0', 'x'.repeat(65), null, undefined, 5]) expect(isTimeZone(bad), String(bad)).toBe(false);
    expect(allTimeZones()).toContain('America/Chicago');
  });

  it('dayIn gives the calendar date in the zone, not in UTC, and counts days back', () => {
    const lateEveningInChicago = Date.parse('2026-03-05T03:30:00Z'); // still the 4th in Chicago
    expect(dayIn('UTC', 0, lateEveningInChicago)).toBe('2026-03-05');
    expect(dayIn('America/Chicago', 0, lateEveningInChicago)).toBe('2026-03-04');
    expect(dayIn('America/Chicago', 30, lateEveningInChicago)).toBe('2026-02-02');
    expect(dayIn('not-a-zone', 0, lateEveningInChicago)).toBe('2026-03-05'); // falls back to UTC rather than throwing
  });
});

describe('brand colours', () => {
  it('picks white text on dark brand colours and near-black on light ones', () => {
    expect(brandForeground('#000000')).toBe('#ffffff');
    expect(brandForeground('#1d4ed8')).toBe('#ffffff');
    expect(brandForeground('#ffffff')).toBe('#0f172a');
    expect(brandForeground('#fde047')).toBe('#0f172a');
  });
});

describe('addresses from the environment', () => {
  it('prefers APP_URL, then the Vercel production domain, then localhost, and never leaves a trailing slash', () => {
    vi.stubEnv('APP_URL', 'https://tips.example.org/');
    expect(appUrl()).toBe('https://tips.example.org');
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'opentip.vercel.app');
    expect(appUrl()).toBe('https://opentip.vercel.app');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    expect(appUrl()).toBe('http://localhost:3000');
  });

  it('demo mode is on only for the exact value 1', () => {
    for (const [v, on] of [['1', true], ['true', false], ['0', false], ['', false]] as const) {
      vi.stubEnv('DEMO_MODE', v);
      expect(demoMode(), v).toBe(on);
    }
  });

  it('accepts DATABASE_URL or Vercel\'s POSTGRES_URL, and drops the channel_binding option Neon adds (this driver cannot use it)', () => {
    const neon = 'postgresql://u:p@ep-x-pooler.neon.tech/db';
    expect(databaseUrl({ DATABASE_URL: `${neon}?sslmode=require&channel_binding=require` })).toBe(`${neon}?sslmode=require`);
    expect(databaseUrl({ DATABASE_URL: `${neon}?channel_binding=require&sslmode=require` })).toBe(`${neon}?sslmode=require`);
    expect(databaseUrl({ DATABASE_URL: `${neon}?channel_binding=require` })).toBe(neon);
    expect(databaseUrl({ DATABASE_URL: `${neon}?a=1&channel_binding=require&b=2` })).toBe(`${neon}?a=1&b=2`);
    expect(databaseUrl({ POSTGRES_URL: `  ${neon}  ` })).toBe(neon); // surrounding spaces from a paste
    expect(databaseUrl({ DATABASE_URL: neon, POSTGRES_URL: 'postgres://other/db' })).toBe(neon); // DATABASE_URL wins
    expect(databaseUrl({})).toBeUndefined();
  });
});

describe('readiness checklist', () => {
  const byLabel = (re: RegExp) => readiness().find((c) => re.test(c.label))!;

  it('flags a missing or short secret key as critical, and clears it for a long one', () => {
    vi.stubEnv('APP_SECRET', 'short');
    expect(byLabel(/APP_SECRET/)).toMatchObject({ ok: false, critical: true });
    vi.stubEnv('APP_SECRET', 'x'.repeat(40));
    expect(byLabel(/APP_SECRET/).ok).toBe(true);
  });

  it('treats email, push and storage as optional, and the retention cron as required outside demo mode', () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('DEMO_MODE', '');
    expect(byLabel(/CRON_SECRET/)).toMatchObject({ ok: false, critical: true });
    vi.stubEnv('DEMO_MODE', '1');
    expect(byLabel(/CRON_SECRET/).critical).toBe(false);
    expect(readiness().some((c) => /DEMO MODE/.test(c.label))).toBe(true);
    for (const re of [/Escalation email/, /Push notifications/, /Evidence storage/]) expect(byLabel(re).critical, String(re)).toBe(false);
  });

  it('makes demo mode a critical problem once a real program is in the database', () => {
    vi.stubEnv('DEMO_MODE', '1');
    expect(byLabel(/DEMO MODE/).critical).toBe(false);
    expect(readiness({ realProgram: true }).find((c) => /DEMO MODE/.test(c.label))).toMatchObject({ ok: false, critical: true });
  });

  it('never prints a secret value in any message', () => {
    vi.stubEnv('APP_SECRET', 'super-secret-value-super-secret-value-123');
    vi.stubEnv('RESEND_API_KEY', 're_abcdef');
    expect(JSON.stringify(readiness())).not.toMatch(/super-secret-value|re_abcdef/);
  });
});

describe('evidence storage self-test', () => {
  it('says plainly when storage is not configured', async () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) vi.stubEnv(k, '');
    expect(storageConfigured()).toBe(false);
    expect(await storageSelfTest()).toMatchObject({ ok: false, message: expect.stringMatching(/not set up/) });
  });

  it('writes, reads back and deletes a test file when storage works, leaving nothing behind', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentip-selftest-'));
    try {
      vi.stubEnv('STORAGE_DRIVER', 'fs');
      vi.stubEnv('STORAGE_DIR', dir);
      const r = await storageSelfTest();
      expect(r.ok).toBe(true);
      expect(r.message).toMatch(/CORS/); // reminds the admin of the one thing a server-side test cannot check
      const left = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).includes('selftest'));
      expect(left).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a failure without throwing when the storage cannot be written', async () => {
    const file = path.join(os.tmpdir(), `opentip-not-a-dir-${process.pid}`);
    fs.writeFileSync(file, 'x'); // a file where a directory is needed
    try {
      vi.stubEnv('STORAGE_DRIVER', 'fs');
      vi.stubEnv('STORAGE_DIR', file);
      expect(await storageSelfTest()).toMatchObject({ ok: false, message: expect.stringMatching(/storage test failed/i) });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
