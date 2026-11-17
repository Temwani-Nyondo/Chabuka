-- Phase 6: player records (games only), team ratings shown as bands, Free tonight. Re-runnable.
-- Everything here is written and read through the API (service role) after its own checks: ratings are never shown
-- as numbers, records follow each player's privacy setting, and Free tonight is anonymous.

create table if not exists team_ratings (
  team_id uuid not null references teams (id) on delete cascade,
  sport_id uuid not null references sports (id) on delete cascade,
  rating integer not null default 1000,
  games integer not null default 0,
  last_delta integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (team_id, sport_id)
);

-- One row per rated game: the audit trail, and what a corrected score is reversed from.
create table if not exists rating_events (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references sports (id) on delete cascade,
  source text not null check (source in ('match', 'fixture')),
  source_id uuid not null unique,
  home_team_id uuid not null references teams (id) on delete cascade,
  away_team_id uuid not null references teams (id) on delete cascade,
  home_before integer not null,
  away_before integer not null,
  home_after integer not null,
  away_after integer not null,
  home_score integer not null,
  away_score integer not null,
  created_at timestamptz not null default now()
);

-- One line per player per game, so records are quick and the same everywhere.
create table if not exists player_stats (
  user_id uuid not null references profiles (id) on delete cascade,
  source text not null check (source in ('match', 'fixture')),
  source_id uuid not null,
  sport_id uuid references sports (id) on delete set null,
  team_id uuid references teams (id) on delete set null,
  opponent text,
  played_at timestamptz not null,
  result text check (result in ('W', 'D', 'L')),
  goals integer not null default 0,
  assists integer not null default 0,
  cards integer not null default 0,
  mvp boolean not null default false,
  primary key (user_id, source, source_id)
);
create index if not exists player_stats_user on player_stats (user_id, played_at desc);
create index if not exists player_stats_source on player_stats (source, source_id);

-- Free tonight: until midnight Lusaka. Organisers only ever see a count.
create table if not exists free_tonight (
  user_id uuid primary key references profiles (id) on delete cascade,
  sports uuid[] not null default '{}',
  lat double precision,
  lng double precision,
  radius_km integer not null default 10 check (radius_km between 1 and 50),
  until timestamptz not null,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

-- Which games already told the free players (one tell per game per evening).
alter table matches add column if not exists free_notified_at timestamptz;

alter table team_ratings enable row level security;
alter table rating_events enable row level security;
alter table player_stats enable row level security;
alter table free_tonight enable row level security;

drop policy if exists free_tonight_own on free_tonight;
create policy free_tonight_own on free_tonight for select using (auth.uid() = user_id);
