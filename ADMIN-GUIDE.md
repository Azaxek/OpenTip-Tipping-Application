# Administrator guide

For program coordinators, school administrators and tip-line supervisors. No technical knowledge needed.

> **Operational requirement, not a software feature: 24/7 coverage.** OpenTip can alert people instantly. It cannot make sure someone answers. Decide who is on call, when, and what happens if they don't respond, and write it in [ESCALATION-PROTOCOL.md](ESCALATION-PROTOCOL.md). Until that is done and staffed, do not promote the tip line as monitored. The form always tells the public: *“If this is an emergency… call 911 now. This form is not monitored in real time.”* That notice cannot be turned off and should never be worded to suggest otherwise.

## 1. The big picture

1. Someone submits a tip. They pick a passcode and receive a **TIP ID**. They never give their name.
2. The tip lands in the **Queue**. Urgent and high-risk tips are pinned to the top in red.
3. A reviewer opens it, replies in the **anonymous chat**, adds private notes, and routes or assigns it.
4. The reviewer closes it with a reason (Actioned, Unfounded, Referred, Other).
5. Old tips are deleted automatically after your retention period.

## 2. Signing in and roles

* **Administrator:** everything, including Settings, Analytics, Materials and the Audit log.
* **Reviewer:** the Queue, tips, chat, notes, and Rewards. Sees only tips routed to their team(s) or assigned to them, unless given **See all tips**.
* Change your own password under your name (top right). Use a long, unique password. Deactivate people who leave (Settings → People): they are signed out immediately.

## 3. Working the queue

New here? The **Tour** button in the header (or **Help → Take the one-minute tour**) walks through the queue in about a minute, and shows administrators the Settings and Materials screens too. It is offered once on a first visit and never forced.

* **Views:** one row of tabs, each with an exact count: *Open*, *Needs reply* (the tipster wrote last), *Urgent*, *Mine*, *Closed*, *All*. **More filters** adds category, location, team, assignee and sorting. The page refreshes itself, and the browser tab title shows how many tips await a reply, so you can work in another window.
* **Search** finds a TIP ID (or part of one) and any word in the description, the chat or the internal notes. Handy when a caller or a colleague mentions a name or a plate number.
* **Red URGENT badge:** the tipster said it is urgent, or the category is high-risk (for example self-harm, weapons, abuse), or the text matched your **watch list** (§14), or someone flagged it.
* **Awaiting reply · 3h** shows how long the tipster has been waiting. It turns red as **Overdue** once it passes the *reply target* you set in Settings (§14).
* **Phone** marks a tip a staff member typed in from a call or visit (§15).

### Inside a tip
* **Description and Evidence.** Photos, video, audio and PDFs open inline. Metadata was removed when they were uploaded.
* **Anonymous chat.** The tipster sees your replies live and their notification (if they turned it on) says only “You have an update on your tip”. Your name is never shown to them. **Insert canned response…** drops in a saved reply.
* **Internal notes** are for staff only; the tipster never sees them.
* **Status:** Under review / Actioned. **Flag urgent** if you judge it more serious than the tipster did.
* **Assignment & routing:** assign a person; choose which teams can see the tip.
* **Close this tip:** a reason is required. A closure note is optional.
* Do not try to work out who the tipster is. If a conversation makes you suspect someone could be in danger, escalate.

### Prank and false tips

Some tips are jokes, mistakes or a grudge. Read it, ask one calm question if it is unclear, and if it does not hold up, close it as *Unfounded* with a one-line note. Do not try to work out who sent it: nobody here can, and trying breaks the promise that makes people use the line. If the same thing keeps arriving, search for the repeated words on the Queue and tell your coordinator. When a tip mentions a weapon or self-harm, treat it as real until you know otherwise.

## 4. Escalation: the “Escalate now” button

Use it when a human needs to be alerted immediately. It emails your on-call people and posts to your Slack/Discord channel **at the same time**, records who pressed it and when, and tells you which channels worked.

