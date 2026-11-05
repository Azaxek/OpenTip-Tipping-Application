// Applies db/migrations/*.sql in order. Safe to re-run. Used by `npm run migrate`, `vercel-build` and tests.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

/**
 * Tips arrive in every script and with emoji, so the database has to store UTF-8. On any other encoding (a default Windows install uses
 * WIN1252) Postgres rejects such a tip and the tipster just sees an error, so refuse to continue instead of losing tips later.
 */
export async function assertUtf8(client) {
  const { rows } = await client.query('show server_encoding');
  const encoding = rows[0]?.server_encoding;
  if (encoding !== 'UTF8') {
    throw new Error(`This database stores text as ${encoding}, not UTF8, so a tip written in Arabic, Chinese, Hindi or with an emoji would be rejected. Create it with: CREATE DATABASE opentip ENCODING 'UTF8' TEMPLATE template0;  (Neon, Supabase and the official Postgres Docker image already do.)`);
  }
}

export async function runMigrations(connectionString, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await assertUtf8(client);
    await client.query('create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query('select name from _migrations')).rows.map((r) => r.name));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      log(`migrate: ${file}`);
      await client.query('begin');
      try {
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await client.query('insert into _migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${e.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const f of ['.env.local', '.env']) { try { process.loadEnvFile(f); } catch {} }
  // Same rules as src/lib/db.ts: accept Vercel's POSTGRES_URL, and drop the channel_binding option Neon adds (this driver cannot do it).
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL)?.trim().replace(/([?&])channel_binding=[^&]*&?/, '$1').replace(/[?&]$/, '');
  if (!url) { console.error('DATABASE_URL is not set. Add it in Vercel: Project → Settings → Environment Variables (see SETUP-GUIDE.md, step 3).'); process.exit(1); }
  runMigrations(url).then(() => console.log('migrate: up to date'), (e) => { console.error(e.message); process.exit(1); });
}
