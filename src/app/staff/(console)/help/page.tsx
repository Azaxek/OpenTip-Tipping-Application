import Link from 'next/link';
import { Card, PageTitle } from '@/components/staff/ui';
import { requireStaff } from '@/lib/session';

export const metadata = { title: 'Help' };

const TERMS: [string, string][] = [
  ['TIP ID', 'The random code a tipster gets (like 7K3M-92QD-X4PF). It is how you refer to a tip. It says nothing about who sent it.'],
  ['Passcode', 'The secret the tipster chose or was given. Only the tipster knows it; staff cannot see or reset it.'],
  ['Routing / teams', 'Each category sends tips to one or more teams. You see tips routed to your teams, or assigned to you.'],
  ['High-risk category', 'A category the program marked as serious (weapons, self-harm, abuse…). Its tips are pinned as priority.'],
  ['Watch list', 'Words the program chose to watch for. A tip containing one is pinned as priority and highlighted for you.'],
  ['On call', 'People who are emailed when someone presses Escalate now.'],
  ['Retention', 'Tips with no activity for the set number of days are deleted for good, with their files.'],
];

export default async function Help() {
  const s = await requireStaff();
  const admin = s.role === 'admin';
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle>Help</PageTitle>
      <p className="-mt-2 text-sm text-slate-700">A five-minute guide. Everything here also works on a phone. Prefer to be shown? <Link href="/staff?tour=1" className="link">Take the one-minute tour</Link>.</p>

      <Card title="Working a tip, step by step">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li><strong>Open the Queue.</strong> The tabs show what needs you: <em>Needs reply</em> (the tipster wrote last), <em>Urgent</em> (pinned in red), <em>Mine</em> (assigned to you). The number on a tab is exact. The page refreshes itself, and the browser tab title shows how many are waiting.</li>
          <li><strong>Read the tip.</strong> Photos, video, audio and PDFs open on the page, and their hidden details (location, camera) were already removed. Words from the watch list are highlighted.</li>
          <li><strong>Reply in the chat.</strong> The tipster sees your reply within a few seconds but never your name. <em>Insert canned response…</em> drops in a saved reply. Ask for what you need (where, when, who) and never ask who they are.</li>
          <li><strong>Make notes.</strong> Internal notes are for staff only; the tipster never sees them.</li>
          <li><strong>Move it along.</strong> Mark it <em>Under review</em> or <em>Actioned</em>, assign it to a person, or change which teams can see it.</li>
          <li><strong>Close it</strong> when nothing more is needed, with a reason. A closed tip can be reopened.</li>
        </ol>
      </Card>

      <Card title="What the badges mean">
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt><span className="badge bg-red-700 text-white">URGENT</span></dt><dd>The tipster said it is urgent, the category is high-risk, or it matched the watch list. Handle these first.</dd>
          <dt><span className="badge bg-orange-100 text-orange-900">Watch list</span></dt><dd>It contains a word the program is watching for.</dd>
          <dt><span className="badge bg-indigo-100 text-indigo-900">Awaiting reply · 3h</span></dt><dd>The tipster is waiting for you, and for how long.</dd>
          <dt><span className="badge bg-red-100 text-red-900">Overdue · 30h</span></dt><dd>Waiting longer than the program's reply target.</dd>
          <dt><span className="badge bg-slate-100 text-slate-800">Phone</span></dt><dd>A staff member typed it in from a call or visit. The caller has a TIP ID and passcode.</dd>
        </dl>
      </Card>

      <Card title="Taking a tip by phone or in person">
        <p className="text-sm">Use <Link href="/staff/tips/new" className="link">+ Log a phone or walk-in tip</Link> on the Queue. Type what the caller says (leave out their own name and number), save, then read the TIP ID and passcode aloud and ask them to write both down. The passcode is shown once. If someone is in danger right now, make sure they have called 911.</p>
      </Card>

      <Card title="Prank and false tips">
        <p className="text-sm">Some tips are jokes, mistakes or a grudge. Read it, ask one calm question if it is unclear, and if it does not hold up, close it as <em>Unfounded</em> with a one-line note on why. Do not try to work out who sent it: nobody here can, and trying breaks the promise that makes people use the line. If the same thing keeps arriving, search for the repeated words on the Queue, note the pattern, and tell your coordinator. When a tip mentions a weapon or self-harm, treat it as real until you know otherwise.</p>
      </Card>

      <Card title="Emergencies: Escalate now">
        <p className="text-sm">On an urgent tip, <strong>Escalate now</strong> emails the people who are on call and posts to your chat channel at the same moment, and the page tells you which channels worked. If it says <strong>no alert was delivered</strong>, phone your on-call contact directly. Escalating alerts a person; it does not call 911 and it does not handle the situation. Your program's own protocol says what that person does.</p>
      </Card>

      <Card title="Rewards">
        <p className="text-sm">On the tip, enter an amount (or tap a quick amount) and <em>Mark eligible</em>. The tipster signs in and taps <em>Show my claim code</em>, which appears once. When they come to claim, enter their TIP ID and code on the <Link href="/staff/rewards" className="link">Rewards</Link> page. Payment itself happens outside this app.</p>
      </Card>

      <Card title="Your account">
        <p className="text-sm">Change your password and turn on two-step sign-in (a 6-digit code from an authenticator app) under <Link href="/staff/account" className="link">your name</Link> at the top right. Two-step sign-in is strongly recommended: it keeps a stolen password from exposing tips.</p>
      </Card>

      {admin && (
        <Card title="For administrators">
          <ul className="list-disc space-y-2 pl-5 text-sm">
            <li>The <strong>Getting started</strong> checklist on the Queue ticks itself off as you finish each step.</li>
            <li><Link href="/staff/settings" className="link">Settings</Link>: who gets alerted about new tips, the watch list, the reply target, evidence limits, retention, and the text tipsters read (in English and Spanish). <em>Send a test alert</em> and <em>Test evidence storage</em> prove those connections work.</li>
            <li><Link href="/staff/settings/people" className="link">People</Link>: add staff, choose who is on call and who gets new-tip emails, reset a password or someone's two-step sign-in.</li>
            <li><Link href="/staff/bulletins" className="link">Bulletins</Link>: publish wanted and case notices with a photo. Each gets an <em>I have information</em> button linked to the anonymous form.</li>
            <li><Link href="/staff/materials" className="link">Materials</Link>: poster, QR code and parent letter. Check the address shown there is your real website before you print.</li>
            <li>24/7 coverage is a staffing decision, not a feature: decide who answers urgent alerts and write it down before you promote the line.</li>
          </ul>
        </Card>
      )}

      <Card title="Words you will see">
        <dl className="space-y-2 text-sm">
          {TERMS.map(([t, d]) => <div key={t}><dt className="inline font-semibold">{t}: </dt><dd className="inline">{d}</dd></div>)}
        </dl>
      </Card>
    </div>
  );
}
