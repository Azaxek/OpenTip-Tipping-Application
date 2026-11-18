/** Public base URL: APP_URL if set, else Vercel's production domain (so a demo needs no extra setting), else localhost. */
export const appUrl = () =>
  (process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/$/, '');

/** The one organization slug a demo deployment is allowed to hold. Anything else in the database is a real program. */
export const DEMO_SLUG = 'demo';

/** True only when DEMO_MODE=1. Demo deployments are pre-seeded and relax bot protection; never enable on a real tip line. */
export const demoMode = () => process.env.DEMO_MODE === '1';
