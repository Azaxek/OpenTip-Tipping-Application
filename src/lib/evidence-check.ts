/**
 * Client-side pre-check for evidence files. Mirrors the server allowlist in media.ts (ACCEPT), so nobody finds out at the
 * very last step, after typing their passcode, that a file was never going to be accepted.
 */
import { en } from './i18n/en';

export type EvidenceLimits = { imageMb: number; docMb: number; avMb: number; tipMb: number; maxFiles: number };

const EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/x-m4a', wav: 'audio/wav', ogg: 'audio/ogg', pdf: 'application/pdf',
};
const KIND: Record<string, 'image' | 'doc' | 'av'> = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image', 'application/pdf': 'doc',
  'video/mp4': 'av', 'video/quicktime': 'av', 'video/webm': 'av', 'audio/mpeg': 'av', 'audio/mp4': 'av', 'audio/x-m4a': 'av', 'audio/wav': 'av', 'audio/ogg': 'av',
};

export const mimeOf = (f: { name: string; type: string }) => f.type || EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] || '';

type EvMessages = Record<'evHeic' | 'evType' | 'evOver' | 'evKindImage' | 'evKindDoc' | 'evKindAv' | 'evCount' | 'evTotal', string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

/** Returns a plain-language reason the file can't be added (in the visitor's language), or null when it is fine. */
export function checkEvidence(file: { name: string; type: string; size: number }, existing: { size: number }[], limits: EvidenceLimits, m: EvMessages = en): string | null {
  const mime = mimeOf(file);
  if (/heic|heif/i.test(mime) || /\.(heic|heif)$/i.test(file.name)) return m.evHeic;
  const kind = KIND[mime];
  if (!kind) return fill(m.evType, { name: file.name });
  const capMb = kind === 'image' ? limits.imageMb : kind === 'doc' ? limits.docMb : limits.avMb;
  if (file.size > capMb * 1048576) return fill(m.evOver, { name: file.name, mb: capMb, kind: kind === 'image' ? m.evKindImage : kind === 'doc' ? m.evKindDoc : m.evKindAv });
  if (existing.length >= limits.maxFiles) return fill(m.evCount, { max: limits.maxFiles });
  if (existing.reduce((n, x) => n + x.size, file.size) > limits.tipMb * 1048576) return fill(m.evTotal, { mb: limits.tipMb });
  return null;
}
