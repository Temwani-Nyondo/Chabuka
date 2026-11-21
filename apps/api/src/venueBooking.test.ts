import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';

// WaitApp is faked at the venueCall boundary: the linked tests check that Chabuka sends the right calls and reads
// WaitApp's answers the same way as its own tables.
const waCalls: { path: string; method: string; body?: unknown }[] = [];
let waReply: (path: string, method: string, body?: unknown) => { status: number; data: Record<string, unknown> } = () => ({ status: 200, data: {} });
vi.mock('./waitapp.js', () => ({
  venueCall: async (_svc: unknown, _venue: unknown, path: string, init: { method: string; body?: unknown }) => {
    waCalls.push({ path, method: init.method, body: init.body });
    return waReply(path, init.method, init.body);
  },
}));

const vb = await import('./venueBooking.js');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = id(1);
const STAFF = id(2);
const PLAYER = id(3);
const STRANGER = id(4);
const VENUE = id(10);
const LINKED = id(11);
const TEAM = id(20);
const NOW = new Date('2026-11-18T08:00:00Z'); // Wed 10:00 Lusaka
const THU = '2026-11-19';
const HOURS = { thu: { open: '08:00', close: '12:00' } };

function world() {
  const t: Record<string, Map<string, Row>> = {
    venues: new Map(),
    venue_spaces: new Map(),
    venue_closures: new Map(),
    venue_staff: new Map(),
    booking_groups: new Map(),
    bookings: new Map(),
    tickets: new Map(),
    waitapp_bookings: new Map(),
    profiles: new Map(),
    teams: new Map(),
    team_members: new Map(),
    matches: new Map(),
    fixtures: new Map(),
    competitions: new Map(),
  };
  const keys: Record<string, (r: Row) => string> = {
    venue_staff: (r) => `${String(r['venue_id'])}:${String(r['user_id'])}`,
    team_members: (r) => `${String(r['team_id'])}:${String(r['user_id'])}`,
  };
  const client = {
    from(table: string) {
      const map = t[table];
      if (!map) throw new Error(`unexpected table ${table}`);
      return new FakeQuery(map, keys[table] ?? ((r) => String(r['id'])));
    },
    auth: { admin: { listUsers: async () => ({ data: { users: [{ id: STAFF, email: 'staff@example.test' }, { id: OWNER, email: 'owner@example.test' }] } }) } },
  } as never;
  t.venues!.set(VENUE, { id: VENUE, name: 'Arena', owner_id: OWNER, status: 'approved', sports: ['Football'], opening_hours: HOURS, waitapp_restaurant_id: null });
  t.venues!.set(LINKED, { id: LINKED, name: 'Linked Park', owner_id: OWNER, status: 'approved', sports: ['Football'], opening_hours: {}, waitapp_restaurant_id: 'rest-1' });
  for (const [uid, name] of [[OWNER, 'Owner'], [STAFF, 'Staff'], [PLAYER, 'Player']] as const) t.profiles!.set(uid, { id: uid, name });
  t.teams!.set(TEAM, { id: TEAM, name: 'Kabwata FC' });
  t.team_members!.set(`${TEAM}:${PLAYER}`, { team_id: TEAM, user_id: PLAYER, role: 'captain' });
  return { t, client };
}

const deps = { now: NOW };

async function withSpace(units = 1, price: number | null = null) {
  const w = world();
  const { spaceId } = (await vb.upsertSpace(w.client, OWNER, { venueId: VENUE, name: 'Pitch 1', unitCount: units, hourlyPrice: price, currency: price ? 'ZMW' : undefined })) as { spaceId: string };
  return { ...w, spaceId };
}

beforeEach(() => {
  waCalls.length = 0;
  waReply = () => ({ status: 200, data: {} });
});

