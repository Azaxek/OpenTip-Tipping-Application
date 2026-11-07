import { WORDS } from './wordlist';

/** Random words joined by hyphens, e.g. "otter-maple-lantern-coral" (4 words = 36 bits). Works in the browser and in Node. */
export function newPassphrase(words = 4): string {
  const r = new Uint16Array(words);
  crypto.getRandomValues(r);
  return Array.from(r, (n) => WORDS[n & (WORDS.length - 1)]).join('-'); // 512 words = 2^9, so masking is unbiased
}

const FOUR_WORDS = /^\p{L}+(?:[\s-]+\p{L}+){3}$/u;

/**
 * What a passcode is compared as. Phone keyboards add a trailing space after a suggested word and capitalise the first letter, and
 * some compose "é" differently, so each would lock a tipster out of their own tip. Unicode is normalised and the ends are trimmed for
 * every passcode; one that is exactly four words (the kind OpenTip generates, however it was typed) is also compared without case
 * and with spaces as hyphens. Anything else stays exact. Used when a passcode is set and when it is checked, so the two always agree.
 */
export function canonicalPasscode(raw: string): string {
  const p = raw.normalize('NFC').trim();
  return FOUR_WORDS.test(p) ? p.toLowerCase().replace(/[\s-]+/g, '-') : p;
}
