# Amendment 3 — Maps, Explore order, and the venue system

Date: 2026-10-30. Author decision by Temwani, overriding the build brief
where this amendment says so.

## Decisions

1. **Google Maps Platform is allowed** for venue/place search and picking,
   because its place coverage in Zambia is stronger than OpenStreetMap's.
   The brief's "no Google Maps / no keys and billing" rule and the dual-system
   restriction are lifted for this surface. The browser key lives only in
   `apps/web/.env` as `VITE_GOOGLE_MAPS_API_KEY` (referrer-restricted,
   never committed).
2. **The venue picker is bidirectional**: typing a place searches Google
   Places and renders the result on a Google map; dropping/dragging a pin on
   the map reverse-geocodes into the text box. Stored on a match: the Google
   `place_id`, the place name, and the coordinates of the user's confirmed
   pin. Chabuka listed venues (the `venues` table) remain a separate,
   bookable listing and stay the first section of the picker.
3. **Explore is list-first.** The brief's "Explore (map first)" is replaced:
   matches are a list sorted for scanning, with a map toggle. The map toggle
   stays on Leaflet + OpenStreetMap (free public discovery). Maps are for
   venue work — picking, checking a location, directions — not the front door.
4. **Venues are browsed as lists first**: searchable venue cards (sport,
   area, facilities, price note), then a venue profile, then the map inside
   the booking/picking flow.
5. **The venue system is in MVP scope, and it is free.** Venue profiles, a
   venue dashboard (incoming bookings, slot schedule, tickets), bookable
   schedule slots, booking requests with venue confirmation, and free tickets
   (a coded pass per confirmed booking) are core. **No payment gateway**:
   every booking and ticket is free while demonstrating, stated plainly in
   the UI. The brief's "never venue calendars / partner dashboards" and the
   README's deferred ticketing are overridden to this extent.
6. **Tool rigidity is relaxed.** "Use exactly these tools; stop and ask
   before swapping" becomes: choose what serves the MVP, note the swap here
   or in the README. Unchanged: the hackathon banned list, the cut order
   (never cut matches, challenges, or the tournament board), no chat/DMs,
   no real payments, no native app.

## Data notes

- `matches` gains `place_id` and `venue_name` (migration
  `20261030000003_venue_system.sql`).
- `venues` gains `owner_id` (the dashboard owner) and `google_place_id`.
- New tables: `venue_slots`, `bookings`, `tickets`, all RLS-protected;
  writes run through the one action layer like everything else.