describe('native venue: spaces and availability', () => {
  it('offers the hours inside opening hours, and a closure removes its hour', async () => {
    const w = await withSpace();
    const av = await vb.getAvailability(w.client, VENUE, w.spaceId, THU, deps);
    expect(av.slots.map((s) => s.start)).toEqual(['08:00', '09:00', '10:00', '11:00']);
    await vb.addClosure(w.client, OWNER, { venueId: VENUE, startsAt: '2026-11-19T07:00:00Z', endsAt: '2026-11-19T08:00:00Z', reason: 'Maintenance' }, deps);
    const after = await vb.getAvailability(w.client, VENUE, w.spaceId, THU, deps);
    expect(after.slots.map((s) => s.start)).toEqual(['08:00', '10:00', '11:00']);
  });

  it('refuses instant booking without WaitApp, and strangers cannot add spaces', async () => {
    const w = world();
    await expect(vb.upsertSpace(w.client, OWNER, { venueId: VENUE, name: 'Court', bookingMode: 'instant' })).rejects.toThrow(/WaitApp/);
    await expect(vb.upsertSpace(w.client, STRANGER, { venueId: VENUE, name: 'Court' })).rejects.toThrow(/owner or its staff/);
  });

  it('says why a time cannot be booked: outside the hours, past closing, or another day', async () => {
    const w = await withSpace();
    await expect(vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '12:00', hours: 1 }, deps)).rejects.toThrow('The venue is open 08:00 to 12:00 that day.');
    await expect(vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '11:00', hours: 2 }, deps)).rejects.toThrow(/closes at 12:00, so the latest a 2-hour booking can start is 10:00/);
    await expect(vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: '2026-11-20', startTime: '09:00', hours: 1 }, deps)).rejects.toThrow(/closed that day/);
  });

  it('will not delete a space with upcoming bookings', async () => {
    const w = await withSpace();
    await vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1 }, deps);
    await expect(vb.deleteSpace(w.client, OWNER, { venueId: VENUE, spaceId: w.spaceId }, deps)).rejects.toThrow(/upcoming bookings/);
  });
});

describe('golf: tee sheet', () => {
  const tee = { intervalMin: 10, playersPerSlot: 4, pricePerPlayer: 250 };
  async function withTee() {
    const w = world();
    const { spaceId } = (await vb.upsertSpace(w.client, OWNER, { venueId: VENUE, name: 'Main course', bookingKind: 'tee', tee })) as { spaceId: string };
    return { ...w, spaceId };
  }

  it('lists tee times every interval up to the last tee time, with spots left', async () => {
    const w = await withTee();
    const av = await vb.getAvailability(w.client, VENUE, w.spaceId, THU, deps);
    expect(av.tee).toMatchObject({ intervalMin: 10, playersPerSlot: 4 });
    expect(av.slots[0]).toMatchObject({ start: '08:00', unitsFree: 4 });
    expect(av.slots[1]!.start).toBe('08:10');
    expect(av.slots.at(-1)!.start).toBe('12:00');
  });

  it('books golfers into a tee time, priced per player, and never overfills it on confirm', async () => {
    const w = await withTee();
    await expect(vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '08:20', hours: 1 }, deps)).rejects.toThrow(/How many golfers/);
    const a = (await vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '08:20', hours: 1, players: 3 }, deps)) as { made: { id: string }[] };
    const row = w.t.bookings!.get(a.made[0]!.id)!;
    expect(row).toMatchObject({ players: 3, pay_at_venue_amount: 750, currency: 'ZMW', starts_at: '2026-11-19T06:20:00.000Z', ends_at: '2026-11-19T06:30:00.000Z' });
    const b = (await vb.requestSpace(w.client, STAFF, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '08:20', hours: 1, players: 2 }, deps)) as { made: { id: string }[] };
    await vb.respondSpaceBooking(w.client, OWNER, { venueId: VENUE, bookingId: a.made[0]!.id, decision: 'confirm' }, deps);
    const second = (await vb.respondSpaceBooking(w.client, OWNER, { venueId: VENUE, bookingId: b.made[0]!.id, decision: 'confirm', mode: 'free_only' }, deps)) as { confirmed: number };
    expect(second.confirmed).toBe(0);
    const av = await vb.getAvailability(w.client, VENUE, w.spaceId, THU, deps);
    expect(av.slots.find((s) => s.start === '08:20')!.unitsFree).toBe(1);
  });

  it('a walk-in fills a tee time; a full one is refused', async () => {
    const w = await withTee();
    await vb.walkInBooking(w.client, OWNER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1, players: 4, guestName: 'Club four-ball' }, deps);
    await expect(vb.walkInBooking(w.client, OWNER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1, players: 1, guestName: 'Late one' }, deps)).rejects.toThrow(/full/);
    const av = await vb.getAvailability(w.client, VENUE, w.spaceId, THU, deps);
    expect(av.slots.some((s) => s.start === '09:00')).toBe(false);
  });

  it('a linked venue cannot sell tee times yet', async () => {
    const w = world();
    await expect(vb.upsertSpace(w.client, OWNER, { venueId: LINKED, name: 'Course', bookingKind: 'tee', tee })).rejects.toThrow(/Tee times stay on Chabuka/);
  });
});

