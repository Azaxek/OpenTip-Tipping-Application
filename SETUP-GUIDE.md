# Setup guide: put your tip line online, step by step

For program coordinators and school administrators. **No programming needed.** If you can create an online account and copy and paste, you can do this. Plan on **60 to 90 minutes** the first time.

> **Screens change.** Cloudflare, Vercel, Neon and the others redesign their dashboards from time to time. If a button is named a little differently from what you read here, the official page linked in that part always shows the current wording.

> **Looking at it before you commit?** The live demo ([`DEMO.md`](DEMO.md)) shows everything with sample data. This guide is for your real tip line.

## What you are building

```
 Public ──► your website (Vercel) ──► database (Neon)         required
                       │
                       ├──► bot check (Cloudflare Turnstile)   required
                       ├──► evidence storage (Cloudflare R2)   optional: photos, video, audio, PDFs
                       ├──► email alerts (Resend)              optional
                       └──► chat alerts (Slack or Discord)     optional
```

**The minimum** is Parts 1 to 5 plus Part 9 onward: a website, a database and the bot check. Tips work without anything else. Add storage, email and chat alerts now or later; each is a few settings and a redeploy.

### What it costs

| Service | What it does | Cost |
|---|---|---|
| **GitHub** | holds your copy of the code | Free |
| **Neon** | the database | Free plan: 1 GB, plenty for tens of thousands of tips |
| **Cloudflare Turnstile** | stops bots | Free |
| **Cloudflare R2** | stores photos and video | 10 GB free per month; Cloudflare asks for a payment method to switch R2 on, but you are not charged unless you pass the free amount |
| **Resend** | sends alert emails | Free: 100 emails a day, 3,000 a month (you must own a domain to send) |
| **Vercel** | runs the website | **See the note below** |

> **Important: Vercel's free "Hobby" plan is for personal, non-commercial use only** ([their rule](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)). A tip line run by a school district, agency or non-profit is usually better placed on the **Pro** plan (about $20 per user per month at the time of writing; check [vercel.com/pricing](https://vercel.com/pricing)). Hobby is fine for trying things out. Read their rule and decide for your situation.

> **Free Neon plan note.** It keeps only **6 hours** of recovery history and puts the database to sleep after 5 quiet minutes (the first tip after a quiet spell is a little slower). For a real program, consider a paid plan for longer history.

## Before you start

1. A computer and a modern browser (Chrome, Edge, Safari or Firefox).
2. An email address you check. A password manager is strongly recommended for the many passwords and keys below.
3. About 90 minutes where you will not be interrupted.
4. **A notes file** (a plain document, kept somewhere private). You will collect these values as you go; Part 9 pastes them into Vercel:

| Value | Where it comes from | Your value |
|---|---|---|
| `APP_SECRET` | Part 2 | |
| `SETUP_TOKEN` | Part 2 | |
| `CRON_SECRET` | Part 2 | |
| `DATABASE_URL` | Part 3 | |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Part 4 | |
| `TURNSTILE_SECRET_KEY` | Part 4 | |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Part 5 (optional) | |
| `RESEND_API_KEY`, `RESEND_FROM` | Part 6 (optional) | |

**Treat every value above as a password.** Never put them in an email, chat, screenshot or the code. If one ever leaks, replace it (every service lets you create a new key) and update Vercel.

---

## Part 1. Copy the code to your own GitHub (5 minutes)

