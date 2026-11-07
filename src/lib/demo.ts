import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { hashPasscode, hashSecret } from './crypto';
import { system } from './db';
import { DEMO_IMAGES } from './demo-assets';
import { newTipId } from './ids';
import type { Org } from './org';
import { addNote, assignTip, closeTip, sendReviewerMessage, setReward, setStatus } from './queue';
import { createOrganization } from './setup';
import type { Staff } from './staff';
import { getStorage } from './storage';
import { createTip, postTipsterMessage } from './tipster';
import { DEMO_SLUG } from './url';

/**
 * Everything a presenter needs for a live demonstration: a fully populated fictional Crime Stoppers program.
 * Only runs when DEMO_MODE=1. Fictional data only; the "evidence" is generated images that carry fake EXIF on purpose,
 * so they pass through the real metadata-stripping pipeline like any upload.
 */
export const DEMO = {
  slug: DEMO_SLUG,
  orgName: 'Metro Area Crime Stoppers (Demo)',
  admin: { name: 'Dana Director', email: 'admin@demo.crimestoppers.example', password: 'CrimeStoppers-Demo1' },
  reviewer: { name: 'Riley Reviewer', email: 'reviewer@demo.crimestoppers.example', password: 'CrimeStoppers-Demo2' },
  tipster: { tipId: '7DEM-0000-0001', passcode: 'demo-passcode' },
};

async function demoPdf() {
  const doc = await PDFDocument.create();
  doc.setAuthor('Demo Person (fake)');
  doc.setTitle('Call log (demo)');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 300]);
  ['CALL LOG SUMMARY (fictional demo document)', '', 'Tue 2:14 PM  incoming  "County Utilities"  asks for gift cards', 'Tue 4:41 PM  incoming  same number, second attempt', 'Wed 10:05 AM incoming  hung up when questioned'].forEach((l, i) => {
    page.drawText(l, { x: 24, y: 260 - i * 22, size: 11, font });
  });
  return Buffer.from(await doc.save());
}

// Small deterministic PRNG so the analytics history is the same every reset.
const prng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const CATEGORY_MIX: [string, number][] = [
  ['Theft/Burglary', 20], ['Drugs/Narcotics', 14], ['Fraud', 12], ['Vandalism', 10], ['Assault', 8], ['Weapons', 6],
  ['Robbery', 6], ['Gang Activity', 5], ['Wanted Person/Fugitive', 5], ['Homicide', 1], ['Other', 8],
];
const SAMPLE_TEXT: Record<string, string[]> = {
  'Theft/Burglary': ['Two people were carrying tools out of the back of the closed hardware store.', 'Catalytic converters keep disappearing from cars in the church lot.'],
  'Drugs/Narcotics': ['Constant short-stay traffic at the house on the corner, mostly after 10 PM.', 'Someone is selling pills out of a gray van behind the strip mall.'],
  Fraud: ['A contractor took deposits from several neighbors and stopped answering calls.', 'Fake rental listings using photos of a house that is not for rent.'],
  Vandalism: ['Windows broken at the community garden shed again last night.', 'Someone spray-painted the underpass and the school fence.'],
  Assault: ['Fight outside the bar on Main last weekend, one person hospitalized.', 'A man was hit with a bottle near the bus stop.'],
  Weapons: ['A teenager was showing a gun in a group chat and said he would bring it out Friday.', 'Saw someone pass what looked like a rifle case into a trunk.'],
  Robbery: ['A woman was grabbed and her bag taken near the parking garage.', 'Two men in masks left the convenience store on foot.'],
  'Gang Activity': ['Group recruiting middle schoolers at the skate park.', 'New tags marking territory along the rail line.'],
  'Wanted Person/Fugitive': ['The person from the news alert is staying at an apartment on Cedar.', 'I saw the wanted man at the laundromat this morning.'],
  Homicide: ['I heard a neighbor talking about what happened the night of the shooting.'],
  Other: ['Abandoned vehicle has been parked with its door open for a week.', 'Streetlights are out on the whole block and there have been break-ins.'],
};

export async function demoStatus() {
  const r = await system((q) => q<{ n: number }>('select count(*)::int as n from organizations where slug = $1', [DEMO.slug]));
  return { loaded: r[0].n > 0 };
}

/** True when this database also holds a program other than the demo one, i.e. DEMO_MODE must not be on. */
export async function realProgramExists() {
  return (await system((q) => q('select 1 from organizations where slug <> $1 limit 1', [DEMO.slug]))).length > 0;
}

