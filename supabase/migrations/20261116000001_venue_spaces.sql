-- Phase 4: venue spaces, opening hours, closures, staff and block bookings.
-- Same model as WaitApp's Bookable Venue (spaces with units, hourly times, request/instant, opening hours,
-- closures), so a Chabuka-only venue and a WaitApp-linked venue work the same way. Re-runnable.
-- New tables are written only by the API (service role) after its own owner/staff checks.

-- Opening hours: same shape as WaitApp's operatingHours ({"mon":{"open":"17:00","close":"22:00","closed":false},...}).
-- Empty = always open.
alter table venues add column if not exists opening_hours jsonb not null default '{}'::jsonb;

create table if not exists venue_spaces (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  sports text[] not null default '{}',
  surface text,
  size_note text,
  unit_count integer not null default 1 check (unit_count between 1 and 20),
  hourly_price numeric(12, 2) check (hourly_price is null or hourly_price >= 0),
  currency text,
  booking_mode text not null default 'request' check (booking_mode in ('request', 'instant')),
  photos text[] not null default '{}',
  sort integer not null default 0,
  active boolean not null default true,
  -- The WaitApp roomFacilityTypes id once this space was copied to a linked WaitApp venue.
  waitapp_type_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists venue_spaces_venue on venue_spaces (venue_id, sort);

create table if not exists venue_closures (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  -- Null = the whole venue.
  space_id uuid references venue_spaces (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists venue_closures_venue on venue_closures (venue_id, starts_at);

create table if not exists venue_staff (
  venue_id uuid not null references venues (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null default 'manager' check (role in ('manager')),
  added_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);

create table if not exists booking_groups (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  requester_id uuid not null references profiles (id) on delete cascade,
  weeks integer not null check (weeks between 1 and 12),
  note text,
  created_at timestamptz not null default now()
);

-- Bookings: space bookings carry their own times and unit; old slot bookings keep working.
alter table bookings add column if not exists space_id uuid references venue_spaces (id) on delete set null;
alter table bookings add column if not exists unit_no integer;
alter table bookings add column if not exists starts_at timestamptz;
alter table bookings add column if not exists ends_at timestamptz;
alter table bookings add column if not exists group_id uuid references booking_groups (id) on delete set null;
alter table bookings add column if not exists team_id uuid references teams (id) on delete set null;
alter table bookings add column if not exists fixture_id uuid references fixtures (id) on delete set null;
alter table bookings add column if not exists note text;
alter table bookings add column if not exists owner_note text;
alter table bookings add column if not exists source text not null default 'player';
alter table bookings drop constraint if exists bookings_source_check;
alter table bookings add constraint bookings_source_check check (source in ('player', 'owner'));
-- Walk-in / phone bookings the venue takes for someone outside Chabuka (requester = the staff member).
alter table bookings add column if not exists guest_name text;
alter table bookings add column if not exists guest_phone text;
-- What the player pays at the venue (Chabuka never takes money).
alter table bookings add column if not exists pay_at_venue_amount numeric(12, 2);
alter table bookings add column if not exists currency text;
alter table bookings add column if not exists decided_by uuid references profiles (id) on delete set null;
alter table bookings add column if not exists decided_at timestamptz;
alter table bookings add column if not exists cancelled_reason text;
alter table bookings add column if not exists checked_in_at timestamptz;
create index if not exists bookings_space_time on bookings (space_id, starts_at) where space_id is not null;
create index if not exists bookings_group on bookings (group_id) where group_id is not null;

-- WaitApp bookings: same grouping and links, plus where the booking came from.
alter table waitapp_bookings add column if not exists group_id uuid references booking_groups (id) on delete set null;
alter table waitapp_bookings add column if not exists team_id uuid references teams (id) on delete set null;
alter table waitapp_bookings add column if not exists fixture_id uuid references fixtures (id) on delete set null;
alter table waitapp_bookings add column if not exists source text not null default 'chabuka';
alter table waitapp_bookings drop constraint if exists waitapp_bookings_source_check;
alter table waitapp_bookings add constraint waitapp_bookings_source_check check (source in ('chabuka', 'waitapp'));
alter table waitapp_bookings add column if not exists customer_name text;
-- Bookings made on WaitApp itself have no Chabuka player.
alter table waitapp_bookings alter column user_id drop not null;
alter table waitapp_bookings drop constraint if exists waitapp_bookings_status_check;
alter table waitapp_bookings add constraint waitapp_bookings_status_check
  check (status in ('pending', 'accepted', 'paid', 'cancelled', 'declined'));

-- Access: spaces and closures are public to signed-in users (no private data). Staff and groups are API-only.
alter table venue_spaces enable row level security;
alter table venue_closures enable row level security;
alter table venue_staff enable row level security;
alter table booking_groups enable row level security;

drop policy if exists venue_spaces_read on venue_spaces;
create policy venue_spaces_read on venue_spaces for select using (auth.role() = 'authenticated');
drop policy if exists venue_closures_read on venue_closures;
create policy venue_closures_read on venue_closures for select using (auth.role() = 'authenticated');
-- Staff can see that they are staff (to list "venues I manage").
drop policy if exists venue_staff_read_self on venue_staff;
create policy venue_staff_read_self on venue_staff for select using (auth.uid() = user_id);