* If it says **NO alert was delivered**, treat that as an emergency of its own: phone your on-call contact directly.
* Alerts contain the TIP ID, the category and a link, never the tip's text.
* Escalation does not call 911 or handle the situation. It gets a person's attention. Your protocol decides what that person does.

Set it up under Settings → *Escalation* and People → *On call*. Then press **Send a test alert** (Settings, right-hand side). It sends a clearly-labelled test through every channel you configured and tells you, channel by channel, whether it got through. Do this after every change to on-call staff, and at least monthly.

## 5. Teams and routing

Settings → Categories, locations & teams.

* Each category can send tips to one or more teams (the defaults send everything to a catch-all team plus specialists, for example self-harm → Counseling + Administration).
* For districts, a team can be limited to certain locations (“Lincoln High counseling only sees Lincoln High tips”). Tick no locations for all.
* Put staff on teams under People. Deleting a team means tips routed only to it become visible to admins and “see all tips” staff only.

### What tipsters read after they submit

Settings → *What tipsters read after they submit* has two boxes:

* **What to expect:** shown above the chat. Say plainly when a person reads tips (for example “We read tips weekdays 8am to 4pm”). The default says the line is not monitored in real time. Never promise more coverage than you have.
* **Help resources:** shown on the receipt and the status page as “Need help right now?”. Crisis lines, victim assistance, local numbers. The defaults are US examples; replace them with resources for your area.

## 6. Categories, locations and canned responses

* **Categories** are what the tipster picks. Edit the wording, order, and whether each is *high-risk* (pinned, escalatable) or *shown to tipsters*. Categories are hidden, not deleted, once used.
* **Locations** are schools/precincts. For schools you can import a list from your student information system as a CSV with two columns, `external_id,name`. Files with any other column, such as student data, are refused on purpose.
* **Canned responses** are one-click replies. The defaults include US crisis and abuse hotlines: **check and replace these with your local resources.** OpenTip does not provide counseling or crisis triage; it routes reports to trained people.

## 7. Rewards

1. In a tip, enter an amount (up to your maximum) and **Mark eligible**. The tipster is notified.
2. The tipster signs in and taps **Show my claim code**. It appears **once** (it is stored only in scrambled form). Lost it? Press **Reissue claim code** and ask them to check again.
3. When they come to claim, open **Rewards**, enter their TIP ID and code, and **Verify & mark claimed**. Five wrong codes lock that tip for 15 minutes.
4. Pay them however your program normally pays (cash, gift card…). Payment is outside this app.

## 8. Analytics

Analytics shows volume, categories, closure reasons, response and closure times, and rewards paid, for any date range/location/category. Export CSV or PDF for boards and funders. It contains totals only, nothing about individual tipsters, and every export is logged.

## 9. Materials

Materials creates a printable poster with a QR code, a QR image, and a parent/community letter you can edit before downloading. If the QR points to the wrong address, your `APP_URL` setting needs fixing (ask whoever deployed the site).

Below the downloads, **Announcement texts** has four ready-to-paste texts filled in from your settings: a news release for local media, a thirty-second announcement to read aloud, a social media post, and an introduction for the people who will answer tips. Replace what is in [square brackets] and use the **Copy text** button. Materials warns in red if your site address still says localhost, because a poster printed then would point at a computer nobody else can reach.

## 10. Retention and the privacy notice

Settings → Retention: tips with no activity for the chosen number of days are permanently deleted, including files. Enter your database provider's backup window too; the public privacy page shows both. If you must keep a tip longer for legal reasons, export what you need and ask your technical contact to pause the purge (see SECURITY.md).

## 11. Health checklist

Settings shows a **Server checklist**. Anything red must be fixed before launch; amber items are optional features. A yellow bar across the console means something critical is missing.

## 12. Launch checklist

