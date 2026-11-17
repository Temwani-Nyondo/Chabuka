-- Golf G3 + G4: golf days (a competition of kind 'golf_day') with individual entries, flights and hole-by-hole scores.
-- Paid entry goes through WaitApp tickets like races (checkout ref "golf:<entryId>"). API-only tables: RLS on, no
-- policies; the API checks organiser, scorer and player rights itself.

alter table competitions drop constraint if exists competitions_kind_check;
alter table competitions add constraint competitions_kind_check check (kind in ('tournament', 'league', 'race', 'golf_day'));
alter table competitions drop constraint if exists competitions_format_check;
alter table competitions add constraint competitions_format_check
  check (format in ('round_robin', 'double_round_robin', 'knockout', 'groups_knockout', 'race', 'golf'));
-- { courseId, scoring, allowancePct, startType, firstTeeAt, intervalMin, entryFee, currency, fieldLimit, maxHandicap, sideContests }
alter table competitions add column if not exists golf_settings jsonb;
alter table competitions add column if not exists golf_results_published_at timestamptz;

create table if not exists golf_flights (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  label text not null,
  tee_time timestamptz,
  start_hole integer not null default 1 check (start_hole between 1 and 18),
  sort integer not null default 0,
  -- The player in the flight who keeps the card for everyone (G4); the organiser can always correct.
  scorer_entry_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists golf_flights_comp on golf_flights (competition_id, sort);

create table if not exists golf_entries (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  player_name text not null,
  handicap_index numeric(4, 1) not null check (handicap_index between -10 and 54),
  phone text,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'confirmed', 'cancelled', 'refunded')),
  flight_id uuid references golf_flights (id) on delete set null,
  paid_ref text,
  ticket_ids text[] not null default '{}',
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists golf_entries_comp on golf_entries (competition_id, status);
create index if not exists golf_entries_user on golf_entries (user_id);

alter table golf_flights drop constraint if exists golf_flights_scorer_fk;
alter table golf_flights add constraint golf_flights_scorer_fk foreign key (scorer_entry_id) references golf_entries (id) on delete set null;

create table if not exists golf_scores (
  entry_id uuid not null references golf_entries (id) on delete cascade,
  hole_no integer not null check (hole_no between 1 and 18),
  -- null = picked up (no score on the hole; 0 Stableford points)
  strokes integer check (strokes between 1 and 20),
  entered_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (entry_id, hole_no)
);

create table if not exists golf_side_results (
  competition_id uuid not null references competitions (id) on delete cascade,
  type text not null check (type in ('longest_drive', 'nearest_pin')),
  hole integer not null check (hole between 1 and 18),
  entry_id uuid references golf_entries (id) on delete set null,
  note text,
  primary key (competition_id, type, hole)
);

alter table golf_flights enable row level security;
alter table golf_entries enable row level security;
alter table golf_scores enable row level security;
alter table golf_side_results enable row level security;

-- Golf G5: every round a golfer has played: logged by hand (casual) or written when a golf day's results are published.
-- Feeds their golf record (rounds, best gross / net / Stableford). API-only.
create table if not exists golf_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  course_id uuid references golf_courses (id) on delete set null,
  course_name text not null,
  source text not null default 'casual' check (source in ('casual', 'golf_day')),
  source_id uuid,
  played_on date not null,
  holes integer not null check (holes in (9, 18)),
  handicap_index numeric(4, 1),
  playing_hcp integer,
  -- { "1": 4, "2": 5, ... } strokes per hole (null = picked up); empty when only a total was entered
  scores jsonb not null default '{}'::jsonb,
  gross integer,
  net integer,
  points integer,
  created_at timestamptz not null default now()
);
create index if not exists golf_rounds_user on golf_rounds (user_id, played_on desc);
create unique index if not exists golf_rounds_source on golf_rounds (user_id, source_id) where source_id is not null;
alter table golf_rounds enable row level security;
