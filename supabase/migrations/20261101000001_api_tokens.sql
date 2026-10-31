-- Agent access tokens (Day 6, brief sections 6 + 10). Raw tokens are never
-- stored; only the SHA-256 hex hash lands here, and revoked_at ends a token.
-- Re-runnable.
create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Agent',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table api_tokens enable row level security;

drop policy if exists api_tokens_read_own on api_tokens;
create policy api_tokens_read_own on api_tokens for select using (auth.uid() = user_id);
drop policy if exists api_tokens_insert_own on api_tokens;
create policy api_tokens_insert_own on api_tokens for insert with check (auth.uid() = user_id);
drop policy if exists api_tokens_update_own on api_tokens;
create policy api_tokens_update_own on api_tokens for update using (auth.uid() = user_id);
