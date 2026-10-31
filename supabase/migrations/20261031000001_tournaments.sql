-- Tournaments (Day 5, brief sections 6-7). Round robin only.
-- Re-runnable. Permission checks live in the API action layer.
create table if not exists competitions (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references profiles (id) on delete cascade,
  sport_id uuid not null references sports (id),
  name text not null,
  kind text not null check (kind in ('tournament', 'league')),
  format text not null default 'round_robin' check (format in ('round_robin')),
  area text,
  starts_on text not null,
  ends_on text,
  max_entries integer not null default 8,
  status text not null default 'registration' check (status in ('registration', 'live', 'finished', 'cancelled')),
  rules text,
  created_at timestamptz not null default now()
);

create table if not exists competition_entries (
  competition_id uuid not null references competitions (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  status text not null default 'registered' check (status in ('registered')),
  created_at timestamptz not null default now(),
  primary key (competition_id, team_id)
);

create table if not exists fixtures (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  home_team_id uuid not null references teams (id) on delete cascade,
  away_team_id uuid not null references teams (id) on delete cascade,
  starts_at timestamptz,
  venue_id uuid references venues (id) on delete set null,
  home_score integer,
  away_score integer,
  status text not null default 'scheduled' check (status in ('scheduled', 'finished')),
  created_at timestamptz not null default now()
);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid references competitions (id) on delete cascade,
  match_id uuid references matches (id) on delete set null,
  author_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists follows (
  user_id uuid not null references profiles (id) on delete cascade,
  competition_id uuid not null references competitions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, competition_id)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table competitions enable row level security;
alter table competition_entries enable row level security;
alter table fixtures enable row level security;
alter table announcements enable row level security;
alter table follows enable row level security;
alter table notifications enable row level security;

-- Authenticated users can read everything written here; writes run through
-- the action layer with the caller's JWT, so writes stay scoped below.

drop policy if exists competitions_read on competitions;
create policy competitions_read on competitions for select using (auth.role() = 'authenticated');
drop policy if exists competitions_insert_own on competitions;
create policy competitions_insert_own on competitions for insert with check (auth.uid() = organiser_id);
drop policy if exists competitions_update_own on competitions;
create policy competitions_update_own on competitions for update using (auth.uid() = organiser_id);

drop policy if exists competition_entries_read on competition_entries;
create policy competition_entries_read on competition_entries for select using (auth.role() = 'authenticated');
drop policy if exists competition_entries_write_captain on competition_entries;
create policy competition_entries_write_captain on competition_entries for insert with check (
  exists (
    select 1 from team_members
    where team_members.team_id = competition_entries.team_id
      and team_members.user_id = auth.uid()
      and team_members.role in ('owner', 'captain')
  )
);
drop policy if exists competition_entries_delete_captain on competition_entries;
create policy competition_entries_delete_captain on competition_entries for delete using (
  exists (
    select 1 from team_members
    where team_members.team_id = competition_entries.team_id
      and team_members.user_id = auth.uid()
      and team_members.role in ('owner', 'captain')
  )
);

drop policy if exists fixtures_read on fixtures;
create policy fixtures_read on fixtures for select using (auth.role() = 'authenticated');
drop policy if exists fixtures_write_organiser on fixtures;
create policy fixtures_write_organiser on fixtures for all using (
  exists (
    select 1 from competitions
    where competitions.id = fixtures.competition_id
      and competitions.organiser_id = auth.uid()
  )
) with check (
  exists (
    select 1 from competitions
    where competitions.id = fixtures.competition_id
      and competitions.organiser_id = auth.uid()
  )
);

drop policy if exists announcements_read on announcements;
create policy announcements_read on announcements for select using (auth.role() = 'authenticated');
drop policy if exists announcements_insert_author on announcements;
create policy announcements_insert_author on announcements for insert with check (auth.uid() = author_id);

drop policy if exists follows_read on follows;
create policy follows_read on follows for select using (auth.role() = 'authenticated');
drop policy if exists follows_write_self on follows;
create policy follows_write_self on follows for insert with check (auth.uid() = user_id);
drop policy if exists follows_delete_self on follows;
create policy follows_delete_self on follows for delete using (auth.uid() = user_id);

drop policy if exists notifications_read_own on notifications;
create policy notifications_read_own on notifications for select using (auth.uid() = user_id);
drop policy if exists notifications_insert_own on notifications;
create policy notifications_insert_own on notifications for insert with check (auth.uid() = user_id);
drop policy if exists notifications_update_own on notifications;
create policy notifications_update_own on notifications for update using (auth.uid() = user_id);
