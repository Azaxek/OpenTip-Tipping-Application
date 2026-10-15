import { describe, expect, it } from 'vitest';
import { seal, unseal } from '@/lib/crypto';
import { system } from '@/lib/db';
import { staffFromToken, staffLogin, staffSignIn } from '@/lib/staff';
import { hotp, newTotpSecret, otpauthUri, stepOf, verifyTotp } from '@/lib/totp';
import { confirmTwoStep, disableTwoStep, resetTwoStep, startTwoStep, twoStepState } from '@/lib/two-step';
import { makeOrg, makeReviewer } from './helpers';

const PW = 'correct horse battery';
const secretOf = async (id: string) => unseal((await system((q) => q<any>('select totp_secret from reviewers where id = $1', [id])))[0].totp_secret)!;
const codeNow = (secret: string, offset = 0) => hotp(secret, stepOf() + offset);

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC 6238 SHA-1 test vector (secret "12345678901234567890", T=59 → …287082)', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(hotp(secret, Math.floor(59 / 30))).toBe('287082');
    expect(hotp(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(hotp(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('generates 160-bit base32 secrets and an otpauth link authenticator apps understand', () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(new Set(Array.from({ length: 50 }, newTotpSecret)).size).toBe(50);
    const uri = otpauthUri(s, 'a@b.org', 'Org & Co');
    expect(uri).toBe(`otpauth://totp/Org%20%26%20Co:a%40b.org?secret=${s}&issuer=Org%20%26%20Co&algorithm=SHA1&digits=6&period=30`);
  });

  it('accepts the current code with one step of clock drift, rejects anything else, and never accepts a step twice', () => {
    const s = newTotpSecret();
    const now = Date.now();
    const cur = stepOf(now);
    expect(verifyTotp(s, hotp(s, cur), 0, now)).toBe(cur);
    expect(verifyTotp(s, hotp(s, cur - 1), 0, now)).toBe(cur - 1);
    expect(verifyTotp(s, hotp(s, cur + 1), 0, now)).toBe(cur + 1);
    expect(verifyTotp(s, hotp(s, cur - 2), 0, now)).toBeNull();
    expect(verifyTotp(s, hotp(s, cur), cur, now)).toBeNull(); // replay
    expect(verifyTotp(s, hotp(s, cur - 1), cur, now)).toBeNull(); // older than the last accepted
    expect(verifyTotp(s, '12 34 56'.replace(/\d/g, '0'), 0, now)).toBeNull();
    for (const bad of ['', 'abcdef', '12345', '1234567', '١٢٣٤٥٦']) expect(verifyTotp(s, bad, 0, now)).toBeNull();
    expect(verifyTotp(s, ` ${hotp(s, cur).slice(0, 3)} ${hotp(s, cur).slice(3)} `, 0, now)).toBe(cur); // spaces are fine
  });
});

describe('sealed secrets', () => {
  it('round-trips, differs every time, and fails closed when tampered with or the key changes', () => {
    const a = seal('JBSWY3DP');
    expect(seal('JBSWY3DP')).not.toBe(a);
    expect(unseal(a)).toBe('JBSWY3DP');
    const [iv, tag, enc] = a.split('.');
    expect(unseal([iv, tag, Buffer.from('xxxxxxxx').toString('base64url')].join('.'))).toBeNull();
    expect(unseal('garbage')).toBeNull();
    const old = process.env.APP_SECRET;
    process.env.APP_SECRET = 'a-different-secret-a-different-secret-1234';
    expect(unseal(a)).toBeNull();
    process.env.APP_SECRET = old;
    expect(enc).toBeTruthy();
  });
});

describe('two-step sign-in', () => {
  it('is off by default; enabling needs a real code; the secret is stored encrypted', async () => {
    const { org, admin, adminEmail } = await makeOrg('campus');
    expect(await twoStepState(admin, org.name)).toEqual({ enabled: false });
    await startTwoStep(admin);
    const st = await twoStepState(admin, org.name);
    expect(st.enabled).toBe(false);
    expect(st.pending?.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(st.pending?.qr).toMatch(/^data:image\/png;base64,/);
    const raw = (await system((q) => q<any>('select totp_secret from reviewers where id = $1', [admin.id])))[0].totp_secret as string;
    expect(raw).not.toContain(st.pending!.secret); // encrypted at rest
    // Not active yet: password alone still signs in.
    expect(await staffSignIn(org.id, adminEmail, PW)).toMatchObject({ token: expect.any(String) });
    await expect(confirmTwoStep(admin, '000000')).rejects.toThrow(/did not match/);
    await confirmTwoStep(admin, codeNow(st.pending!.secret));
    expect(await twoStepState(admin, org.name)).toEqual({ enabled: true });
  });

  it('asks for a code after the right password, signs in with a valid one, and refuses replay, wrong codes and a wrong password', async () => {
    const { org, admin, adminEmail } = await makeOrg('campus');
    await startTwoStep(admin);
    const secret = await secretOf(admin.id);
    await confirmTwoStep(admin, codeNow(secret));
    expect(await staffSignIn(org.id, adminEmail, 'wrong password!!')).toBeNull();
    expect(await staffSignIn(org.id, adminEmail, PW)).toEqual({ needCode: true });
    expect(await staffLogin(org.id, adminEmail, PW)).toBeNull(); // password-only helper cannot bypass it
    // the confirming code is already used: replay is refused even though it is "current"
    expect(await staffSignIn(org.id, adminEmail, PW, codeNow(secret))).toBeNull();
    const next = codeNow(secret, 1);
    const ok = await staffSignIn(org.id, adminEmail, PW, next);
    expect(ok).toMatchObject({ token: expect.any(String) });
    expect((await staffFromToken((ok as any).token))?.email).toBe(adminEmail);
    expect(await staffSignIn(org.id, adminEmail, PW, next)).toBeNull(); // same code again
  });

  it('counts wrong codes toward the lockout, so a stolen password cannot be used to guess codes', async () => {
    const { org, admin, adminEmail } = await makeOrg('campus');
    await startTwoStep(admin);
    const secret = await secretOf(admin.id);
    await confirmTwoStep(admin, codeNow(secret));
    for (let i = 0; i < 5; i++) expect(await staffSignIn(org.id, adminEmail, PW, '111111')).toBeNull();
    // Locked: even the right password and a valid code are refused for now.
    expect(await staffSignIn(org.id, adminEmail, PW, codeNow(secret, 1))).toBeNull();
    expect(await staffSignIn(org.id, adminEmail, PW)).toBeNull();
  });

  it('turning it off needs the password; an admin can reset someone who lost their phone (and signs them out)', async () => {
    const { org, admin, adminEmail } = await makeOrg('campus');
    const rev = await makeReviewer(org, []);
    await startTwoStep(admin);
    await confirmTwoStep(admin, codeNow(await secretOf(admin.id)));
    await expect(disableTwoStep(admin, 'nope nope nope')).rejects.toThrow(/not correct/);
    await disableTwoStep(admin, PW);
    expect(await staffSignIn(org.id, adminEmail, PW)).toMatchObject({ token: expect.any(String) });

    await startTwoStep(rev);
    await confirmTwoStep(rev, codeNow(await secretOf(rev.id)));
    await expect(resetTwoStep(rev, rev.id)).rejects.toThrow('Admins only');
    await expect(resetTwoStep(admin, 'not-a-uuid')).rejects.toThrow('Unknown reviewer');
    await system((q) => q("insert into sessions (token_hash, org_id, reviewer_id, expires_at) values ('h', $1, $2, now() + interval '1 day')", [org.id, rev.id]));
    await resetTwoStep(admin, rev.id);
    expect((await twoStepState(rev, org.name)).enabled).toBe(false);
    expect((await system((q) => q<any>('select count(*)::int as n from sessions where reviewer_id = $1', [rev.id])))[0].n).toBe(0);
    const log = await system((q) => q<any>("select action from audit_log where org_id = $1 and action like 'auth.two_step%' order by id", [org.id]));
    expect(log.map((l: any) => l.action)).toEqual(['auth.two_step_on', 'auth.two_step_off', 'auth.two_step_on', 'auth.two_step_reset']);
  });
});
