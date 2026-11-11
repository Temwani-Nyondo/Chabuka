import { API_BASE } from './api';

// Linked venues: spaces, availability and booking for a venue whose owner connected a WaitApp bookable-venue account.
// WaitApp holds the calendar and takes the payment; these helpers only talk to Chabuka's own API.

export interface VenueSpace {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  pricingUnit: 'hour' | 'session';
  price: number;
  currency: string;
  bookingMode: 'instant' | 'request';
  image: string | null;
}

export interface SpacesInfo {
  venue: { name: string; address: string | null; currency: string; operatingHours: Record<string, { open: string; close: string; closed?: boolean }> | null; bookingPage: string | null };
  spaces: VenueSpace[];
}

export interface SpaceSlot {
  start: string;
  startsAt: string;
  maxHours: number;
  unitsFree: number;
}

export interface SpaceAvailability {
  closed: boolean;
  bookingMode: 'instant' | 'request';
  pricingUnit: string;
  basePrice: number;
  currency: string | null;
  slots: SpaceSlot[];
}

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

async function call<T>(path: string, method: string, token: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Could not reach the Chabuka server. Is the API running?');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? 'Something went wrong. Try again.');
  return data as T;
}

export const fetchVenueSpaces = (token: string, venueId: string) => call<SpacesInfo>(`/api/venues/${venueId}/spaces`, 'GET', token);

export const fetchSpaceAvailability = (token: string, venueId: string, spaceId: string, date: string) =>
  call<SpaceAvailability>(`/api/venues/${venueId}/spaces/${encodeURIComponent(spaceId)}/availability?date=${date}`, 'GET', token);

export async function bookVenueSpace(
  token: string,
  venueId: string,
  input: { typeId: string; spaceName: string; date: string; startTime: string; hours: number; people?: number; name: string; phone: string; email?: string; matchId?: string },
): Promise<SpaceBooking> {
  return (await call<{ booking: SpaceBooking }>(`/api/venues/${venueId}/book-space`, 'POST', token, input)).booking;
}

export async function fetchMySpaceBookings(token: string): Promise<SpaceBooking[]> {
  return (await call<{ bookings: SpaceBooking[] }>('/api/my/space-bookings', 'GET', token)).bookings;
}

export const setVenueCalendarLink = (token: string, venueId: string, link: boolean) =>
  call<{ linked: boolean; spaceCount: number }>(`/api/venues/${venueId}/waitapp-calendar`, 'POST', token, { link });
