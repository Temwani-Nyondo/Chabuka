import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';
import { decryptToken, encryptToken, signState } from './waitapp.js';

const copied = vi.fn(async () => ({ spaces: 2, closures: 0, bookings: 1, failed: 0 }));
vi.mock('./venueBooking.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./venueBooking.js')>()),
  copyVenueToWaitApp: (...a: unknown[]) => (copied as unknown as (...x: unknown[]) => unknown)(...a),
}));

import { buildVenueCard, completeVenueConnect, pushVenueProfile, startVenueConnect, venueIdFromState } from './venueHandshake.js';

const SECRET = 'test-partner-secret-0123456789';
const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const VENUE = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  process.env.WAITAPP_PARTNER_SECRET = SECRET;
  process.env.WAITAPP_TOKEN_KEY = crypto.randomBytes(32).toString('base64');
  process.env.WAITAPP_BASE_URL = 'https://waitapp.test';
  process.env.APP_URL = 'https://chabuka.test';
  copied.mockClear();
});

function world(opts: { status?: string; spaces?: number; linked?: boolean } = {}) {
  const t = {
    venues: new Map<string, Row>(),
    spaces: new Map<string, Row>(),
    profiles: new Map<string, Row>(),
    vlinks: new Map<string, Row>(),
  };
  t.venues.set(VENUE, {
    id: VENUE, name: 'Arena Five', area: 'Kabulonga', lat: -15.42, lng: 28.33, sports: ['Football'], facility_types: ['Floodlights'],
    photos: ['https://img.test/a.jpg', 'not-a-url'], contact: '0977000000', owner_id: OWNER, status: opts.status ?? 'approved',
    google_place_id: 'place-123', opening_hours: { mon: { open: '08:00', close: '22:00' }, xyz: { open: '1', close: '2' } },
    waitapp_restaurant_id: opts.linked ? 'rest-1' : null,
  });
  for (let i = 0; i < (opts.spaces ?? 2); i++) t.spaces.set(`s${i}`, { id: `s${i}`, venue_id: VENUE, active: true });
  t.profiles.set(OWNER, { id: OWNER, name: 'Test Owner' });
  if (opts.linked) t.vlinks.set(VENUE, { venue_id: VENUE, restaurant_id: 'rest-1', token_enc: encryptToken('cbk_venuetoken'), booking_page: null });
  const client = {
    from(table: string) {
      if (table === 'venues') return new FakeQuery(t.venues, (r) => String(r['id']));
      if (table === 'venue_spaces') return new FakeQuery(t.spaces, (r) => String(r['id']));
      if (table === 'profiles') return new FakeQuery(t.profiles, (r) => String(r['id']));
      if (table === 'venue_waitapp_links') return new FakeQuery(t.vlinks, (r) => String(r['venue_id']));
      throw new Error(`unexpected table ${table}`);
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@example.com' } } }) } },
  };
  return { client: client as never, t };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the venue card', () => {
  it("is built from the venue's own Google data, trimmed to what WaitApp accepts", () => {
    const w = world();
    const card = buildVenueCard(w.t.venues.get(VENUE) as never, 2, { name: 'Test Owner', email: 'owner@example.com' });
    expect(card).toMatchObject({
      chabukaVenueId: VENUE, name: 'Arena Five', googlePlaceId: 'place-123', lat: -15.42, lng: 28.33,
      sports: ['Football'], facilities: ['Floodlights'], photos: ['https://img.test/a.jpg'], spaceCount: 2,
      ownerName: 'Test Owner', ownerEmail: 'owner@example.com',
    });
    expect(card['hours']).toEqual({ mon: { open: '08:00', close: '22:00' } });
  });
});

