import { matchSchema, sportListSchema, venueListSchema } from '@chabuka/shared';
import type { Match, Sport, Venue } from '@chabuka/shared';
import { supabase } from './supabase';

export interface MatchListing {
  match: Match;
  sport: Sport | null;
  venue: Venue | null;
  joinedCount: number;
  isParticipant: boolean;
  isOrganiser: boolean;
}

async function buildListings(rows: unknown[], userId: string): Promise<MatchListing[]> {
  if (!supabase || rows.length === 0) return [];
  const matches = rows
    .map((row) => {
      const parsed = matchSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((m): m is Match => m !== null);
  if (matches.length === 0) return [];

  const { data: sportRows } = await supabase.from('sports').select('id,name,formats');
  const sports = sportListSchema.safeParse(sportRows);
  const sportById = new Map<string, Sport>(
    sports.success ? sports.data.map((s) => [s.id, s]) : [],
  );

  const ids = matches.map((m) => m.id);
  const { data: parts } = await supabase
    .from('match_participants')
    .select('match_id,user_id,status')
    .in('match_id', ids)
    .eq('status', 'joined');

  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const p of (parts ?? []) as { match_id: string; user_id: string }[]) {
    counts.set(p.match_id, (counts.get(p.match_id) ?? 0) + 1);
    if (p.user_id === userId) mine.add(p.match_id);
  }

  const venueIds = [...new Set(matches.map((m) => m.venue_id).filter(Boolean))] as string[];
  const venueById = new Map<string, Venue>();
  if (venueIds.length > 0) {
    const { data: venueRows } = await supabase
      .from('venues')
      .select('id,name,area,lat,lng,sports,facility_types,price_note,contact,photos')
      .in('id', venueIds);
    const venues = venueListSchema.safeParse(venueRows ?? []);
    if (venues.success) for (const v of venues.data) venueById.set(v.id, v);
  }

  return matches.map((match) => ({
    match,
    sport: sportById.get(match.sport_id) ?? null,
    venue: match.venue_id ? (venueById.get(match.venue_id) ?? null) : null,
    joinedCount: counts.get(match.id) ?? 0,
    isParticipant: mine.has(match.id),
    isOrganiser: match.organiser_id === userId,
  }));
}

// Public, upcoming, joinable matches for Explore.
export async function fetchOpenMatches(userId: string): Promise<MatchListing[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('visibility', 'public')
    .eq('kind', 'players')
    .in('status', ['open', 'full'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return buildListings(data ?? [], userId);
}

// Matches I organise or have joined, soonest first, for Home.
export async function fetchMyMatches(userId: string): Promise<MatchListing[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: myParts, error: partErr } = await supabase
    .from('match_participants')
    .select('match_id')
    .eq('user_id', userId)
    .eq('status', 'joined');
  if (partErr) throw new Error(partErr.message);
  const joinedIds = (myParts ?? []).map((p) => (p as { match_id: string }).match_id);

  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .or(`organiser_id.eq.${userId}${joinedIds.length ? `,id.in.(${joinedIds.join(',')})` : ''}`)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return buildListings(data ?? [], userId);
}

export async function fetchSports(): Promise<Sport[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('sports').select('id,name,formats').order('name');
  if (error) throw new Error(error.message);
  const parsed = sportListSchema.safeParse(data);
  if (!parsed.success) throw new Error('Unexpected sports data from the server.');
  return parsed.data;
}
