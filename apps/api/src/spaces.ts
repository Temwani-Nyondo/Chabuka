import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ActionError, notifyUsers } from './actions.js';
import { getLinkSummary, waitappCall } from './waitapp.js';

// Linked venues: a Chabuka venue whose owner connected a WaitApp "Bookable Venue" account. WaitApp holds the spaces, the
// calendar and the money; Chabuka reads them, lets a player book, and keeps the booking here, current through WaitApp's
// signed booking webhooks (see applyBookingEvent in waitapp.ts). The owner's own WaitApp link token is used for every call,
// and a token can only ever reach its own venue, so a player can never read or book another venue through this.

interface LinkedVenue {
  id: string;
  name: string;
  owner_id: string;
  status: string;
  waitapp_restaurant_id: string | null;
}

async function loadLinkedVenue(service: SupabaseClient, venueId: string): Promise<LinkedVenue> {
  const { data, error } = await service
    .from('venues')
    .select('id,name,owner_id,status,waitapp_restaurant_id')
    .eq('id', venueId)
    .maybeSingle();
  if (error) throw new ActionError(500, 'Could not load the venue.');
  const venue = data as (Omit<LinkedVenue, 'owner_id'> & { owner_id: string | null }) | null;
  if (!venue) throw new ActionError(404, 'Venue not found.');
  if (venue.status !== 'approved') throw new ActionError(409, 'This venue is not open for bookings yet.');
  if (!venue.waitapp_restaurant_id || !venue.owner_id) throw new ActionError(409, 'This venue does not take online bookings.');
  return venue as LinkedVenue;
}

// --- Owner: link or unlink the venue's WaitApp calendar ------------------------------

export async function setVenueCalendarLink(
  service: SupabaseClient,
  userId: string,
  venueId: string,
  link: boolean,
  deps: { fetch?: typeof fetch } = {},
): Promise<{ linked: boolean; spaceCount: number }> {
  const { data, error } = await service.from('venues').select('id,owner_id').eq('id', venueId).maybeSingle();
  if (error) throw new ActionError(500, 'Could not load the venue.');
  const venue = data as { id: string; owner_id: string | null } | null;
  if (!venue) throw new ActionError(404, 'Venue not found.');
  if (venue.owner_id !== userId) throw new ActionError(403, 'Only the venue owner can do that.');

  if (!link) {
    const { error: updErr } = await service.from('venues').update({ waitapp_restaurant_id: null }).eq('id', venueId);
    if (updErr) throw new ActionError(500, 'Could not unlink the venue.');
    return { linked: false, spaceCount: 0 };
  }

  const summary = await getLinkSummary(service, userId);
  if (!summary) throw new ActionError(409, 'Connect your WaitApp account first.');
  // Prove the linked WaitApp account really is a Bookable Venue, and that it has something to book.
  const { status, data: body } = await waitappCall(service, userId, '/api/partner/chabuka/spaces', { method: 'GET' }, deps);
  if (status === 409) throw new ActionError(409, 'The WaitApp account you connected is not a Bookable Venue. Connect the right business.');
  if (status >= 400) throw new ActionError(502, 'WaitApp could not list your spaces. Try again.');
  const spaces = Array.isArray(body['spaces']) ? (body['spaces'] as unknown[]) : [];
  const { error: updErr } = await service.from('venues').update({ waitapp_restaurant_id: summary.restaurantId }).eq('id', venueId);
  if (updErr) throw new ActionError(500, 'Could not link the venue.');
  return { linked: true, spaceCount: spaces.length };
}

// --- Players: spaces, availability, booking ------------------------------------------

export async function getVenueSpaces(
  service: SupabaseClient,
  venueId: string,
  deps: { fetch?: typeof fetch } = {},
): Promise<Record<string, unknown>> {
  const venue = await loadLinkedVenue(service, venueId);
  const { status, data } = await waitappCall(service, venue.owner_id, '/api/partner/chabuka/spaces', { method: 'GET' }, deps);
  if (status >= 400) throw new ActionError(502, 'The venue calendar is not available right now. Try again soon.');
  return data;
}

export async function getVenueAvailability(
  service: SupabaseClient,
  venueId: string,
  typeId: string,
  date: string,
  deps: { fetch?: typeof fetch } = {},
): Promise<Record<string, unknown>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActionError(400, 'Choose a date.');
  const venue = await loadLinkedVenue(service, venueId);
  const q = `?typeId=${encodeURIComponent(typeId)}&date=${date}`;
  const { status, data } = await waitappCall(service, venue.owner_id, `/api/partner/chabuka/availability${q}`, { method: 'GET' }, deps);
  if (status === 404) throw new ActionError(404, 'That space is not available.');
  if (status >= 400) throw new ActionError(502, 'The venue calendar is not available right now. Try again soon.');
  return data;
}

