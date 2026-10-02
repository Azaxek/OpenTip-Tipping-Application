# Demo deployment (for presenting to a sponsor)

A ready-made, fully populated fictional program that you can put on Vercel in about 10 minutes and click through live. It needs **two free accounts beyond GitHub: Vercel and Neon.** No file bucket, no Cloudflare, no email service.

What you get: *Metro Area Crime Stoppers (Demo)* with seven hand-written tips (an urgent weapons tip nobody has answered yet, an active fraud conversation, a reward-eligible tip you can sign in to as the tipster, closed cases…), evidence photos and a PDF, ten weeks of history for the analytics dashboard, two staff logins, and a built-in **presenter guide** at `/demo` with a 10-minute talk track.

> **Never use a demo deployment for real tips.** Demo mode relaxes bot protection, keeps files in the database, simulates escalation alerts, and wipes all data every night. Every page shows a banner saying so. To go live, make a *separate* deployment following [DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Neon database (free)

1. Sign up at neon.tech → Create project.
2. On the dashboard, copy the **pooled** connection string (the host contains `-pooler`). That is your `DATABASE_URL`.

## 2. Make three random values

Any long random strings work (a password manager can generate them):

* `APP_SECRET`: 32+ characters
* `SETUP_TOKEN`: anything you can type later (you will enter it once to load the demo)
* `CRON_SECRET`: 24+ characters (lets Vercel's nightly job reset the demo)

Or on a computer with Node: `npm install` then `npm run keys`.

## 3. Vercel (free Hobby plan)

1. vercel.com → **Add New… → Project** → import the GitHub repository `Azaxek/OpenTip-Tipping-Application`.
2. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `DATABASE_URL` | your Neon pooled connection string |
| `APP_SECRET` | from step 2 |
| `SETUP_TOKEN` | from step 2 |
| `CRON_SECRET` | from step 2 |
| `DEMO_MODE` | `1` |
| `STORAGE_DRIVER` | `db` |

3. Click **Deploy**. The build creates the database tables automatically. When it finishes, Vercel shows your address, like `https://opentip-xxxx.vercel.app`.

You do **not** need `APP_URL`; the demo works out its own address (QR codes and links use your Vercel production domain).

## 4. Load the demo data (once)

Open `https://YOUR-SITE.vercel.app/demo`, type your `SETUP_TOKEN`, press **Load demo data**, wait about 10–20 seconds, reload. You will see the logins and the walkthrough.

| Who | Sign in |
|---|---|
| Administrator | `admin@demo.crimestoppers.example` / `CrimeStoppers-Demo1` |
| Reviewer | `reviewer@demo.crimestoppers.example` / `CrimeStoppers-Demo2` |
| Tipster with a reward | TIP ID `7DEM-0000-0001` / passcode `demo-passcode` |

## 5. Before the meeting

* Open `/demo` and press **Reset demo data** so everything is fresh (it also happens nightly).
* Have two windows ready: a phone-sized one for the tipster, a normal one for the reviewer console. A private/incognito window is handy for signing in as the tipster without disturbing the reviewer session.
* Follow the numbered walkthrough on the `/demo` page. It covers: submitting a tip (with a photo), the receipt, the plain-language privacy page, the urgent tip in the queue, live chat, escalation, the reward claim, analytics/exports, and the rollout poster.
* Attach only small photos (about 4 MB or less). In demo mode files travel through a serverless function and are stored in the database.

## What is different in demo mode

| Real deployment | Demo deployment |
|---|---|
| Cloudflare Turnstile required | Not required (you can still add it) |
| Evidence in a private R2/S3 bucket, up to 10–25 MB | Evidence stored in Postgres, about 4 MB per file |
| Escalation emails and Slack/Discord alerts | Alerts are *simulated* and labelled as such; the audit log still records them |
| Nightly retention purge | Nightly full reset of the demo program |
| First-run setup wizard | `/demo` loader instead |

Everything else is the real application: the same database rules, anonymity protections, metadata stripping, team routing, chat, rewards and analytics.

## Troubleshooting

* **Build fails on the database step:** `DATABASE_URL` is missing or is not the pooled string. Fix it in Vercel → Settings → Environment Variables and redeploy.
* **`/demo` shows “not found”:** `DEMO_MODE` must be exactly `1`.
* **“SETUP_TOKEN is not set”:** add it in Vercel and redeploy.
* **A photo upload fails:** files must be about 4 MB or smaller in the demo.
* **Sponsor sees a Vercel login page:** send them the main `…vercel.app` address (not a deployment-specific link), or in Vercel → Settings → Deployment Protection make sure Production is public.
* **Want to remove it afterwards:** delete the Vercel project and the Neon project.

## Turning the demo into a real tip line

Do not flip this deployment. Create a fresh Neon database and a new Vercel project and follow [DEPLOYMENT.md](DEPLOYMENT.md) (adds Turnstile, private storage, escalation email/webhook, and the retention purge). Nothing from the demo carries over, by design.
