-- Phase 3: competitions v2 (formats, events with host / cause / sponsors,
-- team registration with approval, captain-reported results, knockouts) and
-- recurring weekly game series.
--
-- Live data had no competitions, entries or fixtures when this was written,
-- so constraints are replaced outright. Public competition data stays
-- readable by signed-in users; private registration details (phone,
-- answers) live in their own API-only table.

-- Competitions: formats, category, event details, registration settings, points.
alter table competitions drop constraint if exists competitions_format_check;
alter table competitions add constraint competitions_format_check
  check (format in ('round_robin', 'double_round_robin', 'knockout', 'groups_knockout'));
alter table competitions add column if not exists category text not null default 'community';
alter table competitions drop constraint if exists competitions_category_check;
alter table competitions add constraint competitions_category_check
  check (category in ('community', 'charity', 'corporate', 'school', 'social'));
alter table competitions add column if not exists description text;
alter table competitions add column if not exists banner_url text;
alter table competitions add column if not exists location text;
alter table competitions add column if not exists venue_id uuid references venues (id) on delete set null;
alter table competitions add column if not exists host_name text;
alter table competitions add column if not exists host_logo_url text;
alter table competitions add column if not exists host_contact text;
alter table competitions add column if not exists host_website text;
alter table competitions add column if not exists cause_name text;
alter table competitions add column if not exists cause_description text;
alter table competitions add column if not exists cause_url text;
alter table competitions add column if not exists fundraising_note text;
alter table competitions add column if not exists entry_fee_note text;
alter table competitions add column if not exists registration_closes_at timestamptz;
alter table competitions add column if not exists requires_approval boolean not null default true;
alter table competitions add column if not exists team_size_min integer;
alter table competitions add column if not exists team_size_max integer;
alter table competitions add column if not exists registration_questions jsonb not null default '[]'::jsonb;
alter table competitions add column if not exists points_win integer not null default 3;
alter table competitions add column if not exists points_draw integer not null default 1;
alter table competitions add column if not exists points_loss integer not null default 0;
alter table competitions add column if not exists group_count integer;
alter table competitions add column if not exists advance_per_group integer;

-- Entries: an approval workflow, group and seed. Old 'registered' rows count as approved.
alter table competition_entries drop constraint if exists competition_entries_status_check;
update competition_entries set status = 'approved' where status = 'registered';
alter table competition_entries alter column status set default 'pending';
alter table competition_entries add constraint competition_entries_status_check
  check (status in ('pending', 'approved', 'rejected', 'withdrawn'));
alter table competition_entries add column if not exists group_label text;
alter table competition_entries add column if not exists seed integer;
alter table competition_entries add column if not exists decided_at timestamptz;

-- Private registration details: contact, squad size, answers. API only.
create table if not exists competition_entry_details (
  competition_id uuid not null references competitions (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  contact_name text not null,
  contact_phone text not null,
  squad_size integer,
  answers jsonb not null default '[]'::jsonb,
  note text,
  created_by uuid references profiles (id) on delete set null,
  decided_by uuid references profiles (id) on delete set null,
  decision_note text,
  created_at timestamptz not null default now(),
  primary key (competition_id, team_id)
);

-- Fixtures: stages, rounds, knockout slots, statuses, captain reports.
alter table fixtures alter column home_team_id drop not null;
alter table fixtures alter column away_team_id drop not null;
alter table fixtures drop constraint if exists fixtures_status_check;
alter table fixtures add constraint fixtures_status_check
  check (status in ('scheduled', 'finished', 'postponed', 'disputed', 'cancelled'));
alter table fixtures add column if not exists stage text not null default 'league';
alter table fixtures drop constraint if exists fixtures_stage_check;
alter table fixtures add constraint fixtures_stage_check check (stage in ('league', 'group', 'knockout'));
alter table fixtures add column if not exists round integer;
alter table fixtures add column if not exists leg integer;
alter table fixtures add column if not exists group_label text;
alter table fixtures add column if not exists bracket_slot integer;
alter table fixtures add column if not exists venue_name text;
alter table fixtures add column if not exists winner_team_id uuid references teams (id) on delete set null;
alter table fixtures add column if not exists reported_by uuid references profiles (id) on delete set null;
alter table fixtures add column if not exists reported_side text;
alter table fixtures add column if not exists reported_home integer;
alter table fixtures add column if not exists reported_away integer;
alter table fixtures add column if not exists reported_winner uuid references teams (id) on delete set null;
alter table fixtures add column if not exists reported_at timestamptz;
create index if not exists fixtures_competition_round on fixtures (competition_id, stage, round);

-- Sponsors shown on the event page.
create table if not exists competition_sponsors (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  logo_url text,
  url text,
  tier text not null default 'partner' check (tier in ('title', 'gold', 'partner', 'supporter')),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists competition_sponsors_comp on competition_sponsors (competition_id, sort);

-- Recurring weekly games.
create table if not exists match_series (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references profiles (id) on delete cascade,
  sport_id uuid not null references sports (id),
  title text not null check (char_length(title) between 1 and 80),
  weekday integer not null check (weekday between 0 and 6),
  local_time text not null check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  interval_weeks integer not null default 1 check (interval_weeks in (1, 2)),
  starts_on date not null,
  until date,
  area text not null,
  venue_id uuid references venues (id) on delete set null,
  venue_name text,
  place_id text,
  lat double precision,
  lng double precision,
  format text,
  capacity integer not null check (capacity between 2 and 100),
  level text check (level in ('recreational', 'intermediate', 'competitive')),
  notes text,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  circle_id uuid references circles (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now()
);

create table if not exists series_regulars (
  series_id uuid not null references match_series (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (series_id, user_id)
);

alter table matches add column if not exists series_id uuid references match_series (id) on delete set null;
create index if not exists matches_series on matches (series_id, starts_at);

alter table competition_entry_details enable row level security;
alter table competition_sponsors enable row level security;
alter table match_series enable row level security;
alter table series_regulars enable row level security;

-- Signed-in users can read sponsors, series and who the regulars are; all
-- writes go through the API. Entry details have no client policy at all.
drop policy if exists competition_sponsors_read on competition_sponsors;
create policy competition_sponsors_read on competition_sponsors for select using (auth.role() = 'authenticated');
drop policy if exists match_series_read on match_series;
create policy match_series_read on match_series for select using (auth.role() = 'authenticated');
drop policy if exists series_regulars_read on series_regulars;
create policy series_regulars_read on series_regulars for select using (auth.role() = 'authenticated');