describe('native venue: requests', () => {
  it('a single request waits, then confirming gives it a unit and a ticket; pay at the venue is recorded', async () => {
    const w = await withSpace(1, 300);
    const r = (await vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 2, teamId: TEAM }, deps)) as { state: string; made: { id: string }[] };
    expect(r.state).toBe('requested');
    const booking = w.t.bookings!.get(r.made[0]!.id)!;
    expect(booking['status']).toBe('requested');
    expect(booking['pay_at_venue_amount']).toBe(600);
    const answer = (await vb.respondSpaceBooking(w.client, OWNER, { venueId: VENUE, bookingId: r.made[0]!.id, decision: 'confirm' }, deps)) as { confirmed: number };
    expect(answer.confirmed).toBe(1);
    expect(w.t.bookings!.get(r.made[0]!.id)!['unit_no']).toBe(1);
    expect([...w.t.tickets!.values()]).toHaveLength(1);
    // Now taken: 09:00 and 10:00 are gone.
    const av = await vb.getAvailability(w.client, VENUE, w.spaceId, THU, deps);
    expect(av.slots.map((s) => s.start)).toEqual(['08:00', '11:00']);
  });

  it('a weekly block reports taken weeks first, then requests only the free ones as one group', async () => {
    const w = await withSpace();
    // Next Thursday 09:00 is already taken by a walk-in.
    await vb.walkInBooking(w.client, OWNER, { venueId: VENUE, spaceId: w.spaceId, date: '2026-11-26', startTime: '09:00', hours: 1, guestName: 'Office team' }, deps);
    const first = (await vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1, weeks: 3 }, deps)) as { state: string; taken: string[]; free: string[] };
    expect(first.state).toBe('needs_confirm');
    expect(first.taken).toEqual(['2026-11-26']);
    expect([...w.t.bookings!.values()].filter((b) => b['status'] === 'requested')).toHaveLength(0);
    const sent = (await vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1, weeks: 3, skipTaken: true }, deps)) as { groupId: string; made: unknown[] };
    expect(sent.made).toHaveLength(2);
    expect([...w.t.booking_groups!.values()]).toHaveLength(1);
    expect([...w.t.bookings!.values()].filter((b) => b['group_id'] === sent.groupId)).toHaveLength(2);
  });

  it('answering a block: "all" refuses if a week went, "free_only" confirms the rest and declines the clash', async () => {
    const w = await withSpace();
    const sent = (await vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1, weeks: 3 }, deps)) as { groupId: string };
    // Meanwhile the owner takes a phone booking in week 2.
    await vb.walkInBooking(w.client, OWNER, { venueId: VENUE, spaceId: w.spaceId, date: '2026-11-26', startTime: '09:00', hours: 1, guestName: 'Phone booking' }, deps);
    await expect(vb.respondSpaceBooking(w.client, OWNER, { venueId: VENUE, groupId: sent.groupId, decision: 'confirm', mode: 'all' }, deps)).rejects.toThrow(/1 of these 3/);
    const r = (await vb.respondSpaceBooking(w.client, OWNER, { venueId: VENUE, groupId: sent.groupId, decision: 'confirm', mode: 'free_only' }, deps)) as { confirmed: number; declined: number };
    expect(r).toMatchObject({ confirmed: 2, declined: 1 });
  });

  it('two units take two bookings at the same hour, a third is refused', async () => {
    const w = await withSpace(2);
    const walk = (name: string) => vb.walkInBooking(w.client, OWNER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '10:00', hours: 1, guestName: name }, deps);
    expect(((await walk('Team A')) as { unit: number }).unit).toBe(1);
    expect(((await walk('Team B')) as { unit: number }).unit).toBe(2);
    await expect(walk('Team C')).rejects.toThrow(/Every unit/);
  });

  it('only team members can book for a team', async () => {
    const w = await withSpace();
    await expect(vb.requestSpace(w.client, STRANGER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1, teamId: TEAM }, deps)).rejects.toThrow(/team you are in/);
  });
});

