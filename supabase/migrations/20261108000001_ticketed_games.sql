-- Ticketed games: WaitApp's ticket engine sells, issues, scans and settles the
-- tickets; Chabuka only mirrors what it needs to show the game and its roster.
-- Everything here is written by the API's service role. Players and organisers
-- can READ ticketing rows but never write them, so nobody can attach a fake
-- checkout link to a game.

-- One row per ticketed game.
create table if not exists match_ticketing (
  match_id uuid primary key references matches (id) on delete cascade,
  waitapp_event_id text not null,
  -- pending_review: WaitApp has not published the event yet (paid events wait
  -- for WaitApp review); on_sale; cancelled.
  status text not null default 'pending_review' check (status in ('draft', 'pending_review', 'on_sale', 'cancelled')),
  checkout_url text not null,
  currency text not null,
  tiers jsonb not null default '[]'::jsonb,
  sold_count integer not null default 0,
  checked_in_count integer not null default 0,
  refunded_count integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table match_ticketing enable row level security;
drop policy if exists match_ticketing_read on match_ticketing;
create policy match_ticketing_read on match_ticketing for select using (auth.role() = 'authenticated');

-- An organiser's link to their WaitApp organiser account. The token is stored
-- encrypted by the API. No policies on purpose: only the service role reads it.
create table if not exists waitapp_links (
  user_id uuid primary key references profiles (id) on delete cascade,
  restaurant_id text not null,
  token_enc text not null,
  organiser_name text,
  currency text,
  created_at timestamptz not null default now()
);
alter table waitapp_links enable row level security;

-- Tickets WaitApp has issued for a game. Holds no payment data: just who it
-- is for and whether it is still valid. user_id stays null until the buyer is
-- matched to a Chabuka account (by reference or verified email).
create table if not exists ticket_orders (
  ticket_id text primary key,
  match_id uuid not null references matches (id) on delete cascade,
  user_id uuid references profiles (id) on delete set null,
  buyer_email text not null,
  tier_name text,
  payment_id text not null,
  status text not null default 'valid' check (status in ('valid', 'used', 'cancelled', 'refunded')),
  created_at timestamptz not null default now()
);
create index if not exists ticket_orders_match_idx on ticket_orders (match_id);
create index if not exists ticket_orders_email_idx on ticket_orders (buyer_email) where user_id is null;
alter table ticket_orders enable row level security;
drop policy if exists ticket_orders_read_own on ticket_orders;
create policy ticket_orders_read_own on ticket_orders for select using (auth.uid() = user_id);

-- Email -> user lookup for the webhook (auth.users is not reachable through
-- the Data API). Service role only.
create or replace function find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  -- Confirmed emails only: an unconfirmed signup must not be able to claim
  -- someone else's tickets by typing their address.
  select id from auth.users
  where lower(email) = lower(p_email) and email_confirmed_at is not null
  limit 1;
$$;
revoke all on function find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function find_user_id_by_email(text) to service_role;
