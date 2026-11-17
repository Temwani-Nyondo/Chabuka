-- Race events (marathons, fun runs, trail runs, walks). A race is a competition with kind 'race' (it reuses the
-- Phase 3 event columns: banner, host, cause, sponsors, category, registration questions). Per-distance details,
-- routes, individual entries, the finish-line log and results live in the tables below. Re-runnable.
-- Paid entry goes through WaitApp tickets (one tier per distance); Chabuka never holds money.
-- All writes go through the API (service role) after its own organiser / official checks.

alter table competitions drop constraint if exists competitions_kind_check;
alter table competitions add constraint competitions_kind_check check (kind in ('tournament', 'league', 'race'));
alter table competitions drop constraint if exists competitions_format_check;
alter table competitions add constraint competitions_format_check
  check (format in ('round_robin', 'double_round_robin', 'knockout', 'groups_knockout', 'race'));
-- Waiver, age bands, waves, T-shirts, race-pack collection details.
alter table competitions add column if not exists race_settings jsonb;
-- The WaitApp event that sells this race's entries (paid races only).
alter table competitions add column if not exists waitapp_event_id text;
alter table competitions add column if not exists waitapp_checkout_url text;

create table if not exists race_distances (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  name text not null,
  distance_km numeric(7, 3) not null check (distance_km > 0),
  laps integer not null default 1 check (laps between 1 and 50),
  starts_at timestamptz not null,
  cutoff_minutes integer,
  min_age integer,
  field_limit integer not null check (field_limit > 0),
  price numeric(12, 2) not null default 0 check (price >= 0),
  currency text not null default 'ZMW',
  waitapp_tier_name text,
  waitapp_tier_id text,
  bib_from integer not null,
  bib_to integer not null,
  next_bib integer,
  sort integer not null default 0,
  gun_started_at timestamptz,
  results_published boolean not null default false,
  created_at timestamptz not null default now(),
  check (bib_to >= bib_from)
);
create index if not exists race_distances_comp on race_distances (competition_id, sort);

create table if not exists race_routes (
  distance_id uuid primary key references race_distances (id) on delete cascade,
  points jsonb not null default '[]'::jsonb,
  source text not null default 'drawn' check (source in ('drawn', 'gpx', 'roads')),
  distance_m integer not null default 0,
  climb_m integer not null default 0,
  pois jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists race_entries (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  distance_id uuid not null references race_distances (id) on delete cascade,
  -- The account that entered (a parent or a company captain can enter someone else).
  user_id uuid not null references profiles (id) on delete cascade,
  runner_name text not null,
  gender text not null check (gender in ('female', 'male')),
  birth_date date not null,
  age_group text,
  club text,
  expected_minutes integer,
  wave text,
  tshirt text,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'confirmed', 'cancelled', 'refunded')),
  bib integer,
  paid_ref text,
  -- WaitApp ticket ids for a paid entry, so a refund (which names tickets) finds the entry.
  ticket_ids text[] not null default '{}',
  answers jsonb not null default '[]'::jsonb,
  waiver_accepted_at timestamptz,
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists race_entries_bib on race_entries (competition_id, bib) where bib is not null;
create index if not exists race_entries_distance on race_entries (distance_id, status);
create index if not exists race_entries_user on race_entries (user_id);

-- Contact and medical details: the organiser only, through the API.
create table if not exists race_entry_private (
  entry_id uuid primary key references race_entries (id) on delete cascade,
  phone text not null,
  emergency_name text not null,
  emergency_phone text not null,
  medical_note text
);

create table if not exists race_results (
  entry_id uuid primary key references race_entries (id) on delete cascade,
  distance_id uuid not null references race_distances (id) on delete cascade,
  gun_seconds numeric(10, 1),
  chip_seconds numeric(10, 1),
  status text not null default 'finished' check (status in ('finished', 'dnf', 'dns', 'dq')),
  overall_pos integer,
  gender_pos integer,
  age_pos integer,
  source text not null default 'line' check (source in ('line', 'csv', 'manual')),
  updated_at timestamptz not null default now()
);
create index if not exists race_results_distance on race_results (distance_id);

-- The raw finish-line log: one row per runner crossing, as recorded by a volunteer.
create table if not exists race_finish_marks (
  id uuid primary key default gen_random_uuid(),
  distance_id uuid not null references race_distances (id) on delete cascade,
  bib integer,
  recorded_at timestamptz not null,
  recorded_by uuid references profiles (id) on delete set null,
  client_id text not null,
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  unique (distance_id, client_id)
);
create index if not exists race_finish_marks_distance on race_finish_marks (distance_id, recorded_at);

create table if not exists race_officials (
  competition_id uuid not null references competitions (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null check (role in ('finish', 'checkin')),
  created_at timestamptz not null default now(),
  primary key (competition_id, user_id, role)
);

alter table race_distances enable row level security;
alter table race_routes enable row level security;
alter table race_entries enable row level security;
alter table race_entry_private enable row level security;
alter table race_results enable row level security;
alter table race_finish_marks enable row level security;
alter table race_officials enable row level security;

-- Public to signed-in users: distances, routes, and results once published. Entries, private details, the finish
-- log and officials are read through the API (which shows a start list without dates of birth or contacts).
drop policy if exists race_distances_read on race_distances;
create policy race_distances_read on race_distances for select using (auth.role() = 'authenticated');
drop policy if exists race_routes_read on race_routes;
create policy race_routes_read on race_routes for select using (auth.role() = 'authenticated');
drop policy if exists race_results_read on race_results;
create policy race_results_read on race_results for select using (
  auth.role() = 'authenticated'
  and exists (select 1 from race_distances d where d.id = distance_id and d.results_published)
);
-- Runners see their own entries directly (My races).
drop policy if exists race_entries_read_own on race_entries;
create policy race_entries_read_own on race_entries for select using (auth.uid() = user_id);
