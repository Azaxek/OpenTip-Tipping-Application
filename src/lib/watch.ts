/** The organization's keyword watch list: comma- or line-separated words and phrases, matched whole-word and case-insensitively. */
export const MAX_KEYWORDS = 100;

export const parseKeywords = (raw: string): string[] =>
  [...new Set(raw.split(/[\n,]/).map((w) => w.trim().toLowerCase().replace(/\s+/g, ' ')).filter((w) => w.length >= 2 && w.length <= 40))].slice(0, MAX_KEYWORDS);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Which watch-list entries appear in the text (whole words/phrases, so "gun" does not match "begun"). */
export function watchHits(text: string, keywords: string[]): string[] {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  return keywords.filter((k) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(k)}($|[^\\p{L}\\p{N}])`, 'u').test(t));
}

/** Wraps matches in the text with markers for display: returns [text, isHit][] segments. */
export function highlight(text: string, hits: string[]): [string, boolean][] {
  if (!hits.length) return [[text, false]];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${hits.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const out: [string, boolean][] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push([text.slice(last, m.index), false]);
    out.push([m[0], true]);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push([text.slice(last), false]);
  return out;
}
