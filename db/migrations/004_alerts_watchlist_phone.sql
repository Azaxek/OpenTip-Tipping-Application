-- New-tip alerts, keyword watch list, response-time target, and staff-entered (phone / walk-in) tips.
-- None of these columns describe a tipster: they are organization settings or derived triage flags.

alter table organizations
  add column new_tip_alerts text not null default 'all' check (new_tip_alerts in ('off', 'urgent', 'all')),
  add column watch_keywords text not null default '' check (char_length(watch_keywords) <= 2000),
  add column response_target_hours integer not null default 24 check (response_target_hours between 1 and 720);

-- Staff who opt in to an email whenever a tip they can see arrives.
alter table reviewers add column notify_new boolean not null default false;

alter table tips
  add column source text not null default 'web' check (source in ('web', 'phone')),
  add column watch_hits text[] not null default '{}',
  add column waiting_since timestamptz;

-- A tip is "waiting" from the moment the tipster last wrote until staff reply.
update tips set waiting_since = created_at where needs_reply and status <> 'closed';
