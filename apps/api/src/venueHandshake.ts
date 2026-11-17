import type { SupabaseClient } from '@supabase/supabase-js';
import { ActionError } from './actions.js';
import { baseUrl, encryptToken, partnerSecret, signState, venueCall, venueLinkToken, verifyState } from './waitapp.js';
import { copyVenueToWaitApp, loadVenueRow } from './venueBooking.js';

// The venue handshake: an approved Chabuka venue gets its own WaitApp Bookable Venue account in one step.
//
// 1. startVenueConnect: Chabuka's server sends WaitApp a "venue card" (the venue as the owner already described it here,
//    Google place and pin included, plus the owner's name and email) with the shared partner secret, and gets a one-time
//    handshake id. The owner's browser goes to WaitApp's /connect/chabuka-venue with it.
// 2. On WaitApp the owner signs in or signs up (name and email prefilled) and confirms: WaitApp creates the venue account
//    from the card (or links the one they already run for the same place) and sends them back with a one-time code.
// 3. completeVenueConnect: we trade the code for a token scoped to that WaitApp venue account, store it on the VENUE, and
//    copy the venue's spaces, hours, closures and upcoming bookings across.
//
// Ticketed games still use the organiser's personal link (waitapp.ts); venues no longer do.

type Deps = { fetch?: typeof fetch };

interface VenueForCard {
  id: string;
  name: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
  sports: string[] | null;
  facility_types: string[] | null;
  photos: string[] | null;
  contact: string | null;
  owner_id: string | null;
  status: string;
  google_place_id: string | null;
  opening_hours: Record<string, { open: string; close: string; closed?: boolean }> | null;
}

const venueSubject = (userId: string, venueId: string) => `${userId}:${venueId}`;

function returnUrl(): string {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new ActionError(503, 'Paid bookings are not set up yet.');
  return `${appUrl.replace(/\/+$/, '')}/venues/waitapp/return`;
}

