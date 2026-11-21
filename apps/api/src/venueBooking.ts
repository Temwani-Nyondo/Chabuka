import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addClosureSchema,
  cancelSpaceBookingSchema,
  checkInSpaceBookingSchema,
  closuresAsBookings,
  computeSpaceSlots,
  deleteSpaceSchema,
  firstFreeUnit,
  openWindowFor,
  overlaps,
  removeClosureSchema,
  removeVenueStaffSchema,
  requestSpaceSchema,
  respondSpaceBookingSchema,
  setHoursSchema,
  unitIdsFor,
  upsertSpaceSchema,
  venueInstant,
  venueStaffSchema,
  venueTime,
  venueYmd,
  addDaysYmd,
  walkInBookingSchema,
  weeklyDates,
  type SpaceSlot,
  type UnitBooking,
  type WeeklyHours,
  teeSlots,
} from '@chabuka/shared';
import type { TeeConfig } from '@chabuka/shared';
import { ActionError, notifyUsers } from './actions.js';
import { venueCall } from './waitapp.js';

// Venue booking, Phase 4. One booking model, two homes:
//  - native: a Chabuka-only venue. Spaces, opening hours, closures and bookings live in Chabuka's tables. No money:
//    bookings are free or "pay at the venue".
//  - linked: the venue connected a WaitApp Bookable Venue account. WaitApp holds spaces, hours, closures, bookings and
//    the money; every read and write below goes to WaitApp's partner API with the venue OWNER's link token (staff act
//    through the owner's link, and a token can only ever reach its own venue).
// Both answer the same calls with the same shapes, so the web never needs to know which home a venue uses.
// All writes use the service client after the checks here (owner, or staff for day-to-day booking work).

type Deps = { fetch?: typeof fetch; now?: Date };

export interface VenueRow {
  id: string;
  name: string;
  owner_id: string | null;
  status: string;
  sports: string[] | null;
  opening_hours: WeeklyHours | null;
  waitapp_restaurant_id: string | null;
}

/** A space as the web sees it, whichever home it lives in. */
export interface SpaceView {
  id: string;
  name: string;
  sports: string[];
  surface: string | null;
  size_note: string | null;
  unit_count: number;
  hourly_price: number | null;
  currency: string | null;
  booking_mode: 'request' | 'instant';
  photos: string[];
  active: boolean;
  waitapp_type_id: string | null;
  /** Golf: 'tee' spaces are sold as tee times (see teeSlots). */
  booking_kind?: 'hourly' | 'tee';
  tee?: TeeConfig | null;
}

const isTee = (s: Pick<SpaceView, 'booking_kind' | 'tee'> | undefined): s is SpaceView & { tee: TeeConfig } => s?.booking_kind === 'tee' && !!s.tee;

export interface ClosureView {
  id: string;
  space_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

/** A booking on the owner's calendar. `status` is normalised across both homes. */
export interface CalBooking {
  id: string;
  spaceId: string | null;
  unitNo: number | null;
  startsAt: string;
  endsAt: string;
  status: 'requested' | 'confirmed' | 'declined' | 'cancelled';
  paid: boolean;
  awaitingPayment: boolean;
  who: string;
  phone: string | null;
  code: string | null;
  source: 'chabuka' | 'waitapp' | 'walk_in';
  groupId: string | null;
  teamId: string | null;
  matchId: string | null;
  fixtureId: string | null;
  note: string | null;
  amount: number | null;
  currency: string | null;
  checkedIn: boolean;
}

const LIVE = ['requested', 'confirmed'];

export async function loadVenueRow(svc: SupabaseClient, venueId: string): Promise<VenueRow> {
  const { data, error } = await svc
    .from('venues')
    .select('id,name,owner_id,status,sports,opening_hours,waitapp_restaurant_id')
    .eq('id', venueId)
    .maybeSingle();
  if (error) throw new ActionError(500, 'Could not load the venue.');
  if (!data) throw new ActionError(404, 'Venue not found.');
  const v = data as VenueRow;
  return { ...v, opening_hours: (v.opening_hours ?? {}) as WeeklyHours, sports: v.sports ?? [] };
}

export const isLinked = (v: VenueRow) => !!v.waitapp_restaurant_id && !!v.owner_id;

export async function isVenueManager(svc: SupabaseClient, venue: VenueRow, userId: string): Promise<boolean> {
  if (venue.owner_id === userId) return true;
  const { data } = await svc.from('venue_staff').select('user_id').eq('venue_id', venue.id).eq('user_id', userId).maybeSingle();
  return !!data;
}

export async function requireVenueManager(svc: SupabaseClient, venueId: string, userId: string): Promise<VenueRow> {
  const venue = await loadVenueRow(svc, venueId);
  if (!(await isVenueManager(svc, venue, userId))) throw new ActionError(403, 'Only the venue owner or its staff can do that.');
  return venue;
}

async function requireOwner(svc: SupabaseClient, venueId: string, userId: string): Promise<VenueRow> {
  const venue = await loadVenueRow(svc, venueId);
  if (venue.owner_id !== userId) throw new ActionError(403, 'Only the venue owner can do that.');
  return venue;
}

// --- WaitApp plumbing ------------------------------------------------------------------

async function wa(
  svc: SupabaseClient,
  venue: VenueRow,
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown },
  deps: Deps,
): Promise<Record<string, unknown>> {
  const { status, data } = await venueCall(svc, venue, `/api/partner/chabuka${path}`, init, deps);
  if (status === 403) {
    if (venue.owner_id) await notifyUsers([venue.owner_id], 'waitapp_reconnect_needed', { venueId: venue.id, title: venue.name }).catch(() => undefined);
    throw new ActionError(409, 'Reconnect WaitApp to manage this venue from Chabuka. The venue owner can do it under Setup.');
  }
  if (status >= 400) {
    const message = typeof data['error'] === 'string' ? (data['error'] as string) : 'WaitApp could not do that. Try again.';
    throw new ActionError(status === 409 || status === 400 || status === 404 ? status : 502, message);
  }
  return data;
}

interface WaSpace {
  id: string;
  name: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  bookingMode?: string;
  unitCount?: number;
  image?: string | null;
  images?: string[];
  isActive?: boolean;
}

function fromWaSpace(s: WaSpace, venue: VenueRow): SpaceView {
  return {
    id: s.id,
    name: s.name,
    sports: venue.sports ?? [],
    surface: null,
    size_note: s.description ?? null,
    unit_count: Math.max(1, Number(s.unitCount ?? 1)),
    hourly_price: s.price == null ? null : Number(s.price),
    currency: s.currency ?? null,
    booking_mode: s.bookingMode === 'instant' ? 'instant' : 'request',
    photos: Array.isArray(s.images) ? s.images : s.image ? [s.image] : [],
    active: s.isActive !== false,
    waitapp_type_id: s.id,
  };
}

interface WaBooking {
  id: string;
  typeId: string;
  unitId?: string | null;
  unitNo?: number | null;
  startsAt: string;
  endsAt: string;
  status: string; // pending | accepted | paid | rejected | cancelled | completed
  customerName?: string | null;
  customerPhone?: string | null;
  bookingCode?: string | null;
  total?: number | null;
  currency?: string | null;
  source?: string | null;
  walkIn?: boolean;
  paymentDue?: boolean;
  partner?: { ref?: string | null; groupId?: string | null; matchId?: string | null; teamId?: string | null; fixtureId?: string | null } | null;
  note?: string | null;
  checkedIn?: boolean;
}

function fromWaBooking(b: WaBooking): CalBooking {
  const s = b.status;
  const status: CalBooking['status'] =
    s === 'pending' ? 'requested' : s === 'rejected' ? 'declined' : s === 'cancelled' ? 'cancelled' : 'confirmed';
  return {
    id: b.id,
    spaceId: b.typeId,
    unitNo: b.unitNo ?? null,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    status,
    paid: s === 'paid' || s === 'completed',
    awaitingPayment: b.paymentDue === true,
    who: b.customerName ?? 'Guest',
    phone: b.customerPhone ?? null,
    code: b.bookingCode ?? null,
    source: b.walkIn ? 'walk_in' : b.partner?.ref ? 'chabuka' : 'waitapp',
    groupId: b.partner?.groupId ?? null,
    teamId: b.partner?.teamId ?? null,
    matchId: b.partner?.matchId ?? null,
    fixtureId: b.partner?.fixtureId ?? null,
    note: b.note ?? null,
    amount: b.total ?? null,
    currency: b.currency ?? null,
    checkedIn: !!b.checkedIn,
  };
}

// --- Native reads ----------------------------------------------------------------------

