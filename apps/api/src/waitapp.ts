import crypto from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ActionError, notifyUsers } from './actions.js';

// Ticketed games: WaitApp's ticket engine sells, issues, scans and settles the
// tickets (the organiser's own WaitApp account is the payee). Chabuka links the
// account, creates the WaitApp event from a game, and listens for signed
// "ticket issued" notifications to keep the roster in step. No payment data
// ever reaches Chabuka.
//
// Env (API host only):
//   WAITAPP_BASE_URL        WaitApp origin (default https://waitapp.online)
//   WAITAPP_PARTNER_SECRET  shared secret, same value as WaitApp's
//                           CHABUKA_PARTNER_SECRET (>= 16 chars)
//   WAITAPP_TOKEN_KEY       base64 of 32 random bytes: encrypts stored tokens
//   APP_URL                 Chabuka web origin (already used for CORS)

const STATE_TTL_SECONDS = 15 * 60;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function baseUrl(): string {
  return (process.env.WAITAPP_BASE_URL || 'https://waitapp.online').replace(/\/+$/, '');
}

function partnerSecret(): string {
  const s = process.env.WAITAPP_PARTNER_SECRET;
  if (!s || s.length < 16) throw new ActionError(503, 'Ticket sales are not set up yet.');
  return s;
}

function tokenKey(): Buffer {
  const raw = process.env.WAITAPP_TOKEN_KEY;
  const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) throw new ActionError(503, 'Ticket sales are not set up yet.');
  return key;
}

