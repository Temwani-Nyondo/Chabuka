import { bookingSchema, ticketSchema, venueListSchema, venueSlotSchema } from '@chabuka/shared';
import type { Booking, Ticket, Venue, VenueSlot } from '@chabuka/shared';
import { supabase } from './supabase';

export type { Booking, Ticket, VenueSlot };

// Listed places to play, from the venues table (readable by any signed-in
// user). Sport filtering is by the venue's own sports list, matched loosely
// so 'Football' on a venue serves the Football sport in the form.
export async function fetchVenues(sportName?: string): Promise<Venue[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('venues')
    .select('id,owner_id,google_place_id,name,area,lat,lng,sports,facility_types,price_note,contact,photos')
    .order('name');
  if (error) throw new Error(error.message);
  const parsed = venueListSchema.safeParse(data ?? []);
  if (!parsed.success) throw new Error('Unexpected venue data from the server.');
  if (!sportName) return parsed.data;
  const wanted = sportName.toLowerCase();
  return parsed.data.filter((v) => v.sports.some((s) => s.toLowerCase() === wanted));
}

const VENUE_COLS = 'id,owner_id,google_place_id,name,area,lat,lng,sports,facility_types,price_note,contact,photos';

export async function fetchVenueById(venueId: string): Promise<Venue | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('venues').select(VENUE_COLS).eq('id', venueId).maybeSingle();
  const parsed = venueListSchema.safeParse(data ? [data] : []);
  return parsed.success ? (parsed.data[0] ?? null) : null;
}

export async function fetchVenueSlots(venueId: string): Promise<VenueSlot[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('venue_slots')
    .select('id,venue_id,starts_at,ends_at,capacity')
    .eq('venue_id', venueId)
    .gte('ends_at', new Date().toISOString())
    .order('starts_at');
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => venueSlotSchema.safeParse(r));
  return rows.filter((r): r is { success: true; data: VenueSlot } => r.success).map((r) => r.data);
}

export async function fetchMyBookings(userId: string): Promise<Booking[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('bookings')
    .select('id,venue_id,slot_id,match_id,requester_id,requested_starts_at,status')
    .eq('requester_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => bookingSchema.safeParse(r));
  return rows.filter((r): r is { success: true; data: Booking } => r.success).map((r) => r.data);
}

export async function fetchMyTickets(userId: string): Promise<Ticket[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('tickets')
    .select('id,booking_id,user_id,code,status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => ticketSchema.safeParse(r));
  return rows.filter((r): r is { success: true; data: Ticket } => r.success).map((r) => r.data);
}

export async function fetchMyVenues(userId: string): Promise<Venue[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('venues')
    .select(VENUE_COLS)
    .eq('owner_id', userId)
    .order('name');
  if (error) throw new Error(error.message);
  const parsed = venueListSchema.safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

export async function fetchVenueBookings(venueIds: string[]): Promise<Booking[]> {
  if (!supabase || venueIds.length === 0) return [];
  const { data, error } = await supabase
    .from('bookings')
    .select('id,venue_id,slot_id,match_id,requester_id,requested_starts_at,status')
    .in('venue_id', venueIds)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => bookingSchema.safeParse(r));
  return rows.filter((r): r is { success: true; data: Booking } => r.success).map((r) => r.data);
}

export async function fetchVenueTickets(bookingIds: string[]): Promise<Ticket[]> {
  if (!supabase || bookingIds.length === 0) return [];
  const { data, error } = await supabase
    .from('tickets')
    .select('id,booking_id,user_id,code,status')
    .in('booking_id', bookingIds);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => ticketSchema.safeParse(r));
  return rows.filter((r): r is { success: true; data: Ticket } => r.success).map((r) => r.data);
}
