-- Circles (user-directed): interest groups with prerequisites. Events can
-- sit in a circle so every subscriber hears about them. Re-runnable.
create table if not exists circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sport_id uuid references sports (id) on delete set null,
  area text,
  description text,
  age_bands text[] not null default '{}',
  genders text[] not null default '{}',
  levels text[] not null default '{}',
  created_by uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists circle_members (
  circle_id uuid not null references circles (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

alter table matches add column if not exists circle_id uuid references circles (id) on delete set null;

alter table circles enable row level security;
alter table circle_members enable row level security;

drop policy if exists circles_read on circles;
create policy circles_read on circles for select using (auth.role() = 'authenticated');
drop policy if exists circles_insert_own on circles;
create policy circles_insert_own on circles for insert with check (auth.uid() = created_by);

drop policy if exists circle_members_read on circle_members;
create policy circle_members_read on circle_members for select using (auth.role() = 'authenticated');
drop policy if exists circle_members_write_self on circle_members;
create policy circle_members_write_self on circle_members for insert with check (auth.uid() = user_id);
drop policy if exists circle_members_delete_self on circle_members;
create policy circle_members_delete_self on circle_members for delete using (auth.uid() = user_id);
