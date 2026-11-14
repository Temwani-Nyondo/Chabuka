-- Phase 2: team administration, availability, lineups, rule books and a
-- second match official (timekeeper).
--
-- Every new table has row level security on and NO client policies: the API is
-- the only door (same as the scoreboard tables). It checks who may read or
-- write, then uses the service role. Existing tables only gain columns.

-- Teams: how players get in, and a kit colour for crests, shirts and the
-- versus screen.
alter table teams add column if not exists join_policy text not null default 'invite';
alter table teams drop constraint if exists teams_join_policy_check;
alter table teams add constraint teams_join_policy_check check (join_policy in ('invite', 'request', 'open'));
alter table teams add column if not exists kit_colour text;
alter table teams drop constraint if exists teams_kit_colour_check;
alter table teams add constraint teams_kit_colour_check check (kit_colour is null or kit_colour ~ '^#[0-9a-fA-F]{6}$');

-- Squad numbers: one shirt number per player, unique within a team.
alter table team_members add column if not exists shirt_number integer;
alter table team_members drop constraint if exists team_members_shirt_number_check;
alter table team_members add constraint team_members_shirt_number_check check (shirt_number is null or shirt_number between 1 and 99);
create unique index if not exists team_members_shirt_unique on team_members (team_id, shirt_number) where shirt_number is not null;

-- Players asking to join a team whose policy is 'request'.
create table if not exists team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  message text check (message is null or char_length(message) <= 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  decided_by uuid references profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists team_join_requests_one_pending on team_join_requests (team_id, user_id) where status = 'pending';
create index if not exists team_join_requests_team on team_join_requests (team_id, status);

-- In / maybe / out for a competition fixture or a game.
create table if not exists availability_responses (
  subject_type text not null check (subject_type in ('fixture', 'match')),
  subject_id uuid not null,
  user_id uuid not null references profiles (id) on delete cascade,
  team_id uuid references teams (id) on delete cascade,
  status text not null check (status in ('in', 'maybe', 'out')),
  note text check (note is null or char_length(note) <= 140),
  updated_at timestamptz not null default now(),
  primary key (subject_type, subject_id, user_id)
);
create index if not exists availability_responses_team on availability_responses (team_id, subject_type, subject_id);

-- One lineup per side of a fixture or game. Slots hold the formation
-- positions (role, x, y, userId); bench is an ordered list of user ids.
create table if not exists lineups (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('fixture', 'match')),
  subject_id uuid not null,
  side text not null check (side in ('home', 'away')),
  team_id uuid references teams (id) on delete cascade,
  formation text not null,
  slots jsonb not null default '[]'::jsonb,
  bench jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id, side)
);

-- Rule books: organiser-written, versioned on every save.
create table if not exists rule_books (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('match', 'competition', 'team')),
  owner_id uuid not null,
  title text not null check (char_length(title) between 1 and 80),
  sport text,
  version integer not null default 1,
  rules jsonb not null default '[]'::jsonb,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_type, owner_id)
);

-- Scoreboards: a timekeeper alongside the scorekeeper (official_id).
alter table scoreboards add column if not exists timekeeper_id uuid references profiles (id) on delete set null;

alter table team_join_requests enable row level security;
alter table availability_responses enable row level security;
alter table lineups enable row level security;
alter table rule_books enable row level security;
