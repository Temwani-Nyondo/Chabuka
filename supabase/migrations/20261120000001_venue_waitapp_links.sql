-- Venue handshake: a Chabuka venue links to its own WaitApp Bookable Venue account. The link belongs to the VENUE (not to
-- whoever pressed the button), so staff or ownership changes don't break it and one owner can link several venues to
-- several WaitApp accounts. venues.waitapp_restaurant_id stays the "linked" flag the rest of the app already reads.
-- API-only: RLS on with no policies, read and written by the service client. The token is encrypted (AES-256-GCM, same
-- key as waitapp_links).

create table if not exists venue_waitapp_links (
  venue_id uuid primary key references venues (id) on delete cascade,
  restaurant_id text not null,
  token_enc text not null,
  booking_page text,
  linked_by uuid references profiles (id) on delete set null,
  linked_at timestamptz not null default now()
);

alter table venue_waitapp_links enable row level security;
