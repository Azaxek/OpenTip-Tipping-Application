# Architecture

How OpenTip is put together, where to look, and the rules that keep it safe. Read this first; [CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow and [SECURITY.md](SECURITY.md) the threat model.

## The one rule

**Anonymity beats convenience.** A tipster is never asked for, and the system never records, anything that identifies them. Every design choice below follows from that, and several automated tests exist only to stop it from eroding.

## System at a glance

```
 Tipster browser ─────────────┐                      ┌── Postgres (Neon / Supabase), row-level security
 (no account, no cookies)     │                      │
                              ▼                      │
 Staff browser ──────►  Next.js app (Vercel)  ───────┼── Object storage (Cloudflare R2): evidence, private
 (cookie session, 2-step)     │  App Router          │
                              │  server actions      ├── Email (Resend) and chat webhook: alerts, no tip content
 Phone (optional) ── SMS ─────┘  route handlers      └── Cloudflare Turnstile: bot check
```

One deployment serves one organization (`getOrg()` in `src/lib/org.ts` is the single place that decides which). The schema already carries `org_id` everywhere, so serving several organizations is a change in that one function, not a rewrite.

## Repository map

| Path | What lives here |
|---|---|
| `db/migrations/` | Plain SQL, append-only, applied in order by `scripts/migrate.mjs` (also on every Vercel build). Never edit an applied migration; add a new one. |
| `src/lib/` | **All business logic.** Plain TypeScript, no React, testable without a browser. |
| `src/app/api/` | Thin public routes: rate limit → size cap → bot check → validate → call `src/lib`. |
| `src/app/staff/` | Reviewer and admin console: server components for pages, server actions (`actions.ts`, `admin-actions.ts`) for changes. |
| `src/app/[lang]/`, `src/app/{submit,check,privacy,wanted}/` | Public pages. English lives at the plain path, other languages under `/es/…`; both render the same components in `src/components/pages/`. |
| `src/components/` | Client components for the tip form, chat, push opt-in; `staff/` for console widgets. |
| `tests/` | Vitest suites. `tests/helpers.ts` builds organizations, staff and tips. |

### The library, by job

| Concern | Modules |
|---|---|
| Database and tenancy | `db.ts` (`withOrg`, `system`), `org.ts`, `setup.ts`, `taxonomy.ts` |
| Tipster side | `tipster.ts` (submit, sign in, chat, claim code), `ids.ts`, `push.ts`, `bulletins.ts`, `passphrase.ts`, `evidence-check.ts` |
| Evidence | `uploads.ts` (plan and ingest), `media.ts` (type sniffing, metadata stripping), `storage.ts` (S3 / filesystem / demo) |
| Staff side | `staff.ts` (sign-in, sessions, the visibility rule), `queue.ts` (everything a reviewer does), `two-step.ts` + `totp.ts`, `phone-tip.ts`, `audit.ts` |
| Alerts | `notify.ts` (new tips and replies), `escalation.ts` (Escalate now, test alert), `outbound.ts` (safe outbound URLs), `watch.ts` (keyword watch list), `after.ts` |
| Reporting and admin | `analytics.ts`, `export.ts`, `materials.ts`, `sis.ts`, `purge.ts`, `readiness.ts` |
| Cross-cutting | `crypto.ts` (argon2id, signed tokens, sealed secrets), `ratelimit.ts`, `turnstile.ts`, `http.ts`, `transparency.ts`, `flash.ts`, `time.ts`, `url.ts`, `i18n/` |

## How the important flows work

### A tip arrives

1. The form (`SubmitWizard`) asks for a Turnstile token, then for each file calls `POST /api/upload/init`. The server checks the declared types and sizes against the organization's limits and returns short-lived **presigned URLs**; the browser uploads straight to the private bucket (Vercel functions cap request bodies at ~4.5 MB).
2. `POST /api/tips` (`src/app/api/tips/route.ts`): `publicPost()` applies the rate limit, size cap and Turnstile check; zod validates the body; `createTip()` inserts the row (argon2id-hashing the passcode), routes it to teams from the category, and records any watch-list words found.
3. `ingest()` downloads each raw upload from `quarantine/`, **detects the real type from the bytes**, rewrites it with all metadata removed, stores it under a random key in `media/`, and deletes the raw file.
4. `afterResponse(() => alertStaff(…))` emails opted-in staff and posts to the chat webhook **after** the tipster already has their TIP ID. Alerts carry the TIP ID, category and a link; never tip text, never which watch words matched.
5. The tipster receives a stateless HMAC-signed token (kept in the tab's `sessionStorage`, 2 hours). Nothing about the session exists server-side.

### A reviewer acts on a tip

```
server action ─► requireStaff() ─► run(back, fn)
                                      └► queue.ts function ─► withOrg(orgId, tx) ─► need(guard(visible(staff)))
                                                                                  ├► the change
                                                                                  └► audit(…)   (same transaction)
                                   ◄─ redirectWithFlash(back, 'ok', "Marked as actioned.")
```

* **`withOrg()`** opens a transaction, drops to the `opentip_app` database role (which has no `BYPASSRLS`) and pins `app.org_id`. Postgres row-level security then makes cross-tenant access impossible even if application code is wrong. `system()` (the owner role) is used only for first-run setup, the cron job and the session lookup.
* **`guard()` / `need()`** in `queue.ts` is the *only* way a staff action loads a tip. It applies `visible()` (`staff.ts`): admins and "see all tips" staff see everything, others only tips routed to their teams or assigned to them. Any new staff action must start with `need()`. `tests/routing-guard.test.ts` runs every action as a reviewer outside the tip's teams (all must be refused and change nothing) and scans `queue.ts` so an action that skips the guard fails the build.
* The audit row is written **in the same transaction** as the change, so the two commit or roll back together.
* Problems a person can fix come back as a typed `StaffInputError` and become a red banner, not a crash. Successes always say what happened (`flash.ts`).

### Sign-in for staff

Email and password (argon2id) with a per-account lockout (5 wrong tries → 15 minutes). An account may turn on two-step sign-in (`two-step.ts`, `totp.ts`): the authenticator secret is **encrypted with `APP_SECRET`** (`crypto.seal`) so a database-only leak cannot mint codes; each code is accepted once (the last used 30-second step is stored); wrong codes count toward the same lockout as wrong passwords. Sessions are random 256-bit tokens in an httpOnly cookie; only their SHA-256 is stored.

### Priority

A tip is priority when **any** of: the tipster said urgent, its category is high-risk, or it matched the keyword watch list (`PRIORITY` in `queue.ts` is the one SQL definition; the queue, counts, alerts and escalation all use it).

### Retention

`/api/cron/purge` (Vercel Cron, daily, `CRON_SECRET` bearer) deletes tips idle past the organization's retention along with messages, notes, files and push subscriptions. Files are deleted **before** rows: if a file cannot be deleted the tip is kept and retried, so evidence is never orphaned.

## Data and privacy

* `TIPSTER_DATA` in `transparency.ts` lists every column of the tipster-facing tables (`tips`, `messages`, `media`, `push_subscriptions`) with a plain-language description. The public privacy page is rendered from it, and `tests/anonymity.test.ts` compares it with the **live schema**, so a column cannot be added without the notice changing.
* The in-memory rate limiter (`ratelimit.ts`) is the only code allowed to read client-address headers. Addresses are never written to a database, log or file. A test scans the source to enforce this.
* The audit log records **staff** identity only.

## Languages

Everything a tipster reads is in `src/lib/i18n/en.ts` (the source of truth). `es.ts` is typed as `Record<MessageKey, string>`, so a missing key is a compile error, and `tests/i18n.test.ts` checks that placeholders match. The language is part of the address (`/es/submit`), so no cookie or setting is stored. Text the organization writes itself (categories, "what to expect", help resources) stays in the language they wrote it in, with optional Spanish versions.

## Testing

| Layer | How |
|---|---|
| Unit and integration | Vitest. Each test file gets its **own empty database with the real migrations**: in-process Postgres (PGlite) by default, or a real server when `TEST_DATABASE_URL` is set (CI does both). No database mocks. |
| Invariants | Anonymity (columns, headers, third-party scripts), tenant isolation on every table, routing guard, rate limits, retention, metadata stripping, 911 banner, translation completeness. |
| Quality gates | `npm run check` = typecheck + lint + tests. CI adds coverage (floor in `vitest.config.mts`, can only go up), a real-Postgres run, a production build and a dependency audit. |

## Conventions

* **No `any` in production code.** Untrusted input is `unknown` and is narrowed; every database query names its row type beside the SQL (`QueueRow`, `TipDetailRow`, …).
* Route handlers and server actions stay thin; logic lives in `src/lib` and is tested there.
* Comments explain *why* (a constraint, a trade-off, a past bug), not what the code already says.
* Never nest `withOrg` (it holds a pooled connection). All bind parameters must be used in the SQL (real Postgres rejects unused ones).
* Prefer the platform to a dependency. Each dependency parses hostile input somewhere.

## Decisions and trade-offs

| Decision | Why | Cost |
|---|---|---|
| Chat polls every 3 s through our own server | No third-party realtime service ever sees the connection | Slightly slower than websockets; fine at tip-line volume |
| Rate limiter in memory, per server instance | Zero stored addresses; simple | On serverless it is approximate across instances. Turnstile and per-TIP-ID lockout are the real brakes |
| Four-word generated passcodes (36 bits) | Memorable, typed once, much stronger than what people pick | Safe only because of the per-TIP-ID lockout; both are tested |
| Bulletin photos stored in the database | No public bucket to misconfigure; small after re-encoding | Not for large media |
| Privacy notice is English-only, with a short accurate Spanish summary | A translated legal-ish inventory that drifts from the schema is worse than none | Spanish readers get the summary and a link |
| Alert webhook is checked for private addresses at save **and** send time | Stops server-side request forgery | A hostile DNS server could answer differently between check and call (documented in `outbound.ts`); only admins can set the URL |
| Text-to-tip replies with a link and never reads the sender | Keeps phone numbers out of the system | The carrier and SMS provider still see the number; the docs say so |

## Recipes

* **Add a database column:** new file in `db/migrations/` (next number). If it is on a tipster-facing table, add it to `TIPSTER_DATA`. Add the field to the row type next to the query that reads it.
* **Add a setting:** column on `organizations` → `Org` type in `org.ts` → zod schema, labels and `UPDATE` in `saveOrgAction` → field in the settings page → a test.
* **Add a language:** copy `i18n/en.ts` to a new file typed `Record<MessageKey, string>`, add it to `LANGS`/`TABLE` in `i18n/index.ts`, add its built-in category names to `i18n/es-defaults.ts`' pattern; the tests tell you what is missing.
* **Add a staff action on a tip:** write the function in `queue.ts` starting with `need(q, s, tipId)`, audit it, add a server action in `actions.ts` that calls it through `run()` with a confirmation message, and test that a reviewer outside the routed team cannot use it.