/** Pure: the card WaitApp builds the venue account from. Only what WaitApp's schema accepts, trimmed to its limits. */
export function buildVenueCard(
  venue: VenueForCard,
  spaceCount: number,
  owner: { name: string | null; email: string | null },
): Record<string, unknown> {
  const hours: Record<string, { open: string; close: string; closed?: boolean }> = {};
  for (const [day, h] of Object.entries(venue.opening_hours ?? {})) {
    if (!['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(day) || !h?.open || !h?.close) continue;
    hours[day] = { open: h.open, close: h.close, ...(h.closed ? { closed: true } : {}) };
  }
  return {
    chabukaVenueId: venue.id,
    name: venue.name.slice(0, 80),
    area: venue.area ?? null,
    address: venue.area ?? null,
    googlePlaceId: venue.google_place_id ?? null,
    lat: venue.lat ?? null,
    lng: venue.lng ?? null,
    sports: (venue.sports ?? []).slice(0, 20).map((s) => s.slice(0, 40)),
    facilities: (venue.facility_types ?? []).slice(0, 30).map((s) => s.slice(0, 60)),
    photos: (venue.photos ?? []).filter((p) => /^https?:\/\//.test(p) && p.length <= 800).slice(0, 8),
    contact: venue.contact ?? null,
    hours,
    spaceCount: Math.min(200, spaceCount),
    ownerName: owner.name ? owner.name.slice(0, 80) : null,
    ownerEmail: owner.email ?? null,
  };
}

export async function startVenueConnect(svc: SupabaseClient, userId: string, venueId: string, deps: Deps = {}): Promise<{ url: string }> {
  const { data, error } = await svc
    .from('venues')
    .select('id,name,area,lat,lng,sports,facility_types,photos,contact,owner_id,status,google_place_id,opening_hours')
    .eq('id', venueId)
    .maybeSingle();
  if (error) throw new ActionError(500, 'Could not load the venue.');
  const venue = data as VenueForCard | null;
  if (!venue) throw new ActionError(404, 'Venue not found.');
  if (venue.owner_id !== userId) throw new ActionError(403, 'Only the venue owner can turn on paid bookings.');
  if (venue.status !== 'approved') throw new ActionError(409, 'Paid bookings can be turned on once the venue is approved.');
  const { data: spaces } = await svc.from('venue_spaces').select('id,booking_kind').eq('venue_id', venueId).eq('active', true);
  const list = (spaces ?? []) as { id: string; booking_kind?: string | null }[];
  if (list.some((s) => s.booking_kind === 'tee')) throw new ActionError(409, 'Tee times stay on Chabuka for now, paid at the course. Paid online tee times come later.');
  const spaceCount = list.length;
  if (spaceCount === 0) throw new ActionError(409, 'Add at least one space (a pitch or court) first.');

  const { data: profile } = await svc.from('profiles').select('name').eq('id', userId).maybeSingle();
  let email: string | null = null;
  try {
    const { data: u } = await svc.auth.admin.getUserById(userId);
    email = u?.user?.email ?? null;
  } catch {
    email = null;
  }
  const card = buildVenueCard(venue, spaceCount, { name: (profile as { name?: string | null } | null)?.name ?? null, email });

  const fetchImpl = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl()}/api/partner/chabuka/venue-connect/prepare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-partner-secret': partnerSecret() },
      body: JSON.stringify(card),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ActionError(502, 'Could not reach WaitApp. Try again.');
  }
  const body = (await res.json().catch(() => null)) as { handshakeId?: string; error?: string } | null;
  if (!res.ok || !body?.handshakeId) throw new ActionError(502, body?.error ?? 'WaitApp could not start the link. Try again.');

  const url = new URL(`${baseUrl()}/connect/chabuka-venue`);
  url.searchParams.set('h', body.handshakeId);
  url.searchParams.set('state', signState(venueSubject(userId, venueId)));
  url.searchParams.set('redirect', returnUrl());
  return { url: url.toString() };
}

/** The venue id the state was signed for, if it is a venue-handshake state for this person. */
export function venueIdFromState(state: string, userId: string): string | null {
  const subject = state.split('.')[0] ?? '';
  const [uid, venueId] = subject.split(':');
  if (uid !== userId || !venueId || !/^[0-9a-f-]{36}$/i.test(venueId)) return null;
  return verifyState(state, venueSubject(userId, venueId)) ? venueId : null;
}

export async function completeVenueConnect(
  svc: SupabaseClient,
  userId: string,
  code: string,
  state: string,
  deps: Deps = {},
): Promise<{ venueId: string; restaurantId: string; bookingPage: string | null; copied: unknown }> {
  const venueId = venueIdFromState(state, userId);
  if (!venueId) throw new ActionError(400, 'That link request has expired. Start again from the venue.');
  const venue = await loadVenueRow(svc, venueId);
  if (venue.owner_id !== userId) throw new ActionError(403, 'Only the venue owner can turn on paid bookings.');

  const fetchImpl = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl()}/api/partner/chabuka/connect/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-partner-secret': partnerSecret() },
      body: JSON.stringify({ code, state }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ActionError(502, 'Could not reach WaitApp. Try again.');
  }
  const data = (await res.json().catch(() => null)) as
    | { token?: string; restaurantId?: string; venueType?: string; bookingPage?: string | null; error?: string }
    | null;
  if (!res.ok || !data?.token || !data.restaurantId) throw new ActionError(400, data?.error ?? 'WaitApp did not accept the link. Start again.');
  if (data.venueType && data.venueType !== 'bookable_venue') throw new ActionError(409, 'That WaitApp account is not a venue account.');

  const { error: linkErr } = await svc.from('venue_waitapp_links').upsert(
    {
      venue_id: venueId,
      restaurant_id: data.restaurantId,
      token_enc: encryptToken(data.token),
      booking_page: data.bookingPage ?? null,
      linked_by: userId,
      linked_at: new Date().toISOString(),
    },
    { onConflict: 'venue_id' },
  );
  if (linkErr) throw new ActionError(500, 'Could not save the venue link.');
  const { error: updErr } = await svc.from('venues').update({ waitapp_restaurant_id: data.restaurantId }).eq('id', venueId);
  if (updErr) throw new ActionError(500, 'Could not save the venue link.');

  // Spaces, hours, closures and upcoming bookings go across so nothing is lost. Best effort: the link stands either way.
  const copied = await copyVenueToWaitApp(svc, await loadVenueRow(svc, venueId), deps).catch(() => null);
  return { venueId, restaurantId: data.restaurantId, bookingPage: data.bookingPage ?? null, copied };
}

/** The linked venue's WaitApp booking page, for the Setup card. Null when the venue has no handshake link. */
export async function venueLinkInfo(svc: SupabaseClient, venueId: string): Promise<{ bookingPage: string | null; perVenue: boolean }> {
  const { data } = await svc.from('venue_waitapp_links').select('booking_page').eq('venue_id', venueId).maybeSingle();
  return { bookingPage: (data as { booking_page?: string | null } | null)?.booking_page ?? null, perVenue: !!data };
}

/**
 * Keeps WaitApp's copy of the venue profile in step after an owner edit here: name, contact and photos. Best effort and
 * only for venues linked through the handshake (an older personal-link venue may share a WaitApp account with other things).
 */
export async function pushVenueProfile(
  svc: SupabaseClient,
  venue: { id: string; owner_id: string | null; waitapp_restaurant_id?: string | null },
  patch: { name?: string; contact?: string | null; photos?: string[] },
  deps: Deps = {},
): Promise<boolean> {
  if (!venue.waitapp_restaurant_id) return false;
  if (!(await venueLinkToken(svc, venue.id).catch(() => null))) return false;
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body['name'] = patch.name;
  if (patch.contact !== undefined) body['contact'] = patch.contact || null;
  if (patch.photos !== undefined) body['photos'] = patch.photos.filter((p) => /^https?:\/\//.test(p)).slice(0, 8);
  if (!Object.keys(body).length) return false;
  try {
    const { status } = await venueCall(svc, venue, '/api/partner/chabuka/venue', { method: 'POST', body }, deps);
    return status < 400;
  } catch {
    return false;
  }
}
