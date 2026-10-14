import { after } from 'next/server';

/** Runs slow side work (alert emails) after the response is sent; outside a request (tests, scripts) it just runs. Never throws. */
export function afterResponse(fn: () => Promise<unknown>) {
  const run = () => fn().catch(() => {});
  try {
    after(run);
  } catch {
    void run();
  }
}
