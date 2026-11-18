import type { Staff } from './staff';

/** One stop on the console tour. `target` is the value of a `data-tour` attribute on the page; null means a centred welcome card. */
export type TourStep = { target: string | null; title: string; body: string; admin?: boolean };

/**
 * The tour is data, not markup, so the wording lives in one place and a test can check that every anchor still exists.
 * Keep each body short: it is a tour, not the manual (that is the Help page).
 */
const STEPS: TourStep[] = [
  { target: null, title: 'Welcome to the queue', body: 'Every tip sent to your program lands here, and the page refreshes by itself. This takes about a minute. Press Esc to stop; you can restart it any time from the Tour button.' },
  { target: 'tabs', title: 'Start with a view', body: 'Needs reply means the tipster wrote last and is waiting. Urgent tips are pinned in red. Mine are assigned to you. The numbers are exact.' },
  { target: 'search', title: 'Find a tip', body: 'Type a TIP ID (or part of one), or any word from the tip, the chat or the internal notes.' },
  { target: 'list', title: 'Open a tip to work it', body: 'Click a TIP ID to read it, chat with the tipster (they never see your name), add private notes, assign it and close it with a reason. Badges show urgency, watch-list matches and how long a tipster has waited.' },
  { target: 'phone-tip', title: 'Took a call? Log it here', body: 'Type what the caller said, then read them the TIP ID and passcode so they can check back anonymously. Never write down their name or number.' },
  { target: 'nav-rewards', title: 'Rewards', body: 'Where you confirm a tipster’s claim code when they come to collect. The payment itself happens outside OpenTip.' },
  { target: 'nav-settings', admin: true, title: 'Settings', body: 'Who is alerted about new tips, the watch list, the reply target, retention and the text tipsters read. Use Send a test alert before you go live.' },
  { target: 'nav-materials', admin: true, title: 'Posters and letters', body: 'Print the poster with its QR code and the parent letter. Check that the address shown there is your real website first.' },
  { target: 'account', title: 'Protect your account', body: 'Turn on two-step sign-in here: a 6-digit code from an authenticator app. It keeps a stolen password from exposing tips.' },
  { target: 'nav-help', title: 'Help is always here', body: 'A plain-language guide to every badge and screen, and the button to run this tour again.' },
];

export const tourSteps = (role: Staff['role']): TourStep[] => STEPS.filter((s) => !s.admin || role === 'admin');
