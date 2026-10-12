-- Public "wanted / case bulletins" (Crime Stoppers' Crime of the Week, wanted persons, vehicle appeals...).
-- Bulletins are published by staff and are public by design; the photo is a re-encoded, metadata-free JPEG kept in the row.
create table bulletins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 3000),
  case_number text check (case_number is null or char_length(case_number) <= 60),
  reward_cents integer check (reward_cents is null or reward_cents >= 0),
  image bytea check (image is null or octet_length(image) <= 1500000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index bulletins_active on bulletins (org_id, active, created_at desc);

alter table bulletins enable row level security;
create policy tenant on bulletins using (org_id = app_org()) with check (org_id = app_org());
grant select, insert, update, delete on bulletins to opentip_app;

-- A tip may say which public case it is about. This is the tipster's own choice and says nothing about who they are.
alter table tips add column bulletin_id uuid references bulletins on delete set null;
