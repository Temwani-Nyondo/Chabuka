-- Golf G2: a space can be sold as a tee sheet (start times every few minutes, up to four golfers each, priced per
-- player and paid at the course) instead of by the hour. Chabuka-only for now: a venue linked to WaitApp keeps hourly
-- spaces only.

alter table venue_spaces add column if not exists booking_kind text not null default 'hourly';
alter table venue_spaces drop constraint if exists venue_spaces_booking_kind_check;
alter table venue_spaces add constraint venue_spaces_booking_kind_check check (booking_kind in ('hourly', 'tee'));
-- { intervalMin, playersPerSlot, pricePerPlayer }
alter table venue_spaces add column if not exists tee jsonb;

alter table bookings add column if not exists players integer;
alter table bookings drop constraint if exists bookings_players_check;
alter table bookings add constraint bookings_players_check check (players is null or players between 1 and 4);