async function nativeSpaces(svc: SupabaseClient, venueId: string, includeInactive = false): Promise<SpaceView[]> {
  const { data, error } = await svc.from('venue_spaces').select('*').eq('venue_id', venueId).order('sort');
  if (error) throw new ActionError(500, 'Could not load the spaces.');
  return ((data ?? []) as (SpaceView & { hourly_price: number | string | null })[])
    .filter((s) => includeInactive || s.active)
    .map((s) => ({ ...s, hourly_price: s.hourly_price == null ? null : Number(s.hourly_price), photos: s.photos ?? [], sports: s.sports ?? [] }));
}

async function nativeClosures(svc: SupabaseClient, venueId: string, fromIso: string, toIso: string): Promise<ClosureView[]> {
  const { data, error } = await svc
    .from('venue_closures')
    .select('id,space_id,starts_at,ends_at,reason')
    .eq('venue_id', venueId)
    .lt('starts_at', toIso)
    .gt('ends_at', fromIso);
  if (error) throw new ActionError(500, 'Could not load closures.');
  return (data ?? []) as ClosureView[];
}

interface NativeBookingRow {
  id: string;
  venue_id: string;
  space_id: string | null;
  unit_no: number | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  requester_id: string;
  source: string;
  guest_name: string | null;
  guest_phone: string | null;
  group_id: string | null;
  team_id: string | null;
  match_id: string | null;
  fixture_id: string | null;
  note: string | null;
  pay_at_venue_amount: number | string | null;
  currency: string | null;
  checked_in_at: string | null;
  players?: number | null;
}

async function nativeBookings(svc: SupabaseClient, venueId: string, fromIso: string, toIso: string): Promise<NativeBookingRow[]> {
  const { data, error } = await svc
    .from('bookings')
    .select('*')
    .eq('venue_id', venueId)
    .lt('starts_at', toIso)
    .gt('ends_at', fromIso);
  if (error) throw new ActionError(500, 'Could not load bookings.');
  return ((data ?? []) as NativeBookingRow[]).filter((b) => b.space_id && b.starts_at && b.ends_at);
}

async function namesFor(svc: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  const { data } = await svc.from('profiles').select('id,name').in('id', unique);
  for (const p of (data ?? []) as { id: string; name: string | null }[]) map.set(p.id, p.name ?? 'Player');
  return map;
}

async function teamNames(svc: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  const { data } = await svc.from('teams').select('id,name').in('id', unique);
  for (const t of (data ?? []) as { id: string; name: string }[]) map.set(t.id, t.name);
  return map;
}

function toCal(b: NativeBookingRow, names: Map<string, string>, withPhone: boolean): CalBooking {
  const walkIn = b.source === 'owner';
  return {
    id: b.id,
    spaceId: b.space_id,
    unitNo: b.unit_no,
    startsAt: b.starts_at!,
    endsAt: b.ends_at!,
    status: (['requested', 'confirmed', 'declined', 'cancelled'].includes(b.status) ? b.status : 'cancelled') as CalBooking['status'],
    paid: false,
    awaitingPayment: false,
    who: walkIn ? (b.guest_name ?? 'Guest') : (names.get(b.requester_id) ?? 'Player'),
    phone: withPhone && walkIn ? b.guest_phone : null,
    code: null,
    source: walkIn ? 'walk_in' : 'chabuka',
    groupId: b.group_id,
    teamId: b.team_id,
    matchId: b.match_id,
    fixtureId: b.fixture_id,
    note: b.note,
    amount: b.pay_at_venue_amount == null ? null : Number(b.pay_at_venue_amount),
    currency: b.currency,
    checkedIn: !!b.checked_in_at,
  };
}

function rangeIso(from: string, days: number): { fromIso: string; toIso: string } {
  return { fromIso: venueInstant(from).toISOString(), toIso: venueInstant(addDaysYmd(from, days)).toISOString() };
}

// --- Public reads (both homes) -------------------------------------------------------------

export async function listSpaces(svc: SupabaseClient, venueId: string, deps: Deps = {}) {
  const venue = await loadVenueRow(svc, venueId);
  if (isLinked(venue)) {
    const data = await wa(svc, venue, '/spaces', { method: 'GET' }, deps);
    const v = (data['venue'] ?? {}) as { operatingHours?: WeeklyHours | null; bookingPage?: string | null };
    const spaces = (Array.isArray(data['spaces']) ? (data['spaces'] as WaSpace[]) : []).map((s) => fromWaSpace(s, venue));
    return { linked: true, hours: v.operatingHours ?? {}, bookingPage: v.bookingPage ?? null, spaces };
  }
  return { linked: false, hours: venue.opening_hours ?? {}, bookingPage: null, spaces: await nativeSpaces(svc, venue.id) };
}

export interface AvailabilityView {
  date: string;
  closed: boolean;
  bookingMode: 'request' | 'instant';
  price: number | null;
  currency: string | null;
  linked: boolean;
  slots: SpaceSlot[];
  /** Tee sheets: price is per player and slots' unitsFree are spots left. */
  tee?: TeeConfig;
}

async function nativeAvailability(svc: SupabaseClient, venue: VenueRow, space: SpaceView, date: string, now: Date): Promise<AvailabilityView> {
  const window = openWindowFor(date, venue.opening_hours);
  const { fromIso, toIso } = rangeIso(date, 1);
  if (isTee(space)) {
    const rows = (await nativeBookings(svc, venue.id, fromIso, toIso)).filter((b) => b.space_id === space.id && b.status === 'confirmed');
    const closures = (await nativeClosures(svc, venue.id, fromIso, toIso)).filter((c) => !c.space_id || c.space_id === space.id);
    return {
      date,
      closed: window === null,
      bookingMode: 'request',
      price: space.tee.pricePerPlayer ?? null,
      currency: space.currency ?? 'ZMW',
      linked: false,
      tee: space.tee,
      slots: teeSlots({
        date,
        window,
        tee: space.tee,
        bookings: rows.map((b) => ({ startsAt: b.starts_at!, players: b.players ?? 1 })),
        closures: closures.map((c) => ({ startsAt: c.starts_at, endsAt: c.ends_at })),
        now,
      }),
    };
  }
  const units = unitIdsFor(space.unit_count);
  const rows = (await nativeBookings(svc, venue.id, fromIso, toIso)).filter((b) => b.space_id === space.id && b.status === 'confirmed');
  const bookings: UnitBooking[] = [];
  for (const b of rows) {
    // A confirmed booking always has a unit; older rows without one block unit 1.
    bookings.push({ unitId: String(b.unit_no ?? 1), startsAt: b.starts_at!, endsAt: b.ends_at! });
  }
  bookings.push(...closuresAsBookings(await nativeClosures(svc, venue.id, fromIso, toIso), space.id, units));
  return {
    date,
    closed: window === null,
    bookingMode: 'request',
    price: space.hourly_price,
    currency: space.currency,
    linked: false,
    slots: computeSpaceSlots({ date, window, unitIds: units, bookings, now }),
  };
}

export async function getAvailability(svc: SupabaseClient, venueId: string, spaceId: string, date: string, deps: Deps = {}): Promise<AvailabilityView> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActionError(400, 'Choose a date.');
  const venue = await loadVenueRow(svc, venueId);
  if (venue.status !== 'approved') throw new ActionError(409, 'This venue is not open for bookings yet.');
  if (isLinked(venue)) {
    const data = await wa(svc, venue, `/availability?typeId=${encodeURIComponent(spaceId)}&date=${date}`, { method: 'GET' }, deps);
    return {
      date,
      closed: data['closed'] === true,
      bookingMode: data['bookingMode'] === 'instant' ? 'instant' : 'request',
      price: typeof data['basePrice'] === 'number' ? (data['basePrice'] as number) : null,
      currency: typeof data['currency'] === 'string' ? (data['currency'] as string) : null,
      linked: true,
      slots: Array.isArray(data['slots']) ? (data['slots'] as SpaceSlot[]) : [],
    };
  }
  const space = (await nativeSpaces(svc, venue.id)).find((s) => s.id === spaceId);
  if (!space) throw new ActionError(404, 'That space is not available.');
  return nativeAvailability(svc, venue, space, date, deps.now ?? new Date());
}

// --- Owner reads ------------------------------------------------------------------------

export interface CalendarView {
  linked: boolean;
  hours: WeeklyHours;
  spaces: SpaceView[];
  closures: ClosureView[];
  bookings: CalBooking[];
  teams: Record<string, string>;
}

