// Emergency: clears two-step sign-in for one staff member when nobody can reach the console to do it.
// Usage:  node scripts/reset-2fa.mjs person@example.org      (reads DATABASE_URL / POSTGRES_URL from .env.local, .env or the environment)
import pg from 'pg';

for (const f of ['.env.local', '.env']) { try { process.loadEnvFile(f); } catch {} }
const email = process.argv[2];
const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL)?.trim().replace(/([?&])channel_binding=[^&]*&?/, '$1').replace(/[?&]$/, '');
if (!email || !url) { console.error('Usage: node scripts/reset-2fa.mjs person@example.org   (with DATABASE_URL set)'); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
const r = await c.query('update reviewers set totp_enabled = false, totp_secret = null, totp_last_step = 0 where lower(email) = lower($1) returning id, org_id', [email]);
for (const row of r.rows) {
  await c.query('delete from sessions where reviewer_id = $1', [row.id]);
  await c.query("insert into audit_log (org_id, reviewer_id, actor, action) values ($1, $2, 'operator (command line)', 'auth.two_step_reset')", [row.org_id, row.id]);
}
await c.end();
console.log(r.rowCount ? `Two-step sign-in cleared for ${email}. They can sign in with their password and set it up again.` : `No staff member with email ${email}.`);
