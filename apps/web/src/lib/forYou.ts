import { forYouScore, matchSlot, slotKey } from '@chabuka/shared';
import { supabase } from './supabase';
import type { MatchListing } from './matches';

// For-you feed: the profile's standing data (own sports, weekly availability)
// ranks open games. Availability never hides a searched game — it only
// orders this feed.
export interface ForYouProfile {
  loaded: boolean;
  slots: Set<string>;
  sports: Set<string>;
}

export async function fetchForYouProfile(userId: string): Promise<ForYouProfile> {
  if (!supabase) return { loaded: false, slots: new Set(), sports: new Set() };
  const [{ data: avail }, { data: mine }] = await Promise.all([
    supabase.from('user_availability').select('day,time_band').eq('user_id', userId),
    supabase.from('user_sports').select('sport_id').eq('user_id', userId),
  ]);
  const slots = new Set(
    ((avail ?? []) as { day: number; time_band: string }[]).map((s) => `${s.day}-${s.time_band}`),
  );
  const sportIds = new Set(((mine ?? []) as { sport_id: string }[]).map((r) => r.sport_id));
  let sports = new Set<string>();
  if (sportIds.size > 0) {
    const { data: rows } = await supabase.from('sports').select('id,name').in('id', [...sportIds]);
    sports = new Set(((rows ?? []) as { id: string; name: string }[]).map((r) => r.name));
  }
  return { loaded: true, slots, sports };
}

export function scoreListing(
  listing: MatchListing,
  profile: ForYouProfile,
  homeArea: string,
): number {
  const sportMatch = profile.sports.size > 0 && profile.sports.has(listing.sport?.name ?? '');
  const s = matchSlot(new Date(listing.match.starts_at));
  const slotMatch = profile.slots.size > 0 && profile.slots.has(slotKey(s.day, s.timeBand));
  const areaMatch =
    homeArea !== '' && (listing.match.area ?? '').toLowerCase() === homeArea;
  return forYouScore({ sportMatch, slotMatch, areaMatch });
}

// Top picks: own sport first, then a free slot. Falls back to soonest games
// when the profile is bare so a fresh account still sees a feed.
export function pickForYou(
  listings: MatchListing[],
  profile: ForYouProfile,
  homeArea: string,
  joinedIds: Set<string>,
  limit = 3,
): MatchListing[] {
  const mineArea = homeArea.toLowerCase();
  return [...listings]
    .filter((l) => !joinedIds.has(l.match.id))
    .map((l) => ({ l, score: scoreListing(l, profile, mineArea) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        +new Date(a.l.match.starts_at) - +new Date(b.l.match.starts_at),
    )
    .slice(0, limit)
    .map((r) => r.l);
}
