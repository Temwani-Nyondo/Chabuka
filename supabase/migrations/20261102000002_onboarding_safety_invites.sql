-- Amendments 3 + 4: onboarding profile data, invite links, safety basics.
-- Re-runnable. WRITTEN BUT NOT APPLIED — needs explicit approval before
-- running against the live project (new tables + profile columns).
-- Availability and exact free days stay private: other users only ever see
-- that a game fits, never anyone's schedule (see game-type fit, not rows).

-- Terms acceptance + travel distance live on the profile row.
alter table profiles add column if not exists travel_km integer;
alter table profiles add column if not exists terms_accepted_at timestamptz;

-- Position per team membership (wizard step 5, Gaffer onboarding).
alter table team_members add column if not exists position text;

-- Usual availability: days (0=Sunday..6=Saturday) plus time bands
-- (morning, afternoon, evening). Private to the owner.
create table if not exists user_availability (
  user_id uuid not null references profiles (id) on delete cascade,
  day smallint not null check (day between 0 and 6),
  time_band text not null check (time_band in ('morning', 'afternoon', 'evening')),
  primary key (user_id, day, time_band)
);

alter table user_availability enable row level security;

drop policy if exists user_availability_owner on user_availability;
create policy user_availability_owner on user_availability
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Usual playing spots, separate from the home area on the profile.
create table if not exists user_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  label text not null,
  area text,
  lat double precision,
  lng double precision,
  venue_id uuid references venues (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table user_places enable row level security;

drop policy if exists user_places_owner on user_places;
create policy user_places_owner on user_places
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Game-type preferences filter and rank suggestions; they never hide a
-- directly searched game (enforced in query code, not here).
create table if not exists user_game_types (
  user_id uuid not null references profiles (id) on delete cascade,
  game_type text not null check (game_type in (
    'corporate', 'charitable', 'awareness', 'neighbourhood',
    'skill_based', 'reunion', 'routine'
  )),
  primary key (user_id, game_type)
);

alter table user_game_types enable row level security;

drop policy if exists user_game_types_owner on user_game_types;
create policy user_game_types_owner on user_game_types
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Platform invite links: invite someone onto Chabuka itself. Optionally tied
-- to a team so claiming it also joins that team. Revocable, expirable.
create table if not exists invite_links (
  code text primary key,
  created_by uuid not null references profiles (id) on delete cascade,
  team_id uuid references teams (id) on delete set null,
  expires_at timestamptz,
  revoked_at timestamptz,
  claimed_by uuid references profiles (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table invite_links enable row level security;

drop policy if exists invite_links_creator on invite_links;
create policy invite_links_creator on invite_links
  for all using (auth.uid() = created_by) with check (auth.uid() = created_by);
drop policy if exists invite_links_claim on invite_links;
create policy invite_links_claim on invite_links for select using (
  revoked_at is null and (expires_at is null or expires_at > now())
);

-- One-tap reports on profiles and teams.
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles (id) on delete cascade,
  target_user_id uuid references profiles (id) on delete cascade,
  target_team_id uuid references teams (id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  check (
    (target_user_id is not null and target_team_id is null) or
    (target_user_id is null and target_team_id is not null)
  )
);

alter table reports enable row level security;

drop policy if exists reports_own on reports;
create policy reports_own on reports
  for all using (auth.uid() = reporter_id) with check (auth.uid() = reporter_id);

-- Blocks: the blocker stops seeing the blocked user.
create table if not exists blocks (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  check (blocker_id <> blocked_user_id)
);

alter table blocks enable row level security;

drop policy if exists blocks_own on blocks;
create policy blocks_own on blocks
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);