export const bookSpaceSchema = z.object({
  venueId: z.string().uuid(),
  typeId: z.string().min(1).max(80),
  spaceName: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  hours: z.number().int().min(1).max(24),
  people: z.number().int().min(1).max(500).optional(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().email().max(120).optional(),
  // The game this space is being booked for. Only the game's organiser can do that, and only at this venue.
  matchId: z.string().uuid().optional(),
});
export type BookSpaceInput = z.infer<typeof bookSpaceSchema>;

export interface SpaceBooking {
  id: string;
  venueId: string;
  matchId: string | null;
  spaceName: string;
  startsAt: string;
  endsAt: string;
  total: number | null;
  currency: string | null;
  status: 'pending' | 'accepted' | 'paid' | 'cancelled';
  instant: boolean;
  checkoutUrl: string | null;
  depositDueBy: string | null;
  bookingCode: string | null;
}

interface BookingRow {
  id: string;
  venue_id: string;
  match_id: string | null;
  space_name: string;
  starts_at: string;
  ends_at: string;
  total: number | string | null;
  currency: string | null;
  status: SpaceBooking['status'];
  instant: boolean;
  checkout_url: string | null;
  deposit_due_by: string | null;
  booking_code: string | null;
}

const toBooking = (r: BookingRow): SpaceBooking => ({
  id: r.id,
  venueId: r.venue_id,
  matchId: r.match_id,
  spaceName: r.space_name,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  total: r.total == null ? null : Number(r.total),
  currency: r.currency,
  status: r.status,
  instant: r.instant,
  // A payment link is only useful while a payment is due.
  checkoutUrl: r.status === 'accepted' ? r.checkout_url : null,
  depositDueBy: r.deposit_due_by,
  bookingCode: r.booking_code,
});

export async function bookSpace(
  service: SupabaseClient,
  userId: string,
  raw: BookSpaceInput,
  deps: { fetch?: typeof fetch } = {},
): Promise<SpaceBooking> {
  const input = bookSpaceSchema.parse(raw);
  const venue = await loadLinkedVenue(service, input.venueId);
  if (input.matchId) {
    const { data: m } = await service.from('matches').select('id,organiser_id,venue_id').eq('id', input.matchId).maybeSingle();
    const match = m as { id: string; organiser_id: string; venue_id: string | null } | null;
    if (!match) throw new ActionError(404, 'Game not found.');
    if (match.organiser_id !== userId) throw new ActionError(403, 'Only the game organiser can book its venue.');
    if (match.venue_id !== venue.id) throw new ActionError(409, 'This game is at a different venue.');
  }
  const { status, data } = await waitappCall(
    service,
    venue.owner_id,
    '/api/partner/chabuka/bookings',
    {
      method: 'POST',
      body: {
        typeId: input.typeId,
        date: input.date,
        startTime: input.startTime,
        hours: input.hours,
        ...(input.people ? { people: input.people } : {}),
        customerName: input.name,
        customerPhone: input.phone,
        ...(input.email ? { customerEmail: input.email } : {}),
        chabukaUserId: userId,
      },
    },
    deps,
  );
  if (status >= 400) {
    // 409 is a lost race or a closed day: WaitApp's own wording is the right message for the player.
    const message = typeof data['error'] === 'string' ? (data['error'] as string) : 'Could not make the booking. Try again.';
    throw new ActionError(status === 409 || status === 400 ? status : 502, message);
  }
  const facility = (data['facility'] ?? {}) as { startsAt?: string; endsAt?: string };
  const deposit = (data['deposit'] ?? null) as { amount?: number; dueBy?: string } | null;
  const reservationId = String(data['reservationId'] ?? '');
  if (!reservationId || !facility.startsAt || !facility.endsAt) throw new ActionError(502, 'WaitApp sent an incomplete booking.');
  const instant = data['instant'] === true;
  const row = {
    venue_id: venue.id,
    user_id: userId,
    match_id: input.matchId ?? null,
    waitapp_reservation_id: reservationId,
    booking_code: typeof data['bookingCode'] === 'string' ? data['bookingCode'] : null,
    space_id: input.typeId,
    space_name: input.spaceName,
    starts_at: facility.startsAt,
    ends_at: facility.endsAt,
    total: typeof data['total'] === 'number' ? data['total'] : null,
    currency: typeof data['currency'] === 'string' ? (data['currency'] as string) : null,
    instant,
    status: data['status'] === 'accepted' ? 'accepted' : 'pending',
    checkout_url: typeof data['checkoutUrl'] === 'string' ? data['checkoutUrl'] : null,
    deposit_due_by: deposit?.dueBy ?? null,
  };
  const { data: saved, error } = await service.from('waitapp_bookings').insert(row).select('*').single();
  if (error) throw new ActionError(500, 'Your booking was made on WaitApp but could not be saved here. Check your WaitApp booking.');
  await notifyUsers([venue.owner_id], 'space_booking_requested', {
    venueId: venue.id,
    title: venue.name,
    spaceName: input.spaceName,
    startsAt: facility.startsAt,
    instant,
  });
  return toBooking(saved as BookingRow);
}

export async function listMySpaceBookings(service: SupabaseClient, userId: string): Promise<SpaceBooking[]> {
  const { data, error } = await service
    .from('waitapp_bookings')
    .select('*')
    .eq('user_id', userId)
    .order('starts_at', { ascending: false })
    .limit(50);
  if (error) throw new ActionError(500, 'Could not load your bookings.');
  return ((data ?? []) as BookingRow[]).map(toBooking);
}
