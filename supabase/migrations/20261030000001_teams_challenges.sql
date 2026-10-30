-- Teams + challenges (brief sections 6-7). Re-runnable, mirrors matches_core.
-- Permission checks (captain-only etc.) live in the API action layer.
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  sport_id uuid not null references sports (id),
  category text not null default 'recreational' check (category in ('corporate', 'neighbourhood', 'recreational', 'competitive', 'veterans', 'alumni', 'social', 'club')),
  city text,
  area text,
  lat double precision,
  lng double precision,
  verified boolean not null default false,
  created_by uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null default 'player' check (role in ('owner', 'captain', 'player')),
  primary key (team_id, user_id)
);

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  sport_id uuid not null references sports (id),
  format text,
  level text check (level in ('recreational', 'intermediate', 'competitive')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  area text,
  lat double precision,
  lng double precision,
  radius_km double precision,
  status text not null default 'open' check (status in ('open', 'accepted', 'reschedule_proposed', 'declined', 'expired')),
  opponent_team_id uuid references teams (id) on delete set null,
  proposed_starts_at timestamptz,
  match_id uuid references matches (id) on delete set null,
  created_by uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table teams enable row level security;
alter table team_members enable row level security;
alter table challenges enable row level security;

drop policy if exists teams_read on teams;
create policy teams_read on teams for select using (auth.role() = 'authenticated');
drop policy if exists teams_insert_own on teams;
create policy teams_insert_own on teams for insert with check (auth.uid() = created_by);
drop policy if exists teams_update_owner on teams;
create policy teams_update_owner on teams for update using (auth.uid() = created_by);
drop policy if exists teams_delete_owner on teams;
create policy teams_delete_owner on teams for delete using (auth.uid() = created_by);

drop policy if exists team_members_read on team_members;
create policy team_members_read on team_members for select using (auth.role() = 'authenticated');
drop policy if exists team_members_insert_self on team_members;
create policy team_members_insert_self on team_members for insert with check (auth.uid() = user_id);
drop policy if exists team_members_update_self on team_members;
create policy team_members_update_self on team_members for update using (auth.uid() = user_id);
drop policy if exists team_members_delete_self on team_members;
create policy team_members_delete_self on team_members for delete using (auth.uid() = user_id);

drop policy if exists challenges_read on challenges;
create policy challenges_read on challenges for select using (auth.role() = 'authenticated');
drop policy if exists challenges_insert_own on challenges;
create policy challenges_insert_own on challenges for insert with check (auth.uid() = created_by);
drop policy if exists challenges_update_creator on challenges;
create policy challenges_update_creator on challenges for update using (auth.uid() = created_by);
drop policy if exists challenges_delete_creator on challenges;
create policy challenges_delete_creator on challenges for delete using (auth.uid() = created_by);
