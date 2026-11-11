import type { SupabaseClient } from '@supabase/supabase-js';

// What a signed-out visitor may see on the landing page: upcoming open games
// and approved venues, with no organiser or player identities. Read with the
// service client and trimmed here, so nothing private can leak through RLS.

export interface LandingGame {
  id: string;
  sport: string;
  title: string;
  area: string | null;
  venueName: string | null;
  startsAt: string;
  spotsTaken: number;
  capacity: number;
  lat: number | null;
  lng: number | null;
}

export interface LandingVenue {
  id: string;
  name: string;
  area: string | null;
  sports: string[];
  priceNote: string | null;
}

export interface LandingData {
  games: LandingGame[];
  venues: LandingVenue[];
}

const GAME_LIMIT = 12;
const VENUE_LIMIT = 8;

export async function readLanding(db: SupabaseClient, now = new Date()): Promise<LandingData> {
  const { data: matchRows, error } = await db
    .from('matches')
    .select('id,title,sport_id,starts_at,area,venue_name,lat,lng,capacity')
    .eq('status', 'open')
    .gte('starts_at', now.toISOString())
    .order('starts_at')
    .limit(GAME_LIMIT);
  if (error) throw new Error(error.message);
  const matches = (matchRows ?? []) as {
    id: string;
    title: string;
    sport_id: string;
    starts_at: string;
    area: string | null;
    venue_name: string | null;
    lat: number | null;
    lng: number | null;
    capacity: number;
  }[];

  const sportIds = [...new Set(matches.map((m) => m.sport_id))];
  const sportNames = new Map<string, string>();
  if (sportIds.length > 0) {
    const { data } = await db.from('sports').select('id,name').in('id', sportIds);
    for (const s of (data ?? []) as { id: string; name: string }[]) sportNames.set(s.id, s.name);
  }

  const taken = new Map<string, number>();
  if (matches.length > 0) {
    const { data } = await db
      .from('match_participants')
      .select('match_id')
      .in('match_id', matches.map((m) => m.id));
    for (const p of (data ?? []) as { match_id: string }[]) taken.set(p.match_id, (taken.get(p.match_id) ?? 0) + 1);
  }

  const { data: venueRows, error: venueError } = await db
    .from('venues')
    .select('id,name,area,sports,price_note')
    .eq('status', 'approved')
    .order('name')
    .limit(VENUE_LIMIT);
  if (venueError) throw new Error(venueError.message);

  return {
    games: matches.map((m) => ({
      id: m.id,
      sport: sportNames.get(m.sport_id) ?? 'Sport',
      title: m.title,
      area: m.area,
      venueName: m.venue_name,
      startsAt: m.starts_at,
      spotsTaken: taken.get(m.id) ?? 0,
      capacity: m.capacity,
      lat: m.lat,
      lng: m.lng,
    })),
    venues: ((venueRows ?? []) as { id: string; name: string; area: string | null; sports: string[] | null; price_note: string | null }[]).map(
      (v) => ({ id: v.id, name: v.name, area: v.area, sports: v.sports ?? [], priceNote: v.price_note }),
    ),
  };
}
