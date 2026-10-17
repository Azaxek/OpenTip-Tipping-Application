'use client';
import { useEffect, useState } from 'react';

const OPTS = { dateStyle: 'medium', timeStyle: 'short' } as const;

/**
 * A timestamp shown in the reader's own time zone. The server cannot know it (on Vercel the server clock is UTC), so the first
 * paint is labelled UTC and the browser swaps in local time straight away.
 */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => `${new Date(iso).toLocaleString('en-US', { ...OPTS, timeZone: 'UTC' })} UTC`);
  useEffect(() => setText(new Date(iso).toLocaleString(undefined, OPTS)), [iso]);
  return <time dateTime={iso} title="Shown in your device's time zone" suppressHydrationWarning>{text}</time>;
}
