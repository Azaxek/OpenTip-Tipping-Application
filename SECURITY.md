# Security and privacy model (for legal and security review)

This document states plainly what OpenTip protects, how, what it does **not** protect, and what the deploying organization must verify. Please read the limits section before making any promise of anonymity to the public.

## 1. Design goal

A tipster can report and follow up with a reviewer without the system ever learning or storing who they are, and without staff being able to find out from OpenTip's data.

## 2. What is stored about a tip

Only four tipster-facing tables exist: `tips`, `messages`, `media`, `push_subscriptions`. Their columns are listed field-by-field, in plain language, in `src/lib/transparency.ts`, which also renders the public page `/privacy`. An automated test compares that list to the live database schema on every build, so a new column cannot appear without the public notice changing, and a second test rejects column names that look identifying (ip, user agent, email, phone, device, file name, coordinates, cookie, referrer, etc.).

Not stored anywhere: IP address, user agent, device identifiers, cookies (no tipster cookies at all), original file names, EXIF/GPS/camera data, request headers.

Staff identity (email, name) lives only in `reviewers`, `audit_log` and the `reviewer_id` on messages/notes. The audit log is append-only for the application's database role and records staff actions only.

## 3. Controls

| Area | Control |
|---|---|
| Passcodes, claim codes, staff passwords | argon2id hashes only; never stored or logged in plaintext or reversibly encrypted. A passcode is first keyed with `APP_SECRET` (HMAC) and then hashed, because a generated one is only 36 bits: a copy of the database alone cannot be used to guess passcodes offline. Changing `APP_SECRET` therefore locks tipsters out of existing tips, so treat it as permanent. Hashes written before the key existed are replaced on the tipster's next sign-in. Lookups for unknown IDs perform a dummy verification so timing does not reveal which TIP IDs exist. |
| How a passcode is compared | The same normalisation runs when a passcode is set and when it is checked: Unicode is normalised and the ends are trimmed, so a phone keyboard's trailing space or differently composed accent cannot lock a tipster out of their own tip. A passcode of exactly four words (what OpenTip generates) is also compared without case and with spaces as hyphens; every other passcode stays exact and case-sensitive. |
| Text the database cannot store | A NUL character is removed where text enters (public requests and staff forms) instead of failing the request. The migration refuses a database that is not UTF8, because on any other encoding a tip in Arabic, Chinese or with an emoji would be rejected. |
| TIP IDs (60 bits) and claim codes (80 bits) | CSPRNG (`crypto.randomInt`), non-sequential, unambiguous alphabet. |
| Guessing protection | Per-TIP-ID lockout (5 wrong passcodes → 15 min), per-account staff lockout, per-tip claim-code lockout, Cloudflare Turnstile on submit/login, and per-client rate limits. |
| Rate limiting | In process memory; the address is never written to a database, log or file. Anonymous endpoints are limited per client address but deliberately generously (60 submissions/hour, 60 sign-ins/15 minutes, 120 upload requests/hour), because schools and mobile carriers put many honest people behind one address. Signed-in actions (chat, polling, claim codes) are limited per tip, keyed by a random row id held in memory only. **Ceiling:** on serverless hosting each warm instance counts separately, so the limits are a speed bump, not a hard global cap; the lockouts and Turnstile carry the real weight. Swap in Upstash Redis if you need hard limits. |
| Turnstile | Called without the client IP. In production, submission and sign-in refuse to work if it is not configured. |
| Tipster sessions | A stateless HMAC-signed token in the browser tab's `sessionStorage` (2 h), carrying only a random internal row id. Nothing about the session is stored server-side. Not a cookie. |
| Staff sessions | Random 256-bit token in an httpOnly, SameSite=Lax (Secure in production) cookie; only its SHA-256 is stored; 7 days; revocable; cleared on sign-out, deactivation and password reset, and changing your own password signs out every other session. |
| Tenant isolation | Every tenant table has Postgres row-level security bound to a per-transaction organization setting, and requests run as a role without `BYPASSRLS`. Verified by a test that attempts cross-tenant reads, writes and deletes on every table. |
| Team routing | Reviewers see only tips routed to their teams or assigned to them (or all, with admin / “see all tips”). Enforced in one guard used by every staff action, including media, chat polling and reward redemption. |
| Evidence | Direct-to-private-storage upload via short-lived presigned URLs → real type detected from bytes (client-declared type ignored) → **metadata stripped server-side** → stored under a random key → raw upload deleted. Images: re-encoded (EXIF, GPS, XMP, IPTC, ICC removed; orientation baked in). Video/audio: stream-copy re-mux with all global metadata, chapters, cover art and data/GPS tracks dropped. PDF: rebuilt into a fresh document (no Info dict, no XMP), embedded JPEG EXIF removed losslessly, JavaScript actions removed. Anything that cannot be sanitized is discarded, never stored raw. |
| Two-step sign-in | Optional authenticator-app codes (RFC 6238). The secret is stored encrypted with `APP_SECRET`, so a database-only leak cannot mint codes. A code is accepted once; wrong codes count toward the same lockout as wrong passwords, so a stolen password cannot be used to guess codes. An administrator can reset someone who lost their phone; `npm run reset-2fa` covers the case where no one can sign in. |
| Outbound requests | The chat-webhook URL an administrator enters must be `https`, on the standard port, a public hostname, and every address it resolves to must be public (no private, loopback, link-local or cloud-metadata ranges). Checked when saved and again before every send. Push endpoints are limited to known push services. |
| Push | Payload-free: the service worker shows a fixed generic notification. Stored subscription endpoints are restricted to known push-service domains so the server cannot be pointed at internal addresses. |
| Content security | Restrictive CSP (Next.js's inline bootstrap scripts require `'unsafe-inline'`; nonce-based CSP is a possible hardening), `frame-ancestors 'self'`, `no-referrer`, `nosniff`, no third-party scripts except Turnstile, `no-store` on tipster and staff pages. CI test bans analytics/tracker strings and unexpected external hosts on tipster pages. |
| Alerts | New-tip and reply alerts go only to staff who opted in **and** may see that tip. They name the TIP ID, category and a link; they never contain the tip text or which watch-list words matched, because email and chat are less private than the console. |
| Supply chain | `package-lock.json` is committed; CI runs `npm audit` for high-severity advisories in production dependencies on every push; Dependabot opens weekly update pull requests. |
| Retention | Daily job deletes tips idle longer than the org's retention (with messages, notes, files, push subscriptions), raw uploads older than an hour, unreferenced media objects, expired sessions, and old audit rows. If a file cannot be deleted the tip is kept and retried, so evidence is never orphaned. |
| Audit | Staff actions (view, status, close, assign, route, reward, redemption, escalation, exports, settings, sign-in) are logged with staff identity, never tipster identity. |
| CSV/PDF exports | Aggregates only; formula-injection neutralized; the export itself is audit-logged. |

## 4. Honest limits (do not over-promise)

1. **Hosting providers see network metadata.** Whoever carries the traffic (Vercel, Cloudflare, Neon/Supabase, the tipster's ISP, their school network) can observe IP addresses at their layer. OpenTip does not record them, but it cannot prevent the provider from doing so. Follow the log/analytics checklist in DEPLOYMENT.md, record what you verified, and phrase promises as “this tip line does not record your IP address or device details”, not “you cannot be identified”.
2. **Content can identify a person.** A name, a distinctive detail, a voice, a face in a video, a shadow, a signature in a photo. Metadata stripping does not touch that. Consider telling tipsters (the privacy page and the form already do).
3. **Direct-to-storage uploads and Turnstile** involve the storage provider and Cloudflare in the tipster's connection.
4. **Push notifications** involve the browser vendor's push service and put a notification on the device. The text is generic, but its existence could be seen by someone using the device. Opt-in only, with a warning.
5. **Device security is out of scope.** A tipster's shared or monitored device can reveal that they visited, and browser history records the visit. The receipt card shows only the TIP ID. Every tipster page has a **Quick exit** button (and Esc twice) that wipes the tab's saved draft and session and replaces the page with a weather site, leaving no Back-button path to the tip line; nothing is loaded from that site until it is used.
6. **Untrusted file parsing.** Photos are decoded by libvips (sharp), audio/video by ffmpeg (stream copy, protocol whitelist restricted to local files, 60 s timeout, sanitized names), PDFs by pdf-lib. Keep dependencies updated. PDFs that embed non-JPEG images, or use unusual constructs, may retain image-level metadata that is not scrubbed; restricting documents to PDF and keeping size caps limits exposure. Consider disabling video/audio (set Max files to 0 or remove those types) if your risk appetite is low.
7. **Encryption at rest and backups are provider properties.** The app cannot enforce or test them. You must verify and record them (DEPLOYMENT.md §11). Deleted tips can persist in provider backups until those expire; the configured “provider backup window” is shown to tipsters, and the app cannot shorten it.
8. **Legal holds vs. retention.** The purge is automatic. If you must preserve a tip for legal reasons, export what you need and suspend the cron job (remove `CRON_SECRET` or the schedule) for the duration, with counsel's guidance.
9. **Mandated reporting.** Some organizations (schools) have legal duties on receipt of certain reports. OpenTip does not encode those duties; your policy must.
10. **No formal penetration test has been performed.** Commission one before high-stakes use.
11. **Staff compromise is the biggest realistic risk**: a stolen staff password exposes tip content (not tipster identity). Use unique long passwords. Turn on two-step sign-in (Account page) for every administrator and keep a second administrator as a backup.

12. **Text-to-tip.** The optional text-message reply links to the anonymous form and never reads or stores the sender, but the phone carrier and the SMS provider necessarily see the sender's number. A tipster who wants no phone trail should use the link from another device. In the US, SMS from an application also needs carrier registration (10DLC or toll-free verification).
13. **Alert webhooks.** The address check happens just before each request, so a hostile DNS server could in theory answer differently the second time (DNS rebinding). Only administrators can set the URL.

### Demo mode

`DEMO_MODE=1` (see DEMO.md) exists only for demonstrations. It allows the bot check to be absent, stores small files in the database instead of private object storage, simulates escalation alerts, publishes fictional credentials on the sign-in page, and wipes the program nightly. The database-storage driver refuses to start unless `DEMO_MODE=1`, every page shows a demo banner, and the readiness checklist flags it. A real tip line must never set it.

## 5. What the deploying organization must verify

- [ ] Log/analytics settings at Vercel, Cloudflare and the database provider (DEPLOYMENT.md §10).
- [ ] Encryption at rest at the database and object-storage providers.
- [ ] Backup retention window recorded in Settings.
- [ ] Turnstile configured; Settings checklist has no red items.
- [ ] Storage bucket is private (no public URL/domain).
- [ ] Escalation delivered end-to-end on every channel, and ESCALATION-PROTOCOL.md completed and staffed.
- [ ] Staff accounts use long unique passwords; departing staff are deactivated.
- [ ] Privacy notice reviewed by counsel; retention period matches your policy.

## 6. Automated checks (run in CI)

`npm test` covers: exact column allowlist and privacy-notice drift; no identifying columns; push table holds only the opaque subscription; no IP/UA header reads outside the in-memory limiter and no logging in tipster code; no third-party scripts on tipster pages; passcodes and claim codes hashed; ID randomness; the 911 banner present and not configurable; metadata stripping for JPEG, video, audio and PDF; rate limits on submission, login, claim and upload endpoints; Turnstile behavior including fail-closed; cross-tenant isolation on every table; retention purge including object storage and stuck-file retry; escalation firing and audit logging; SIS location-only enforcement.

The same pipeline also enforces: lint with **no `any` in production code**, a test-coverage floor that can only go up, the **whole suite on a real PostgreSQL 16 server** (each test file gets its own throwaway database), a dependency vulnerability audit, and a production build. `tests/routing-guard.test.ts` runs every staff action as a reviewer outside the tip's teams and scans the source so a new action cannot skip the visibility guard.

## 7. Reporting a vulnerability

Please report privately to the maintainers of your deployment's repository (enable GitHub “Private vulnerability reporting” on your fork) rather than opening a public issue.