1. Go to [github.com/signup](https://github.com/signup) and create an account (or sign in).
2. Open the OpenTip project: **github.com/Azaxek/OpenTip-Tipping-Application**.
3. Click **Fork** (top right), then **Create fork**.

✅ *You should now see the project at `github.com/YOUR-NAME/OpenTip-Tipping-Application`.* Everything from here refers to **your** copy.

## Part 2. Make three secret keys (5 minutes)

OpenTip needs three random strings. Each should be **at least 32 characters**. Use any **one** of these methods; a password manager's "generate a 40-character password" button is the easiest.

**Windows (PowerShell)**: open the Start menu, type `PowerShell`, press Enter, and run this three times (once per key). Each run prints one key:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

**Mac or Linux (Terminal)**, three times:

```bash
openssl rand -hex 32
```

Save them in your notes as:

* `APP_SECRET`: signs sessions and protects two-step sign-in secrets. Changing it later signs everyone out and resets everyone's two-step sign-in.
* `SETUP_TOKEN`: the password for the one-time setup page, so a stranger cannot claim your new site.
* `CRON_SECRET`: lets the nightly clean-up job prove it is allowed to run.

## Part 3. Create the database on Neon (10 minutes)

1. Go to [neon.com](https://neon.com) and sign up (the "Sign up" button; signing in with GitHub is fine).
2. Create a **project**. Name it `opentip`. Choose the region **closest to your community**. Accept the defaults for everything else.
3. On the project's dashboard click **Connect**. In the box that opens:
   * Turn **Connection pooling** **on**.
   * Copy the **connection string** (it starts with `postgresql://` and contains `-pooler`).
4. Paste it into your notes as `DATABASE_URL`.

✅ *It looks like* `postgresql://neondb_owner:longpassword@ep-something-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`

> Neon sometimes adds `&channel_binding=require` at the end. OpenTip removes that for you automatically, so you can leave it.

> **The database must use UTF-8.** Neon and Supabase already do. If you run your own PostgreSQL (a default Windows install uses WIN1252), create the database with `CREATE DATABASE opentip ENCODING 'UTF8' TEMPLATE template0;`. OpenTip stops with a clear message on any other encoding, because a tip written in Arabic, Chinese or with an emoji would otherwise fail.

## Part 4. Turn on the bot check (Cloudflare Turnstile, 10 minutes)

Turnstile is a free, privacy-friendly "are you a person?" check that Cloudflare runs. **The tip form refuses to work without it**, on purpose, so bot protection can never be silently off.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and create a free account (or sign in).
2. In the left menu open **Turnstile** and click **Add widget**.
3. Fill in:
   * **Widget name**: `OpenTip`
   * **Hostname management**: add the address your site will have. If you will use your Vercel address, decide your project name now (Part 9) and add `YOUR-PROJECT-NAME.vercel.app`. You can add more hostnames later, including your own domain.
   * **Widget mode**: **Managed** (recommended).
4. Click **Create** and copy the two keys into your notes:
   * **Site Key** → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   * **Secret Key** → `TURNSTILE_SECRET_KEY` (shown once; copy it now)

Official guide, if a label looks different: [developers.cloudflare.com/turnstile](https://developers.cloudflare.com/turnstile/get-started/).

## Part 5. Evidence storage (Cloudflare R2, optional, 20 minutes)

Skip this and the tip form simply will not offer photo and video uploads. Everything else works. You can add it any time.

1. In the Cloudflare dashboard open **R2 object storage → Overview**. Cloudflare may ask you to add a payment method and "subscribe" to R2 first; the free amount (10 GB a month) is far more than a tip line needs.
2. Click **Create bucket**, name it (for example `opentip-evidence`), and leave it **private**. **Do not** switch on public access or a public domain.
3. Allow your website to upload to it. Open the bucket → **Settings → CORS Policy → Add CORS policy**, choose the **JSON** tab, and paste this, replacing the address with your site (**no slash at the end**):

   ```json
   [
     {
       "AllowedOrigins": ["https://YOUR-PROJECT-NAME.vercel.app"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```

   Click **Save**. If you later add your own domain, add it to the list too.
4. Create a key: back on **R2 → Overview**, next to **API Tokens** choose **Manage**, then **Create Account API token**. Choose **Object Read & Write**, limit it to your bucket, and create it. Copy:
   * **Access Key ID** → `S3_ACCESS_KEY_ID`
   * **Secret Access Key** → `S3_SECRET_ACCESS_KEY` (shown once)
5. Your account's storage address is `https://ACCOUNT-ID.r2.cloudflarestorage.com` (find the Account ID on the R2 overview page). Put these in your notes:
   * `S3_ENDPOINT` = that address (**no bucket name on the end**)
   * `S3_BUCKET` = your bucket name
6. *Recommended:* in the bucket's settings add an **object lifecycle rule** deleting anything under the prefix `quarantine/` after 1 day. It is a safety net; the app also cleans up on its own.

Official guides: [CORS](https://developers.cloudflare.com/r2/buckets/cors/) · [API tokens](https://developers.cloudflare.com/r2/api/tokens/).

## Part 6. Alert emails (Resend, optional, 15 minutes)

Used when someone presses **Escalate now**, and for new-tip emails to staff who opt in.

1. Sign up at [resend.com](https://resend.com).
2. **Domains → Add Domain** and enter a domain you own (for example `yourprogram.org`). Resend shows the exact records to add at the company where you bought the domain, and checks them for you. This can take from a few minutes to a few hours.
3. **API Keys → Create API Key**. Choose **Sending access**. Copy it → `RESEND_API_KEY`.
4. `RESEND_FROM` is the sender, in this exact style: `Your Program <alerts@yourprogram.org>`.

> No domain? Skip email and use chat alerts (Part 7) instead. Email needs a domain you control.

## Part 7. Chat alerts (Slack or Discord, optional, 5 minutes)

You paste one address into OpenTip's Settings later (not into Vercel).

* **Slack:** [create an app](https://api.slack.com/apps) → **Incoming Webhooks** → turn **Activate Incoming Webhooks** on → **Add New Webhook to Workspace** → choose the channel → **Allow**. Copy the URL starting `https://hooks.slack.com/services/…`
* **Discord:** in the channel's **Edit Channel → Integrations → Webhooks → New Webhook**, then **Copy Webhook URL** (it looks like `https://discord.com/api/webhooks/…`).

Treat the URL like a password: anyone with it can post to your channel. Alerts name the tip and link to it but **never contain what the tipster wrote**.

## Part 8. Optional: a text number that replies with your form link

People can text a number and get a reply with the link to the anonymous form. The text itself is never read or stored by OpenTip, but **the phone company and your text-message provider do see the sender's number**, and the tip itself is still written on the website. In the US, sending texts from an application also requires carrier registration (Twilio calls it A2P 10DLC, or toll-free verification), which takes time and has fees: see [Twilio's overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc). Most programs start without this.

If you want it: buy a number at [twilio.com](https://www.twilio.com), and set the number's "A message comes in" webhook to `https://YOUR-SITE/api/sms` (HTTP POST).

## Part 9. Put it online (Vercel, 15 minutes)

1. Go to [vercel.com/signup](https://vercel.com/signup) and sign up with your **GitHub** account (see the Hobby/Pro note above).
2. Click **Add New… → Project**. Find **OpenTip-Tipping-Application** under **Import Git Repository** (click **Adjust GitHub App Permissions** if it is not listed) and click **Import**.
3. **Project Name**: this becomes your address `NAME.vercel.app`. It must match what you told Turnstile and R2. Use lowercase letters, numbers and dashes.
4. Open **Environment Variables**. Add each of these (name on the left, your value on the right). Vercel lets you paste several `NAME=value` lines at once.

   | Name | Required? |
   |---|---|
   | `DATABASE_URL` | **yes** |
   | `APP_SECRET`, `SETUP_TOKEN`, `CRON_SECRET` | **yes** |
   | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | **yes** |
   | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | for photo/video uploads |
   | `RESEND_API_KEY`, `RESEND_FROM` | for email alerts |
   | `APP_URL` | recommended once you have your final address, e.g. `https://tips.yourprogram.org` (no slash at the end) |

   Leave `DEMO_MODE` **unset**: it is only for demonstrations.
5. Click **Deploy** and wait a few minutes. The build creates all the database tables for you.

✅ *When it finishes you see "Congratulations" and a preview.* Click **Continue to Dashboard** → **Visit**.

> **Changed a value later?** Vercel does not apply changes to a running site. Go to **Project → Settings → Environment Variables** to edit, then **Deployments → the latest one → ⋯ → Redeploy**. Values starting `NEXT_PUBLIC_` and `S3_ENDPOINT` are read when the site is built, so they always need a redeploy.

## Part 10. First-run setup (5 minutes)

1. Open your site's address. It sends you to the **Set up your tip line** page.
2. Enter the **setup token** (`SETUP_TOKEN` from your notes).
3. Choose **School or district** or **Crime Stoppers / community**, fill in your program's name, hotline (optional), the highest reward you will ever pay (0 = none) and how many idle days before tips are deleted.
4. Create **your administrator account**: your name, email, and a long unique password (10+ characters).
5. Click **Create my tip line**. You land in Settings.

## Part 11. Check that everything works (20 minutes)

Do not announce the tip line until every item below passes. The **Getting started** checklist on the Queue tracks the main ones for you.

1. **Settings → Server checklist** has no ❌. A ⚠️ means an optional feature you have not set up.
2. **Settings → Test your connections**:
   * **Send a test alert**. Mark yourself *On call* under **People** first. Confirm the email and the chat message really arrive.
   * **Test evidence storage**. It says it works, or tells you in plain words what to fix.
3. **Settings → Provider backup window**: enter how long your database keeps backups (Neon's free plan: 6 hours, so enter `1`). This is shown to tipsters in the privacy notice.
4. **Settings → What tipsters read after they submit**: replace the sample help numbers with ones for your area, and be honest about when a person reads tips.
5. **Settings → Time zone**: check it is yours. Analytics count days in it.
6. **Send a practice tip from your phone on mobile data (not your Wi-Fi)**, with a photo from your camera. Then in the Queue:
   * open it, check the photo appears, and reply in the chat;
   * on your phone, open **Check a tip**, sign in, and confirm the reply appears without reloading;
   * (photo check) download the photo and look at its details in an online "EXIF viewer": there should be no location.
7. **Account → Set up two-step sign-in** for yourself and every administrator.
8. **Materials → Download your poster**, print it and scan the QR code with a phone. If the address shown at the top of that page is wrong, set `APP_URL` and redeploy first.
9. Write down who answers urgent alerts and when ([`ESCALATION-PROTOCOL.md`](ESCALATION-PROTOCOL.md)). **OpenTip can alert people instantly; it cannot make someone answer.** Until that is decided and staffed, do not promote the line as monitored.

## Part 12. Your own web address (optional)

1. Vercel: **Project → Settings → Domains → Add**, and follow the on-screen instructions to point the domain at Vercel (they show the exact record to create).
2. Set `APP_URL` to the new address in Vercel's Environment Variables and redeploy.
3. Add the new hostname in Cloudflare **Turnstile → your widget → Hostname management**, and add the new origin to the R2 **CORS** list.

## Keeping it healthy

* **Updates:** on GitHub open your fork and use **Sync fork → Update branch**. Vercel redeploys and applies database changes automatically. Tip data is never dropped by an update.
* **Privacy hygiene:** in Vercel do **not** turn on Analytics, Speed Insights or log drains for this project; in Cloudflare do not enable R2 access logs. See [`DEPLOYMENT.md`](DEPLOYMENT.md) §10.
* **Monthly:** press **Send a test alert** after any change to on-call staff, and at least once a month.
* **Lost phone with two-step sign-in?** Another administrator can reset it under **Settings → People**. If no one can sign in, see [`ADMIN-GUIDE.md`](ADMIN-GUIDE.md).

## If something goes wrong

| What you see | Most likely cause | Fix |
|---|---|---|
| Vercel build fails: "DATABASE_URL is not set" | The variable is missing or misspelled | Add it under Environment Variables, then **Redeploy** |
| Build fails with a database connection or authentication error | `DATABASE_URL` was copied incompletely, or the Neon password changed | Copy the string again from Neon's **Connect** box (pooling on) |
| The build stops with "stores text as WIN1252, not UTF8" | The database was created with another encoding (common on a self-run Windows PostgreSQL) | Create a new database with `ENCODING 'UTF8'` (Part 3) and point `DATABASE_URL` at it |
| Setup page says the token is not correct | `SETUP_TOKEN` in Vercel differs from what you typed | Compare them; after fixing, redeploy |
| "Bot check failed" on the tip form | The Turnstile keys are wrong, or your site's address is not in the widget's hostnames | Re-check both keys; add the hostname in Turnstile; redeploy (the site key is read at build) |
| Photos fail at the last step | R2 CORS missing/wrong, or the address in it has a path or slash | Fix the CORS list (Part 5); run **Test evidence storage** |
| "Test evidence storage" says keys refused | Token lacks **Object Read & Write**, or is for another bucket | Create a new token (Part 5) and update Vercel |
| The form has no upload step | `S3_*` settings are missing, or "Max files per tip" is 0 | Add them and redeploy; check Settings → Evidence limits |
| Test alert says "not set up" | Email/chat not configured, or nobody is marked *On call* | Part 6/7; mark people on call under **People** |
| Alert emails never arrive | Resend domain not verified yet, or the email went to spam | Wait for Resend to show the domain as verified; check spam |
| Poster QR code opens the wrong address | `APP_URL` not set or still points at a test address | Set it to your real address, redeploy, download the poster again |
| Everyone was signed out after a change | `APP_SECRET` was changed | Expected; sign in again (two-step sign-in must be set up again) |
| The first tip after a quiet spell is slow | Neon's free plan sleeps the database | Normal; a paid plan removes it |

Still stuck? Open an issue on your fork with the **exact error message** (never paste keys or passwords) and what you were doing.

## Glossary

* **Fork**: your own copy of a project on GitHub.
* **Environment variable**: a setting stored in Vercel (like a password) that the site reads when it runs.
* **Deploy / redeploy**: build the site from your code and settings and put it online.
* **Webhook**: an address that lets one service post messages into another (here, into Slack or Discord).
* **CORS**: the rule that lets your website upload straight into your storage bucket.
* **Turnstile**: Cloudflare's bot check.
* **On call**: people who are emailed when someone presses *Escalate now*.
