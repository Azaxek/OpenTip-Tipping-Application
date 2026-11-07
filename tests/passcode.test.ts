import { describe, expect, it } from 'vitest';
import { hashSecret, verifySecret } from '@/lib/crypto';
import { system } from '@/lib/db';
import { canonicalPasscode, newPassphrase } from '@/lib/passphrase';
import { createTip, tipsterLogin } from '@/lib/tipster';
import { categoryId, makeOrg } from './helpers';

describe('passcode as typed', () => {
  it('trims, normalises Unicode, and folds only four-word passcodes', () => {
    expect(canonicalPasscode('  river-lamp-cloud-seven ')).toBe('river-lamp-cloud-seven');
    expect(canonicalPasscode('River Lamp  Cloud-Seven')).toBe('river-lamp-cloud-seven');
    expect(canonicalPasscode('café niño')).toBe('café niño'); // two words: only normalised and trimmed
    expect(canonicalPasscode('MixedCase Pass 42')).toBe('MixedCase Pass 42'); // not four words: stays exact
    expect(canonicalPasscode('Hunter22 ')).toBe('Hunter22');
    expect(canonicalPasscode('one two three four five')).toBe('one two three four five'); // five words: exact
  });

  it('keeps what the app generates stable', () => {
    for (let i = 0; i < 50; i++) { const p = newPassphrase(); expect(canonicalPasscode(p)).toBe(p); }
  });

  // Found by hand: a passcode with the space a phone keyboard adds after a suggestion could never be typed again, and five tries lock the tip.
  it('lets a tipster back in however their keyboard formatted the passcode', async () => {
    const { org } = await makeOrg('campus');
    const base = { categoryId: await categoryId(org, 'Weapons'), description: 'x' };
    const words = await createTip(org, { ...base, passcode: 'Otter Maple Lantern Coral ' });
    for (const typed of ['otter-maple-lantern-coral', 'OTTER MAPLE LANTERN CORAL', ' otter maple lantern coral']) expect(await tipsterLogin(org, words.tipId, typed), typed).toBeTruthy();
    expect(await tipsterLogin(org, words.tipId, 'otter-maple-lantern')).toBeNull();

    const own = await createTip(org, { ...base, passcode: 'MixedCase Pass 42 ' });
    expect(await tipsterLogin(org, own.tipId, 'MixedCase Pass 42')).toBeTruthy();
    expect(await tipsterLogin(org, own.tipId, 'mixedcase pass 42')).toBeNull(); // a passcode of the person's own making is still case-sensitive

    const accents = await createTip(org, { ...base, passcode: 'café niño' });
    expect(await tipsterLogin(org, accents.tipId, 'café niño')).toBeTruthy();
  });

  it('refuses a passcode that is only spaces', async () => {
    const { org } = await makeOrg('campus');
    await expect(createTip(org, { categoryId: await categoryId(org, 'Weapons'), description: 'x', passcode: '        ' })).rejects.toThrow(/at least/);
  });
});

describe('passcode hashing', () => {
  it('keys passcodes with the server secret, and re-keys an older plain hash on the next sign-in', async () => {
    const { org } = await makeOrg('campus');
    const tip = await createTip(org, { categoryId: await categoryId(org, 'Weapons'), description: 'x', passcode: 'otter-maple-lantern-coral' });
    const stored = async () => (await system((q) => q<{ passcode_hash: string }>('select passcode_hash from tips where org_id = $1 and tip_id = $2', [org.id, tip.tipId])))[0].passcode_hash;

    // A copy of the database alone cannot confirm a guess: the bare passcode does not verify against what is stored.
    const first = await stored();
    expect(first).toMatch(/^p1:\$argon2id\$/);
    expect(await verifySecret(first.slice(3), 'otter-maple-lantern-coral')).toBe(false);

    // A tip written before the key existed still signs in, and is replaced by a keyed hash.
    const plain = await hashSecret('otter-maple-lantern-coral');
    await system((q) => q('update tips set passcode_hash = $2 where org_id = $1', [org.id, plain]));
    expect(await tipsterLogin(org, tip.tipId, 'otter-maple-lantern-coral')).toBeTruthy();
    expect(await stored()).toMatch(/^p1:/);
    expect(await tipsterLogin(org, tip.tipId, 'otter-maple-lantern-coral')).toBeTruthy();
    expect(await tipsterLogin(org, tip.tipId, 'otter-maple-lantern-wrong')).toBeNull();
  });
});
