# Chabuka

Real-life sports matchmaking: find a game, find an opponent, find a place, and play.

Grassroots sport is arranged through WhatsApp groups, phone calls, and
spreadsheets. Finding players, an opponent, or a pitch is slow, and a team's
history disappears when the group chat dies. Chabuka is where sport gets
arranged, not discussed: every screen moves someone from intent to a real game.

Built for the Meta Global AI Developer Hackathon, Indie Developer track,
"Build for Your World" (27 Oct – 4 Nov 2026). Solo build.

## Try the live demo

Sign in with any of these seeded accounts (all share one password):

Password: `Chabuka demo 2026!`

- `player1@demo.chabuka` (also `player2` … `player60`) — regular player.
  Join the 9/10 tonight game to trigger the Match Found reveal live.
- `captain@demo.chabuka` — team owner and captain. Create teams and
  challenges, send invites, talk or chat to Gaffer.
- `organiser@demo.chabuka` — tournament organiser and venue-side flows.
  Post results, confirm venue bookings.

These are public demo accounts on seeded data — reset any mischief with
`node supabase/seed/seed.mjs` followed by
`node supabase/seed/simulate-activity.mjs`.

## What is built

One server action layer. The web app, Gaffer, and the MCP tools all call
the same actions, so each behavior is built once. The API contract returns the
new state plus the actions now available, and the web renders its buttons
from that list.

- Matches: create, join, withdraw. Explore is list-first with a map toggle.
  Joining the last seat fires the Match Found reveal; tournament score
  overlays stay manual, casual fills auto-dismiss.
- Teams and challenges: create teams, post "looking for opponent"
  challenges, accept / decline / propose another time as the other captain.
- Tournaments: competitions, entries, round-robin fixtures, standings
  calculated from finished fixtures (never stored), results, announcements,
  follows. The board lives at `/board`.
- Circles: interest groups with prerequisite checks, member feeds, and event
  notifications.
- Venues and bookings: searchable venue list, venue profiles, bookable slots,
  booking requests with venue confirmation, free coded tickets per confirmed
  booking. Every booking and ticket is free while demonstrating. No payment
  gateway.
- Invites: shareable team invite links at `/invite` and `/invite/:code`,
  sign-in / sign-up inline, claim tap, manual code entry, revoke from the
  team page.
- Calendar: every match exposes an ICS download
  (`GET /api/calendar/:matchId.ics`) plus a Google Calendar add link. No
  OAuth sync, by decision.
- Gaffer ("Ask Gaffer" in the nav, `/gaffer`): game plans, rules and
  trivia insight, briefs and recaps, venue booking help, match creation.
  Reads through Gaffer-only context tools; writes go through the action layer
  as the signed-in user, so RLS applies exactly as in the app. Photos (up to
  3, downscaled in the browser) and voice notes (WAV, under 3 minutes) are
  supported. Gaffer never invents scores or stats and always says
  bookings are free.
- Registration: name, area, sports plus level, optional town, optional birth
  year (shown only as an age band), optional gender. Eight sports, including
  marathon and hiking. Social sign-in code exists for Supabase OAuth
  (Google / Facebook) but needs app credentials in the Supabase dashboard.
- Trust and policy: block / report users and teams, in-app
  `/privacy`, `/terms`, and `/community` pages.
- Theme: light / dark toggle, persisted, applied before first paint.

## Screenshots

Coming with the Day 3 mobile polish pass.

## Architecture

```text
chabuka/
  apps/web          React + Vite app
  apps/api          Express: /api/actions/*, /api/helper, /mcp
  apps/agent-demo   Muse Spark agent using Chabuka's MCP
  packages/shared   zod schemas, types, action names, CTA labels
  supabase/         migrations and seed script
```

Web routes include `/home`, `/explore`, `/teams`, `/teams/:id`,
`/gaffer`, `/board`, `/circles`, `/notifications`, `/roadmap`,
`/profile`, `/venues/dashboard`, `/venues/:venueId`, plus public
`/`, `/login`, `/invite`, `/privacy`, `/terms`, and `/community`.

## Meta models used, and where

All AI calls use Meta models through one wrapper
(`apps/api/src/model.ts`): Baseten first
(`meta-models/muse-spark-open-1026`), Meta Model API as fallback.

