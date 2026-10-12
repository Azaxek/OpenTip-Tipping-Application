import pg from 'pg';

export type Q = <T = any>(text: string, params?: unknown[]) => Promise<T[]>;

const g = globalThis as { __otPool?: pg.Pool };

/**
 * The database address. DATABASE_URL, or the POSTGRES_URL that Vercel's Neon/Supabase integration fills in for you.
 * Neon's copy button adds `channel_binding=require`, which this driver cannot do and which makes every connection fail,
 * so it is dropped here rather than leaving a trap for whoever pastes the string.
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const url = env.DATABASE_URL || env.POSTGRES_URL;
  return url?.trim().replace(/([?&])channel_binding=[^&]*&?/, '$1').replace(/[?&]$/, '');
}

function pool(): pg.Pool {
  if (!g.__otPool) {
    const url = databaseUrl();
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__otPool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 5), idleTimeoutMillis: 10_000 });
    g.__otPool.on('error', () => {}); // idle-client errors must not crash the process
  }
  return g.__otPool;
}

export async function closePool() {
  await g.__otPool?.end();
  g.__otPool = undefined;
}

/**
 * Dev-only (PG_SIMPLE_PROTOCOL=1, set by `npm run dev:db`): PGlite's socket server mishandles pipelined extended-protocol
 * messages after an SQL error, so the local dev database gets parameters inlined into simple queries instead.
 * Never enabled against Neon/Supabase/Postgres, which use real bind parameters.
 */
function inline(c: pg.PoolClient, text: string, params: unknown[]): string {
  const lit = (v: unknown): string =>
    v === null || v === undefined ? 'null'
    : typeof v === 'number' || typeof v === 'bigint' ? String(v)
    : typeof v === 'boolean' ? (v ? 'true' : 'false')
    : Buffer.isBuffer(v) ? c.escapeLiteral(`\\x${v.toString('hex')}`)
    : v instanceof Date ? c.escapeLiteral(v.toISOString())
    : Array.isArray(v) ? c.escapeLiteral(`{${v.map((x) => (x === null ? 'NULL' : `"${String(x).replace(/(["\\])/g, '\\$1')}"`)).join(',')}}`)
    : typeof v === 'object' ? c.escapeLiteral(JSON.stringify(v))
    : c.escapeLiteral(String(v));
  return text.replace(/\$(\d+)/g, (_, n) => lit(params[Number(n) - 1]));
}

const exec = async (c: pg.PoolClient, text: string, params: unknown[] = []) =>
  (await (process.env.PG_SIMPLE_PROTOCOL ? c.query(inline(c, text, params)) : c.query(text, params as any[]))).rows;

async function tx<T>(setup: (run: (text: string, params?: unknown[]) => Promise<unknown>) => Promise<void>, fn: (q: Q) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query('begin');
    await setup((text, params) => exec(c, text, params));
    const out = await fn((text, params) => exec(c, text, params) as Promise<any[]>);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Tenant-scoped transaction. Drops to the non-BYPASSRLS `opentip_app` role and pins app.org_id, so Postgres RLS
 * (not application code) guarantees this org can only see its own rows. Never nest calls (deadlocks small pools).
 */
export const withOrg = <T>(orgId: string, fn: (q: Q) => Promise<T>) =>
  tx(async (run) => {
    await run('set local role opentip_app');
    await run("select set_config('app.org_id', $1, true)", [orgId]);
  }, fn);

/** Owner-role transaction (bypasses RLS). Only for setup, org resolution, session lookup and the purge job. */
export const system = <T>(fn: (q: Q) => Promise<T>) => tx(async () => {}, fn);
