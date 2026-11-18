# Deployment guide

Target: a live, free tip line in about an hour, with no server to maintain. If you can copy and paste values into a web form, you can do this.

> **New to all this?** Follow [`SETUP-GUIDE.md`](SETUP-GUIDE.md), which walks through every click with checkpoints and a troubleshooting table. This page is the shorter, more technical reference.

**You will create free accounts at:** GitHub, Vercel, Neon *or* Supabase, and Cloudflare. Resend (email alerts) is optional.

> Do the whole checklist at the end (“Verify before you announce it”). A tip line that silently fails is worse than none.

---

## 1. Put the code on GitHub

Fork or upload this repository to your own GitHub account. Everything below refers to *your* copy.

## 2. Database (choose one)

### Option A: Neon (simplest)
1. Create a project at neon.tech. Copy the **pooled** connection string (it contains `-pooler`).
2. That is your `DATABASE_URL`.

### Option B: Supabase
1. Create a project. Project Settings → Database → Connection string → **Transaction pooler**.
2. That is your `DATABASE_URL`. (You do not need Supabase Auth, its client libraries or its API keys: OpenTip only talks to the database.)

The database must use UTF8 encoding (Neon and Supabase do; on your own server create it with `ENCODING 'UTF8'`). The migration stops with a clear message otherwise.

The migration creates a low-privilege database role (`opentip_app`) and every request runs as that role, which is what makes row-level security bite. The connecting user needs permission to create a role; the default owner user on both services has it.

## 3. Evidence storage: Cloudflare R2