- Gaffer chat: `POST /api/helper` with the signed-in user's token.
- Voice notes: `POST /api/helper/transcribe` (WAV only); needs
  `META_API_KEY`, `META_BASE_URL`, and `META_TRANSCRIBE_MODEL_ID` on the API
  server, otherwise it answers HTTP 503 honestly.
- Demo agent: Muse Spark through the MCP tools below.

The Baseten and Meta keys live on the API server only, never in the web app
or the repo.

## Connect an AI agent to Chabuka's MCP

The API serves a stateless MCP endpoint at `POST /mcp`. Mint a personal
access token on your Profile page ("Connect an AI agent"), then present it as
`Authorization: Bearer <token>`. The token value is shown once at mint time
and can be revoked from the same page.

Tools (19): `search_matches`, `get_match`, `draft_match`,
`confirm_match`, `join_match`, `withdraw_from_match`, `search_challenges`,
`post_challenge`, `respond_to_challenge`, `search_venues`,
`request_booking`, `get_board`, `follow_board`, `search_circles`,
`join_circle`, `get_my_profile`, `search_nearby`, `get_calendar_link`,
`get_my_schedule`. Draft-then-confirm applies where something gets created.

Sample client lives in `apps/agent-demo`:

```bash
AGENT_API_URL=http://localhost:3001 AGENT_TOKEN=<paste-once-token> npm start --workspace @chabuka/agent-demo
AGENT_API_URL=http://localhost:3001 AGENT_TOKEN=<paste-once-token> npm start --workspace @chabuka/agent-demo -- --run
```

## Maps (Amendment 3)

Explore is list-first; its map toggle renders public discovery on Leaflet +
OpenStreetMap — free, no key. Venue search and picking use Google Maps
Platform: Places autocomplete renders the picked place on a Google Map, and
dropping/dragging a pin reverse-geocodes back into the text box. A match
stores the Google `place_id`, the place name, and the coordinates of the
user's own confirmed pin. Venues are browsed as lists first (cards, then a
profile), with the map inside the picking/booking flow. See
[docs/amendment-3-maps-venues.md](docs/amendment-3-maps-venues.md).

## Run it locally

Prerequisites: Node 20+ and npm, plus a Supabase cloud project.

1. Copy `.env.example` to `.env` and fill in the Supabase values. The web app
   also needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in
   `apps/web/.env` (Vite only reads `VITE_*` vars from the app dir). Server
   model keys (`BASETEN_API_KEY`, `META_API_KEY`, `META_BASE_URL`,
   `META_MODEL_ID`, `META_TRANSCRIBE_MODEL_ID`) belong on the API host only.
2. Apply `supabase/migrations` in order: `supabase link` + `supabase db push`,
   or paste each file into the Supabase dashboard SQL editor.
3. `npm install`
4. Seed the Lusaka demo scene (re-runnable):
   `node supabase/seed/seed.mjs`, then
   `node supabase/seed/simulate-activity.mjs`.
5. `npm run dev` (builds `@chabuka/shared`, then starts the web app).
   Run the API in a second terminal with `npm run dev:api`. Defaults:
   web on Vite's port, API on `http://localhost:3001`; the web app points at
   the API with `VITE_API_URL`.

## Deploy

- Web: Vercel (`vercel.json` builds shared + web, SPA rewrites to
  `index.html`).
- API: Render (`render.yaml`: install, build shared + API, start the API,
  health check at `/health`). Set `APP_URL`, Supabase keys, Baseten / Meta
  keys, and the browser `VITE_GOOGLE_MAPS_API_KEY` in the host dashboards —
  secrets are never committed. `APP_URL` doubles as the web origin allowed
  by API CORS and the base for calendar links.

## Roadmap

After the core (matches, challenges, tournament board): entry fees,
fundraising, MVP and stat badges, league tab, Hall of Fame, discipline
icons, verified badges — each first as a clearly-labelled preview shell.
Venue profiles, the venue dashboard, booking schedules, and free tickets are
in the MVP (Amendment 3). Never: chat/DMs, real payments, knockout engine,
rankings, native app, social feeds.

## License

MIT — see [LICENSE](LICENSE).
