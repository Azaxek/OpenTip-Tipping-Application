import { pushConfigured } from './push';
import { storageConfigured } from './storage';

export type Check = { label: string; ok: boolean; critical: boolean; fix: string };

/** Plain-language health checks for the setup page and admin console. Never exposes secret values. */
export function readiness(): Check[] {
  const has = (k: string) => !!process.env[k];
  const demo = process.env.DEMO_MODE === '1';
  const storage = storageConfigured();
  return [
    { label: 'Secret key (APP_SECRET)', ok: (process.env.APP_SECRET?.length ?? 0) >= 32, critical: true, fix: 'Run `npm run keys` and set APP_SECRET.' },
    ...(demo ? [{ label: 'DEMO MODE is ON (sample data, relaxed bot protection)', ok: false, critical: false, fix: 'Fine for a demonstration. Remove DEMO_MODE before collecting real tips.' }] : []),
    { label: 'Bot protection (Cloudflare Turnstile)', ok: has('TURNSTILE_SECRET_KEY') && has('NEXT_PUBLIC_TURNSTILE_SITE_KEY'), critical: process.env.NODE_ENV === 'production' && !demo, fix: 'Create a free Turnstile widget and set NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY. In production, tip submission stays closed until this is set.' },
    { label: 'Evidence storage (private bucket)', ok: storage, critical: false, fix: 'Set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (and S3_ENDPOINT). Without it, tips with attachments will fail.' },
    { label: 'Escalation email (Resend)', ok: has('RESEND_API_KEY') && has('RESEND_FROM'), critical: false, fix: 'Set RESEND_API_KEY and RESEND_FROM, or rely on a Slack/Discord webhook (Settings).' },
    { label: 'Push notifications for tipsters', ok: pushConfigured(), critical: false, fix: 'Optional. Run `npm run keys` for VAPID keys.' },
    { label: 'Scheduled retention purge (CRON_SECRET)', ok: has('CRON_SECRET'), critical: !demo, fix: 'Set CRON_SECRET so the daily purge job can run. Without it, old tips are never deleted.' },
    { label: 'Public URL (APP_URL)', ok: has('APP_URL') || has('VERCEL_PROJECT_PRODUCTION_URL'), critical: false, fix: 'Set APP_URL so QR codes and escalation links point at the right address.' },
  ];
}