// --- Token encryption (AES-256-GCM) ------------------------------------------

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decryptToken(stored: string): string {
  const [iv, tag, enc] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !enc) throw new ActionError(500, 'Stored WaitApp link is unreadable.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// --- Signed state for the link round trip -------------------------------------

function hmac(value: string): string {
  return crypto.createHmac('sha256', partnerSecret()).update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function signState(userId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + STATE_TTL_SECONDS;
  const body = `${userId}.${exp}`;
  return `${body}.${hmac(body)}`;
}

export function verifyState(state: string, userId: string, now = Date.now()): boolean {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [uid, exp, sig] = parts as [string, string, string];
  if (uid !== userId || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(now / 1000)) return false;
  return safeEqual(sig, hmac(`${uid}.${exp}`));
}

export function buildConnectUrl(userId: string): string {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new ActionError(503, 'Ticket sales are not set up yet.');
  const redirect = `${appUrl.replace(/\/+$/, '')}/connect/waitapp`;
  const url = new URL(`${baseUrl()}/connect/chabuka`);
  url.searchParams.set('state', signState(userId));
  url.searchParams.set('redirect', redirect);
  return url.toString();
}

// --- Links ----------------------------------------------------------------------

export interface WaitAppLink {
  restaurantId: string;
  organiserName: string | null;
  currency: string | null;
}

export async function getLinkSummary(service: SupabaseClient, userId: string): Promise<WaitAppLink | null> {
  const { data, error } = await service
    .from('waitapp_links')
    .select('restaurant_id,organiser_name,currency')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new ActionError(500, 'Could not read the WaitApp link.');
  if (!data) return null;
  const row = data as { restaurant_id: string; organiser_name: string | null; currency: string | null };
  return { restaurantId: row.restaurant_id, organiserName: row.organiser_name, currency: row.currency };
}

async function getLinkToken(service: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await service.from('waitapp_links').select('token_enc').eq('user_id', userId).maybeSingle();
  if (error) throw new ActionError(500, 'Could not read the WaitApp link.');
  if (!data) throw new ActionError(409, 'Connect your WaitApp organiser account first.');
  return decryptToken((data as { token_enc: string }).token_enc);
}

export async function completeLink(
  service: SupabaseClient,
  userId: string,
  code: string,
  state: string,
  deps: { fetch?: typeof fetch } = {},
): Promise<WaitAppLink> {
  if (!verifyState(state, userId)) throw new ActionError(400, 'That link request has expired. Start again.');
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
    | { token?: string; restaurantId?: string; organiserName?: string; currency?: string; error?: string }
    | null;
  if (!res.ok || !data?.token || !data.restaurantId) {
    throw new ActionError(400, data?.error ?? 'WaitApp did not accept the link. Start again.');
  }
  const { error } = await service.from('waitapp_links').upsert(
    {
      user_id: userId,
      restaurant_id: data.restaurantId,
      token_enc: encryptToken(data.token),
      organiser_name: data.organiserName ?? null,
      currency: data.currency ?? null,
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new ActionError(500, 'Could not save the WaitApp link.');
  return { restaurantId: data.restaurantId, organiserName: data.organiserName ?? null, currency: data.currency ?? null };
}

export async function removeLink(service: SupabaseClient, userId: string): Promise<void> {
  const { error } = await service.from('waitapp_links').delete().eq('user_id', userId);
  if (error) throw new ActionError(500, 'Could not remove the WaitApp link.');
}

// --- Creating the WaitApp event for a game ------------------------------------

export const ticketingInputSchema = z.object({
  matchId: z.string().uuid(),
  tiers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        price: z.number().min(0).max(1_000_000),
        capacity: z.number().int().min(1).max(100000).optional(),
      }),
    )
    .min(1)
    .max(6),
});
export type TicketingInput = z.infer<typeof ticketingInputSchema>;

type TicketStatus = 'draft' | 'pending_review' | 'on_sale' | 'cancelled';

function mapStatus(waitappStatus: string | undefined): TicketStatus {
  switch (waitappStatus) {
    case 'published':
      return 'on_sale';
    case 'pending_review':
      return 'pending_review';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'draft';
  }
}

interface MatchRow {
  id: string;
  organiser_id: string;
  title: string;
  starts_at: string;
  capacity: number;
  kind: string;
  status: string;
  venue_id: string | null;
  venue_name: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
}

async function loadOwnMatch(service: SupabaseClient, userId: string, matchId: string): Promise<MatchRow> {
  const { data, error } = await service
    .from('matches')
    .select('id,organiser_id,title,starts_at,capacity,kind,status,venue_id,venue_name,area,lat,lng,notes')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new ActionError(500, 'Could not load the game.');
  const match = data as MatchRow | null;
  // Not found and not-yours look the same on purpose.
  if (!match || match.organiser_id !== userId) throw new ActionError(404, 'Game not found.');
  return match;
}

export async function waitappCall(
  service: SupabaseClient,
  userId: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  deps: { fetch?: typeof fetch } = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const token = await getLinkToken(service, userId);
  const fetchImpl = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl()}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ActionError(502, 'Could not reach WaitApp. Try again.');
  }
  const data = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (res.status === 401) {
    // The organiser removed the link on WaitApp's side: drop ours so the UI asks to reconnect.
    await removeLink(service, userId).catch(() => undefined);
    throw new ActionError(409, 'The WaitApp link is no longer valid. Connect your account again.');
  }
  return { status: res.status, data };
}

export async function createTicketing(
  service: SupabaseClient,
  userId: string,
  input: TicketingInput,
  deps: { fetch?: typeof fetch; now?: Date } = {},
) {
  const match = await loadOwnMatch(service, userId, input.matchId);
  if (match.kind !== 'players') throw new ActionError(409, 'Only open player games can sell tickets.');
  if (match.status !== 'open' && match.status !== 'full') throw new ActionError(409, 'This game is not open.');
  if (new Date(match.starts_at) <= (deps.now ?? new Date())) throw new ActionError(409, 'The game has already started.');

  let venueName = match.venue_name;
  if (!venueName && match.venue_id) {
    const { data } = await service.from('venues').select('name').eq('id', match.venue_id).maybeSingle();
    venueName = (data as { name?: string } | null)?.name ?? null;
  }

  const { status, data } = await waitappCall(
    service,
    userId,
    '/api/partner/chabuka/events',
    {
      method: 'POST',
      body: {
        chabukaMatchId: match.id,
        title: match.title,
        ...(match.notes ? { description: match.notes } : {}),
        date: match.starts_at,
        ...(venueName ? { venue: venueName } : {}),
        ...(match.area ? { city: match.area } : {}),
        ...(match.lat != null ? { lat: match.lat } : {}),
        ...(match.lng != null ? { lng: match.lng } : {}),
        capacity: match.capacity,
        tiers: input.tiers,
      },
    },
    deps,
  );
  if (status >= 400 || typeof data.eventId !== 'string') {
    throw new ActionError(status === 409 ? 409 : 400, typeof data.error === 'string' ? data.error : 'WaitApp could not create the ticketed event.');
  }

  const row = {
    match_id: match.id,
    waitapp_event_id: data.eventId,
    status: mapStatus(typeof data.status === 'string' ? data.status : undefined),
    checkout_url: String(data.checkoutUrl ?? ''),
    currency: String(data.currency ?? 'ZMW'),
    tiers: input.tiers.map((t) => ({ name: t.name, price: t.price })),
    updated_at: new Date().toISOString(),
  };
  const { error } = await service.from('match_ticketing').upsert(row, { onConflict: 'match_id' });
  if (error) throw new ActionError(500, 'Could not save the ticketing details.');
  return { ...row, soldCount: 0 };
}

