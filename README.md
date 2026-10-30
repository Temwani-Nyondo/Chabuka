# Chabuka

Real-life sports matchmaking: find a game, find an opponent, find a place, and play.

Grassroots sport is arranged through WhatsApp groups, phone calls, and
spreadsheets. Finding players, an opponent, or a pitch is slow, and a team's
history disappears when the group chat dies. Chabuka is where sport gets
arranged, not discussed: every screen moves someone from intent to a real game.

Built for the Meta Global AI Developer Hackathon, Indie Developer track,
"Build for Your World" (27 Oct – 4 Nov 2026). Solo build.

## What was built during the hackathon

- 2026-10-27 (Day 1): monorepo scaffold, Supabase schema (sports, profiles,
  user_sports), magic-link auth, onboarding, navigation shell, first deploy.
- Day 2: one server action layer (`create_match`, `join_match`,
  `withdraw_match`) shared by web, helper and MCP, returning the new state
  plus the actions now available. Web wired to it: Create Match form, Explore
  list with Join/Withdraw, Home showing your games. Social sign-in (Meta,
  then Google, email as backup) and the Baseten-first model wrapper landed
  with it.

(Days 3–9 entries land with each day's work.)

## Screenshots

Coming with the Day 3 mobile polish pass.

## Architecture

One server action layer: every thing a user can do is one server function.
The web app, the AI helper, and the MCP tools all call those same functions,
so each action is built once. (The action layer lands on Day 2.)

```text
chabuka/
  apps/web          React + Vite app
  apps/api          Express: /api/actions/*, /api/helper, /mcp
  apps/agent-demo   Muse Spark agent using Chabuka's MCP (Day 6)
  packages/shared   zod schemas, types, action names, CTA labels
  supabase/         migrations and seed script
```

## Meta models used, and where

Landing Days 6–7. Planned: Muse Spark Open on Baseten for the helper
(`meta-models/muse-spark-open-1026`, fallback Muse Spark via the Meta Model
API), Muse Voice Transcribe for voice notes, and Muse Spark via the Meta
Model API for the demo agent. Every AI call in the product uses a Meta model.

## Run it locally

Prerequisites: Node 20+ and npm, plus a Supabase cloud project.

1. Copy `.env.example` to `.env` and fill in the Supabase values. The web app
   also needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in
   `apps/web/.env` (Vite only reads `VITE_*` vars from the app dir).
2. Apply `supabase/migrations` in order: `supabase link` + `supabase db push`,
   or paste each file into the Supabase dashboard SQL editor.
3. `npm install`
4. `npm run dev` (builds `@chabuka/shared`, then starts the web app)

## Connect an AI agent to Chabuka's MCP

Landing Day 6 with the MCP server. Sample config goes here.

## Maps (dual system)

Leaflet + OpenStreetMap renders all public discovery (Explore, pins) — free,
no key. Separately, Google Places may power place search/venue picking where
Google's terms allow: Places results are displayed on a Google Map/attributed
surface, only the `place_id` is stored, and saved coordinates always come from
the user's own confirmed pin — never from cached Google content. Directions
hand off to the phone's map app via Maps URLs. Partner venue registration UI
is post-hackathon.

## Roadmap

After the core (matches, challenges, tournament board): entry fees,
fundraising, MVP and stat badges, ticketing, league tab, Hall of Fame,
discipline icons, verified badges — each first as a clearly-labelled preview
shell. Never: chat/DMs, real payments, knockout engine, rankings, venue
calendars, partner dashboards, native app, social feeds.

## License

MIT — see [LICENSE](LICENSE).
