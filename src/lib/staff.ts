import { audit } from './audit';
import { hashSecret, randomToken, sha256, unseal, verifySecret } from './crypto';
import { system, withOrg } from './db';
import { verifyTotp } from './totp';

export type Staff = {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: 'admin' | 'reviewer';
  allTips: boolean;
  onCall: boolean;
};

export const SESSION_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export type SignIn = { token: string } | { needCode: true } | null;

/**
 * Email + password (+ authenticator code when the person turned on two-step sign-in).
 * Failure is uniform (null) for a wrong password, a wrong code, an unknown email and a locked account; a wrong code counts
 * toward the same lockout as a wrong password, so a stolen password cannot be used to guess six-digit codes.
 * { needCode } is returned only after the password was right.
 */
export async function staffSignIn(orgId: string, email: string, password: string, code?: string): Promise<SignIn> {
  const row = (
    await withOrg(orgId, (q) =>
      q<{ id: string; password_hash: string; active: boolean; locked: boolean; name: string; email: string; totp_enabled: boolean; totp_secret: string | null; totp_last_step: string }>(
        'select id, password_hash, active, name, email, totp_enabled, totp_secret, totp_last_step::text, coalesce(locked_until > now(), false) as locked from reviewers where lower(email) = lower($1)',
        [String(email).slice(0, 320)],
      ),
    )
  )[0];
  const usable = row && row.active && !row.locked;
  const ok = await verifySecret(usable ? row.password_hash : null, String(password).slice(0, 256));
  if (!row) return null;
  const fail = async () => {
    if (usable) {
      await withOrg(orgId, (q) =>
        q(
          `update reviewers set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
           where id = $1`,
          [row.id, MAX_FAILS, LOCK_MINUTES],
        ),
      );
    }
    return null;
  };
  if (!ok) return fail();
  let step = 0;
  if (row.totp_enabled) {
    if (!code?.trim()) return { needCode: true };
    const secret = row.totp_secret ? unseal(row.totp_secret) : null;
    step = (secret && verifyTotp(secret, String(code).slice(0, 12), Number(row.totp_last_step))) || 0;
    if (!step) return fail();
  }
  const token = randomToken();
  await withOrg(orgId, async (q) => {
    await q('update reviewers set failed_attempts = 0, locked_until = null, totp_last_step = greatest(totp_last_step, $2) where id = $1', [row.id, step]);
    await q("insert into sessions (token_hash, org_id, reviewer_id, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))", [sha256(token), orgId, row.id, SESSION_DAYS]);
    await audit(q, { id: row.id, orgId, name: row.name, email: row.email }, 'auth.login');
  });
  return { token };
}

/** Password-only convenience (first-run setup signs in the brand-new admin, who has no two-step yet). Null if a code is still needed. */
export async function staffLogin(orgId: string, email: string, password: string): Promise<string | null> {
  const r = await staffSignIn(orgId, email, password);
  return r && 'token' in r ? r.token : null;
}

/** Cross-org lookup by an unguessable token hash, so it runs as the owner role; everything after is org-scoped. */
export async function staffFromToken(token: string | undefined): Promise<Staff | null> {
  if (!token) return null;
  const r = (
    await system((q) =>
      q(
        `select r.id, r.org_id, r.email, r.name, r.role, r.all_tips, r.on_call
           from sessions s join reviewers r on r.id = s.reviewer_id
          where s.token_hash = $1 and s.expires_at > now() and r.active`,
        [sha256(token)],
      ),
    )
  )[0];
  return r ? { id: r.id, orgId: r.org_id, email: r.email, name: r.name, role: r.role, allTips: r.all_tips, onCall: r.on_call } : null;
}

export const staffLogout = (token: string) => system((q) => q('delete from sessions where token_hash = $1', [sha256(token)]));

export const newPasswordHash = (pw: string) => hashSecret(pw);

/** SQL predicate limiting which tips a staff member may touch: admins/all_tips see all, others only routed or assigned. */
export function visible(s: Staff, param: number, alias = 't'): string {
  if (s.role === 'admin' || s.allTips) return `($${param}::uuid is not null)`; // always true; keeps the parameter referenced
  return `(${alias}.assigned_reviewer_id = $${param} or exists (select 1 from tip_teams tt join team_members tm on tm.team_id = tt.team_id where tt.tip_id = ${alias}.id and tm.reviewer_id = $${param}))`;
}
