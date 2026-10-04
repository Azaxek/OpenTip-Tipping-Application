# OpenTip

**Live demo:** [opentip-demo.vercel.app](https://opentip-demo.vercel.app/)  ·  **Built with:** Next.js 16, TypeScript, Tailwind, PostgreSQL (row-level security), Cloudflare R2 + Turnstile, Web Push

A free, self-hostable **anonymous tip line** for Crime Stoppers programs, schools and districts. It is built to match the working feature set of commercial products such as P3 Tips / P3 Campus, with no per-seat or per-program license, and to put **tipster anonymity ahead of convenience** everywhere the two conflict.

> **Not a 911 replacement.** The tip form is not monitored in real time. A non-removable "call 911" banner is shown above every form. Read [ESCALATION-PROTOCOL.md](ESCALATION-PROTOCOL.md) before you launch.

## What it does

| Area | Included |
|---|---|
| Submission | Mobile-first PWA (installable, no app store). Location → category → urgency → description (5,000 chars) → evidence → passcode. Two default taxonomies (Crime Stoppers, Campus), editable any time. |
| Identity | No accounts. A random **TIP ID** plus a passcode the tipster chooses. Passcodes are stored only as argon2id hashes; nothing can be recovered. |
| Evidence | Photo, video, audio and PDF. Uploaded straight to private storage, then every file has its metadata stripped **on the server** before it is kept. |
| Follow-up | Live two-way anonymous chat, status tracking, optional Web Push ("You have an update on your tip", never any content). |
| Rewards | Reviewer sets eligibility and amount; tipster gets a one-time claim code (stored hashed); staff redeem it and the claim is logged. Payout stays outside the app. |
| Reviewer console | Queue with filters/sort, urgent pinning, team and location routing, assignment, internal notes, canned responses, closure reasons, audit trail. |
| Escalation | One click alerts on-call staff by email and Slack/Discord webhook simultaneously, logs it, and shouts if nothing could be delivered. |
| Analytics | Volume, categories, closure reasons, median/average time to first response and to closure, rewards paid. CSV and PDF export (exports are audit-logged). Aggregates only. |
| Schools | SIS **location-list** CSV connector (rejects any file with student data columns) and a documented connector interface. |
| Rollout | Poster/flyer PDF with QR, editable parent/community letter PDF, QR PNG. |
| Compliance | Retention purge (tips, files, sessions, audit rows), in-app privacy notice that CI checks against the real schema. |

## Try it locally (about 3 minutes, no accounts)

```bash
npm install
npm run keys              # prints APP_SECRET, SETUP_TOKEN, VAPID keys… copy them into .env.local
npm run dev:db            # local Postgres (prints the DATABASE_URL lines to add to .env.local)
npm run dev               # http://localhost:3000  → the setup wizard opens
```

Put this in `.env.local` (use the values printed above):

```
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres
PG_POOL_MAX=1
PG_SIMPLE_PROTOCOL=1
STORAGE_DRIVER=fs
APP_URL=http://localhost:3000
```

`npm run dev:db` and `STORAGE_DRIVER=fs` are for **local trials only**. Production uses Neon/Supabase and Cloudflare R2 (see below).

## Deploy for free

Full click-by-click steps are in [DEPLOYMENT.md](DEPLOYMENT.md). In short: GitHub + Vercel Hobby + Neon (or Supabase) + Cloudflare (R2 and Turnstile), optionally Resend for email alerts. Nothing has a per-tip or per-seat cost.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAzaxek%2FOpenTip-Tipping-Application&env=DATABASE_URL,APP_SECRET,SETUP_TOKEN,CRON_SECRET,APP_URL,S3_ENDPOINT,S3_BUCKET,S3_ACCESS_KEY_ID,S3_SECRET_ACCESS_KEY,NEXT_PUBLIC_TURNSTILE_SITE_KEY,TURNSTILE_SECRET_KEY&envDescription=See%20DEPLOYMENT.md%20for%20where%20each%20value%20comes%20from)

(If you fork this repository, change the address in the button link to your fork.)

## Demo for a sponsor

Need to show it to someone? [DEMO.md](DEMO.md) puts a fully populated fictional Crime Stoppers program (sample tips, evidence, chat, rewards, ten weeks of analytics, and a built-in presenter guide) on Vercel in about 10 minutes using only Vercel and Neon.

## Documentation

| File | Audience |
|---|---|
| [ADMIN-GUIDE.md](ADMIN-GUIDE.md) | Program coordinators (non-technical) |
| [ESCALATION-PROTOCOL.md](ESCALATION-PROTOCOL.md) | A template **you** fill in: on-call rotation and 911-vs-app guidance |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Whoever sets up hosting |
| [DEMO.md](DEMO.md) | Presenters: a ready-to-show demo deployment |
| [UX-AUDIT-AND-ROADMAP.md](UX-AUDIT-AND-ROADMAP.md) | What was tested from the tipster, administrator and reviewer seats, what was fixed, and the plan to make this the best tip line |
| [SECURITY.md](SECURITY.md) | Security and legal review: exactly what is and is not protected |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Developers |

## How anonymity is enforced (short version)

* No IP, user agent or device data is ever written anywhere. Rate limiting is in process memory only. Turnstile is called without the client IP.
* Every tipster-facing table is on an **exact column allowlist** that also drives the public privacy notice; a CI test fails if the schema and the notice ever disagree, or if a column name looks identifying.
* Uploads are sniffed by their real bytes, and re-encoded/re-muxed to remove EXIF, GPS, XMP, container tags and PDF author data before storage. Original file names are never stored.
* Tenants are isolated by **Postgres row-level security**, not just application checks.
* Push notifications carry no payload at all, so nothing can show on a lock screen.

The honest limits are in [SECURITY.md](SECURITY.md): hosting providers still see network metadata at their layer, and what a tipster *writes* can identify them.

## Deployment models

* **Model A (default):** one organization per deployment. Each program forks the repo and runs on its own free accounts: full data ownership.
* **Model B (fast-follow):** one shared deployment serving several programs on subdomains. The database is already tenant-scoped with RLS and every query goes through one org-resolution function (`src/lib/org.ts`); what remains is host-based routing and per-tenant domains. Model A and B share one schema.

## Testing

```bash
npm test          # real migrations on in-process Postgres, no services required
npm run typecheck
npm run build
```

## Status and scope

Out of scope by design: integration with law-enforcement systems or 911 dispatch, tipster identity verification, payout processing, student roster data, and any crisis counseling (canned responses only point to static resources).

No license file is included yet. Add the license you intend before publishing the repository.
