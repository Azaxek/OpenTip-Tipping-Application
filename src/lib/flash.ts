import { redirect } from 'next/navigation';

/**
 * One-line messages shown at the top of the next console page: green for `ok`, red for `e`.
 * Server actions put them in the address (?ok=… / ?e=…) because a redirect is the only thing that survives a form post;
 * the page's <Flash> reads them back and removes them from the address so a reload does not repeat them.
 */
export type FlashKind = 'ok' | 'e';

export const flash = (kind: FlashKind, message: string) => `${kind}=${encodeURIComponent(message)}`;

// A function declaration (not an arrow): only declared functions let TypeScript know the code after a call is unreachable.
export function redirectWithFlash(path: string, kind: FlashKind, message: string): never {
  redirect(`${path}?${flash(kind, message)}`);
}