1. In Cloudflare: R2 → Create bucket (any name). Leave it **private**. Do **not** enable public access or a public domain.
2. R2 → Manage API tokens → create a token with *Object Read & Write* on that bucket. Note the Access Key ID, Secret Access Key, and the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`).
3. Bucket → Settings → **CORS policy** (browsers upload directly to the bucket, so it must allow your site):

```json
[
  {
    "AllowedOrigins": ["https://YOUR-SITE-ADDRESS"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

4. Environment variables: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (leave `S3_REGION=auto`, and **do not** set `STORAGE_DRIVER=fs`).
5. Recommended: R2 → bucket → Settings → Object lifecycle rules → delete objects under prefix `quarantine/` after 1 day (belt and braces; the nightly purge also removes any raw upload older than an hour).

Supabase Storage's S3 endpoint can be used instead, but presigned uploads with a signed `Content-Length` were only designed against R2; test an upload with a real photo, a 20 MB video and a PDF before relying on it.

Vercel functions cap request bodies at about 4.5 MB, which is why files go straight to storage and are sanitized afterwards, on the server, before the tip is confirmed.

## 4. Bot protection: Cloudflare Turnstile

Turnstile → Add widget → Managed, add your site's domain. Copy the **Site key** (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) and **Secret key** (`TURNSTILE_SECRET_KEY`).

In production the tip form and sign-in **refuse to work** until these are set; this is deliberate, so bot protection can never be silently off.

## 5. Secrets

Run these on any computer with Node 20+ (or use any random-string generator for the first three):

```bash
npm install
npm run keys
```

It prints `APP_SECRET`, `SETUP_TOKEN`, `CRON_SECRET` and a VAPID key pair (for optional push notifications). Keep them; you will paste them into Vercel next.

## 6. Vercel

1. vercel.com → Add New → Project → import your GitHub repository.
2. Add the environment variables:

| Variable | Value / source |
|---|---|
| `DATABASE_URL` | step 2 |
| `APP_SECRET` | step 5 (32+ characters; changing it signs everyone out) |
| `SETUP_TOKEN` | step 5. Protects the first-run wizard from strangers |
| `CRON_SECRET` | step 5. Lets the nightly purge job authenticate |
| `APP_URL` | your final address, e.g. `https://tips.example.org` (no trailing slash). Used in QR codes and alert links |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | step 3 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | step 4 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional (push). Subject like `mailto:tips@yourorg.org` |
| `RESEND_API_KEY`, `RESEND_FROM` | optional (escalation email); see step 8 |

3. Deploy. The build runs the database migrations automatically (`vercel-build`).
4. `vercel.json` schedules the nightly retention purge; Vercel sends `CRON_SECRET` with it automatically.

## 7. First-run setup

Open your site. You are sent to `/setup`. Enter the `SETUP_TOKEN`, choose *School or district* or *Crime Stoppers*, and create the first administrator. Then follow the checklist on Settings.

## 8. Escalation channels (do not skip)

Escalation is your emergency alert. Configure at least one channel, ideally two:

* **Email:** create a Resend account, verify a sending domain, set `RESEND_API_KEY` and `RESEND_FROM` (for example `OpenTip <alerts@yourorg.org>`). In Settings → People, mark the on-call people.
* **Chat webhook:** create an incoming webhook in Slack or Discord and paste it into Settings → Escalation. Alerts name the tip and link to the console; they never contain tip content.

Then press **Escalate now** on a test tip. The console tells you, per channel, whether anything was delivered.

## 9. Custom domain

Vercel → Project → Domains. Set `APP_URL` to the same address and redeploy so QR codes and alert links match. Also add the domain to your Turnstile widget and to the R2 CORS `AllowedOrigins`.

## 10. Logs and metadata (read this)

The application code never records IP addresses, user agents or headers. Your **hosting provider's own infrastructure still sees network metadata** as it delivers pages, so:

* Do **not** enable Vercel Analytics, Speed Insights, Web Analytics, log drains, or any third-party monitoring on this project.
* Review the project's Logs and Firewall settings and keep them to the minimum retention your plan allows.
* In Cloudflare, do not enable R2 access logs or Logpush for the bucket.
* Do not put the site behind another analytics-injecting proxy.

Document what you verified in your own compliance notes (see [SECURITY.md](SECURITY.md)).

## 11. Encryption at rest and backups (verify, don't assume)

The app cannot check these for you. In your provider consoles confirm and record:

* **Neon / Supabase database storage is encrypted at rest** (both state that stored data is encrypted at rest; confirm on their current security pages for your plan and write down what you found).
* **Cloudflare R2 objects are encrypted at rest** (Cloudflare states R2 encrypts stored objects by default; confirm).
* **Backup window:** find out how long your database plan retains backups / point-in-time history, and enter that number in Settings → *Provider backup window*. It is shown to tipsters in the privacy notice. Tips deleted by the retention purge can still exist in provider backups until those backups expire. The app cannot delete inside your provider's backups. If the window is longer than your promise to the public, shorten the provider setting.

## Verify before you announce it

1. Submit a tip from your phone **on cellular data**, with a photo taken by your camera app and a short video.
2. Sign in as staff; confirm the tip, the photo and the video appear. Download the photo and check it has no location data (for example with an online “EXIF viewer”, or `exiftool`).
3. Reply from the console; confirm it appears on the phone without reloading, and that turning on notifications gives a generic “You have an update” alert only.
4. Mark it reward-eligible, reveal the claim code on the phone, redeem it in Rewards.
5. Press **Escalate now**; confirm the alert arrives on every channel.
6. Settings shows no red items.
7. `https://YOUR-SITE/api/cron/purge` returns 401 without the secret (and the Vercel Cron dashboard shows it scheduled).
8. Try to open `/staff/media/anything` while signed out: 401.
9. Print the poster (Materials) and scan it.

## Updating

Pull the latest code into your repository. Vercel redeploys and applies new migrations automatically. Migrations never drop tip data.

## Running locally

See the README. `npm run dev:db` is a convenience database for trials; never use it for real tips.

## Roadmap: Model B (shared multi-tenant deployment)

The schema already carries `org_id` on every table with Postgres RLS. To serve several programs from one deployment you add: host/subdomain → organization resolution in `src/lib/org.ts` (`getOrg`), per-tenant custom domains in Vercel, per-tenant secrets/branding, and a platform-operator role. Nothing in the tenant tables needs to change.
