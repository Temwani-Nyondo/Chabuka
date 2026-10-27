-- Day 1 core: sports, profiles, user_sports, avatar storage.
-- Re-runnable: every policy is dropped before creation.
create table if not exists sports (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  formats text[] not null default '{}'
);

insert into sports (name, formats) values
  ('Football', array['5-a-side', '7-a-side', '11-a-side']),
  ('futsal', array['5-a-side']),
  ('basketball', array['5v5', '3x3']),
  ('tennis', array['singles', 'doubles']),
  ('padel', array['doubles']),
  ('netball', array['7-a-side'])
on conflict (name) do update set formats = excluded.formats;

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  photo_url text,
  country text default 'Zambia',
  city text default 'Lusaka',
  area text,
  lat double precision,
  lng double precision,
  bio text,
  created_at timestamptz not null default now()
);

create table if not exists user_sports (
  user_id uuid not null references profiles (id) on delete cascade,
  sport_id uuid not null references sports (id) on delete cascade,
  level text not null check (level in ('recreational', 'intermediate', 'competitive')),
  primary key (user_id, sport_id)
);

alter table sports enable row level security;
alter table profiles enable row level security;
alter table user_sports enable row level security;

-- Sports are readable by everyone, including logged-out visitors.
drop policy if exists sports_read on sports;
create policy sports_read on sports for select using (true);

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (auth.role() = 'authenticated');
drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles for insert with check (auth.uid() = id);
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update using (auth.uid() = id);

drop policy if exists user_sports_read on user_sports;
create policy user_sports_read on user_sports for select using (auth.role() = 'authenticated');
drop policy if exists user_sports_insert_own on user_sports;
create policy user_sports_insert_own on user_sports for insert with check (auth.uid() = user_id);
drop policy if exists user_sports_delete_own on user_sports;
create policy user_sports_delete_own on user_sports for delete using (auth.uid() = user_id);

-- Avatar uploads: public read, signed-in upload, owners manage their folder.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.role() = 'authenticated');
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