describe('native venue: closures, cancelling, staff', () => {
  it('a closure over bookings is refused unless the owner cancels them', async () => {
    const w = await withSpace();
    const r = (await vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1 }, deps)) as { made: { id: string }[] };
    const closure = { venueId: VENUE, startsAt: '2026-11-19T06:00:00Z', endsAt: '2026-11-19T10:00:00Z', reason: 'Burst pipe' };
    await expect(vb.addClosure(w.client, OWNER, closure, deps)).rejects.toThrow(/1 booking falls/);
    const done = (await vb.addClosure(w.client, OWNER, { ...closure, cancelBookings: true }, deps)) as { cancelled: number };
    expect(done.cancelled).toBe(1);
    expect(w.t.bookings!.get(r.made[0]!.id)!['status']).toBe('cancelled');
    expect(w.t.bookings!.get(r.made[0]!.id)!['cancelled_reason']).toBe('Closed: Burst pipe');
  });

  it('the player cancels their own block; a stranger cannot', async () => {
    const w = await withSpace();
    const sent = (await vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1, weeks: 2 }, deps)) as { groupId: string };
    await expect(vb.cancelSpaceBooking(w.client, STRANGER, { groupId: sent.groupId }, deps)).rejects.toThrow(/Only the person who booked/);
    const r = (await vb.cancelSpaceBooking(w.client, PLAYER, { groupId: sent.groupId }, deps)) as { count: number };
    expect(r.count).toBe(2);
  });

  it('staff can answer requests and set up spaces but cannot change staff', async () => {
    const w = await withSpace();
    await vb.addStaff(w.client, OWNER, { venueId: VENUE, email: 'staff@example.test' });
    const r = (await vb.requestSpace(w.client, PLAYER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '09:00', hours: 1 }, deps)) as { made: { id: string }[] };
    await expect(vb.respondSpaceBooking(w.client, STAFF, { venueId: VENUE, bookingId: r.made[0]!.id, decision: 'decline', note: 'Booked for maintenance' }, deps)).resolves.toMatchObject({ declined: 1 });
    await expect(vb.upsertSpace(w.client, STAFF, { venueId: VENUE, name: 'Court B' })).resolves.toMatchObject({ state: 'created' });
    await expect(vb.addStaff(w.client, STAFF, { venueId: VENUE, email: 'owner@example.test' })).rejects.toThrow(/Only the venue owner/);
    await expect(vb.respondSpaceBooking(w.client, STRANGER, { venueId: VENUE, bookingId: r.made[0]!.id, decision: 'decline' }, deps)).rejects.toThrow(/owner or its staff/);
  });

  it('the owner calendar shows walk-in guests and phones; players cannot open it', async () => {
    const w = await withSpace();
    await vb.walkInBooking(w.client, OWNER, { venueId: VENUE, spaceId: w.spaceId, date: THU, startTime: '10:00', hours: 1, guestName: 'Mr Banda', guestPhone: '0977123456' }, deps);
    const cal = await vb.getCalendar(w.client, OWNER, VENUE, THU, 1, deps);
    expect(cal.bookings[0]).toMatchObject({ who: 'Mr Banda', phone: '0977123456', source: 'walk_in', status: 'confirmed' });
    await expect(vb.getCalendar(w.client, PLAYER, VENUE, THU, 1, deps)).rejects.toThrow(/owner or its staff/);
  });
});

