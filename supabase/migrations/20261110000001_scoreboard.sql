-- Scoreboard: live officiating for fixtures and games. One appointed official
-- records events (goals, assists, subs, cards, periods, tennis points); a pure
-- reducer in @chabuka/shared turns the log into the live state. Everyone can
-- watch through the API; nothing here is readable or writable directly by
-- clients, so permissions live in one place (the API). Re-runnable.

create table if not exists scoreboards (
  id uuid primary key default gen_random_uuid(),
  share_code text not null unique,
  fixture_id uuid unique references fixtures (id) on delete cascade,
  match_id uuid unique references matches (id) on delete cascade,
  sport text not null check (sport in ('football', 'futsal', 'basketball', 'netball', 'tennis', 'padel')),
  config jsonb not null,
  home_name text not null,
  away_name text not null,
  home_team_id uuid references teams (id) on delete set null,
  away_team_id uuid references teams (id) on delete set null,
  status text not null default 'setup' check (status in ('setup', 'live', 'paused', 'break', 'ended')),
  official_id uuid references profiles (id) on delete set null,
  appointed_by uuid references profiles (id) on delete set null,
  created_by uuid not null references profiles (id) on delete cascade,
  home_score integer not null default 0,
  away_score integer not null default 0,
  mvp_player_id uuid,
  result_posted boolean not null default false,
  last_seq integer not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check ((fixture_id is not null) <> (match_id is not null))
);

create table if not exists scoreboard_players (
  id uuid primary key default gen_random_uuid(),
  scoreboard_id uuid not null references scoreboards (id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  user_id uuid references profiles (id) on delete set null,
  name text not null,
  number integer,
  starter boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists scoreboard_players_board on scoreboard_players (scoreboard_id);

alter table scoreboards drop constraint if exists scoreboards_mvp_fk;
alter table scoreboards add constraint scoreboards_mvp_fk
  foreign key (mvp_player_id) references scoreboard_players (id) on delete set null;

create table if not exists scoreboard_events (
  id uuid primary key default gen_random_uuid(),
  scoreboard_id uuid not null references scoreboards (id) on delete cascade,
  seq integer not null,
  client_id uuid not null,
  type text not null,
  at bigint not null,
  payload jsonb not null default '{}'::jsonb,
  voided boolean not null default false,
  voided_by uuid references profiles (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (scoreboard_id, seq),
  unique (scoreboard_id, client_id)
);

-- Row level security on, with no policies: only the service role (the API,
-- after its own permission checks) can read or write these tables.
alter table scoreboards enable row level security;
alter table scoreboard_players enable row level security;
alter table scoreboard_events enable row level security;
