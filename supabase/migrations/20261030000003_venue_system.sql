-- Amendment 3 venue system: match place storage, venue ownership,
-- bookable schedule slots, free bookings and free tickets. Re-runnable.
-- No money anywhere: bookings and tickets are free in the MVP.
alter table matches add column if not exists place_id text;
alter table matches add column if not exists venue_name text;
alter table venues add column if not exists owner_id uuid references profiles (id) on delete set null;
alter table venues add column if not exists google_place_id text;

create table if not exists venue_slots (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null default 1 check (capacity > 0),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  slot_id uuid references venue_slots (id) on delete set null,
  match_id uuid references matches (id) on delete set null,
  requester_id uuid not null references profiles (id) on delete cascade,
  requested_starts_at timestamptz,
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'declined', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  code text not null unique,
  status text not null default 'issued' check (status in ('issued', 'used', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table venue_slots enable row level security;
alter table bookings enable row level security;
alter table tickets enable row level security;

-- Venues: owners register and manage their own venue (dashboard).
drop policy if exists venues_insert_owner on venues;
create policy venues_insert_owner on venues for insert with check (auth.uid() = owner_id);
drop policy if exists venues_update_owner on venues;
create policy venues_update_owner on venues for update using (auth.uid() = owner_id);

-- Slots: any signed-in user can see the schedule; only the venue owner writes.
drop policy if exists venue_slots_read on venue_slots;
create policy venue_slots_read on venue_slots for select using (auth.role() = 'authenticated');
drop policy if exists venue_slots_write_owner on venue_slots;
create policy venue_slots_write_owner on venue_slots for insert with check (
  exists (select 1 from venues v where v.id = venue_id and v.owner_id = auth.uid())
);

-- Bookings: requester sees their own; the venue owner sees their venue's.
drop policy if exists bookings_read on bookings;
create policy bookings_read on bookings for select using (
  auth.uid() = requester_id
  or exists (select 1 from venues v where v.id = venue_id and v.owner_id = auth.uid())
);
drop policy if exists bookings_insert_self on bookings;
create policy bookings_insert_self on bookings for insert with check (auth.uid() = requester_id);
drop policy if exists bookings_update_parties on bookings;
create policy bookings_update_parties on bookings for update using (
  auth.uid() = requester_id
  or exists (select 1 from venues v where v.id = venue_id and v.owner_id = auth.uid())
);

-- Tickets: holder sees their own; the venue owner sees tickets for their venue.
drop policy if exists tickets_read on tickets;
create policy tickets_read on tickets for select using (
  auth.uid() = user_id
  or exists (
    select 1 from bookings b join venues v on v.id = b.venue_id
    where b.id = booking_id and v.owner_id = auth.uid()
  )
);
drop policy if exists tickets_insert_owner on tickets;
create policy tickets_insert_owner on tickets for insert with check (
  exists (
    select 1 from bookings b join venues v on v.id = b.venue_id
    where b.id = booking_id and v.owner_id = auth.uid()
  )
);
drop policy if exists tickets_update_parties on tickets;
create policy tickets_update_parties on tickets for update using (
  auth.uid() = user_id
  or exists (
    select 1 from bookings b join venues v on v.id = b.venue_id
    where b.id = booking_id and v.owner_id = auth.uid()
  )
);