export async function getCalendar(svc: SupabaseClient, userId: string, venueId: string, from: string, days: number, deps: Deps = {}): Promise<CalendarView> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new ActionError(400, 'Choose a start date.');
  const span = Math.min(Math.max(1, days), 31);
  const venue = await requireVenueManager(svc, venueId, userId);
  if (isLinked(venue)) {
    const data = await wa(svc, venue, `/calendar?from=${from}&days=${span}`, { method: 'GET' }, deps);
    const bookings = (Array.isArray(data['bookings']) ? (data['bookings'] as WaBooking[]) : []).map(fromWaBooking);
    const closures = (Array.isArray(data['closures']) ? (data['closures'] as { id: string; typeId?: string | null; startsAt: string; endsAt: string; reason?: string | null }[]) : []).map(
      (c) => ({ id: c.id, space_id: c.typeId ?? null, starts_at: c.startsAt, ends_at: c.endsAt, reason: c.reason ?? null }),
    );
    const teams = await teamNames(svc, bookings.map((b) => b.teamId ?? ''));
    return {
      linked: true,
      hours: (data['hours'] ?? {}) as WeeklyHours,
      spaces: (Array.isArray(data['spaces']) ? (data['spaces'] as WaSpace[]) : []).map((s) => fromWaSpace(s, venue)),
      closures,
      bookings,
      teams: Object.fromEntries(teams),
    };
  }
  const { fromIso, toIso } = rangeIso(from, span);
  const rows = await nativeBookings(svc, venue.id, fromIso, toIso);
  const names = await namesFor(svc, rows.map((r) => r.requester_id));
  const teams = await teamNames(svc, rows.map((r) => r.team_id ?? ''));
  return {
    linked: false,
    hours: venue.opening_hours ?? {},
    spaces: await nativeSpaces(svc, venue.id, true),
    closures: await nativeClosures(svc, venue.id, fromIso, toIso),
    bookings: rows.map((r) => toCal(r, names, true)),
    teams: Object.fromEntries(teams),
  };
}

export interface RequestCard {
  key: string;
  groupId: string | null;
  bookingIds: string[];
  who: string;
  team: string | null;
  spaceId: string | null;
  spaceName: string;
  weekday: number;
  start: string;
  end: string;
  dates: string[];
  clashes: string[]; // dates that clash with a confirmed booking or closure
  note: string | null;
  matchId: string | null;
  fixtureId: string | null;
  source: CalBooking['source'];
}