// --- Roster sync --------------------------------------------------------------------

const refPattern = /^chabuka:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

async function resolveBuyer(service: SupabaseClient, ref: string | null, email: string): Promise<string | null> {
  const fromRef = ref ? refPattern.exec(ref)?.[1] : undefined;
  if (fromRef) {
    const { data } = await service.from('profiles').select('id').eq('id', fromRef).maybeSingle();
    if (data) return fromRef;
  }
  // Confirmed emails only (enforced inside the function).
  const { data } = await service.rpc('find_user_id_by_email', { p_email: email });
  return typeof data === 'string' ? data : null;
}

export interface IssuedTickets {
  matchId: string;
  paymentId: string;
  ticketIds: string[];
  tierName: string | null;
  buyerEmail: string;
  ref: string | null;
}

async function recount(service: SupabaseClient, matchId: string): Promise<void> {
  const countOf = async (statuses: string[]): Promise<number> => {
    const { count } = await service
      .from('ticket_orders')
      .select('ticket_id', { count: 'exact', head: true })
      .eq('match_id', matchId)
      .in('status', statuses);
    return count ?? 0;
  };
  const [sold, checkedIn, refunded] = await Promise.all([countOf(['valid', 'used']), countOf(['used']), countOf(['refunded'])]);
  await service
    .from('match_ticketing')
    .update({ sold_count: sold, checked_in_count: checkedIn, refunded_count: refunded, updated_at: new Date().toISOString() })
    .eq('match_id', matchId);
}

/** Idempotent: replaying the same tickets changes nothing. */
export async function applyTicketsIssued(service: SupabaseClient, t: IssuedTickets): Promise<{ userId: string | null }> {
  if (t.ticketIds.length === 0) return { userId: null };
  const userId = await resolveBuyer(service, t.ref, t.buyerEmail);
  const rows = t.ticketIds.map((id) => ({
    ticket_id: id,
    match_id: t.matchId,
    user_id: userId,
    // Stored lowercase so claims are an exact match, never a pattern.
    buyer_email: t.buyerEmail.trim().toLowerCase(),
    tier_name: t.tierName,
    payment_id: t.paymentId,
  }));
  const { error } = await service.from('ticket_orders').upsert(rows, { onConflict: 'ticket_id', ignoreDuplicates: true });
  if (error) throw new ActionError(500, 'Could not record the tickets.');
  if (userId) {
    const { error: partErr } = await service
      .from('match_participants')
      .upsert({ match_id: t.matchId, user_id: userId, status: 'joined' }, { onConflict: 'match_id,user_id' });
    if (partErr) throw new ActionError(500, 'Could not add the buyer to the game.');
  }
  await recount(service, t.matchId);
  return { userId };
}

// --- Webhook ------------------------------------------------------------------------

const envelopeSchema = z.object({ id: z.string().min(1), type: z.string(), data: z.record(z.string(), z.unknown()) });

const issuedSchema = z.object({
  eventId: z.string().min(1),
  chabukaMatchId: z.string().uuid().nullable(),
  paymentId: z.string().min(1),
  ticketIds: z.array(z.string().min(1)).max(50),
  tierName: z.string().nullable().optional(),
  buyer: z.object({ email: z.string().email() }),
  ref: z.string().nullable().optional(),
});
const ticketsSchema = z.object({
  eventId: z.string().min(1),
  chabukaMatchId: z.string().uuid().nullable(),
  ticketIds: z.array(z.string().min(1)).min(1).max(50),
});
const eventSchema = z.object({
  eventId: z.string().min(1),
  chabukaMatchId: z.string().uuid().nullable(),
  reason: z.string().nullable().optional(),
  newDate: z.string().optional(),
  refundChoiceDeadline: z.string().optional(),
});

