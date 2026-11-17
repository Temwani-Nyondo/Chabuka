import type { SpaceSlot, WeeklyHours } from '@chabuka/shared';
import { API_BASE } from './api';

// Venue booking (Phase 4). The API answers the same way for a Chabuka-only venue and a WaitApp-linked one, so these
// screens never need to know where the venue's calendar lives.

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
  booking_kind?: 'hourly' | 'tee';
  tee?: { intervalMin: number; playersPerSlot: number; pricePerPlayer?: number | null } | null;
}

export interface ClosureView {
  id: string;
  space_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

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

export interface SpacesResult {
  linked: boolean;
  hours: WeeklyHours;
  bookingPage: string | null;
  spaces: SpaceView[];
}

export interface AvailabilityView {
  date: string;
  closed: boolean;
  bookingMode: 'request' | 'instant';
  price: number | null;
  currency: string | null;
  linked: boolean;
  slots: SpaceSlot[];
  /** Golf tee sheet: price is per player and each slot's unitsFree is spots left. */
  tee?: { intervalMin: number; playersPerSlot: number; pricePerPlayer?: number | null };
}

export interface CalendarView {
  linked: boolean;
  hours: WeeklyHours;
  spaces: SpaceView[];
  closures: ClosureView[];
  bookings: CalBooking[];
  teams: Record<string, string>;
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
  clashes: string[];
  note: string | null;
  matchId: string | null;
  fixtureId: string | null;
  source: CalBooking['source'];
}

export interface VenueStats {
  weekStart: string;
  thisWeekHours: number;
  lastWeekHours: number;
  openHours: number;
  fillRate: number;
  waiting: number;
  busiest: { hour: string; count: number }[];
}

export interface StaffView {
  owner: { userId: string; name: string } | null;
  staff: { userId: string; name: string; role: string; since: string }[];
  canManageStaff: boolean;
}

export interface MyVenue {
  id: string;
  name: string;
  area: string | null;
  status: string;
  photo: string | null;
  linked: boolean;
  role: 'owner' | 'manager';
  waiting: number;
}

export interface MyBooking {
  id: string;
  home: 'chabuka' | 'waitapp';
  venueId: string;
  venueName: string;
  spaceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  code: string | null;
  groupId: string | null;
  payLine: string | null;
  checkoutUrl: string | null;
}

async function get<T>(path: string, token: string, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Could not reach the Chabuka server.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? fallback);
  return data as T;
}

export const fetchSpaces = (token: string, venueId: string) => get<SpacesResult>(`/api/venues/${venueId}/booking/spaces`, token, 'Could not load the spaces.');

export const fetchAvailability = (token: string, venueId: string, spaceId: string, date: string) =>
  get<AvailabilityView>(`/api/venues/${venueId}/booking/availability?spaceId=${encodeURIComponent(spaceId)}&date=${date}`, token, 'Could not load free times.');

export const fetchCalendar = (token: string, venueId: string, from: string, days: number) =>
  get<CalendarView>(`/api/venues/${venueId}/booking/calendar?from=${from}&days=${days}`, token, 'Could not load the calendar.');

export const fetchRequests = (token: string, venueId: string) =>
  get<{ requests: RequestCard[] }>(`/api/venues/${venueId}/booking/requests`, token, 'Could not load requests.').then((r) => r.requests);

export const fetchToday = (token: string, venueId: string) =>
  get<{ date: string; linked: boolean; spaces: SpaceView[]; bookings: CalBooking[]; teams: Record<string, string> }>(
    `/api/venues/${venueId}/booking/today`,
    token,
    "Could not load today's bookings.",
  );

export const fetchStats = (token: string, venueId: string) => get<VenueStats>(`/api/venues/${venueId}/booking/stats`, token, 'Could not load the numbers.');

export const fetchStaff = (token: string, venueId: string) => get<StaffView>(`/api/venues/${venueId}/booking/staff`, token, 'Could not load staff.');

export const fetchMyVenues = (token: string) => get<{ venues: MyVenue[] }>('/api/my/venues', token, 'Could not load your venues.').then((r) => r.venues);

export const fetchMyBookingsAll = (token: string) => get<{ bookings: MyBooking[] }>('/api/my/bookings', token, 'Could not load your bookings.').then((r) => r.bookings);

// --- Venue handshake: "Take paid bookings online" -------------------------------------

async function postJson<T>(path: string, token: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? fallback);
  return data;
}

export interface WaitAppVenueInfo { bookingPage: string | null; perVenue: boolean }
export const fetchWaitAppInfo = (token: string, venueId: string) =>
  get<WaitAppVenueInfo>(`/api/venues/${venueId}/waitapp`, token, 'Could not load the WaitApp link.');

/** Starts the handshake; the browser then goes to the returned WaitApp page. */
export const startWaitAppConnect = (token: string, venueId: string) =>
  postJson<{ url: string }>(`/api/venues/${venueId}/waitapp/start`, token, {}, 'Could not start the WaitApp link.');

export interface WaitAppConnectResult {
  venueId: string;
  restaurantId: string;
  bookingPage: string | null;
  copied: { spaces: number; closures: number; bookings: number; failed: number } | null;
}
export const completeWaitAppConnect = (token: string, code: string, state: string) =>
  postJson<WaitAppConnectResult>('/api/venues/waitapp/complete', token, { code, state }, 'Could not finish the WaitApp link.');

export async function setWaitAppLink(token: string, venueId: string, link: boolean) {
  const res = await fetch(`${API_BASE}/api/venues/${venueId}/waitapp-calendar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ link }),
  });
  const data = (await res.json().catch(() => null)) as
    | { linked: boolean; spaceCount: number; copied?: { spaces: number; closures: number; bookings: number; failed: number } | null; error?: string }
    | null;
  if (!res.ok) throw new Error(data?.error ?? 'Could not change the WaitApp link.');
  return data!;
}

/** "Sat 21 Nov" for a YYYY-MM-DD venue date. */
export function dayChip(ymd: string): { dow: string; day: string; month: string } {
  const d = new Date(`${ymd}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
    day: String(d.getUTCDate()),
    month: d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }),
  };
}

export function longDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}
