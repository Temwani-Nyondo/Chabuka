-- Phase 5: circles as channels, creators, one follow system, profile visibility. Re-runnable.
-- No comments or direct messages anywhere. Writes go through the API (service role) after its own checks.
-- The profile column lock is a SEPARATE migration (20261118000002), applied only once the new web app is live.

-- Circles: owner and admins post; members react, vote, mute.
create table if not exists circle_admins (
  circle_id uuid not null references circles (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
insert into circle_admins (circle_id, user_id, role)
  select id, created_by, 'owner' from circles
  on conflict (circle_id, user_id) do nothing;

alter table circle_members add column if not exists notify text not null default 'all';
alter table circle_members drop constraint if exists circle_members_notify_check;
alter table circle_members add constraint circle_members_notify_check check (notify in ('all', 'important', 'none'));
alter table circle_members add column if not exists last_read_at timestamptz;
-- Removed members keep a row so they cannot rejoin.
alter table circle_members add column if not exists removed_at timestamptz;
alter table circle_members add column if not exists removed_by uuid references profiles (id) on delete set null;

create table if not exists circle_posts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  kind text not null default 'update' check (kind in ('update', 'photo', 'poll', 'game', 'result', 'event')),
  body text not null default '',
  images text[] not null default '{}',
  link_type text check (link_type in ('match', 'competition', 'race')),
  link_id uuid,
  poll jsonb,
  important boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists circle_posts_circle on circle_posts (circle_id, created_at desc);

create table if not exists circle_poll_votes (
  post_id uuid not null references circle_posts (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  option integer not null check (option between 0 and 5),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists post_reactions (
  post_type text not null check (post_type in ('circle', 'creator')),
  post_id uuid not null,
  user_id uuid not null references profiles (id) on delete cascade,
  reaction text not null check (reaction in ('like', 'fire', 'clap', 'strong')),
  created_at timestamptz not null default now(),
  primary key (post_type, post_id, user_id, reaction)
);
create index if not exists post_reactions_post on post_reactions (post_type, post_id);

alter table competitions add column if not exists circle_id uuid references circles (id) on delete set null;

-- Creators: admin-approved, followable, posts and articles.
create table if not exists creator_profiles (
  user_id uuid primary key references profiles (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null,
  bio text not null default '',
  avatar_url text,
  banner_url text,
  sports text[] not null default '{}',
  links jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  pitch text,
  review_note text,
  reviewed_by uuid references profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists creator_posts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references creator_profiles (user_id) on delete cascade,
  kind text not null default 'post' check (kind in ('post', 'article')),
  title text not null default '',
  body text not null default '',
  cover_url text,
  images text[] not null default '{}',
  sport_id uuid references sports (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists creator_posts_creator on creator_posts (creator_id, published_at desc);

-- One follow system. Competition follows (incl. races) carry over from the old table, which stays read-only.
create table if not exists user_follows (
  user_id uuid not null references profiles (id) on delete cascade,
  subject_type text not null check (subject_type in ('creator', 'team', 'competition', 'venue')),
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, subject_type, subject_id)
);
create index if not exists user_follows_subject on user_follows (subject_type, subject_id);
insert into user_follows (user_id, subject_type, subject_id, created_at)
  select user_id, 'competition', competition_id, created_at from follows
  on conflict do nothing;

-- Who sees a player's record, teams and sports. Name and photo are always visible.
alter table profiles add column if not exists visibility text not null default 'connections';
alter table profiles drop constraint if exists profiles_visibility_check;
alter table profiles add constraint profiles_visibility_check check (visibility in ('everyone', 'connections', 'private'));

-- What anyone may see of another player: name, photo, cover, visibility. Once 20261118000002 limits the
-- profiles table to your own row, every read of other people goes through this view (owned by postgres, so it is
-- not held back by the profiles row policy, and it only ever exposes these columns).
create or replace view public_profiles as
  select id, name, photo_url, cover_url, visibility from profiles;
revoke all on public_profiles from anon;
grant select on public_profiles to authenticated;

-- Your own full profile (also readable directly from profiles: your own row stays visible to you).
create or replace function get_my_profile() returns setof profiles
language sql security definer set search_path = public stable as $$
  select * from profiles where id = auth.uid();
$$;
revoke all on function get_my_profile() from public;
grant execute on function get_my_profile() to authenticated;

alter table circle_admins enable row level security;
alter table circle_posts enable row level security;
alter table circle_poll_votes enable row level security;
alter table post_reactions enable row level security;
alter table creator_profiles enable row level security;
alter table creator_posts enable row level security;
alter table user_follows enable row level security;

drop policy if exists circle_admins_read on circle_admins;
create policy circle_admins_read on circle_admins for select using (auth.role() = 'authenticated');
drop policy if exists circle_posts_read on circle_posts;
create policy circle_posts_read on circle_posts for select using (auth.role() = 'authenticated' and deleted_at is null);
drop policy if exists post_reactions_read on post_reactions;
create policy post_reactions_read on post_reactions for select using (auth.role() = 'authenticated');
drop policy if exists creator_profiles_read on creator_profiles;
create policy creator_profiles_read on creator_profiles for select using (status = 'approved' or auth.uid() = user_id);
drop policy if exists creator_posts_read on creator_posts;
create policy creator_posts_read on creator_posts for select using (
  auth.uid() = creator_id
  or (status = 'published' and deleted_at is null
      and exists (select 1 from creator_profiles c where c.user_id = creator_id and c.status = 'approved'))
);
drop policy if exists user_follows_own on user_follows;
create policy user_follows_own on user_follows for select using (auth.uid() = user_id);
-- Poll votes: read through the API (tallies), never directly.