/** Waiting requests from now on, block bookings folded into one card, with clashes flagged. */
export async function getRequests(svc: SupabaseClient, userId: string, venueId: string, deps: Deps = {}): Promise<RequestCard[]> {
  const now = deps.now ?? new Date();
  const from = venueYmd(now);
  const cal = await getCalendar(svc, userId, venueId, from, 31, deps);
  // Look further ahead for long blocks: a second window covers weeks 5-9.
  const later = await getCalendar(svc, userId, venueId, addDaysYmd(from, 31), 31, deps).catch(() => null);
  const all = [...cal.bookings, ...(later?.bookings ?? [])];
  const closures = [...cal.closures, ...(later?.closures ?? [])];
  const spaceName = new Map(cal.spaces.map((s) => [s.id, s.name]));
  const unitsOf = new Map(cal.spaces.map((s) => [s.id, s.unit_count]));
  const waiting = all.filter((b) => b.status === 'requested' && new Date(b.endsAt).getTime() > now.getTime());
  const groups = new Map<string, CalBooking[]>();
  for (const b of waiting) {
    const key = b.groupId ?? b.id;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const cards: RequestCard[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const first = list[0]!;
    const clashes: string[] = [];
    for (const b of list) {
      const confirmed = all.filter((x) => x.status === 'confirmed' && x.spaceId === b.spaceId && overlaps(x.startsAt, x.endsAt, b.startsAt, b.endsAt)).length;
      const closed = closures.some((c) => (!c.space_id || c.space_id === b.spaceId) && overlaps(c.starts_at, c.ends_at, b.startsAt, b.endsAt));
      if (closed || confirmed >= (unitsOf.get(b.spaceId ?? '') ?? 1)) clashes.push(venueYmd(b.startsAt));
    }
    cards.push({
      key,
      groupId: first.groupId,
      bookingIds: list.map((b) => b.id),
      who: first.who,
      team: first.teamId ? (cal.teams[first.teamId] ?? later?.teams[first.teamId] ?? null) : null,
      spaceId: first.spaceId,
      spaceName: spaceName.get(first.spaceId ?? '') ?? 'Space',
      weekday: new Date(venueInstant(venueYmd(first.startsAt)).getTime() + 12 * 3_600_000).getUTCDay(),
      start: venueTime(first.startsAt),
      end: venueTime(first.endsAt),
      dates: list.map((b) => venueYmd(b.startsAt)),
      clashes,
      note: first.note,
      matchId: first.matchId,
      fixtureId: first.fixtureId,
      source: first.source,
    });
  }
  return cards.sort((a, b) => (a.dates[0] ?? '').localeCompare(b.dates[0] ?? ''));
}

export async function getToday(svc: SupabaseClient, userId: string, venueId: string, deps: Deps = {}) {
  const today = venueYmd(deps.now ?? new Date());
  const cal = await getCalendar(svc, userId, venueId, today, 1, deps);
  return {
    date: today,
    linked: cal.linked,
    spaces: cal.spaces,
    bookings: cal.bookings.filter((b) => b.status === 'confirmed').sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    teams: cal.teams,
  };
}

export async function getStats(svc: SupabaseClient, userId: string, venueId: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const today = venueYmd(now);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = addDaysYmd(today, -((dow + 6) % 7)); // Monday
  const cal = await getCalendar(svc, userId, venueId, addDaysYmd(weekStart, -21), 28, deps);
  const hoursOf = (b: CalBooking) => (new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()) / 3_600_000;
  const inWeek = (b: CalBooking, start: string) => {
    const d = venueYmd(b.startsAt);
    return d >= start && d < addDaysYmd(start, 7);
  };
  const confirmed = cal.bookings.filter((b) => b.status === 'confirmed');
  const thisWeek = confirmed.filter((b) => inWeek(b, weekStart)).reduce((n, b) => n + hoursOf(b), 0);
  const lastWeek = confirmed.filter((b) => inWeek(b, addDaysYmd(weekStart, -7))).reduce((n, b) => n + hoursOf(b), 0);
  // Open hours this week across all units, for a fill rate.
  let openHours = 0;
  for (let i = 0; i < 7; i += 1) {
    const w = openWindowFor(addDaysYmd(weekStart, i), cal.hours);
    if (!w) continue;
    const perUnit = (w.close - w.open) / 60;
    for (const s of cal.spaces.filter((x) => x.active)) openHours += perUnit * s.unit_count;
  }
  const byHour = new Map<string, number>();
  for (const b of confirmed) {
    const h = venueTime(b.startsAt);
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  const busiest = [...byHour.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([hour, count]) => ({ hour, count }));
  const waiting = cal.bookings.filter((b) => b.status === 'requested' && new Date(b.startsAt) > now).length;
  return { weekStart, thisWeekHours: thisWeek, lastWeekHours: lastWeek, openHours, fillRate: openHours > 0 ? thisWeek / openHours : 0, waiting, busiest };
}

// --- Setup: spaces, hours, closures ------------------------------------------------------------

export async function upsertSpace(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = upsertSpaceSchema.parse(raw);
  const venue = await requireVenueManager(svc, input.venueId, userId);
  if (input.bookingKind === 'tee') {
    if (!input.tee) throw new ActionError(400, 'Set the tee interval, players per tee time and price.');
    if (isLinked(venue)) throw new ActionError(409, 'Tee times stay on Chabuka for now. Unlink WaitApp to sell tee times, or keep this venue hourly.');
  }
  if (isLinked(venue)) {
    const data = await wa(
      svc,
      venue,
      '/spaces',
      {
        method: 'PUT',
        body: {
          ...(input.spaceId ? { id: input.spaceId } : {}),
          name: input.name,
          description: [input.surface, input.sizeNote].filter(Boolean).join(', ') || null,
          unitCount: input.unitCount,
          basePrice: input.hourlyPrice ?? 0,
          ...(input.currency ? { currency: input.currency } : {}),
          bookingMode: input.bookingMode,
          images: input.photos,
          isActive: input.active,
        },
      },
      deps,
    );
    return { state: 'saved', spaceId: String(data['id'] ?? input.spaceId ?? '') };
  }
  if (input.bookingMode === 'instant') {
    throw new ActionError(400, 'Instant booking needs payment up front. Link your WaitApp account to use it.');
  }
  const row = {
    venue_id: venue.id,
    name: input.name,
    sports: input.sports,
    surface: input.surface || null,
    size_note: input.sizeNote || null,
    unit_count: input.unitCount,
    hourly_price: input.hourlyPrice ?? null,
    currency: input.hourlyPrice != null && input.hourlyPrice > 0 ? (input.currency ?? 'ZMW') : null,
    booking_mode: 'request',
    photos: input.photos,
    active: input.active,
    booking_kind: input.bookingKind,
    tee: input.bookingKind === 'tee' ? input.tee : null,
    ...(input.bookingKind === 'tee' ? { currency: input.tee?.pricePerPlayer ? (input.currency ?? 'ZMW') : null, hourly_price: null } : {}),
    updated_at: new Date().toISOString(),
  };
  if (input.spaceId) {
    const { data: existing } = await svc.from('venue_spaces').select('id,venue_id').eq('id', input.spaceId).maybeSingle();
    if (!existing || (existing as { venue_id: string }).venue_id !== venue.id) throw new ActionError(404, 'Space not found.');
    const { error } = await svc.from('venue_spaces').update(row).eq('id', input.spaceId);
    if (error) throw new ActionError(500, 'Could not save the space.');
    return { state: 'saved', spaceId: input.spaceId };
  }
  const { data: count } = await svc.from('venue_spaces').select('id').eq('venue_id', venue.id);
  const { data, error } = await svc
    .from('venue_spaces')
    .insert({ ...row, sort: ((count ?? []) as unknown[]).length })
    .select('id')
    .single();
  if (error) throw new ActionError(500, 'Could not add the space.');
  return { state: 'created', spaceId: (data as { id: string }).id };
}

export async function deleteSpace(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = deleteSpaceSchema.parse(raw);
  const venue = await requireVenueManager(svc, input.venueId, userId);
  if (isLinked(venue)) {
    // WaitApp never deletes a space with history: it is switched off instead.
    await wa(svc, venue, '/spaces', { method: 'PUT', body: { id: input.spaceId, isActive: false } }, deps);
    return { state: 'hidden' };
  }
  const now = (deps.now ?? new Date()).toISOString();
  const { data: future } = await svc.from('bookings').select('id,status').eq('space_id', input.spaceId).gt('ends_at', now);
  if (((future ?? []) as { status: string }[]).some((b) => LIVE.includes(b.status))) {
    throw new ActionError(409, 'This space has upcoming bookings. Cancel them or switch the space off instead.');
  }
  const { error } = await svc.from('venue_spaces').delete().eq('id', input.spaceId).eq('venue_id', venue.id);
  if (error) throw new ActionError(500, 'Could not delete the space.');
  return { state: 'deleted' };
}

export async function setHours(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = setHoursSchema.parse(raw);
  const venue = await requireVenueManager(svc, input.venueId, userId);
  for (const [day, h] of Object.entries(input.hours)) {
    if (!h || h.closed) continue;
    const [oh, om] = h.open.split(':').map(Number) as [number, number];
    const [ch, cm] = h.close.split(':').map(Number) as [number, number];
    const close = ch * 60 + cm === 0 ? 1440 : ch * 60 + cm;
    if (close <= oh * 60 + om) throw new ActionError(400, `Closing time on ${day} must be after opening time.`);
  }
  if (isLinked(venue)) {
    await wa(svc, venue, '/hours', { method: 'PUT', body: { operatingHours: input.hours } }, deps);
  }
  // Native keeps its own copy too, so unlinking later starts from the latest hours.
  const { error } = await svc.from('venues').update({ opening_hours: input.hours }).eq('id', venue.id);
  if (error) throw new ActionError(500, 'Could not save the opening hours.');
  return { state: 'saved' };
}

export async function addClosure(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = addClosureSchema.parse(raw);
  const venue = await requireVenueManager(svc, input.venueId, userId);
  if (isLinked(venue)) {
    const data = await wa(
      svc,
      venue,
      '/closures',
      {
        method: 'POST',
        body: { typeId: input.spaceId ?? null, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason, cancelBookings: input.cancelBookings },
      },
      deps,
    );
    return { state: 'closed', closureId: String(data['id'] ?? ''), cancelled: Number(data['cancelled'] ?? 0) };
  }
  if (input.spaceId) {
    const { data: s } = await svc.from('venue_spaces').select('id,venue_id').eq('id', input.spaceId).maybeSingle();
    if (!s || (s as { venue_id: string }).venue_id !== venue.id) throw new ActionError(404, 'Space not found.');
  }
  const hit = (await nativeBookings(svc, venue.id, input.startsAt, input.endsAt)).filter(
    (b) => LIVE.includes(b.status) && (!input.spaceId || b.space_id === input.spaceId),
  );
  if (hit.length > 0 && !input.cancelBookings) {
    throw new ActionError(
      409,
      `${hit.length} booking${hit.length === 1 ? ' falls' : 's fall'} inside this closure. Choose to cancel them (the players are told why), or pick other times.`,
    );
  }
  const { data, error } = await svc
    .from('venue_closures')
    .insert({ venue_id: venue.id, space_id: input.spaceId ?? null, starts_at: input.startsAt, ends_at: input.endsAt, reason: input.reason, created_by: userId })
    .select('id')
    .single();
  if (error) throw new ActionError(500, 'Could not add the closure.');
  if (hit.length > 0) await cancelNative(svc, hit, userId, `Closed: ${input.reason}`, true, venue);
  return { state: 'closed', closureId: (data as { id: string }).id, cancelled: hit.length };
}

export async function removeClosure(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = removeClosureSchema.parse(raw);
  const venue = await requireVenueManager(svc, input.venueId, userId);
  if (isLinked(venue)) {
    await wa(svc, venue, `/closures?id=${encodeURIComponent(input.closureId)}`, { method: 'DELETE' }, deps);
    return { state: 'removed' };
  }
  const { error } = await svc.from('venue_closures').delete().eq('id', input.closureId).eq('venue_id', venue.id);
  if (error) throw new ActionError(500, 'Could not remove the closure.');
  return { state: 'removed' };
}

// --- Bookings --------------------------------------------------------------------------

function windowFor(date: string, startTime: string, hours: number): { startsAt: string; endsAt: string } {
  const startsAt = venueInstant(date, startTime).toISOString();
  return { startsAt, endsAt: new Date(new Date(startsAt).getTime() + hours * 3_600_000).toISOString() };
}

function fits(av: AvailabilityView, startTime: string, hours: number, players = 1): boolean {
  if (av.closed) return false;
  const slot = av.slots.find((s) => s.start === startTime);
  if (!slot) return false;
  return av.tee ? slot.unitsFree >= players : slot.maxHours >= hours;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Why a single requested time can't be booked, in words a player can act on (not just "no longer free"). */
function whyNotFree(av: AvailabilityView, venue: VenueRow, date: string, startTime: string, hours: number): string {
  if (av.closed) return 'The venue is closed that day. Pick another day.';
  const window = venue.opening_hours && !isLinked(venue) ? openWindowFor(date, venue.opening_hours) : null;
  const [h, m] = startTime.split(':').map(Number);
  const start = (h ?? 0) * 60 + (m ?? 0);
  if (window && (start < window.open || start >= window.close)) return `The venue is open ${hhmm(window.open)} to ${hhmm(window.close)} that day.`;
  if (window && !av.tee && start + hours * 60 > window.close) return `The venue closes at ${hhmm(window.close)}, so the latest a ${hours}-hour booking can start is ${hhmm(window.close - hours * 60)}.`;
  const slot = av.slots.find((s) => s.start === startTime);
  if (slot && av.tee && slot.unitsFree > 0) return `Only ${slot.unitsFree} ${slot.unitsFree === 1 ? 'place is' : 'places are'} left at that tee time.`;
  if (slot && !av.tee && slot.maxHours > 0) return `Only ${slot.maxHours} ${slot.maxHours === 1 ? 'hour is' : 'hours are'} free from ${startTime}.`;
  return 'That time is already taken. Pick another time.';
}

/** A tee time is one interval long; anything else runs for its hours. */
function teeWindow(date: string, startTime: string, tee: TeeConfig): { startsAt: string; endsAt: string } {
  const startsAt = venueInstant(date, startTime).toISOString();
  return { startsAt, endsAt: new Date(new Date(startsAt).getTime() + tee.intervalMin * 60_000).toISOString() };
}

/** Golfers already confirmed at this tee time (excluding one booking being re-checked). */
async function teePlayersAt(svc: SupabaseClient, venue: VenueRow, spaceId: string, startsAt: string, endsAt: string, ignoreId?: string): Promise<number> {
  const rows = (await nativeBookings(svc, venue.id, startsAt, endsAt)).filter(
    (b) => b.space_id === spaceId && b.status === 'confirmed' && b.id !== ignoreId && new Date(b.starts_at!).getTime() === new Date(startsAt).getTime(),
  );
  return rows.reduce((n, b) => n + (b.players ?? 1), 0);
}

export async function walkInBooking(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = walkInBookingSchema.parse(raw);
  const venue = await requireVenueManager(svc, input.venueId, userId);
  if (isLinked(venue)) {
    const data = await wa(
      svc,
      venue,
      '/bookings/walk-in',
      {
        method: 'POST',
        body: {
          typeId: input.spaceId,
          date: input.date,
          startTime: input.startTime,
          hours: input.hours,
          customerName: input.guestName,
          ...(input.guestPhone ? { customerPhone: input.guestPhone } : {}),
          ...(input.note ? { note: input.note } : {}),
        },
      },
      deps,
    );
    return { state: 'confirmed', bookingId: String(data['reservationId'] ?? ''), code: data['bookingCode'] ?? null };
  }
  const space = (await nativeSpaces(svc, venue.id, true)).find((s) => s.id === input.spaceId);
  if (!space) throw new ActionError(404, 'Space not found.');
  if (isTee(space)) {
    const players = input.players ?? 1;
    const { startsAt, endsAt } = teeWindow(input.date, input.startTime, space.tee);
    const av = await nativeAvailability(svc, venue, space, input.date, deps.now ?? new Date());
    if (!fits(av, input.startTime, 0, players)) throw new ActionError(409, 'That tee time is full, closed or not on the tee sheet.');
    const price = space.tee.pricePerPlayer ? space.tee.pricePerPlayer * players : null;
    const { data, error } = await svc
      .from('bookings')
      .insert({
        venue_id: venue.id, space_id: space.id, unit_no: 1, starts_at: startsAt, ends_at: endsAt, requested_starts_at: startsAt,
        requester_id: userId, status: 'confirmed', source: 'owner', guest_name: input.guestName, guest_phone: input.guestPhone || null,
        note: input.note || null, players, pay_at_venue_amount: price, currency: price ? (space.currency ?? 'ZMW') : null,
        decided_by: userId, decided_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new ActionError(500, 'Could not save the booking.');
    return { state: 'confirmed', bookingId: (data as { id: string }).id, unit: 1 };
  }
  const { startsAt, endsAt } = windowFor(input.date, input.startTime, input.hours);
  const unit = await freeUnitNative(svc, venue, space, startsAt, endsAt);
  if (!unit) throw new ActionError(409, 'Every unit of this space is taken or closed at that time.');
  const { data, error } = await svc
    .from('bookings')
    .insert({
      venue_id: venue.id,
      space_id: space.id,
      unit_no: Number(unit),
      starts_at: startsAt,
      ends_at: endsAt,
      requested_starts_at: startsAt,
      requester_id: userId,
      status: 'confirmed',
      source: 'owner',
      guest_name: input.guestName,
      guest_phone: input.guestPhone || null,
      note: input.note || null,
      pay_at_venue_amount: space.hourly_price != null ? space.hourly_price * input.hours : null,
      currency: space.currency,
      decided_by: userId,
      decided_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new ActionError(500, 'Could not save the booking.');
  return { state: 'confirmed', bookingId: (data as { id: string }).id, unit: Number(unit) };
}

async function freeUnitNative(svc: SupabaseClient, venue: VenueRow, space: SpaceView, startsAt: string, endsAt: string, ignoreId?: string): Promise<string | null> {
  const units = unitIdsFor(space.unit_count);
  const rows = (await nativeBookings(svc, venue.id, startsAt, endsAt)).filter(
    (b) => b.space_id === space.id && b.status === 'confirmed' && b.id !== ignoreId,
  );
  const taken: UnitBooking[] = rows.map((b) => ({ unitId: String(b.unit_no ?? 1), startsAt: b.starts_at!, endsAt: b.ends_at! }));
  taken.push(...closuresAsBookings(await nativeClosures(svc, venue.id, startsAt, endsAt), space.id, units));
  return firstFreeUnit(units, taken, startsAt, endsAt);
}

async function checkLinks(svc: SupabaseClient, userId: string, input: { teamId?: string; matchId?: string; fixtureId?: string }) {
  if (input.teamId) {
    const { data } = await svc.from('team_members').select('user_id').eq('team_id', input.teamId).eq('user_id', userId).maybeSingle();
    if (!data) throw new ActionError(403, 'You can only book for a team you are in.');
  }
  if (input.matchId) {
    const { data } = await svc.from('matches').select('organiser_id').eq('id', input.matchId).maybeSingle();
    if (!data || (data as { organiser_id: string }).organiser_id !== userId) throw new ActionError(403, 'Only the game organiser can book a venue for it.');
  }
  if (input.fixtureId) {
    const { data } = await svc.from('fixtures').select('competition_id,home_team_id,away_team_id').eq('id', input.fixtureId).maybeSingle();
    const f = data as { competition_id: string; home_team_id: string | null; away_team_id: string | null } | null;
    if (!f) throw new ActionError(404, 'Fixture not found.');
    const { data: comp } = await svc.from('competitions').select('organiser_id').eq('id', f.competition_id).maybeSingle();
    let ok = (comp as { organiser_id?: string } | null)?.organiser_id === userId;
    if (!ok) {
      const teams = [f.home_team_id, f.away_team_id].filter((t): t is string => !!t);
      if (teams.length > 0) {
        const { data: m } = await svc.from('team_members').select('role').in('team_id', teams).eq('user_id', userId);
        ok = ((m ?? []) as { role: string }[]).some((r) => r.role === 'captain' || r.role === 'owner');
      }
    }
    if (!ok) throw new ActionError(403, 'Only the organiser or a captain can book a venue for this fixture.');
  }
}

/**
 * A player asks for a space, once or every week for N weeks. Weeks that are taken or closed are reported back first;
 * the player sends again with skipTaken to request only the free weeks.
 */
export async function requestSpace(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = requestSpaceSchema.parse(raw);
  const venue = await loadVenueRow(svc, input.venueId);
  if (venue.status !== 'approved') throw new ActionError(409, 'This venue is not open for bookings yet.');
  await checkLinks(svc, userId, input);
  const dates = weeklyDates(input.date, input.weeks);
  const free: string[] = [];
  const taken: string[] = [];
  for (const d of dates) {
    const av = await getAvailability(svc, venue.id, input.spaceId, d, deps);
    if (av.tee && !input.players) throw new ActionError(400, 'How many golfers?');
    (fits(av, input.startTime, input.hours, input.players ?? 1) ? free : taken).push(d);
  }
  if (free.length === 0) {
    if (dates.length > 1) throw new ActionError(409, 'None of those weeks are free at that time.');
    const av = await getAvailability(svc, venue.id, input.spaceId, input.date, deps);
    throw new ActionError(409, whyNotFree(av, venue, input.date, input.startTime, input.hours));
  }
  if (taken.length > 0 && !input.skipTaken) return { state: 'needs_confirm', free, taken };

  let groupId: string | null = null;
  if (free.length > 1) {
    const { data, error } = await svc
      .from('booking_groups')
      .insert({ venue_id: venue.id, requester_id: userId, weeks: free.length, note: input.note || null })
      .select('id')
      .single();
    if (error) throw new ActionError(500, 'Could not save the booking.');
    groupId = (data as { id: string }).id;
  }
  const { data: me } = await svc.from('profiles').select('name').eq('id', userId).maybeSingle();
  const myName = (me as { name?: string | null } | null)?.name ?? 'A player';

  if (isLinked(venue)) {
    if (!input.name || !input.phone) throw new ActionError(400, 'Add your name and phone number for the venue.');
    const spaceName = (await listSpaces(svc, venue.id, deps)).spaces.find((s) => s.id === input.spaceId)?.name ?? 'Space';
    const made: { id: string; date: string; status: string; checkoutUrl: string | null }[] = [];
    const failed: string[] = [];
    for (const d of free) {
      try {
        const data = await wa(
          svc,
          venue,
          '/bookings',
          {
            method: 'POST',
            body: {
              typeId: input.spaceId,
              date: d,
              startTime: input.startTime,
              hours: input.hours,
              customerName: input.name,
              customerPhone: input.phone,
              chabukaUserId: userId,
              partnerRef: { groupId, matchId: input.matchId ?? null, teamId: input.teamId ?? null, fixtureId: input.fixtureId ?? null },
              ...(input.note ? { note: input.note } : {}),
            },
          },
          deps,
        );
        const facility = (data['facility'] ?? {}) as { startsAt?: string; endsAt?: string };
        const deposit = (data['deposit'] ?? null) as { dueBy?: string } | null;
        const { startsAt, endsAt } = windowFor(d, input.startTime, input.hours);
        const status = data['status'] === 'accepted' ? 'accepted' : 'pending';
        const { data: saved } = await svc
          .from('waitapp_bookings')
          .insert({
            venue_id: venue.id,
            user_id: userId,
            match_id: input.matchId ?? null,
            team_id: input.teamId ?? null,
            fixture_id: input.fixtureId ?? null,
            group_id: groupId,
            source: 'chabuka',
            customer_name: input.name,
            waitapp_reservation_id: String(data['reservationId'] ?? ''),
            booking_code: typeof data['bookingCode'] === 'string' ? data['bookingCode'] : null,
            space_id: input.spaceId,
            space_name: spaceName,
            starts_at: facility.startsAt ?? startsAt,
            ends_at: facility.endsAt ?? endsAt,
            total: typeof data['total'] === 'number' ? data['total'] : null,
            currency: typeof data['currency'] === 'string' ? data['currency'] : null,
            instant: data['instant'] === true,
            status,
            checkout_url: typeof data['checkoutUrl'] === 'string' ? data['checkoutUrl'] : null,
            deposit_due_by: deposit?.dueBy ?? null,
          })
          .select('id')
          .single();
        made.push({ id: (saved as { id: string } | null)?.id ?? '', date: d, status, checkoutUrl: status === 'accepted' && typeof data['checkoutUrl'] === 'string' ? (data['checkoutUrl'] as string) : null });
      } catch {
        failed.push(d);
      }
    }
    if (made.length === 0) throw new ActionError(409, 'The venue could not take that booking. Try another time.');
    if (venue.owner_id) {
      await notifyUsers([venue.owner_id], 'booking_requested', { venueId: venue.id, title: venue.name, startsAt: windowFor(free[0]!, input.startTime, input.hours).startsAt, weeks: made.length, who: myName, groupId });
    }
    return { state: 'requested', linked: true, groupId, made, failed };
  }

  const space = (await nativeSpaces(svc, venue.id)).find((s) => s.id === input.spaceId)!;
  const tee = isTee(space) ? space.tee : null;
  const players = tee ? (input.players ?? 1) : null;
  const teePrice = tee?.pricePerPlayer && players ? tee.pricePerPlayer * players : null;
  const rows = free.map((d) => {
    const { startsAt, endsAt } = tee ? teeWindow(d, input.startTime, tee) : windowFor(d, input.startTime, input.hours);
    return {
      venue_id: venue.id,
      space_id: space.id,
      starts_at: startsAt,
      ends_at: endsAt,
      requested_starts_at: startsAt,
      requester_id: userId,
      status: 'requested',
      source: 'player',
      group_id: groupId,
      team_id: input.teamId ?? null,
      match_id: input.matchId ?? null,
      fixture_id: input.fixtureId ?? null,
      note: input.note || null,
      pay_at_venue_amount: tee ? teePrice : space.hourly_price != null && space.hourly_price > 0 ? space.hourly_price * input.hours : null,
      currency: tee ? (teePrice ? (space.currency ?? 'ZMW') : null) : space.hourly_price != null && space.hourly_price > 0 ? space.currency : null,
      ...(players ? { players } : {}),
    };
  });
  const { data, error } = await svc.from('bookings').insert(rows).select('id');
  if (error) throw new ActionError(500, 'Could not send the request.');
  const managers = await managerIds(svc, venue);
  await notifyUsers(managers, 'booking_requested', {
    venueId: venue.id,
    title: venue.name,
    startsAt: rows[0]!.starts_at,
    weeks: rows.length,
    who: myName,
    spaceName: space.name,
    groupId,
  });
  return { state: 'requested', linked: false, groupId, made: ((data ?? []) as { id: string }[]).map((r, i) => ({ id: r.id, date: free[i]!, status: 'pending', checkoutUrl: null })), failed: [] };
}

async function managerIds(svc: SupabaseClient, venue: VenueRow): Promise<string[]> {
  const { data } = await svc.from('venue_staff').select('user_id').eq('venue_id', venue.id);
  return [...new Set([venue.owner_id, ...((data ?? []) as { user_id: string }[]).map((s) => s.user_id)].filter((x): x is string => !!x))];
}

async function issueTicket(svc: SupabaseClient, bookingId: string, userId: string): Promise<string> {
  const code = `CHB-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  await svc.from('tickets').insert({ booking_id: bookingId, user_id: userId, code, status: 'issued' });
  return code;
}

/** Owner or staff answer one request or a whole block. free_only confirms what still fits and declines the rest. */
export async function respondSpaceBooking(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = respondSpaceBookingSchema.parse(raw);
  const venue = await requireVenueManager(svc, input.venueId, userId);
  const now = deps.now ?? new Date();

  if (isLinked(venue)) {
    let ids: string[] = [];
    if (input.groupId) {
      const { data } = await svc.from('waitapp_bookings').select('waitapp_reservation_id,status,starts_at').eq('group_id', input.groupId).eq('venue_id', venue.id);
      ids = ((data ?? []) as { waitapp_reservation_id: string; status: string; starts_at: string }[])
        .filter((r) => r.status === 'pending' && new Date(r.starts_at) > now)
        .map((r) => r.waitapp_reservation_id);
    } else if (input.bookingId) ids = [input.bookingId];
    let confirmed = 0;
    let declined = 0;
    for (const id of ids) {
      const decision = input.decision === 'confirm' ? 'accept' : 'decline';
      try {
        await wa(svc, venue, `/bookings/${encodeURIComponent(id)}/respond`, { method: 'POST', body: { decision, ...(input.note ? { note: input.note } : {}) } }, deps);
        if (decision === 'accept') confirmed += 1;
        else declined += 1;
        await svc.from('waitapp_bookings').update({ status: decision === 'accept' ? 'accepted' : 'declined', updated_at: new Date().toISOString() }).eq('waitapp_reservation_id', id);
      } catch (err) {
        if (input.decision === 'confirm' && input.mode === 'free_only') {
          await wa(svc, venue, `/bookings/${encodeURIComponent(id)}/respond`, { method: 'POST', body: { decision: 'decline', note: 'That week is already taken.' } }, deps).catch(() => undefined);
          declined += 1;
        } else throw err;
      }
    }
    // WaitApp tells the player (with the payment link) and sends booking.* webhooks back to us.
    return { state: 'answered', confirmed, declined };
  }

  let rows: NativeBookingRow[] = [];
  if (input.groupId) {
    const { data } = await svc.from('bookings').select('*').eq('group_id', input.groupId).eq('venue_id', venue.id);
    rows = (data ?? []) as NativeBookingRow[];
  } else {
    const { data } = await svc.from('bookings').select('*').eq('id', input.bookingId!).eq('venue_id', venue.id);
    rows = (data ?? []) as NativeBookingRow[];
  }
  rows = rows.filter((r) => r.status === 'requested' && r.space_id && r.ends_at && new Date(r.ends_at) > now);
  if (rows.length === 0) throw new ActionError(409, 'There is nothing waiting to answer here.');
  const stamp = { decided_by: userId, decided_at: new Date().toISOString(), owner_note: input.note || null };

  if (input.decision === 'decline') {
    for (const r of rows) await svc.from('bookings').update({ status: 'declined', ...stamp }).eq('id', r.id);
    await notifyUsers([rows[0]!.requester_id], 'booking_answered', { venueId: venue.id, title: venue.name, decision: 'decline', confirmed: 0, declined: rows.length, note: input.note ?? null, startsAt: rows[0]!.starts_at });
    return { state: 'answered', confirmed: 0, declined: rows.length };
  }

  const spaces = await nativeSpaces(svc, venue.id, true);
  const plan: { row: NativeBookingRow; unit: string | null }[] = [];
  for (const r of rows.sort((a, b) => a.starts_at!.localeCompare(b.starts_at!))) {
    const space = spaces.find((s) => s.id === r.space_id);
    if (space && isTee(space)) {
      // A tee time holds up to playersPerSlot golfers across all its bookings (earlier confirmations in this batch count).
      const already = await teePlayersAt(svc, venue, space.id, r.starts_at!, r.ends_at!, r.id);
      const inBatch = plan.filter((p) => p.unit && p.row.space_id === space.id && p.row.starts_at === r.starts_at).reduce((n, p) => n + (p.row.players ?? 1), 0);
      plan.push({ row: r, unit: already + inBatch + (r.players ?? 1) <= space.tee.playersPerSlot ? '1' : null });
      continue;
    }
    plan.push({ row: r, unit: space ? await freeUnitNative(svc, venue, space, r.starts_at!, r.ends_at!, r.id) : null });
  }
  const clashing = plan.filter((p) => !p.unit);
  if (clashing.length > 0 && input.mode === 'all') {
    throw new ActionError(409, `${clashing.length} of these ${plan.length} times are no longer free. Accept the free ones instead, or decline.`);
  }
  let confirmed = 0;
  for (const p of plan) {
    if (p.unit) {
      const { error } = await svc.from('bookings').update({ status: 'confirmed', unit_no: Number(p.unit), ...stamp }).eq('id', p.row.id);
      if (error) throw new ActionError(500, 'Could not confirm the booking.');
      await issueTicket(svc, p.row.id, p.row.requester_id);
      confirmed += 1;
    } else {
      await svc.from('bookings').update({ status: 'declined', ...stamp, owner_note: input.note || 'That time is already taken.' }).eq('id', p.row.id);
    }
  }
  await notifyUsers([rows[0]!.requester_id], 'booking_answered', {
    venueId: venue.id,
    title: venue.name,
    decision: 'confirm',
    confirmed,
    declined: plan.length - confirmed,
    note: input.note ?? null,
    startsAt: rows[0]!.starts_at,
  });
  return { state: 'answered', confirmed, declined: plan.length - confirmed };
}

async function cancelNative(svc: SupabaseClient, rows: NativeBookingRow[], actorId: string, reason: string | null, byVenue: boolean, venue: VenueRow) {
  for (const r of rows) {
    await svc.from('bookings').update({ status: 'cancelled', cancelled_reason: reason }).eq('id', r.id);
    await svc.from('tickets').update({ status: 'cancelled' }).eq('booking_id', r.id).eq('status', 'issued');
  }
  if (byVenue) {
    const byPlayer = new Map<string, NativeBookingRow[]>();
    for (const r of rows.filter((x) => x.source !== 'owner')) byPlayer.set(r.requester_id, [...(byPlayer.get(r.requester_id) ?? []), r]);
    for (const [player, list] of byPlayer) {
      await notifyUsers([player], 'booking_cancelled_by_venue', { venueId: venue.id, title: venue.name, count: list.length, reason, startsAt: list[0]!.starts_at });
    }
  } else {
    const managers = (await managerIds(svc, venue)).filter((m) => m !== actorId);
    await notifyUsers(managers, 'booking_cancelled_by_player', { venueId: venue.id, title: venue.name, count: rows.length, startsAt: rows[0]?.starts_at ?? null });
  }
}

/** The player cancels a booking or the rest of a block; the venue can cancel too (the player is told why). */
export async function cancelSpaceBooking(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = cancelSpaceBookingSchema.parse(raw);
  const now = deps.now ?? new Date();
  // Linked bookings live in waitapp_bookings; cancelling goes through WaitApp so refunds follow its rules.
  type WaRow = { id: string; venue_id: string; user_id: string | null; waitapp_reservation_id: string; status: string; starts_at: string };
  const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
  let waRows: WaRow[] = [];
  if (input.groupId) {
    const { data } = await svc.from('waitapp_bookings').select('*').eq('group_id', input.groupId);
    waRows = (data ?? []) as WaRow[];
  } else {
    if (isUuid(input.bookingId!)) {
      const { data } = await svc.from('waitapp_bookings').select('*').eq('id', input.bookingId!);
      waRows = (data ?? []) as WaRow[];
    }
    if (waRows.length === 0) {
      const { data } = await svc.from('waitapp_bookings').select('*').eq('waitapp_reservation_id', input.bookingId!);
      waRows = (data ?? []) as WaRow[];
    }
  }
  const linkedRows = waRows.filter((r) => ['pending', 'accepted', 'paid'].includes(r.status) && new Date(r.starts_at) > now);
  // A booking made on WaitApp's side that Chabuka has no row for: the venue can still cancel it from its calendar.
  if (linkedRows.length === 0 && input.venueId && input.bookingId && !isUuid(input.bookingId)) {
    const venue = await requireVenueManager(svc, input.venueId, userId);
    if (!isLinked(venue)) throw new ActionError(404, 'Booking not found.');
    await wa(svc, venue, `/bookings/${encodeURIComponent(input.bookingId)}/cancel`, { method: 'POST', body: { reason: input.reason ?? null, by: 'venue' } }, deps);
    return { state: 'cancelled', count: 1 };
  }
  if (linkedRows.length > 0) {
    const venue = await loadVenueRow(svc, linkedRows[0]!.venue_id);
    const mine = linkedRows.every((r) => r.user_id === userId);
    if (!mine && !(await isVenueManager(svc, venue, userId))) throw new ActionError(403, 'Only the person who booked or the venue can cancel it.');
    for (const r of linkedRows) {
      await wa(svc, venue, `/bookings/${encodeURIComponent(r.waitapp_reservation_id)}/cancel`, { method: 'POST', body: { reason: input.reason ?? null, by: mine ? 'guest' : 'venue' } }, deps);
      await svc.from('waitapp_bookings').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', r.id);
    }
    return { state: 'cancelled', count: linkedRows.length };
  }
  if (!input.groupId && !isUuid(input.bookingId!)) throw new ActionError(404, 'Booking not found.');
  const q = input.groupId ? svc.from('bookings').select('*').eq('group_id', input.groupId) : svc.from('bookings').select('*').eq('id', input.bookingId!);
  const { data } = await q;
  const rows = ((data ?? []) as NativeBookingRow[]).filter((r) => LIVE.includes(r.status) && (!r.starts_at || new Date(r.starts_at) > now));
  if (rows.length === 0) throw new ActionError(409, 'There is nothing left to cancel.');
  const venue = await loadVenueRow(svc, rows[0]!.venue_id);
  const mine = rows.every((r) => r.requester_id === userId && r.source !== 'owner');
  const manager = await isVenueManager(svc, venue, userId);
  if (!mine && !manager) throw new ActionError(403, 'Only the person who booked or the venue can cancel it.');
  await cancelNative(svc, rows, userId, input.reason ?? null, !mine, venue);
  return { state: 'cancelled', count: rows.length };
}

export async function checkInSpaceBooking(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = checkInSpaceBookingSchema.parse(raw);
  const venue = await requireVenueManager(svc, input.venueId, userId);
  if (isLinked(venue)) throw new ActionError(409, 'This venue checks people in on WaitApp. Use the WaitApp scanner.');
  const { data } = await svc.from('bookings').select('id,venue_id,status,checked_in_at').eq('id', input.bookingId).maybeSingle();
  const b = data as { id: string; venue_id: string; status: string; checked_in_at: string | null } | null;
  if (!b || b.venue_id !== venue.id) throw new ActionError(404, 'Booking not found.');
  if (b.status !== 'confirmed') throw new ActionError(409, 'Only a confirmed booking can be checked in.');
  if (b.checked_in_at) return { state: 'already_checked_in' };
  await svc.from('bookings').update({ checked_in_at: new Date().toISOString() }).eq('id', b.id);
  await svc.from('tickets').update({ status: 'used' }).eq('booking_id', b.id).eq('status', 'issued');
  return { state: 'checked_in' };
}

// --- Staff --------------------------------------------------------------------------------

export async function addStaff(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = venueStaffSchema.parse(raw);
  const venue = await requireOwner(svc, input.venueId, userId);
  const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const match = (list?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === input.email.toLowerCase());
  if (!match) throw new ActionError(404, 'No Chabuka account uses that email yet. Ask them to sign up first.');
  if (match.id === venue.owner_id) throw new ActionError(409, 'That is you: the owner can already do everything.');
  const { error } = await svc.from('venue_staff').upsert({ venue_id: venue.id, user_id: match.id, role: 'manager', added_by: userId });
  if (error) throw new ActionError(500, 'Could not add them.');
  await notifyUsers([match.id], 'venue_staff_added', { venueId: venue.id, title: venue.name });
  return { state: 'added', userId: match.id };
}

export async function removeStaff(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = removeVenueStaffSchema.parse(raw);
  const venue = await requireOwner(svc, input.venueId, userId);
  const { error } = await svc.from('venue_staff').delete().eq('venue_id', venue.id).eq('user_id', input.userId);
  if (error) throw new ActionError(500, 'Could not remove them.');
  return { state: 'removed' };
}

export async function listStaff(svc: SupabaseClient, userId: string, venueId: string) {
  const venue = await requireVenueManager(svc, venueId, userId);
  const { data } = await svc.from('venue_staff').select('user_id,role,created_at').eq('venue_id', venue.id);
  const rows = (data ?? []) as { user_id: string; role: string; created_at: string }[];
  const names = await namesFor(svc, [...rows.map((r) => r.user_id), venue.owner_id ?? '']);
  return {
    owner: venue.owner_id ? { userId: venue.owner_id, name: names.get(venue.owner_id) ?? 'Owner' } : null,
    staff: rows.map((r) => ({ userId: r.user_id, name: names.get(r.user_id) ?? 'Manager', role: r.role, since: r.created_at })),
    canManageStaff: venue.owner_id === userId,
  };
}

/** Venues the user owns or helps run, for "My venues". */
export async function myVenues(svc: SupabaseClient, userId: string) {
  const { data: owned } = await svc.from('venues').select('id,name,area,status,photos,waitapp_restaurant_id').eq('owner_id', userId);
  const { data: staffRows } = await svc.from('venue_staff').select('venue_id').eq('user_id', userId);
  const staffIds = ((staffRows ?? []) as { venue_id: string }[]).map((r) => r.venue_id);
  let managed: unknown[] = [];
  if (staffIds.length > 0) {
    const { data } = await svc.from('venues').select('id,name,area,status,photos,waitapp_restaurant_id').in('id', staffIds);
    managed = data ?? [];
  }
  type Row = { id: string; name: string; area: string | null; status: string; photos: string[] | null; waitapp_restaurant_id: string | null };
  const all = [
    ...((owned ?? []) as Row[]).map((v) => ({ ...v, role: 'owner' as const })),
    ...(managed as Row[]).map((v) => ({ ...v, role: 'manager' as const })),
  ];
  const out = [];
  for (const v of all) {
    const { data: waiting } = await svc.from('bookings').select('id,starts_at').eq('venue_id', v.id).eq('status', 'requested');
    const now = Date.now();
    const pending = ((waiting ?? []) as { starts_at: string | null }[]).filter((b) => !b.starts_at || new Date(b.starts_at).getTime() > now).length;
    out.push({ id: v.id, name: v.name, area: v.area, status: v.status, photo: v.photos?.[0] ?? null, linked: !!v.waitapp_restaurant_id, role: v.role, waiting: pending });
  }
  return out;
}

/** My bookings across both homes, newest first. */
export async function myBookings(svc: SupabaseClient, userId: string) {
  const { data: native } = await svc.from('bookings').select('*').eq('requester_id', userId).eq('source', 'player').order('created_at', { ascending: false }).limit(100);
  const rows = ((native ?? []) as (NativeBookingRow & { created_at?: string })[]).filter((r) => r.space_id && r.starts_at);
  const venueIds = [...new Set(rows.map((r) => r.venue_id))];
  const spaceIds = [...new Set(rows.map((r) => r.space_id!))];
  const vNames = new Map<string, string>();
  const sNames = new Map<string, string>();
  if (venueIds.length) {
    const { data } = await svc.from('venues').select('id,name').in('id', venueIds);
    for (const v of (data ?? []) as { id: string; name: string }[]) vNames.set(v.id, v.name);
  }
  if (spaceIds.length) {
    const { data } = await svc.from('venue_spaces').select('id,name').in('id', spaceIds);
    for (const s of (data ?? []) as { id: string; name: string }[]) sNames.set(s.id, s.name);
  }
  const ids = rows.map((r) => r.id);
  const codes = new Map<string, string>();
  if (ids.length) {
    const { data } = await svc.from('tickets').select('booking_id,code,status').in('booking_id', ids);
    for (const t of (data ?? []) as { booking_id: string; code: string; status: string }[]) if (t.status !== 'cancelled') codes.set(t.booking_id, t.code);
  }
  const { data: waRows } = await svc.from('waitapp_bookings').select('*').eq('user_id', userId).order('starts_at', { ascending: false }).limit(100);
  const waList = (waRows ?? []) as {
    id: string;
    venue_id: string;
    space_name: string;
    starts_at: string;
    ends_at: string;
    status: string;
    booking_code: string | null;
    total: number | string | null;
    currency: string | null;
    checkout_url: string | null;
    group_id: string | null;
  }[];
  for (const v of waList) if (!vNames.has(v.venue_id)) vNames.set(v.venue_id, '');
  const missing = waList.map((w) => w.venue_id).filter((id) => !vNames.get(id));
  if (missing.length) {
    const { data } = await svc.from('venues').select('id,name').in('id', [...new Set(missing)]);
    for (const v of (data ?? []) as { id: string; name: string }[]) vNames.set(v.id, v.name);
  }
  const list = [
    ...rows.map((r) => ({
      id: r.id,
      home: 'chabuka' as const,
      venueId: r.venue_id,
      venueName: vNames.get(r.venue_id) ?? 'Venue',
      spaceName: sNames.get(r.space_id!) ?? 'Space',
      startsAt: r.starts_at!,
      endsAt: r.ends_at!,
      status: r.status,
      code: codes.get(r.id) ?? null,
      groupId: r.group_id,
      payLine: r.pay_at_venue_amount != null ? `${r.currency ?? ''} ${Number(r.pay_at_venue_amount)} at the venue`.trim() : null,
      checkoutUrl: null as string | null,
    })),
    ...waList.map((w) => ({
      id: w.id,
      home: 'waitapp' as const,
      venueId: w.venue_id,
      venueName: vNames.get(w.venue_id) ?? 'Venue',
      spaceName: w.space_name,
      startsAt: w.starts_at,
      endsAt: w.ends_at,
      status: w.status === 'pending' ? 'requested' : w.status === 'accepted' || w.status === 'paid' ? 'confirmed' : w.status,
      code: w.booking_code,
      groupId: w.group_id,
      payLine: w.total != null ? `${w.currency ?? ''} ${Number(w.total)}${w.status === 'paid' ? ', paid' : ''}`.trim() : null,
      checkoutUrl: w.status === 'accepted' ? w.checkout_url : null,
    })),
  ];
  return list.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

// --- Linking: copy to WaitApp, pull back ---------------------------------------------------------

/**
 * After the owner links a WaitApp Bookable Venue: copy Chabuka's spaces, hours, closures and future confirmed bookings
 * across so nothing is lost, then WaitApp is the calendar. Best effort per item; returns what moved.
 */
export async function copyVenueToWaitApp(svc: SupabaseClient, venue: VenueRow, deps: Deps = {}) {
  const now = (deps.now ?? new Date()).toISOString();
  const result = { spaces: 0, closures: 0, bookings: 0, failed: 0 };
  const spaces = (await nativeSpaces(svc, venue.id, true)).filter((s) => !isTee(s));
  const map = new Map<string, string>();
  for (const s of spaces) {
    try {
      const data = await wa(
        svc,
        venue,
        '/spaces',
        {
          method: 'PUT',
          body: {
            ...(s.waitapp_type_id ? { id: s.waitapp_type_id } : {}),
            name: s.name,
            description: [s.surface, s.size_note].filter(Boolean).join(', ') || null,
            unitCount: s.unit_count,
            basePrice: s.hourly_price ?? 0,
            ...(s.currency ? { currency: s.currency } : {}),
            bookingMode: 'request',
            images: s.photos,
            isActive: s.active,
          },
        },
        deps,
      );
      const typeId = String(data['id'] ?? '');
      if (typeId) {
        map.set(s.id, typeId);
        await svc.from('venue_spaces').update({ waitapp_type_id: typeId }).eq('id', s.id);
        result.spaces += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  if (venue.opening_hours && Object.keys(venue.opening_hours).length > 0) {
    await wa(svc, venue, '/hours', { method: 'PUT', body: { operatingHours: venue.opening_hours } }, deps).catch(() => {
      result.failed += 1;
    });
  }
  const far = new Date(Date.now() + 365 * 86_400_000).toISOString();
  for (const c of await nativeClosures(svc, venue.id, now, far)) {
    try {
      await wa(svc, venue, '/closures', { method: 'POST', body: { typeId: c.space_id ? (map.get(c.space_id) ?? null) : null, startsAt: c.starts_at, endsAt: c.ends_at, reason: c.reason ?? 'Closed', cancelBookings: false } }, deps);
      result.closures += 1;
    } catch {
      result.failed += 1;
    }
  }
  const future = (await nativeBookings(svc, venue.id, now, far)).filter((b) => b.status === 'confirmed' && b.space_id && map.has(b.space_id));
  const names = await namesFor(svc, future.map((b) => b.requester_id));
  for (const b of future) {
    try {
      const hours = Math.max(1, Math.round((new Date(b.ends_at!).getTime() - new Date(b.starts_at!).getTime()) / 3_600_000));
      await wa(
        svc,
        venue,
        '/bookings/walk-in',
        {
          method: 'POST',
          body: {
            typeId: map.get(b.space_id!),
            date: venueYmd(b.starts_at!),
            startTime: venueTime(b.starts_at!),
            hours,
            customerName: b.source === 'owner' ? (b.guest_name ?? 'Guest') : (names.get(b.requester_id) ?? 'Chabuka player'),
            ...(b.guest_phone ? { customerPhone: b.guest_phone } : {}),
            note: 'Booked on Chabuka before the venue linked WaitApp. Pay at the venue.',
            ...(b.source !== 'owner' ? { chabukaUserId: b.requester_id } : {}),
          },
        },
        deps,
      );
      result.bookings += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

/** After unlinking: refresh Chabuka's own spaces and hours from WaitApp so the venue keeps working here. */
export async function pullVenueFromWaitApp(svc: SupabaseClient, venue: VenueRow, deps: Deps = {}) {
  const data = await wa(svc, venue, '/spaces', { method: 'GET' }, deps);
  const hours = ((data['venue'] ?? {}) as { operatingHours?: WeeklyHours | null }).operatingHours ?? null;
  const remote = Array.isArray(data['spaces']) ? (data['spaces'] as WaSpace[]) : [];
  const local = await nativeSpaces(svc, venue.id, true);
  let pulled = 0;
  for (const [i, s] of remote.entries()) {
    const view = fromWaSpace(s, venue);
    const row = {
      venue_id: venue.id,
      name: view.name.slice(0, 60),
      unit_count: Math.min(20, view.unit_count),
      hourly_price: view.hourly_price,
      currency: view.currency,
      booking_mode: 'request',
      photos: view.photos.slice(0, 6),
      active: true,
      waitapp_type_id: s.id,
      updated_at: new Date().toISOString(),
    };
    const existing = local.find((l) => l.waitapp_type_id === s.id);
    if (existing) await svc.from('venue_spaces').update(row).eq('id', existing.id);
    else await svc.from('venue_spaces').insert({ ...row, sports: venue.sports ?? [], sort: local.length + i });
    pulled += 1;
  }
  if (hours) await svc.from('venues').update({ opening_hours: hours }).eq('id', venue.id);
  return { spaces: pulled };
}
