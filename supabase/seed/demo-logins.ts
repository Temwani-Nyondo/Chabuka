// Demo seed logins — fictional test accounts only, created by
// supabase/seed/seed.mjs. Never use these credentials anywhere else.
export const DEMO_PASSWORD = 'Chabuka demo 2026!';

export const DEMO_LOGINS = {
  captain: 'captain@demo.chabuka',
  organiser: 'organiser@demo.chabuka',
} as const;

// Seeded players: player1@demo.chabuka … player60@demo.chabuka
export const SEEDED_PLAYER_COUNT = 60;
export const seededPlayerEmail = (n: number) => `player${n}@demo.chabuka`;
