import { system, type Q } from './db';

export type Org = {
  id: string;
  slug: string;
  name: string;
  org_type: 'crime_stoppers' | 'campus';
  hotline: string | null;
  primary_color: string;
  max_reward_cents: number;
  retention_days: number;
  audit_retention_days: number;
  backup_retention_days: number;
  image_mb: number;
  doc_mb: number;
  av_mb: number;
  tip_mb: number;
  max_files: number;
  escalation_email_mode: 'on_call' | 'admins' | 'off';
  escalation_webhook_url: string | null;
  tipster_note: string;
  help_text: string;
  tipster_note_es: string;
  help_text_es: string;
  timezone: string;
  new_tip_alerts: 'off' | 'urgent' | 'all';
  watch_keywords: string;
  response_target_hours: number;
};

/**
 * The single place that decides which organization a request belongs to.
 * Model A (default): the one org in this deployment (or DEFAULT_ORG_SLUG).
 * Model B (fast-follow): resolve by request host/subdomain here - every other call site already passes org.id
 * into withOrg(), and Postgres RLS does the isolation, so nothing else has to change.
 */
export async function getOrg(): Promise<Org | null> {
  const slug = process.env.DEFAULT_ORG_SLUG;
  const rows = await system((q) =>
    slug ? q<Org>('select * from organizations where slug = $1', [slug]) : q<Org>('select * from organizations order by created_at limit 1'),
  );
  return rows[0] ?? null;
}

/** Same as getOrg but reads inside an org-scoped transaction (no RLS bypass needed). */
export const orgInTx = async (q: Q) => (await q<Org>('select * from organizations'))[0];
