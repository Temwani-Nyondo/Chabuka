import { API_BASE } from './api';
import { supabase } from './supabase';

// Ticketed games: WaitApp sells, issues and scans the tickets. These helpers
// only talk to Chabuka's own API; no payment details ever pass through here.

export interface MatchTicketing {
  match_id: string;
  waitapp_event_id: string;
  status: 'draft' | 'pending_review' | 'on_sale' | 'cancelled';
  checkout_url: string;
  currency: string;
  tiers: { name: string; price: number }[];
  sold_count: number;
  checked_in_count: number;
  refunded_count: number;
}

// What the signed-in player holds for one game. Read under RLS: only their own rows.
export interface MyTickets {
  total: number;
  checkedIn: number;
}

export interface WaitAppLink {
  restaurantId: string;
  organiserName: string | null;
  currency: string | null;
}

export interface TierInput {
  name: string;
  price: number;
  capacity?: number;
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

export async function getWaitAppLink(token: string): Promise<WaitAppLink | null> {
  return (await call<{ link: WaitAppLink | null }>('/api/waitapp/link', 'GET', token)).link;
}

export async function startWaitAppLink(token: string): Promise<string> {
  return (await call<{ url: string }>('/api/waitapp/connect-url', 'POST', token)).url;
}

export async function finishWaitAppLink(token: string, code: string, state: string): Promise<WaitAppLink> {
  return (await call<{ link: WaitAppLink }>('/api/waitapp/link', 'POST', token, { code, state })).link;
}

export async function unlinkWaitApp(token: string): Promise<void> {
  await call('/api/waitapp/link', 'DELETE', token);
}

export async function createTicketing(token: string, matchId: string, tiers: TierInput[]): Promise<void> {
  await call('/api/waitapp/ticketing', 'POST', token, { matchId, tiers });
}

export async function refreshTicketing(token: string, matchId: string): Promise<void> {
  await call('/api/waitapp/ticketing/refresh', 'POST', token, { matchId });
}

export async function claimTickets(token: string): Promise<void> {
  await call('/api/waitapp/claim', 'POST', token);
}

/** Ticketing rows for a set of games. Quietly empty if ticketing is not set up yet. */
export async function fetchTicketing(matchIds: string[]): Promise<Map<string, MatchTicketing>> {
  const out = new Map<string, MatchTicketing>();
  if (!supabase || matchIds.length === 0) return out;
  const { data, error } = await supabase.from('match_ticketing').select('*').in('match_id', matchIds);
  if (error) return out;
  for (const row of (data ?? []) as MatchTicketing[]) out.set(row.match_id, row);
  return out;
}

/** My own tickets per game (live ones only). Quietly empty if ticketing is not set up yet. */
export async function fetchMyTickets(matchIds: string[], userId: string): Promise<Map<string, MyTickets>> {
  const out = new Map<string, MyTickets>();
  if (!supabase || matchIds.length === 0) return out;
  const { data, error } = await supabase
    .from('ticket_orders')
    .select('match_id,status')
    .eq('user_id', userId)
    .in('match_id', matchIds)
    .in('status', ['valid', 'used']);
  if (error) return out;
  for (const row of (data ?? []) as { match_id: string; status: string }[]) {
    const cur = out.get(row.match_id) ?? { total: 0, checkedIn: 0 };
    cur.total += 1;
    if (row.status === 'used') cur.checkedIn += 1;
    out.set(row.match_id, cur);
  }
  return out;
}

/** WaitApp's page for finding a ticket (the QR also arrives by email or WhatsApp). */
export function ticketLookupUrl(ticketing: MatchTicketing): string {
  return `${new URL(ticketing.checkout_url).origin}/customer/tickets/lookup`;
}

/** The buyer's own Chabuka id rides along so the sale can be matched back to them. */
export function checkoutLink(ticketing: MatchTicketing, userId: string): string {
  const url = new URL(ticketing.checkout_url);
  url.searchParams.set('cref', `chabuka:${userId}`);
  return url.toString();
}

export function priceLabel(ticketing: MatchTicketing): string {
  const prices = ticketing.tiers.map((t) => t.price);
  if (prices.length === 0) return 'Tickets';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max <= 0) return 'Free ticket';
  const fmt = (n: number) => `${ticketing.currency} ${n % 1 === 0 ? n : n.toFixed(2)}`;
  return min === max ? fmt(min) : `${fmt(min)} - ${fmt(max)}`;
}

const RETURN_KEY = 'chabuka:ticketing-return';

export function rememberTicketingReturn(matchId: string): void {
  try {
    window.sessionStorage.setItem(RETURN_KEY, matchId);
  } catch {
    // Private mode: they land on Home instead.
  }
}

export function takeTicketingReturn(): string | null {
  try {
    const v = window.sessionStorage.getItem(RETURN_KEY);
    window.sessionStorage.removeItem(RETURN_KEY);
    return v;
  } catch {
    return null;
  }
}
