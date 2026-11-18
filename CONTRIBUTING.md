# Contributing

Thank you for helping. This project holds tips from people who are trusting it with their safety, so the bar on anonymity is higher than in a typical web app.

## Setup

```bash
npm install
npm run keys        # secrets for .env.local
npm run dev:db      # local Postgres (PGlite) for trials
npm run dev
npm run check       # typecheck + lint + tests: run this before every push
npm run test:coverage
npm run build
```

Start with [ARCHITECTURE.md](ARCHITECTURE.md): the map of the code, how a tip and a reviewer action flow through it, and the rules that keep it safe.

Tests run the real SQL migrations on in-process Postgres (PGlite), so they exercise real row-level security and real bind parameters. No mocks of the database. To run the same suite against a real server (CI does this on PostgreSQL 16), point `TEST_DATABASE_URL` at any Postgres you can create databases on; each test file gets a throwaway database:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

## Anonymity rules (a PR that breaks one will not be merged)

1. **Never read, log, store or forward IP addresses, user agents, or other request metadata** on tipster-facing code. The only permitted reader of client-address headers is `src/lib/ratelimit.ts`, and it keeps them in memory. A test enforces this.
2. **Adding a column to `tips`, `messages`, `media` or `push_subscriptions`?** You must also add it, with a plain-language description, to `TIPSTER_DATA` in `src/lib/transparency.ts`. The public privacy notice is generated from it and a test fails if they differ. A column that could identify a person or device will not be accepted.
3. **No third-party scripts, analytics, fonts or trackers** on tipster pages. Turnstile is the only exception.
4. **Secrets are hashed** (argon2id). Nothing reversible, nothing logged.
5. **Evidence is never stored unsanitized.** New file types need a strip-and-verify test in `tests/media.test.ts`.
6. **The 911 banner stays**: `EmergencyBanner` takes no props that reword or hide it.
7. **Every tenant table gets `org_id` and an RLS policy**, and is added to the list in `tests/tenancy.test.ts`.
8. **Every staff action on a tip goes through the shared guard** in `src/lib/queue.ts` so team routing cannot be bypassed. `tests/routing-guard.test.ts` fails the build if a new action skips it.
9. **Outbound URLs that an administrator types in** (the alert webhook) go through `assertPublicHttpsUrl` in `src/lib/outbound.ts`.
10. **Alerts never contain tip text** or which watch-list words matched.

## Layout

See the repository map and the per-job module table in [ARCHITECTURE.md](ARCHITECTURE.md). In short: SQL in `db/migrations/`, all logic in `src/lib/`, thin routes in `src/app/api/`, the console in `src/app/staff/`, and tests in `tests/`.

## Conventions

* **No `any` in production code** (the linter enforces it). Untrusted input is `unknown` and narrowed; every database query names its row type next to the SQL.
* Keep route handlers thin; put logic in `src/lib` and test it there.
* Comments say *why* (a constraint, a trade-off, a past bug), not what the code already says.
* Never lower the coverage floor in `vitest.config.mts` to make a build pass; add the missing test.
* Migrations are append-only: never edit one that has been applied.
* Don't nest `withOrg` calls (deadlocks small connection pools).
* Parameters must all be referenced in the SQL (real Postgres rejects unused bind parameters).
* Prefer the platform and the standard library to new dependencies. Every dependency parses hostile input somewhere; justify additions.
* Write the smallest change that solves the problem, with a test for anything that touches a trust boundary.

## Adding an SIS connector

Implement `LocationConnector` in `src/lib/sis.ts` (return `{externalId, name}[]` for schools only, never student data), then call `syncLocations(admin, connector)` from an admin action or a cron route. Add a test like the CSV ones.

## Reporting security issues

Privately, via your fork's GitHub “Report a vulnerability”, not a public issue.
