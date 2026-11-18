import { withOrg } from './db';
import type { Staff } from './staff';

export type OnboardingStep = { id: string; title: string; why: string; href: string; done: boolean };

/**
 * The "Getting started" checklist an administrator sees until the program is ready to announce. Every step is ticked from what is
 * actually recorded (the audit log, the people list, the tips table), never from a button that says "mark done", so it cannot
 * claim a test alert worked when it did not.
 */
export async function gettingStarted(s: Staff): Promise<{ steps: OnboardingStep[]; done: number }> {
  const f = await withOrg(s.orgId, async (q) => {
    const [row] = await q<{ team: number; wording: boolean; alert: boolean; poster: boolean; tips: number; twostep: boolean }>(
      `select (select count(*)::int from reviewers where active) as team,
              exists (select 1 from audit_log where action = 'settings.org') as wording,
              exists (select 1 from audit_log where action = 'alert.test' and detail ->> 'delivered' = 'true') as alert,
              exists (select 1 from audit_log where action = 'materials.download') as poster,
              (select count(*)::int from tips) as tips,
              coalesce((select totp_enabled from reviewers where id = $1), false) as twostep`,
      [s.id],
    );
    return row;
  });
  const steps: OnboardingStep[] = [
    { id: 'team', title: 'Add your team', why: 'Reviewers see only the tips routed to their teams, and someone has to be on call.', href: '/staff/settings/people', done: f.team >= 2 },
    { id: 'wording', title: 'Check what tipsters read after they submit', why: 'Be honest about when a person reads tips, and replace the sample help numbers with ones for your area.', href: '/staff/settings', done: f.wording },
    { id: 'alert', title: 'Send a test alert', why: 'Proves an urgent tip would actually reach someone, before you need it.', href: '/staff/settings', done: f.alert },
    { id: 'twostep', title: 'Turn on two-step sign-in for yourself', why: 'A stolen password is the most realistic way tips could be exposed.', href: '/staff/account', done: f.twostep },
    { id: 'poster', title: 'Download your poster and QR code', why: 'This is how the public finds the tip line.', href: '/staff/materials', done: f.poster },
    { id: 'practice', title: 'Send a practice tip', why: 'See exactly what a tipster sees, then answer it from the queue.', href: '/submit', done: f.tips >= 1 },
  ];
  return { steps, done: steps.filter((x) => x.done).length };
}
