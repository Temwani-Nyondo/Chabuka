-- Share links: a reusable invite link per game (anyone with it can see the game and join) and one personal
-- "join Chabuka" link per player. Both reuse invite_links; the old single-use team links keep working.
-- Who joined through whose link is recorded (invite_link_uses, profiles.invited_by).
-- Re-runnable.

alter table invite_links add column if not exists match_id uuid references matches (id) on delete cascade;
alter table invite_links add column if not exists multi_use boolean not null default false;
alter table invite_links add column if not exists use_count integer not null default 0;

-- One live personal link per player, one live link per player per game: sharing again reuses it.
create unique index if not exists invite_links_personal_one
  on invite_links (created_by) where multi_use and match_id is null and team_id is null and revoked_at is null;
create unique index if not exists invite_links_match_one
  on invite_links (created_by, match_id) where match_id is not null and revoked_at is null;

create table if not exists invite_link_uses (
  code text not null references invite_links (code) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  used_at timestamptz not null default now(),
  primary key (code, user_id)
);

alter table invite_link_uses enable row level security;

-- Read-only to the player who used it and to the link's creator; writes go through the API.
drop policy if exists invite_link_uses_read on invite_link_uses;
create policy invite_link_uses_read on invite_link_uses for select using (
  auth.uid() = user_id
  or exists (select 1 from invite_links l where l.code = invite_link_uses.code and l.created_by = auth.uid())
);

-- Who brought this player to Chabuka (first link they used). Set once by the API, never changed.
alter table profiles add column if not exists invited_by uuid references profiles (id) on delete set null;

-- "Invite people to my game": one nudge per game per sender per audience (a circle id, or 'followers').
create table if not exists match_invites_sent (
  match_id uuid not null references matches (id) on delete cascade,
  sender_id uuid not null references profiles (id) on delete cascade,
  audience text not null,
  recipients integer not null default 0,
  sent_at timestamptz not null default now(),
  primary key (match_id, sender_id, audience)
);

alter table match_invites_sent enable row level security;

drop policy if exists match_invites_sent_read on match_invites_sent;
create policy match_invites_sent_read on match_invites_sent for select using (auth.uid() = sender_id);
