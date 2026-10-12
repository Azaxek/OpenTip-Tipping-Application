import { hashSecret } from './crypto';
import { system } from './db';
import { TAXONOMIES, type OrgType } from './taxonomy';

export type SetupInput = {
  slug?: string;
  name: string;
  orgType: OrgType;
  hotline?: string;
  primaryColor?: string;
  maxRewardCents?: number;
  retentionDays?: number;
  locationName?: string;
  timezone?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';

/** First-run setup: org + taxonomy + teams + routing + one placeholder location + the first admin. */
export async function createOrganization(i: SetupInput, opts: { allowMultiple?: boolean } = {}) {
  if (i.adminPassword.length < 10) throw new Error('Admin password must be at least 10 characters');
  const passwordHash = await hashSecret(i.adminPassword);
  const tax = TAXONOMIES[i.orgType];
  return system(async (q) => {
    if (!opts.allowMultiple && (await q('select 1 from organizations limit 1')).length) throw new Error('This deployment is already set up');
    const slug = i.slug ?? `${slugify(i.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const org = (
      await q(
        `insert into organizations (slug, name, org_type, hotline, primary_color, max_reward_cents, retention_days, tipster_note, help_text, timezone)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [slug, i.name, i.orgType, i.hotline || null, i.primaryColor || '#1d4ed8', i.maxRewardCents ?? 0, i.retentionDays ?? 365, tax.tipsterNote, tax.helpText, i.timezone || 'UTC'],
      )
    )[0].id as string;

    const teamIds: Record<string, string> = {};
    for (const t of tax.teams) teamIds[t] = (await q('insert into teams (org_id, name) values ($1, $2) returning id', [org, t]))[0].id;

    const catIds: Record<string, string> = {};
    for (const [n, c] of tax.categories.entries()) {
      const cat = (
        await q('insert into categories (org_id, name, description, sort, high_risk) values ($1, $2, $3, $4, $5) returning id', [org, c.name, c.description, n, !!c.highRisk])
      )[0].id;
      catIds[c.name] = cat;
      // Every category routes to the catch-all team (first team) plus any specialist teams.
      for (const t of new Set([tax.teams[0], ...(c.teams ?? [])])) {
        await q('insert into category_teams (org_id, category_id, team_id) values ($1, $2, $3)', [org, cat, teamIds[t]]);
      }
    }

    for (const c of tax.canned) {
      const targets = c.categories?.length ? c.categories : [null];
      for (const name of targets) await q('insert into canned_responses (org_id, category_id, title, body) values ($1, $2, $3, $4)', [org, name ? catIds[name] : null, c.title, c.body]);
    }

    await q('insert into locations (org_id, name) values ($1, $2)', [org, i.locationName || (i.orgType === 'campus' ? 'Main Campus' : 'All Areas')]);

    const admin = (
      await q(
        `insert into reviewers (org_id, email, name, password_hash, role, all_tips, on_call)
         values ($1, $2, $3, $4, 'admin', true, true) returning id`,
        [org, i.adminEmail.trim(), i.adminName.trim(), passwordHash],
      )
    )[0].id;
    for (const t of Object.values(teamIds)) await q('insert into team_members (org_id, team_id, reviewer_id) values ($1, $2, $3)', [org, t, admin]);
    return { orgId: org, adminId: admin as string };
  });
}
