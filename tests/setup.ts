import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { afterAll, vi } from 'vitest';
import { runMigrations } from '../scripts/migrate.mjs';
import { closePool } from '@/lib/db';

// Hostnames in tests (hooks.example.org ...) must not need real DNS. outbound.test.ts passes its own resolver to test the guard itself.
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));

process.env.APP_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.APP_URL = 'http://localhost:3000';
process.env.STORAGE_DRIVER = 'fs';
process.env.STORAGE_DIR = path.join(os.tmpdir(), `opentip-test-${process.pid}`);

/**
 * Every test file gets its own empty database with the real migrations applied, in one of two modes:
 *
 *  - default: in-process Postgres (PGlite, real Postgres compiled to WASM). No setup, fast, used locally.
 *  - TEST_DATABASE_URL=postgres://user:pass@host:port/postgres: a REAL Postgres server (CI does this). Each file creates a throwaway
 *    database on that server, runs the migrations, and drops it afterwards, so the same tests then exercise real pooled connections.
 *    The user needs permission to create databases and roles.
 */
const adminUrl = process.env.TEST_DATABASE_URL;
let cleanup: () => Promise<void>;

if (adminUrl) {
  const name = `ot_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  process.env.PG_POOL_MAX = '4';
  await runMigrations(process.env.DATABASE_URL, () => {});
  cleanup = async () => {
    await closePool();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  };
} else {
  const db = await PGlite.create();
  const dir = path.resolve(process.cwd(), 'db/migrations');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));

  // Plugged in where the `pg` Pool normally lives, so all app code runs unchanged with real bind parameters (same semantics as Neon/Supabase).
  let busy: Promise<void> = Promise.resolve(); // one connection at a time, like PG_POOL_MAX=1
  (globalThis as { __otPool?: unknown }).__otPool = {
    async connect() {
      let release!: () => void;
      const turn = busy;
      busy = new Promise<void>((r) => (release = r));
      await turn;
      return { query: async (text: string, params?: unknown[]) => ({ rows: (await db.query(text, params)).rows }), release };
    },
    on() {},
    async end() {},
  };
  cleanup = async () => {
    await closePool();
    await db.close();
  };
}

afterAll(async () => {
  await cleanup();
  fs.rmSync(process.env.STORAGE_DIR as string, { recursive: true, force: true });
});