/** Wipes the demo organization (rows cascade) and its files, then seeds a fresh, fully populated one. */
export async function resetDemo() {
  if (process.env.DEMO_MODE !== '1') throw new Error('Demo data can only be loaded when DEMO_MODE=1');
  if (await realProgramExists()) throw new Error('This database holds a real program, so demo data (with its published logins) will not be loaded. Remove DEMO_MODE.');
  const storage = getStorage();

  // 1. wipe
  for (const o of await system((q) => q<{ id: string }>('select id from organizations where slug = $1', [DEMO.slug]))) {
    for (const f of await storage.list(`media/${o.id}/`)) await storage.delete(f.key).catch(() => {});
  }
  for (const f of await storage.list('quarantine/')) await storage.delete(f.key).catch(() => {});
  await system((q) => q('delete from organizations where slug = $1', [DEMO.slug]));

  // 2. organization, taxonomy, teams, first admin (the normal setup path)
  const { orgId, adminId } = await createOrganization(
    {
      slug: DEMO.slug, name: DEMO.orgName, orgType: 'crime_stoppers', hotline: '555-0142', primaryColor: '#0f4c81', maxRewardCents: 100_000,
      retentionDays: 90, locationName: 'Downtown', adminName: DEMO.admin.name, adminEmail: DEMO.admin.email, adminPassword: DEMO.admin.password,
    },
    { allowMultiple: true },
  );
  const reviewerHash = await hashSecret(DEMO.reviewer.password);
  const tipsterHash = await hashPasscode(DEMO.tipster.passcode);
  const reviewerId = await system(async (q) => {
    // Uploads travel through a serverless function in the demo, so keep files small.
    await q('update organizations set image_mb = 4, doc_mb = 4, av_mb = 4, tip_mb = 12, max_files = 4 where id = $1', [orgId]);
    for (const n of ['Northside', 'Riverside', 'Eastgate']) await q('insert into locations (org_id, name) values ($1, $2)', [orgId, n]);
    const r = (await q<{ id: string }>("insert into reviewers (org_id, email, name, password_hash, role, all_tips, on_call) values ($1, $2, $3, $4, 'reviewer', false, true) returning id", [orgId, DEMO.reviewer.email, DEMO.reviewer.name, reviewerHash]))[0].id;
    await q('insert into team_members (org_id, team_id, reviewer_id) select $1, id, $2 from teams where org_id = $1', [orgId, r]);
    return r;
  });
  const org = (await system((q) => q<Org>('select * from organizations where id = $1', [orgId])))[0];
  const admin: Staff = { id: adminId, orgId, email: DEMO.admin.email, name: DEMO.admin.name, role: 'admin', allTips: true, onCall: true };
  const reviewer: Staff = { id: reviewerId, orgId, email: DEMO.reviewer.email, name: DEMO.reviewer.name, role: 'reviewer', allTips: false, onCall: true };

  const cats = Object.fromEntries((await system((q) => q<{ id: string; name: string }>('select id, name from categories where org_id = $1', [orgId]))).map((c) => [c.name, c.id]));
  const locs = Object.fromEntries((await system((q) => q<{ id: string; name: string }>('select id, name from locations where org_id = $1', [orgId]))).map((l) => [l.name, l.id]));
  const locIds = Object.values(locs);

  // 3. hand-written tips that tell the story of the demo
  const evidence = async (kind: 'sedan' | 'house' | 'shelter' | 'pdf') => {
    const key = `quarantine/${randomUUID()}`;
    await storage.put(key, kind === 'pdf' ? await demoPdf() : Buffer.from(DEMO_IMAGES[kind], 'base64'), kind === 'pdf' ? 'application/pdf' : 'image/jpeg');
    return key;
  };
  const submit = async (o: { cat: string; loc: string; text: string; urgent?: boolean; ev?: ('sedan' | 'house' | 'shelter' | 'pdf')[] }) => {
    const t = await createTip(org, {
      categoryId: cats[o.cat], locationId: locs[o.loc], description: o.text, urgent: o.urgent, passcode: DEMO.tipster.passcode,
      attachmentKeys: await Promise.all((o.ev ?? []).map(evidence)),
    });
    const id = (await system((q) => q<{ id: string }>('select id from tips where tip_id = $1', [t.tipId])))[0].id;
    return { id, tipId: t.tipId };
  };
  /** Space out this tip's messages and set when staff first replied / closed, then move everything `agoMin` minutes into the past. */
  const timeline = (id: string, o: { agoMin: number; replyMin?: number; gapMin?: number; closeMin?: number }) =>
    system(async (q) => {
      await q(
        `with o as (select m.id, row_number() over (order by m.seq) n from messages m where m.tip_id = $1)
         update messages m set created_at = t.created_at + make_interval(mins => ($2::int + (o.n - 1)::int * $3::int))
           from o, tips t where m.id = o.id and t.id = $1`,
        [id, o.replyMin ?? 0, o.gapMin ?? 15],
      );
      await q(
        `update tips set first_response_at = case when first_response_at is not null then created_at + make_interval(mins => $2::int) end,
                         closed_at = case when closed_at is not null then created_at + make_interval(mins => $3::int) end where id = $1`,
        [id, o.replyMin ?? 0, o.closeMin ?? 0],
      );
      const back = `make_interval(mins => $2::int)`;
      await q(
        `update tips set created_at = created_at - ${back}, updated_at = now() - ${back}, first_response_at = first_response_at - ${back}, closed_at = closed_at - ${back},
                         claim_code_revealed_at = claim_code_revealed_at - ${back}, claimed_at = claimed_at - ${back} where id = $1`,
        [id, o.agoMin],
      );
      await q(`update messages set created_at = created_at - ${back} where tip_id = $1`, [id, o.agoMin]);
      await q(`update internal_notes set created_at = created_at - ${back} where tip_id = $1`, [id, o.agoMin]);
    });

  // A: urgent, weapons, fresh, nobody has replied yet: the "what happens right now" tip
  const a = await submit({ cat: 'Weapons', loc: 'Downtown', urgent: true, ev: ['sedan'], text: 'A man in a gray hoodie showed what looked like a handgun in his waistband outside the transit center on 4th Street around 5 PM. He got into a dark blue sedan, plate starts with 7KD. I have seen him there before, usually on weekday evenings.' });
  await timeline(a.id, { agoMin: 14 });

  // B: an active conversation with a PDF, assigned to the reviewer
  const b = await submit({ cat: 'Fraud', loc: 'Northside', ev: ['pdf'], text: 'Robocalls pretending to be the county utility are demanding gift cards from older residents at Maple Court. My grandmother nearly paid $400. I attached her call log.' });
  await sendReviewerMessage(reviewer, b.id, 'Thank you. This matches two other reports this week. Do you remember the number or the name they used?');
  await postTipsterMessage(orgId, b.id, 'It showed as "County Utilities". The number started 555-01 and they wanted gift cards read out over the phone.');
  await sendReviewerMessage(reviewer, b.id, 'Very helpful. We are alerting the senior center. If another call comes, do not engage, and reply here with the time.');
  await assignTip(admin, b.id, reviewerId);
  await addNote(admin, b.id, 'Same script as cases 3391 and 3402. Sent bulletin to the senior center and the county fraud unit.');
  await timeline(b.id, { agoMin: 190, replyMin: 38, gapMin: 22 });

  // C: unanswered, evidence photo
  const c = await submit({ cat: 'Drugs/Narcotics', loc: 'Riverside', ev: ['house'], text: 'The vacant house on Delmar has had cars stopping for two or three minutes at all hours this month. Someone leaves through the side door each time. I took this photo at night.' });
  await timeline(c.id, { agoMin: 300 });

  // D: actioned
  const d = await submit({ cat: 'Vandalism', loc: 'Eastgate', ev: ['shelter'], text: 'Bus shelter on Eastgate was tagged again overnight. The same red symbol has shown up on four other stops.' });
  await sendReviewerMessage(reviewer, d.id, 'Thanks. We matched the tag to a known crew and passed it to patrol.');
  await addNote(reviewer, d.id, 'Photo matches tags from the March series. Patrol notified, city crews cleaning tomorrow.');
  await setStatus(reviewer, d.id, 'actioned');
  await timeline(d.id, { agoMin: 2 * 24 * 60, replyMin: 95, gapMin: 30 });

  // E: the reward story, with a fixed TIP ID and passcode the presenter can sign in with
  const e = await submit({ cat: 'Robbery', loc: 'Downtown', text: 'I know who robbed the Corner Market on Tuesday night. He goes by "Deuce", lives above the tire shop on 9th, and was bragging about it. Tall, red jacket with a white stripe.' });
  await system((q) => q('update tips set tip_id = $2 where id = $1', [e.id, DEMO.tipster.tipId]));
  await sendReviewerMessage(admin, e.id, 'Thank you. Your information helped lead to an arrest this morning.');
  await postTipsterMessage(orgId, e.id, 'Glad to hear it. Please keep me out of it.');
  await sendReviewerMessage(admin, e.id, 'You stay anonymous. Your tip is reward-eligible: sign in to see your claim code, then contact us to claim it.');
  await setReward(admin, e.id, true, 25_000);
  await setStatus(admin, e.id, 'actioned');
  await timeline(e.id, { agoMin: 4 * 24 * 60, replyMin: 47, gapMin: 300 });

  // F and G: closed with different reasons
  const f = await submit({ cat: 'Wanted Person/Fugitive', loc: 'Riverside', text: 'The man from the news alert is staying in the apartment above the laundromat on Cedar. He came out twice this morning.' });
  await sendReviewerMessage(admin, f.id, 'Thank you. We have passed this to the county fugitive task force.');
  await closeTip(admin, f.id, 'referred', 'Referred to county fugitive task force.');
  await timeline(f.id, { agoMin: 9 * 24 * 60, replyMin: 25, closeMin: 26 * 60 });
  const g = await submit({ cat: 'Gang Activity', loc: 'Northside', text: 'Some kids in matching jackets hang around the rec center. I think it is a gang.' });
  await sendReviewerMessage(admin, g.id, 'Thanks for looking out. Can you say what made you think so?');
  await addNote(admin, g.id, 'Followed up with rec center staff: youth basketball team jackets. Unfounded.');
  await closeTip(admin, g.id, 'unfounded', 'Team jackets for a youth league.');
  await timeline(g.id, { agoMin: 16 * 24 * 60, replyMin: 180, closeMin: 3 * 24 * 60 });

  // 4. ~10 weeks of history so the analytics dashboard has something to show
  const rnd = prng(20260925);
  const weighted = (mix: [string, number][]) => {
    let x = rnd() * mix.reduce((n, [, w]) => n + w, 0);
    for (const [k, w] of mix) {
    x -= w;
    if (x < 0) return k;
  }
    return mix[0][0];
  };
  const REASONS: [string, number][] = [['actioned', 45], ['unfounded', 25], ['referred', 20], ['other', 10]];
  const rewardAmounts = [10_000, 15_000, 25_000, 50_000];
  await system(async (q) => {
    for (let n = 0; n < 72; n++) {
      const ageH = (0.4 + rnd() * 74) * 24;
      const cat = weighted(CATEGORY_MIX);
      const created = new Date(Date.now() - ageH * 3_600_000);
      const respondH = 0.3 + rnd() ** 2.4 * 26;
      const closeH = respondH + 6 + rnd() * 24 * 8;
      let status = 'closed';
      if (ageH < 72 && rnd() < 0.5) status = 'new';
      else if (ageH < 240 && rnd() < 0.35) status = 'under_review';
      else if (rnd() < 0.08) status = 'actioned';
      if (status === 'closed' && closeH > ageH) status = 'under_review';
      const responded = status !== 'new';
      const closed = status === 'closed';
      const reason = closed ? weighted(REASONS) : null;
      const eligible = closed && reason === 'actioned' && rnd() < 0.2;
      const claimedAt = eligible && rnd() < 0.7 ? new Date(created.getTime() + (closeH + 24 + rnd() * 96) * 3_600_000) : null;
      const at = (h: number) => new Date(created.getTime() + h * 3_600_000);
      const texts = SAMPLE_TEXT[cat];
      await q(
        `insert into tips (org_id, tip_id, passcode_hash, location_id, category_id, urgent, description, status, needs_reply, closure_reason, closed_at,
                           first_response_at, reward_eligible, reward_amount_cents, claimed_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          orgId, newTipId(), tipsterHash, locIds[Math.floor(rnd() * locIds.length)], cats[cat], rnd() < 0.12, texts[Math.floor(rnd() * texts.length)], status, !responded,
          reason, closed ? at(closeH) : null, responded ? at(respondH) : null, eligible, eligible ? rewardAmounts[Math.floor(rnd() * rewardAmounts.length)] : null,
          claimedAt && claimedAt.getTime() < Date.now() ? claimedAt : null, created, closed ? at(closeH) : responded ? at(respondH) : created,
        ],
      );
    }
    // route history like real tips (category -> team), so team-scoped staff see it too
    await q('insert into tip_teams (org_id, tip_id, team_id) select t.org_id, t.id, ct.team_id from tips t join category_teams ct on ct.category_id = t.category_id where t.org_id = $1 on conflict do nothing', [orgId]);
  });

  return { orgId, liveTips: 7, historicalTips: 72 };
}
