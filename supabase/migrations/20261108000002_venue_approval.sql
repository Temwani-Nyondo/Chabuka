-- Venue approval: a venue is visible and bookable only once a platform admin
-- approves it. Existing venues are already live, so they are approved here,
-- BEFORE the read policy tightens. Slots can now carry a price (null = free).

alter table venues add column if not exists status text not null default 'pending'
  check (status in ('pending', 'approved', 'rejected'));
alter table venues add column if not exists review_note text;
alter table venues add column if not exists reviewed_by uuid references profiles (id) on delete set null;
alter table venues add column if not exists reviewed_at timestamptz;

-- Everything that exists right now is live: keep it live.
update venues set status = 'approved', reviewed_at = coalesce(reviewed_at, now()) where status = 'pending';

-- One listing per real place. A rejected listing frees the place again.
create unique index if not exists venues_google_place_id_live_key
  on venues (google_place_id)
  where google_place_id is not null and status <> 'rejected';

-- Platform admins: managed with the service role (or SQL); a user can only
-- see their own row, which is how the web app asks "am I an admin?".
create table if not exists platform_admins (
  user_id uuid primary key references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
drop policy if exists platform_admins_read_self on platform_admins;
create policy platform_admins_read_self on platform_admins for select using (auth.uid() = user_id);

-- Owners cannot approve themselves. Outside the service role: a new venue is
-- always pending, review fields never change, and editing what identifies the
-- place (name, location) sends an approved venue back for review.
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
drop trigger if exists venues_guard_review_trg on venues;
create trigger venues_guard_review_trg before insert or update on venues
  for each row execute function venues_guard_review();

-- Visibility: approved venues for everyone; owners also see their own; admins see all.
drop policy if exists venues_read on venues;
create policy venues_read on venues for select using (
  status = 'approved'
  or owner_id = auth.uid()
  or exists (select 1 from platform_admins a where a.user_id = auth.uid())
);

-- Slots follow their venue's visibility.
drop policy if exists venue_slots_read on venue_slots;
create policy venue_slots_read on venue_slots for select using (
  exists (
    select 1 from venues v
    where v.id = venue_id
      and (v.status = 'approved'
           or v.owner_id = auth.uid()
           or exists (select 1 from platform_admins a where a.user_id = auth.uid()))
  )
);

-- Slot price. Null means free. Paid booking itself arrives with WaitApp payments.
alter table venue_slots add column if not exists price numeric(10, 2) check (price is null or price >= 0);
alter table venue_slots add column if not exists currency text;
