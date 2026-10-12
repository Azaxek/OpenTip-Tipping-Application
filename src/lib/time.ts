/** True for an IANA time zone name this runtime understands, e.g. "America/Chicago". */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date (YYYY-MM-DD) it is right now in the given zone, optionally some days back. */
export function dayIn(tz: string, daysBack = 0, now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: isTimeZone(tz) ? tz : 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now - daysBack * 86_400_000);
}

export const allTimeZones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
  }
};
