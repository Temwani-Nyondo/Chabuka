-- Gaffer memory, team availability polls, and casual-match scores.
-- Re-runnable.
create table if not exists gaffer_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

alter table gaffer_memories enable row level security;

drop policy if exists gaffer_memories_owner on gaffer_memories;
create policy gaffer_memories_owner on gaffer_memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists polls (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  created_by uuid not null references profiles (id) on delete cascade,
  question text not null,
  closes_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

alter table polls enable row level security;

drop policy if exists polls_read_members on polls;
create policy polls_read_members on polls for select using (
  exists (
    select 1 from team_members m
    where m.team_id = polls.team_id and m.user_id = auth.uid()
  )
);
drop policy if exists polls_insert_members on polls;
create policy polls_insert_members on polls for insert with check (
  created_by = auth.uid() and exists (
    select 1 from team_members m
    where m.team_id = polls.team_id and m.user_id = auth.uid()
  )
);
drop policy if exists polls_update_creator on polls;
create policy polls_update_creator on polls for update using (created_by = auth.uid());

create table if not exists poll_responses (
  poll_id uuid not null references polls (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  response text not null check (response in ('in', 'out', 'maybe')),
  responded_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

alter table poll_responses enable row level security;

drop policy if exists poll_responses_read_members on poll_responses;
create policy poll_responses_read_members on poll_responses for select using (
  exists (
    select 1 from polls p
    join team_members m on m.team_id = p.team_id
    where p.id = poll_responses.poll_id and m.user_id = auth.uid()
  )
);
drop policy if exists poll_responses_write_own on poll_responses;
create policy poll_responses_write_own on poll_responses for insert with check (
  user_id = auth.uid() and exists (
    select 1 from polls p
    join team_members m on m.team_id = p.team_id
    where p.id = poll_responses.poll_id and m.user_id = auth.uid()
  )
);
drop policy if exists poll_responses_update_own on poll_responses;
create policy poll_responses_update_own on poll_responses for update using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
);

-- Casual-match scores, reported by the organiser (tournaments use fixtures).
alter table matches add column if not exists home_score integer;
alter table matches add column if not exists away_score integer;