export function verifyWebhookSignature(rawBody: string, timestamp: string, signature: string, now = Date.now()): boolean {
  if (!/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac('sha256', partnerSecret()).update(`${timestamp}.${rawBody}`).digest('hex');
  return safeEqual(expected, signature);
}

/** The webhook may only touch the game whose WaitApp event it names. */
async function requireTicketedMatch(service: SupabaseClient, matchId: string | null, eventId: string): Promise<string> {
  if (!matchId) throw new ActionError(404, 'Unknown game.');
  const { data: ticketing } = await service
    .from('match_ticketing')
    .select('waitapp_event_id')
    .eq('match_id', matchId)
    .maybeSingle();
  if (!ticketing || (ticketing as { waitapp_event_id: string }).waitapp_event_id !== eventId) {
    throw new ActionError(404, 'Unknown game.');
  }
  return matchId;
}

/** Joined players of a game, for notifications. */
async function participantIds(service: SupabaseClient, matchId: string): Promise<string[]> {
  const { data } = await service.from('match_participants').select('user_id').eq('match_id', matchId).eq('status', 'joined');
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

async function gameTitle(service: SupabaseClient, matchId: string): Promise<string> {
  const { data } = await service.from('matches').select('title').eq('id', matchId).maybeSingle();
  return (data as { title?: string } | null)?.title ?? 'your game';
}

/**
 * Applies a status to tickets and keeps the roster honest: a player whose
 * last live ticket is refunded leaves the game (and is told); other tickets
 * they hold keep their spot.
 */
export async function setTicketStatus(
  service: SupabaseClient,
  matchId: string,
  ticketIds: string[],
  status: 'used' | 'refunded' | 'cancelled',
): Promise<void> {
  // Only forward moves: a refunded ticket never goes back to used, and an
  // already-used ticket is never marked used twice.
  const from = status === 'used' ? ['valid'] : ['valid', 'used'];
  const { data: changed, error } = await service
    .from('ticket_orders')
    .update({ status })
    .eq('match_id', matchId)
    .in('ticket_id', ticketIds)
    .in('status', from)
    .select('user_id');
  if (error) throw new ActionError(500, 'Could not update the tickets.');

  if (status !== 'used') {
    const affected = [...new Set(((changed ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((u): u is string => !!u))];
    const title = await gameTitle(service, matchId);
    for (const uid of affected) {
      const { count } = await service
        .from('ticket_orders')
        .select('ticket_id', { count: 'exact', head: true })
        .eq('match_id', matchId)
        .eq('user_id', uid)
        .in('status', ['valid', 'used']);
      if ((count ?? 0) === 0) {
        await service.from('match_participants').update({ status: 'withdrawn' }).eq('match_id', matchId).eq('user_id', uid);
        await notifyUsers([uid], 'ticket_refunded', { matchId, title });
      }
    }
  }
  await recount(service, matchId);
}

export async function handleWebhook(
  service: SupabaseClient,
  rawBody: string,
  headers: { timestamp: string; signature: string },
): Promise<{ handled: boolean }> {
  if (!verifyWebhookSignature(rawBody, headers.timestamp, headers.signature)) {
    throw new ActionError(401, 'Bad signature.');
  }
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(rawBody));
  } catch {
    throw new ActionError(400, 'Bad payload.');
  }

  switch (envelope.type) {
    case 'ticket.issued': {
      const data = issuedSchema.parse(envelope.data);
      const matchId = await requireTicketedMatch(service, data.chabukaMatchId, data.eventId);
      await applyTicketsIssued(service, {
        matchId,
        paymentId: data.paymentId,
        ticketIds: data.ticketIds,
        tierName: data.tierName ?? null,
        buyerEmail: data.buyer.email,
        ref: data.ref ?? null,
      });
      return { handled: true };
    }
    case 'ticket.used':
    case 'ticket.refunded': {
      const data = ticketsSchema.parse(envelope.data);
      const matchId = await requireTicketedMatch(service, data.chabukaMatchId, data.eventId);
      await setTicketStatus(service, matchId, data.ticketIds, envelope.type === 'ticket.used' ? 'used' : 'refunded');
      return { handled: true };
    }
    case 'event.cancelled': {
      const data = eventSchema.parse(envelope.data);
      const matchId = await requireTicketedMatch(service, data.chabukaMatchId, data.eventId);
      const players = await participantIds(service, matchId);
      const title = await gameTitle(service, matchId);
      await service.from('match_ticketing').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('match_id', matchId);
      await service.from('matches').update({ status: 'cancelled' }).eq('id', matchId);
      await notifyUsers(players, 'game_cancelled', { matchId, title, reason: data.reason ?? null });
      return { handled: true };
    }
    case 'event.postponed': {
      const data = eventSchema.parse(envelope.data);
      const matchId = await requireTicketedMatch(service, data.chabukaMatchId, data.eventId);
      if (!data.newDate || Number.isNaN(Date.parse(data.newDate))) throw new ActionError(400, 'Bad payload.');
      const players = await participantIds(service, matchId);
      const title = await gameTitle(service, matchId);
      await service.from('matches').update({ starts_at: new Date(data.newDate).toISOString() }).eq('id', matchId);
      await notifyUsers(players, 'game_postponed', {
        matchId,
        title,
        newDate: data.newDate,
        refundChoiceDeadline: data.refundChoiceDeadline ?? null,
      });
      return { handled: true };
    }
    case 'booking.accepted':
    case 'booking.paid':
    case 'booking.cancelled':
      return applyBookingEvent(service, envelope.type, envelope.data);
    default:
      return { handled: false };
  }
}

// --- Space bookings (a linked bookable venue) ---------------------------------------------

const bookingEventSchema = z.object({
  reservationId: z.string().min(1),
  partnerRef: z.string().nullable().optional(),
  depositDueBy: z.string().nullable().optional(),
});

/**
 * WaitApp says a booking made through Chabuka was accepted, paid or released. Keeps the player's booking row current
 * and tells the player (and, once paid, the venue owner). Only moves forward: a paid booking never goes back to
 * accepted if an older webhook arrives late, and a cancelled one stays cancelled.
 */
async function applyBookingEvent(
  service: SupabaseClient,
  type: 'booking.accepted' | 'booking.paid' | 'booking.cancelled',
  rawData: Record<string, unknown>,
): Promise<{ handled: boolean }> {
  const data = bookingEventSchema.parse(rawData);
  const next = type === 'booking.paid' ? 'paid' : type === 'booking.cancelled' ? 'cancelled' : 'accepted';
  const { data: row, error } = await service
    .from('waitapp_bookings')
    .select('id,venue_id,user_id,match_id,status,space_name,starts_at')
    .eq('waitapp_reservation_id', data.reservationId)
    .maybeSingle();
  if (error) throw new ActionError(500, 'Could not read the booking.');
  const booking = row as { id: string; venue_id: string; user_id: string; match_id: string | null; status: string; space_name: string; starts_at: string } | null;
  if (!booking) return { handled: false };
  const rank: Record<string, number> = { pending: 0, accepted: 1, paid: 2, cancelled: 3 };
  // Same or older news than we already hold (a repeated or late webhook): nothing to do.
  if ((rank[next] ?? 0) <= (rank[booking.status] ?? 0)) return { handled: true };
  const patch: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
  if (data.depositDueBy) patch['deposit_due_by'] = data.depositDueBy;
  const { error: updErr } = await service.from('waitapp_bookings').update(patch).eq('id', booking.id);
  if (updErr) throw new ActionError(500, 'Could not update the booking.');

  const { data: venue } = await service.from('venues').select('name,owner_id').eq('id', booking.venue_id).maybeSingle();
  const v = venue as { name: string; owner_id: string | null } | null;
  const payload = { bookingId: booking.id, venueId: booking.venue_id, title: v?.name ?? '', spaceName: booking.space_name, startsAt: booking.starts_at };
  await notifyUsers([booking.user_id], `space_booking_${next}`, payload);
  if (next === 'paid' && v?.owner_id) await notifyUsers([v.owner_id], 'space_booking_paid_owner', payload);
  // A game's space is now paid for: the players hear that the venue is secured.
  if (next === 'paid' && booking.match_id) {
    const players = (await participantIds(service, booking.match_id)).filter((id) => id !== booking.user_id);
    await notifyUsers(players, 'game_venue_booked', { matchId: booking.match_id, title: await gameTitle(service, booking.match_id), venue: v?.name ?? '', spaceName: booking.space_name, startsAt: booking.starts_at });
  }
  return { handled: true };
}

// --- Refresh / reconcile ------------------------------------------------------------

export async function refreshTicketing(
  service: SupabaseClient,
  userId: string,
  matchId: string,
  deps: { fetch?: typeof fetch } = {},
) {
  await loadOwnMatch(service, userId, matchId);
  const { data: ticketing } = await service
    .from('match_ticketing')
    .select('waitapp_event_id')
    .eq('match_id', matchId)
    .maybeSingle();
  if (!ticketing) throw new ActionError(404, 'This game is not selling tickets.');
  const eventId = (ticketing as { waitapp_event_id: string }).waitapp_event_id;

  const { status, data } = await waitappCall(service, userId, `/api/partner/chabuka/events/${encodeURIComponent(eventId)}`, { method: 'GET' }, deps);
  if (status >= 400) throw new ActionError(502, 'WaitApp could not report on this event.');

  const sales = Array.isArray(data.sales) ? (data.sales as Record<string, unknown>[]) : [];
  for (const s of sales) {
    const buyer = (s.buyer ?? {}) as { email?: string };
    const ticketIds = Array.isArray(s.ticketIds) ? (s.ticketIds as string[]) : [];
    if (!buyer.email || typeof s.paymentId !== 'string') continue;
    await applyTicketsIssued(service, {
      matchId,
      paymentId: s.paymentId,
      ticketIds,
      tierName: typeof s.tierName === 'string' ? s.tierName : null,
      buyerEmail: buyer.email,
      ref: typeof s.ref === 'string' ? s.ref : null,
    });
  }
  // Statuses (checked in / refunded) for every ticket WaitApp knows about.
  const tickets = Array.isArray(data.tickets) ? (data.tickets as { id?: string; status?: string }[]) : [];
  for (const status of ['used', 'refunded', 'cancelled'] as const) {
    const ids = tickets.filter((t) => t.status === status && typeof t.id === 'string').map((t) => t.id as string);
    if (ids.length > 0) await setTicketStatus(service, matchId, ids, status);
  }
  const { error } = await service
    .from('match_ticketing')
    .update({ status: mapStatus(typeof data.status === 'string' ? data.status : undefined), updated_at: new Date().toISOString() })
    .eq('match_id', matchId);
  if (error) throw new ActionError(500, 'Could not update the ticketing status.');
  const { data: row } = await service.from('match_ticketing').select('*').eq('match_id', matchId).maybeSingle();
  return row;
}

// --- Claiming tickets bought before signing up ---------------------------------------

export async function claimTickets(service: SupabaseClient, userId: string): Promise<{ claimed: number }> {
  const { data: userRes } = await service.auth.admin.getUserById(userId);
  const user = userRes?.user;
  // Only a confirmed email may claim: otherwise typing someone's address at signup would hand over their tickets.
  if (!user?.email || !user.email_confirmed_at) return { claimed: 0 };
  const { data: open } = await service
    .from('ticket_orders')
    .select('ticket_id,match_id')
    .is('user_id', null)
    .eq('buyer_email', user.email.trim().toLowerCase());
  const rows = (open ?? []) as { ticket_id: string; match_id: string }[];
  if (rows.length === 0) return { claimed: 0 };
  const { error } = await service
    .from('ticket_orders')
    .update({ user_id: userId })
    .in('ticket_id', rows.map((r) => r.ticket_id))
    .is('user_id', null);
  if (error) throw new ActionError(500, 'Could not attach your tickets.');
  for (const matchId of new Set(rows.map((r) => r.match_id))) {
    await service.from('match_participants').upsert({ match_id: matchId, user_id: userId, status: 'joined' }, { onConflict: 'match_id,user_id' });
  }
  return { claimed: rows.length };
}

