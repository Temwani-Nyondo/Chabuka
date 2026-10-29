-- H1 catch-up: partners, venues, matches, match_participants. Re-runnable.
-- Capacity and status transitions live in the API action layer, never here.
create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles (id) on delete set null,
  name text not null,
  type text not null check (type in ('venue_provider', 'equipment_provider'))
);

create table if not exists venues (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references partners (id) on delete set null,
  name text not null,
  area text,
  lat double precision,
  lng double precision,
  sports text[] not null default '{}',
  facility_types text[] not null default '{}',
  price_note text,
  contact text,
  photos text[] not null default '{}'
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references profiles (id) on delete cascade,
  sport_id uuid not null references sports (id),
  title text not null,
  starts_at timestamptz not null,
  venue_id uuid references venues (id) on delete set null,
  lat double precision,
  lng double precision,
  area text,
  format text,
  capacity integer not null default 10 check (capacity > 0),
  level text check (level in ('recreational', 'intermediate', 'competitive')),
  kind text not null default 'players' check (kind in ('players', 'team-vs-team')),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  status text not null default 'open' check (status in ('open', 'full', 'game_on', 'postponed', 'cancelled', 'finished')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists match_participants (
  match_id uuid not null references matches (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  status text not null default 'joined' check (status in ('joined', 'withdrawn')),
  primary key (match_id, user_id)
);

alter table partners enable row level security;
alter table venues enable row level security;
alter table matches enable row level security;
alter table match_participants enable row level security;

drop policy if exists partners_read on partners;
create policy partners_read on partners for select using (auth.role() = 'authenticated');
drop policy if exists venues_read on venues;
create policy venues_read on venues for select using (auth.role() = 'authenticated');
drop policy if exists matches_read on matches;
create policy matches_read on matches for select using (auth.role() = 'authenticated');
drop policy if exists matches_insert_own on matches;
create policy matches_insert_own on matches for insert with check (auth.uid() = organiser_id);
drop policy if exists matches_update_organiser on matches;
create policy matches_update_organiser on matches for update using (auth.uid() = organiser_id);
drop policy if exists matches_delete_organiser on matches;
create policy matches_delete_organiser on matches for delete using (auth.uid() = organiser_id);
drop policy if exists participants_read on match_participants;
create policy participants_read on match_participants for select using (auth.role() = 'authenticated');
drop policy if exists participants_insert_self on match_participants;
create policy participants_insert_self on match_participants for insert with check (auth.uid() = user_id);
drop policy if exists participants_update_self on match_participants;
create policy participants_update_self on match_participants for update using (auth.uid() = user_id);
drop policy if exists participants_delete_self on match_participants;
create policy participants_delete_self on match_participants for delete using (auth.uid() = user_id);
