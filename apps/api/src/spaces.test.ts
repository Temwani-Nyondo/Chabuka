import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';
import { encryptToken, handleWebhook } from './waitapp.js';
import { bookSpace, getVenueAvailability, getVenueSpaces, listMySpaceBookings, setVenueCalendarLink } from './spaces.js';

const SECRET = 'test-partner-secret-0123456789';
const OWNER = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const VENUE = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  process.env.WAITAPP_PARTNER_SECRET = SECRET;
  process.env.WAITAPP_TOKEN_KEY = crypto.randomBytes(32).toString('base64');
  process.env.WAITAPP_BASE_URL = 'https://waitapp.test';
});

function world(opts: { linked?: boolean; approved?: boolean; waitappLink?: boolean } = {}) {
  const t = {
    venues: new Map<string, Row>(),
    links: new Map<string, Row>(),
    bookings: new Map<string, Row>(),
    matches: new Map<string, Row>(),
    participants: new Map<string, Row>(),
  };
  t.venues.set(VENUE, {
    id: VENUE, name: 'Matero Courts', owner_id: OWNER, status: opts.approved === false ? 'pending' : 'approved',
    waitapp_restaurant_id: opts.linked === false ? null : 'rest-1',
  });
  if (opts.waitappLink !== false) {
    t.links.set(OWNER, { user_id: OWNER, restaurant_id: 'rest-1', token_enc: encryptToken('cbk_ownertoken'), organiser_name: 'Matero', currency: 'ZMW' });
  }
  const client = {
    from(table: string) {
      if (table === 'venues') return new FakeQuery(t.venues, (r) => String(r['id']));
      if (table === 'waitapp_links') return new FakeQuery(t.links, (r) => String(r['user_id']));
      if (table === 'matches') return new FakeQuery(t.matches, (r) => String(r['id']));
      if (table === 'match_participants') return new FakeQuery(t.participants, (r) => `${String(r['match_id'])}:${String(r['user_id'])}`);
      if (table === 'waitapp_bookings') return new FakeQuery(t.bookings, (r) => String(r['id']));
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, t };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('linking a venue to its WaitApp calendar', () => {
  it('only the owner can, and only with a connected WaitApp account', async () => {
    const w = world({ linked: false });
    await expect(setVenueCalendarLink(w.client, STRANGER, VENUE, true)).rejects.toMatchObject({ status: 403 });
    const none = world({ linked: false, waitappLink: false });
    await expect(setVenueCalendarLink(none.client, OWNER, VENUE, true)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a WaitApp account that is not a bookable venue', async () => {
    const w = world({ linked: false });
    const fetch = vi.fn(async () => json(409, { error: 'This account is not a bookable venue.' }));
    await expect(setVenueCalendarLink(w.client, OWNER, VENUE, true, { fetch: fetch as never })).rejects.toMatchObject({ status: 409 });
    expect(w.t.venues.get(VENUE)!['waitapp_restaurant_id']).toBeNull();
  });

  it('links a real bookable venue and can unlink again', async () => {
    const w = world({ linked: false });
    const fetch = vi.fn(async () => json(200, { spaces: [{ id: 's1' }, { id: 's2' }] }));
    const r = await setVenueCalendarLink(w.client, OWNER, VENUE, true, { fetch: fetch as never });
    expect(r).toEqual({ linked: true, spaceCount: 2 });
    expect(w.t.venues.get(VENUE)!['waitapp_restaurant_id']).toBe('rest-1');
    const sent = (fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(sent.headers['authorization']).toBe('Bearer cbk_ownertoken');
    await setVenueCalendarLink(w.client, OWNER, VENUE, false);
    expect(w.t.venues.get(VENUE)!['waitapp_restaurant_id']).toBeNull();
  });
});

describe('reading a linked venue', () => {
  it('only an approved, linked venue is readable, and it uses the owner link', async () => {
    await expect(getVenueSpaces(world({ approved: false }).client, VENUE)).rejects.toMatchObject({ status: 409 });
    await expect(getVenueSpaces(world({ linked: false }).client, VENUE)).rejects.toMatchObject({ status: 409 });
    const w = world();
    const fetch = vi.fn(async () => json(200, { venue: { name: 'Matero' }, spaces: [] }));
    await getVenueSpaces(w.client, VENUE, { fetch: fetch as never });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://waitapp.test/api/partner/chabuka/spaces');
    await getVenueAvailability(w.client, VENUE, 's 1', '2026-11-20', { fetch: fetch as never });
    expect((fetch.mock.calls[1] as unknown as [string])[0]).toBe('https://waitapp.test/api/partner/chabuka/availability?typeId=s%201&date=2026-11-20');
    await expect(getVenueAvailability(w.client, VENUE, 's1', 'tomorrow')).rejects.toMatchObject({ status: 400 });
  });
});

const booking = {
  venueId: VENUE, typeId: 's1', spaceName: 'Court 1', date: '2026-11-20', startTime: '10:00', hours: 2,
  name: 'Chanda', phone: '0977123456',
};

describe('booking a space', () => {
  it('an instant space comes back confirmed with a payment link, and is saved for the player', async () => {
    const w = world();
    const fetch = vi.fn(async (_u: string, init: { body: string }) => {
      expect(JSON.parse(init.body).chabukaUserId).toBe(PLAYER);
      return json(200, {
        reservationId: 'res-1', bookingCode: 'WA-ABCD', instant: true, status: 'accepted', total: 300, currency: 'ZMW',
        facility: { startsAt: '2026-11-20T08:00:00.000Z', endsAt: '2026-11-20T10:00:00.000Z', hours: 2 },
        deposit: { amount: 300, dueBy: '2026-11-11T12:10:00.000Z' }, checkoutUrl: 'https://waitapp.test/pay/stay/res-1/',
      });
    });
    const b = await bookSpace(w.client, PLAYER, booking, { fetch: fetch as never });
    expect(b.status).toBe('accepted');
    expect(b.checkoutUrl).toBe('https://waitapp.test/pay/stay/res-1/');
    expect(b.total).toBe(300);
    expect([...w.t.bookings.values()]).toHaveLength(1);
    expect([...w.t.bookings.values()][0]!['user_id']).toBe(PLAYER);
    expect((await listMySpaceBookings(w.client, PLAYER))).toHaveLength(1);
    expect((await listMySpaceBookings(w.client, STRANGER))).toHaveLength(0);
  });

  it('a request-to-book space waits for the venue, with no payment link yet', async () => {
    const w = world();
    const fetch = vi.fn(async () => json(200, {
      reservationId: 'res-2', bookingCode: 'WA-WXYZ', instant: false, status: 'pending', total: 500, currency: 'ZMW',
      facility: { startsAt: '2026-11-20T08:00:00.000Z', endsAt: '2026-11-20T10:00:00.000Z', hours: 2 }, deposit: null,
      checkoutUrl: 'https://waitapp.test/pay/stay/res-2/',
    }));
    const b = await bookSpace(w.client, PLAYER, booking, { fetch: fetch as never });
    expect(b.status).toBe('pending');
    expect(b.checkoutUrl).toBeNull();
  });

  it('passes on WaitApp\'s reason when someone just took the time, and saves nothing', async () => {
    const w = world();
    const fetch = vi.fn(async () => json(409, { error: 'Someone just booked that time. Please choose another.' }));
    await expect(bookSpace(w.client, PLAYER, booking, { fetch: fetch as never })).rejects.toMatchObject({
      status: 409,
      message: 'Someone just booked that time. Please choose another.',
    });
    expect(w.t.bookings.size).toBe(0);
  });

  it('refuses an unlinked venue and bad details', async () => {
    await expect(bookSpace(world({ linked: false }).client, PLAYER, booking)).rejects.toMatchObject({ status: 409 });
    await expect(bookSpace(world().client, PLAYER, { ...booking, hours: 0 })).rejects.toThrow();
  });
});

describe('booking a space for a game', () => {
  const MATCH = '55555555-5555-4555-8555-555555555555';
  const okFetch = () =>
    vi.fn(async () => json(200, {
      reservationId: 'res-g', bookingCode: 'WA-GAME', instant: true, status: 'accepted', total: 300, currency: 'ZMW',
      facility: { startsAt: '2026-11-20T08:00:00.000Z', endsAt: '2026-11-20T10:00:00.000Z', hours: 2 },
      deposit: { amount: 300, dueBy: '2026-11-11T12:10:00.000Z' }, checkoutUrl: 'https://waitapp.test/pay/stay/res-g/',
    }));

  it('ties the booking to the game when its organiser books the venue the game is at', async () => {
    const w = world();
    w.t.matches.set(MATCH, { id: MATCH, organiser_id: PLAYER, venue_id: VENUE });
    const b = await bookSpace(w.client, PLAYER, { ...booking, matchId: MATCH }, { fetch: okFetch() as never });
    expect(b.matchId).toBe(MATCH);
    expect([...w.t.bookings.values()][0]!['match_id']).toBe(MATCH);
  });

  it('refuses anyone but the organiser, a game at another venue, and an unknown game', async () => {
    const w = world();
    w.t.matches.set(MATCH, { id: MATCH, organiser_id: PLAYER, venue_id: VENUE });
    await expect(bookSpace(w.client, STRANGER, { ...booking, matchId: MATCH }, { fetch: okFetch() as never })).rejects.toMatchObject({ status: 403 });
    w.t.matches.set(MATCH, { id: MATCH, organiser_id: PLAYER, venue_id: '66666666-6666-4666-8666-666666666666' });
    await expect(bookSpace(w.client, PLAYER, { ...booking, matchId: MATCH }, { fetch: okFetch() as never })).rejects.toMatchObject({ status: 409 });
    await expect(bookSpace(w.client, PLAYER, { ...booking, matchId: '77777777-7777-4777-8777-777777777777' }, { fetch: okFetch() as never })).rejects.toMatchObject({ status: 404 });
    expect(w.t.bookings.size).toBe(0);
  });

  it('a paid game booking is handled without error and stays paid', async () => {
    const w = world();
    w.t.matches.set(MATCH, { id: MATCH, organiser_id: PLAYER, venue_id: VENUE, title: 'Sunday run' });
    w.t.participants.set(`${MATCH}:${STRANGER}`, { match_id: MATCH, user_id: STRANGER, status: 'joined' });
    w.t.bookings.set('b9', { id: 'b9', venue_id: VENUE, user_id: PLAYER, match_id: MATCH, waitapp_reservation_id: 'res-9', status: 'accepted', space_name: 'Court 1', starts_at: '2026-11-20T08:00:00.000Z' });
    const s = signed('booking.paid', { reservationId: 'res-9', partnerRef: PLAYER });
    await expect(handleWebhook(w.client, s.raw, s.headers)).resolves.toEqual({ handled: true });
    expect(w.t.bookings.get('b9')!['status']).toBe('paid');
  });
});

function signed(type: string, data: Record<string, unknown>) {
  const raw = JSON.stringify({ id: crypto.randomUUID(), type, createdAt: new Date().toISOString(), data });
  const ts = String(Math.floor(Date.now() / 1000));
  return { raw, headers: { timestamp: ts, signature: crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex') } };
}

describe('booking webhooks from WaitApp', () => {
  function withBooking(status: string) {
    const w = world();
    w.t.bookings.set('b1', {
      id: 'b1', venue_id: VENUE, user_id: PLAYER, waitapp_reservation_id: 'res-1', status, space_name: 'Court 1',
      starts_at: '2026-11-20T08:00:00.000Z',
    });
    return w;
  }
  const send = (w: ReturnType<typeof world>, type: string, data: Record<string, unknown> = {}) => {
    const s = signed(type, { reservationId: 'res-1', partnerRef: PLAYER, ...data });
    return handleWebhook(w.client, s.raw, s.headers);
  };

  it('moves a booking forward as it is accepted and paid', async () => {
    const w = withBooking('pending');
    await send(w, 'booking.accepted', { depositDueBy: '2026-11-11T12:10:00.000Z' });
    expect(w.t.bookings.get('b1')!['status']).toBe('accepted');
    expect(w.t.bookings.get('b1')!['deposit_due_by']).toBe('2026-11-11T12:10:00.000Z');
    await send(w, 'booking.paid');
    expect(w.t.bookings.get('b1')!['status']).toBe('paid');
  });

  it('ignores a repeated or late webhook, and a cancelled booking stays cancelled', async () => {
    const w = withBooking('paid');
    await send(w, 'booking.accepted');
    expect(w.t.bookings.get('b1')!['status']).toBe('paid');
    await send(w, 'booking.cancelled');
    expect(w.t.bookings.get('b1')!['status']).toBe('cancelled');
    await send(w, 'booking.paid');
    expect(w.t.bookings.get('b1')!['status']).toBe('cancelled');
  });

  it('says it did not handle a booking it does not know, and rejects a bad signature', async () => {
    const w = withBooking('pending');
    const s = signed('booking.paid', { reservationId: 'unknown' });
    await expect(handleWebhook(w.client, s.raw, s.headers)).resolves.toEqual({ handled: false });
    await expect(handleWebhook(w.client, s.raw, { timestamp: s.headers.timestamp, signature: 'nope' })).rejects.toMatchObject({ status: 401 });
  });
});
