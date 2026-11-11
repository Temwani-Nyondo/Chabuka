-- Venue owner paths: close self-service holes in bookings, tickets and team
-- roles; let owners edit and delete their own slots; opening hours; venue
-- claims. Re-runnable. WRITTEN BUT NOT APPLIED: needs explicit approval.

-- Opening hours (free text such as "Mon-Fri 16:00-21:00, Sat 08:00-18:00").
alter table venues add column if not exists hours text;

-- ---------------------------------------------------------------------------
-- Venues: an owner can never change who owns the listing. Ownership moves only
-- through the service role (claim approval or an admin assignment).
-- ---------------------------------------------------------------------------
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
  else
    new.owner_id := old.owner_id;
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

-- ---------------------------------------------------------------------------
-- Slots: owners can edit and delete their own slots (the API refuses a delete
-- when confirmed bookings exist).
-- ---------------------------------------------------------------------------
drop policy if exists venue_slots_update_owner on venue_slots;
create policy venue_slots_update_owner on venue_slots for update
  using (exists (select 1 from venues v where v.id = venue_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from venues v where v.id = venue_id and v.owner_id = auth.uid()));
drop policy if exists venue_slots_delete_owner on venue_slots;
create policy venue_slots_delete_owner on venue_slots for delete
  using (exists (select 1 from venues v where v.id = venue_id and v.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Bookings: the status lifecycle is enforced in the database, so a client
-- talking to Supabase directly cannot confirm its own booking, book an
-- unapproved venue, or move a booking to another venue or slot.
-- ---------------------------------------------------------------------------
create or replace function bookings_guard() returns trigger
language plpgsql
as $$
declare
  v_owner uuid;
  v_status text;
  v_price numeric;
begin
  if coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  select owner_id, status into v_owner, v_status
    from venues where id = coalesce(new.venue_id, old.venue_id);

  if tg_op = 'INSERT' then
    if new.status <> 'requested' then
      raise exception 'A booking starts as requested.';
    end if;
    if v_status is distinct from 'approved' then
      raise exception 'This venue cannot take bookings yet.';
    end if;
    if new.slot_id is not null then
      select price into v_price from venue_slots where id = new.slot_id and venue_id = new.venue_id;
      if not found then
        raise exception 'That slot belongs to another venue.';
      end if;
      if v_price is not null and v_price > 0 then
        raise exception 'This slot is paid. Book it through checkout.';
      end if;
    end if;
    return new;
  end if;

  if new.venue_id is distinct from old.venue_id
     or new.slot_id is distinct from old.slot_id
     or new.requester_id is distinct from old.requester_id
     or new.match_id is distinct from old.match_id
     or new.requested_starts_at is distinct from old.requested_starts_at then
    raise exception 'Only the status of a booking can change.';
  end if;
  if new.status is distinct from old.status then
    if auth.uid() = v_owner and old.status = 'requested' and new.status in ('confirmed', 'declined') then
      null;
    elsif auth.uid() = old.requester_id and old.status in ('requested', 'confirmed') and new.status = 'cancelled' then
      null;
    else
      raise exception 'That booking change is not allowed.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_guard_trg on bookings;
create trigger bookings_guard_trg before insert or update on bookings
  for each row execute function bookings_guard();

-- ---------------------------------------------------------------------------
-- Tickets: only the venue owner issues and checks in; the holder can only let
-- a ticket go (cancelled).
-- ---------------------------------------------------------------------------
create or replace function tickets_guard() returns trigger
language plpgsql
as $$
declare
  v_owner uuid;
  v_booking_status text;
  v_booking_user uuid;
begin
  if coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  select v.owner_id, b.status, b.requester_id into v_owner, v_booking_status, v_booking_user
    from bookings b join venues v on v.id = b.venue_id
    where b.id = coalesce(new.booking_id, old.booking_id);

  if tg_op = 'INSERT' then
    if auth.uid() is distinct from v_owner or v_booking_status <> 'confirmed'
       or new.status <> 'issued' or new.user_id is distinct from v_booking_user then
      raise exception 'Tickets are issued by the venue for a confirmed booking.';
    end if;
    return new;
  end if;

  if new.booking_id is distinct from old.booking_id
     or new.user_id is distinct from old.user_id
     or new.code is distinct from old.code then
    raise exception 'Only the status of a ticket can change.';
  end if;
  if new.status is distinct from old.status then
    if auth.uid() = v_owner and old.status = 'issued' and new.status = 'used' then
      null;
    elsif auth.uid() = old.user_id and old.status = 'issued' and new.status = 'cancelled' then
      null;
    else
      raise exception 'That ticket change is not allowed.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists tickets_guard_trg on tickets;
create trigger tickets_guard_trg before insert or update on tickets
  for each row execute function tickets_guard();

-- ---------------------------------------------------------------------------
-- Teams: you cannot make yourself captain or owner of someone else's team
-- (tournament entry trusts these roles). A team's creator is its first owner;
-- anyone else joins as a player. Owners manage their own roster.
-- ---------------------------------------------------------------------------
drop policy if exists team_members_insert_self on team_members;
create policy team_members_insert_self on team_members for insert with check (
  auth.uid() = user_id
  and (role = 'player'
       or exists (select 1 from teams t where t.id = team_id and t.created_by = auth.uid()))
);

drop policy if exists team_members_update_owner on team_members;
create policy team_members_update_owner on team_members for update using (
  exists (select 1 from team_members m where m.team_id = team_members.team_id and m.user_id = auth.uid() and m.role = 'owner')
);
drop policy if exists team_members_delete_owner on team_members;
create policy team_members_delete_owner on team_members for delete using (
  exists (select 1 from team_members m where m.team_id = team_members.team_id and m.user_id = auth.uid() and m.role = 'owner')
);

create or replace function team_members_guard() returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  if new.role is distinct from old.role
     and new.role in ('owner', 'captain')
     and not exists (
       select 1 from team_members m
       where m.team_id = old.team_id and m.user_id = auth.uid() and m.role = 'owner'
     ) then
    raise exception 'Only a team owner can give the owner or captain role.';
  end if;
  return new;
end;
$$;
drop trigger if exists team_members_guard_trg on team_members;
create trigger team_members_guard_trg before update on team_members
  for each row execute function team_members_guard();

-- ---------------------------------------------------------------------------
-- Venue claims: someone says a listing is theirs; a platform admin decides.
-- Approval (service role) sets venues.owner_id.
-- ---------------------------------------------------------------------------
create table if not exists venue_claims (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists venue_claims_one_pending
  on venue_claims (venue_id, user_id) where status = 'pending';

alter table venue_claims enable row level security;
drop policy if exists venue_claims_read_own on venue_claims;
create policy venue_claims_read_own on venue_claims for select using (auth.uid() = user_id);
drop policy if exists venue_claims_insert_own on venue_claims;
create policy venue_claims_insert_own on venue_claims for insert
  with check (auth.uid() = user_id and status = 'pending');

-- ---------------------------------------------------------------------------
-- Slot load: how many confirmed bookings each slot has, so players see "Full"
-- without being able to read other people's bookings. Approved venues only
-- (or your own).
-- ---------------------------------------------------------------------------
create or replace function venue_slot_load(p_venue uuid)
returns table (slot_id uuid, confirmed integer)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, count(b.id)::integer
  from venue_slots s
  join venues v on v.id = s.venue_id
  left join bookings b on b.slot_id = s.id and b.status = 'confirmed'
  where s.venue_id = p_venue
    and (v.status = 'approved' or v.owner_id = auth.uid())
  group by s.id;
$$;
revoke all on function venue_slot_load(uuid) from public;
grant execute on function venue_slot_load(uuid) to authenticated;
