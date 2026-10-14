import { WORDS } from './wordlist';

/** Random words joined by hyphens, e.g. "otter-maple-lantern-coral" (4 words = 36 bits). Works in the browser and in Node. */
export function newPassphrase(words = 4): string {
  const r = new Uint16Array(words);
  crypto.getRandomValues(r);
  return Array.from(r, (n) => WORDS[n & (WORDS.length - 1)]).join('-'); // 512 words = 2^9, so masking is unbiased
}