describe('starting the handshake', () => {
  it('only the owner, only an approved venue, and only with a space', async () => {
    const fetch = vi.fn(async () => json(200, { handshakeId: 'h1' }));
    await expect(startVenueConnect(world().client, STRANGER, VENUE, { fetch: fetch as never })).rejects.toMatchObject({ status: 403 });
    await expect(startVenueConnect(world({ status: 'pending' }).client, OWNER, VENUE, { fetch: fetch as never })).rejects.toMatchObject({ status: 409 });
    await expect(startVenueConnect(world({ spaces: 0 }).client, OWNER, VENUE, { fetch: fetch as never })).rejects.toMatchObject({ status: 409 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the card with the partner secret and returns the WaitApp page for this venue', async () => {
    const fetch = vi.fn(async (_u: string, _i: { headers: Record<string, string>; body: string }) => json(200, { handshakeId: 'h1' }));
    const { url } = await startVenueConnect(world().client, OWNER, VENUE, { fetch: fetch as never });
    const [sentUrl, init] = fetch.mock.calls[0]!;
    expect(sentUrl).toBe('https://waitapp.test/api/partner/chabuka/venue-connect/prepare');
    expect(init.headers['x-partner-secret']).toBe(SECRET);
    expect(JSON.parse(init.body)).toMatchObject({ googlePlaceId: 'place-123', ownerEmail: 'owner@example.com' });
    const u = new URL(url);
    expect(u.pathname).toBe('/connect/chabuka-venue');
    expect(u.searchParams.get('h')).toBe('h1');
    expect(u.searchParams.get('redirect')).toBe('https://chabuka.test/venues/waitapp/return');
    expect(venueIdFromState(u.searchParams.get('state')!, OWNER)).toBe(VENUE);
    expect(venueIdFromState(u.searchParams.get('state')!, STRANGER)).toBeNull();
  });
});

describe('completing the handshake', () => {
  const state = () => signState(`${OWNER}:${VENUE}`);

  it('refuses a state that is not a venue state for this person', async () => {
    await expect(completeVenueConnect(world().client, OWNER, 'code-123456', signState(OWNER))).rejects.toMatchObject({ status: 400 });
    await expect(completeVenueConnect(world().client, STRANGER, 'code-123456', state())).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a WaitApp account that is not a venue account', async () => {
    const w = world();
    const fetch = vi.fn(async () => json(200, { token: 'cbk_x', restaurantId: 'rest-1', venueType: 'restaurant' }));
    await expect(completeVenueConnect(w.client, OWNER, 'code-123456', state(), { fetch: fetch as never })).rejects.toMatchObject({ status: 409 });
    expect(w.t.vlinks.size).toBe(0);
  });

  it('stores the link on the venue and copies the venue across', async () => {
    const w = world();
    const fetch = vi.fn(async () => json(200, { token: 'cbk_new', restaurantId: 'rest-7', venueType: 'bookable_venue', bookingPage: 'https://waitapp.test/book/arena-five' }));
    const r = await completeVenueConnect(w.client, OWNER, 'code-123456', state(), { fetch: fetch as never });
    expect(r).toMatchObject({ venueId: VENUE, restaurantId: 'rest-7', bookingPage: 'https://waitapp.test/book/arena-five' });
    const link = w.t.vlinks.get(VENUE)!;
    expect(decryptToken(String(link['token_enc']))).toBe('cbk_new');
    expect(link['linked_by']).toBe(OWNER);
    expect(w.t.venues.get(VENUE)!['waitapp_restaurant_id']).toBe('rest-7');
    expect(copied).toHaveBeenCalledTimes(1);
  });
});

describe('keeping the WaitApp profile in step', () => {
  it('pushes name, contact and photos with the venue token', async () => {
    const w = world({ linked: true });
    const fetch = vi.fn(async (_u: string, _i: { headers: Record<string, string>; body: string }) => json(200, { ok: true }));
    const venue = { id: VENUE, owner_id: OWNER, waitapp_restaurant_id: 'rest-1' };
    expect(await pushVenueProfile(w.client, venue, { name: 'Arena 5', photos: ['https://img.test/b.jpg', 'bad'] }, { fetch: fetch as never })).toBe(true);
    const [u, init] = fetch.mock.calls[0]!;
    expect(u).toBe('https://waitapp.test/api/partner/chabuka/venue');
    expect(init.headers['authorization']).toBe('Bearer cbk_venuetoken');
    expect(JSON.parse(init.body)).toEqual({ name: 'Arena 5', photos: ['https://img.test/b.jpg'] });
  });

  it('does nothing for a venue without its own link', async () => {
    const fetch = vi.fn();
    expect(await pushVenueProfile(world().client, { id: VENUE, owner_id: OWNER, waitapp_restaurant_id: 'rest-1' }, { name: 'X' }, { fetch: fetch as never })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