describe('linked venue: the same calls go to WaitApp', () => {
  it('lists WaitApp spaces in the same shape', async () => {
    const w = world();
    waReply = (path) =>
      path === '/api/partner/chabuka/spaces'
        ? { status: 200, data: { venue: { operatingHours: HOURS }, spaces: [{ id: 'type-1', name: 'Five-a-side', price: 250, currency: 'ZMW', bookingMode: 'instant', unitCount: 2 }] } }
        : { status: 404, data: {} };
    const r = await vb.listSpaces(w.client, LINKED);
    expect(r.linked).toBe(true);
    expect(r.spaces[0]).toMatchObject({ id: 'type-1', name: 'Five-a-side', unit_count: 2, hourly_price: 250, booking_mode: 'instant', waitapp_type_id: 'type-1' });
  });

  it('a weekly request makes one WaitApp booking per free week, grouped, with the links carried', async () => {
    const w = world();
    let n = 0;
    waReply = (path, method) => {
      if (path.startsWith('/api/partner/chabuka/availability')) {
        return { status: 200, data: { closed: false, bookingMode: 'request', basePrice: 250, currency: 'ZMW', slots: [{ start: '09:00', startsAt: '', maxHours: 2, unitsFree: 1 }] } };
      }
      if (path === '/api/partner/chabuka/spaces') return { status: 200, data: { spaces: [{ id: 'type-1', name: 'Five-a-side' }] } };
      if (path === '/api/partner/chabuka/bookings' && method === 'POST') {
        n += 1;
        return { status: 200, data: { reservationId: `res-${n}`, bookingCode: `B${n}`, status: 'pending', total: 250, currency: 'ZMW' } };
      }
      return { status: 404, data: {} };
    };
    const r = (await vb.requestSpace(w.client, PLAYER, { venueId: LINKED, spaceId: 'type-1', date: THU, startTime: '09:00', hours: 1, weeks: 2, teamId: TEAM, name: 'Player', phone: '0977000000' }, deps)) as { groupId: string; made: unknown[] };
    expect(r.made).toHaveLength(2);
    const posts = waCalls.filter((c) => c.path === '/api/partner/chabuka/bookings');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.body).toMatchObject({ typeId: 'type-1', startTime: '09:00', chabukaUserId: PLAYER, partnerRef: { groupId: r.groupId, teamId: TEAM } });
    const rows = [...w.t.waitapp_bookings!.values()];
    expect(rows.map((x) => x['group_id'])).toEqual([r.groupId, r.groupId]);
    expect(rows[0]!['space_name']).toBe('Five-a-side');
  });

  it('a linked request needs a name and phone for the venue', async () => {
    const w = world();
    waReply = () => ({ status: 200, data: { closed: false, slots: [{ start: '09:00', startsAt: '', maxHours: 1, unitsFree: 1 }] } });
    await expect(vb.requestSpace(w.client, PLAYER, { venueId: LINKED, spaceId: 'type-1', date: THU, startTime: '09:00', hours: 1 }, deps)).rejects.toThrow(/name and phone/);
  });

  it('an old link without the manage scope asks the owner to reconnect, and does not drop the link', async () => {
    const w = world();
    waReply = () => ({ status: 403, data: { error: 'Reconnect WaitApp to manage this venue from Chabuka.' } });
    await expect(vb.setHours(w.client, OWNER, { venueId: LINKED, hours: HOURS })).rejects.toThrow(/Reconnect WaitApp/);
  });

  it('the calendar maps WaitApp statuses and payment state', async () => {
    const w = world();
    waReply = () => ({
      status: 200,
      data: {
        hours: HOURS,
        spaces: [{ id: 'type-1', name: 'Five-a-side', unitCount: 1 }],
        closures: [{ id: 'c1', typeId: null, startsAt: '2026-11-19T09:00:00Z', endsAt: '2026-11-19T10:00:00Z', reason: 'Holiday' }],
        bookings: [
          { id: 'r1', typeId: 'type-1', startsAt: '2026-11-19T06:00:00Z', endsAt: '2026-11-19T07:00:00Z', status: 'pending', customerName: 'Guest A' },
          { id: 'r2', typeId: 'type-1', startsAt: '2026-11-19T07:00:00Z', endsAt: '2026-11-19T08:00:00Z', status: 'accepted', paymentDue: true, partner: { ref: PLAYER, teamId: TEAM } },
          { id: 'r3', typeId: 'type-1', startsAt: '2026-11-19T08:00:00Z', endsAt: '2026-11-19T09:00:00Z', status: 'paid', walkIn: false },
        ],
      },
    });
    const cal = await vb.getCalendar(w.client, OWNER, LINKED, THU, 1, deps);
    expect(cal.bookings.map((b) => [b.status, b.paid, b.awaitingPayment, b.source])).toEqual([
      ['requested', false, false, 'waitapp'],
      ['confirmed', false, true, 'chabuka'],
      ['confirmed', true, false, 'waitapp'],
    ]);
    expect(cal.closures[0]).toMatchObject({ space_id: null, reason: 'Holiday' });
    expect(cal.teams[TEAM]).toBe('Kabwata FC');
  });

  it('linking copies spaces, hours and future confirmed bookings across', async () => {
    const w = await withSpace(2, 200);
    await vb.walkInBooking(w.client, OWNER, { venueId: VENUE, spaceId: w.spaceId, date: '2027-01-07', startTime: '09:00', hours: 1, guestName: 'Mr Phiri' }, { now: NOW });
    waReply = (path) => (path === '/api/partner/chabuka/spaces' ? { status: 200, data: { id: 'type-new' } } : { status: 200, data: {} });
    const venue = { ...(await vb.loadVenueRow(w.client, VENUE)), waitapp_restaurant_id: 'rest-1' };
    const r = await vb.copyVenueToWaitApp(w.client, venue, { now: NOW });
    expect(r).toMatchObject({ spaces: 1, bookings: 1, failed: 0 });
    expect(w.t.venue_spaces!.get(w.spaceId)!['waitapp_type_id']).toBe('type-new');
    expect(waCalls.find((c) => c.path === '/api/partner/chabuka/hours')?.body).toEqual({ operatingHours: HOURS });
    expect(waCalls.find((c) => c.path === '/api/partner/chabuka/bookings/walk-in')?.body).toMatchObject({ typeId: 'type-new', date: '2027-01-07', startTime: '09:00', customerName: 'Mr Phiri' });
  });
});
