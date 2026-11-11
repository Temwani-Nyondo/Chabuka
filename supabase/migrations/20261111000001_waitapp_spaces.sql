-- Linked venues: a Chabuka venue can use a WaitApp "Bookable Venue" account for its spaces, calendar and money. WaitApp
-- holds the slots and takes payment; Chabuka shows them and records each player's booking here, kept current by signed
-- booking webhooks. Venues that are not linked keep today's free request flow. Re-runnable.

alter table venues add column if not exists waitapp_restaurant_id text;

-- Only the service role (the API, after checking the caller owns the venue and the WaitApp account really is a bookable
-- venue) may set or change the link. An owner cannot point their venue at someone else's WaitApp account.
create or replace function venues_guard_review() returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.review_note := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.waitapp_restaurant_id := null;
  else
    new.owner_id := old.owner_id;
    new.waitapp_restaurant_id := old.waitapp_restaurant_id;
    new.review_note := old.review_note;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    if old.status = 'approved'
       and (new.name is distinct from old.name
            or new.lat is distinct from old.lat
            or new.lng is distinct from old.lng
            or new.google_place_id is distinct from old.google_place_id) then
      new.status := 'pending';
    else
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;

create table if not exists waitapp_bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  -- The Chabuka game this booking is for, when it was made for one (the organiser books the space for their game).
  match_id uuid references matches (id) on delete set null,
  waitapp_reservation_id text not null unique,
  booking_code text,
  space_id text not null,
  space_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  total numeric(12, 2),
  currency text,
  instant boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'paid', 'cancelled')),
  checkout_url text,
  deposit_due_by timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists waitapp_bookings_user on waitapp_bookings (user_id, starts_at desc);
create index if not exists waitapp_bookings_venue on waitapp_bookings (venue_id, starts_at desc);
create index if not exists waitapp_bookings_match on waitapp_bookings (match_id) where match_id is not null;

alter table waitapp_bookings enable row level security;
-- The player sees their own bookings and the venue owner sees their venue's. Writes are API-only (service role).
drop policy if exists waitapp_bookings_read on waitapp_bookings;
create policy waitapp_bookings_read on waitapp_bookings for select using (
  auth.uid() = user_id
  or exists (select 1 from venues v where v.id = venue_id and v.owner_id = auth.uid())
);