- [ ] ESCALATION-PROTOCOL.md completed; on-call people named and marked *On call*
- [ ] Escalation tested: alert received on every channel (Settings → Send a test alert)
- [ ] Evidence storage tested (Settings → Test evidence storage), if you accept photos and video
- [ ] Two-step sign-in on for every administrator, and at least two administrators
- [ ] Categories, teams and locations reviewed; canned responses use local resources
- [ ] Reviewers created, on the right teams, using their own passwords
- [ ] Privacy notice and retention period approved by your legal counsel
- [ ] Poster/letter reviewed; staff briefed on the “do not try to identify tipsters” rule

## 13. What to tell tipsters

* “Save your TIP ID and passcode. We can't recover them.”
* “We don't record your name, phone, email, IP address or device.”
* “Be careful what you write or photograph: details themselves can identify you.”
* “In an emergency call 911. This form is not watched in real time.”
* “If someone might see your screen, press **Quick exit** (or Esc twice): it clears this tab and opens a weather site.”


## 14. New-tip alerts, the watch list and reply targets

Settings → **When a tip arrives**.

* **Alert staff about:** every new tip, only urgent / high-risk / watch-list tips, or nothing. Each person chooses to receive these emails under **People → Email me new tips**, and only for tips they are allowed to see. If you set a Slack/Discord webhook, new tips are posted there too, and a tipster's reply is emailed to the assigned reviewer when they had been caught up.
* **Alerts never contain what the tipster wrote**, and never say which watch-list words matched: email and chat are less private than the console. They name the TIP ID, category, location and a link.
* **Keyword watch list:** words or phrases separated by commas (for example *gun, knife, bomb threat, overdose*). Whole words only and case does not matter, so “gun” does not match “begun”. A match pins the tip as a priority, highlights the word for reviewers, and is checked again on the tipster's later messages. The words are never shown to tipsters.
* **Reply target (hours):** how long a tip may wait before it shows as **Overdue**. Choose a number you can actually keep.

## 15. Phone and walk-in tips

On the Queue, **+ Log a phone or walk-in tip**. Anyone on staff can use it. Type what the caller says (leave out their own name and number), save, then **read the TIP ID and the generated passcode aloud** and ask the caller to write both down. The passcode is shown once and is never in the address bar. The caller can then check back and chat anonymously, or claim a reward, exactly like a web tipster. The tip is marked *Phone* and is recorded in the audit log as entered by staff.

## 16. Two-step sign-in

**Your name → Set up two-step sign-in.** Install an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…), scan the QR code, type the 6-digit code to confirm. From then on signing in needs the password **and** a code. Strongly recommended for every administrator.

* **Lost phone?** Another administrator opens **Settings → People → Reset two-step sign-in** for that person; they then sign in with their password and set it up again. Keep at least two administrators.
* **No administrator can sign in?** Whoever manages the deployment can run `npm run reset-2fa -- their@email` against the database (see `scripts/reset-2fa.mjs`).
* Changing `APP_SECRET` resets everyone's two-step sign-in, because the secrets are encrypted with it.

## 17. Wanted and case bulletins

**Bulletins** (administrators). Publish a headline, details, an optional case number, reward and photo. Each public bulletin has an **I have information** button that opens the anonymous form already linked to that case, and the tip shows the case on the reviewer's screen. Photos are shrunk in your browser and re-encoded on the server with all camera and location data removed. Hide a bulletin to take it off the public page; deleting it keeps the tips already sent. Public page: `/wanted`.

## 18. Languages and time zone

* Every tipster page also exists in Spanish under `/es` (the language is in the address; nothing is stored). The built-in category names and guidance are translated. Text **you** wrote (categories you renamed, “what to expect”, help resources) stays as you wrote it; under *Spanish versions (optional)* in Settings you can provide Spanish versions. **Have a native speaker review the Spanish before launch.**
* **Time zone** (Settings → About your program): analytics count days in this zone, so a tip received at 9 pm counts on that day. Times in the console show in each person's own device time zone.

## 19. Text-to-tip (optional)

If your deployment has a text-message number pointed at `/api/sms` (SETUP-GUIDE.md, Part 8), anyone who texts it gets a reply with the link to the anonymous form. OpenTip never reads or stores the sender, but the phone company and the SMS provider see the number, so tell people the tip itself is written on the website.
