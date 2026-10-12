-- Optional two-step sign-in (authenticator app codes) for staff. Staff identity data only; never tipster data.
-- totp_secret is stored encrypted with APP_SECRET (see crypto.seal), so a database-only leak cannot mint codes.
-- totp_last_step records the last accepted 30-second step so a code can never be used twice.
alter table reviewers
  add column totp_secret text,
  add column totp_enabled boolean not null default false,
  add column totp_last_step bigint not null default 0;
