import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blankCard } from '@chabuka/shared';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';

const sent: { ids: string[]; type: string; payload: Record<string, unknown> }[] = [];
vi.mock('./actions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./actions.js')>()),
  notifyUsers: async (ids: string[], type: string, payload: Record<string, unknown>) => void sent.push({ ids, type, payload }),
}));
let waReply: () => { status: number; data: Record<string, unknown> } = () => ({ status: 200, data: {} });
const waCalls: { path: string; body: unknown }[] = [];
vi.mock('./waitapp.js', () => ({
  waitappCall: async (_svc: unknown, _u: string, path: string, init: { body?: unknown }) => {
    waCalls.push({ path, body: init.body });
    return waReply();
  },
}));

const gd = await import('./golfDays.js');
const { saveCourse } = await import('./golf.js');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = id(1);
const P1 = id(2);
const P2 = id(3);
const P3 = id(4);
const STRANGER = id(5);
const VENUE = id(10);
const GOLF = id(40);
const NOW = new Date('2026-12-01T08:00:00Z');

function world() {
  const names = ['competitions', 'sports', 'golf_courses', 'golf_holes', 'venues', 'venue_staff', 'golf_entries', 'golf_flights', 'golf_scores', 'golf_side_results', 'golf_rounds', 'profiles'];
  const t: Record<string, Map<string, Row>> = Object.fromEntries(names.map((n) => [n, new Map<string, Row>()]));
  const keys: Record<string, (r: Row) => string> = {
    golf_holes: (r) => `${String(r['course_id'])}:${String(r['hole_no'])}`,
    golf_scores: (r) => `${String(r['entry_id'])}:${String(r['hole_no'])}`,
    golf_side_results: (r) => `${String(r['competition_id'])}:${String(r['type'])}:${String(r['hole'])}`,
    venue_staff: (r) => `${String(r['venue_id'])}:${String(r['user_id'])}`,
    golf_rounds: (r) => `${String(r['user_id'])}:${String(r['source_id'])}`,
  };
  const client = {
    from(table: string) {
      const map = t[table];
      if (!map) throw new Error(`unexpected table ${table}`);
      return new FakeQuery(map, keys[table] ?? ((r) => String(r['id'])));
    },
  } as never;
  t.sports!.set(GOLF, { id: GOLF, name: 'golf' });
  t.venues!.set(VENUE, { id: VENUE, name: 'Lusaka Golf Club', owner_id: ORG, status: 'approved', sports: ['golf'], opening_hours: {}, waitapp_restaurant_id: null });
  return { t, client };
}

async function golfDay(w: ReturnType<typeof world>, extra: Record<string, unknown> = {}) {
  const course = await saveCourse(w.client, ORG, { venueId: VENUE, name: 'Main', holes: 9, card: blankCard(9) });
  const { competitionId } = await gd.createGolfDay(w.client, ORG, {
    name: 'Charity Golf Day',
    area: 'Lusaka',
    settings: { courseId: course.id, scoring: 'stableford', firstTeeAt: '2026-12-05T06:00:00.000Z', intervalMin: 10, fieldLimit: 3, ...extra },
  });
  return competitionId;
}

beforeEach(() => {
  sent.length = 0;
  waCalls.length = 0;
  waReply = () => ({ status: 200, data: {} });
});

describe('golf days: entering', () => {
  it('a free entry is confirmed at once; the field limit and handicap limit hold', async () => {
    const w = world();
    const gid = await golfDay(w, { maxHandicap: 36 });
    const e = await gd.enterGolfDay(w.client, P1, { competitionId: gid, playerName: 'Mwila', handicapIndex: 12.4, phone: '0977000001' }, { now: NOW });
    expect(e.state).toBe('confirmed');
    expect(sent.at(-1)!.type).toBe('golf_entry_confirmed');
    await expect(gd.enterGolfDay(w.client, P2, { competitionId: gid, playerName: 'Banda', handicapIndex: 40, phone: '0977000002' }, { now: NOW })).rejects.toThrow(/up to 36/);
    await gd.enterGolfDay(w.client, P2, { competitionId: gid, playerName: 'Banda', handicapIndex: 20, phone: '0977000002' }, { now: NOW });
    await gd.enterGolfDay(w.client, P3, { competitionId: gid, playerName: 'Phiri', handicapIndex: 5, phone: '0977000003' }, { now: NOW });
    await expect(gd.enterGolfDay(w.client, STRANGER, { competitionId: gid, playerName: 'Late', handicapIndex: 5, phone: '0977000004' }, { now: NOW })).rejects.toThrow(/full/);
  });

  it('a guest entry from WaitApp: same handicap limit, no account, email kept, nobody notified, form shows the rules', async () => {
    const w = world();
    const gid = await golfDay(w, { maxHandicap: 36 });
    const before = sent.length;
    await expect(gd.enterGolfDay(w.client, null, { competitionId: gid, playerName: 'Guest', handicapIndex: 40, phone: '0977000009' }, { now: NOW, guestEmail: 'g@x.test' })).rejects.toThrow(/up to 36/);
    const e = await gd.enterGolfDay(w.client, null, { competitionId: gid, playerName: 'Guest', handicapIndex: 18, phone: '0977000009' }, { now: NOW, guestEmail: 'g@x.test' });
    expect(e.state).toBe('confirmed');
    expect(w.t.golf_entries!.get(e.entryId)).toMatchObject({ user_id: null, guest_email: 'g@x.test', source: 'waitapp' });
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)!.ids).toEqual([null]);
    await expect(gd.enterGolfDay(w.client, null, { competitionId: gid, playerName: 'Guest', handicapIndex: 18, phone: '0977000009' }, { now: NOW, guestEmail: 'g@x.test' })).rejects.toThrow(/already entered/);
    const form = await gd.golfEntryForm(w.client, gid, NOW);
    expect(form).toMatchObject({ kind: 'golf_day', open: true, maxHandicap: 36, entryFee: 0 });
  });

  it('a paid entry goes to WaitApp checkout with the golf ref and is confirmed by the ticket, refunded by a refund', async () => {
    const w = world();
    const gid = await golfDay(w, { entryFee: 500 });
    await expect(gd.enterGolfDay(w.client, P1, { competitionId: gid, playerName: 'Mwila', handicapIndex: 12, phone: '0977000001' }, { now: NOW })).rejects.toThrow(/not open yet/);
    waReply = () => ({ status: 200, data: { eventId: 'ev1', checkoutUrl: 'https://waitapp.test/checkout/event/ev1/' } });
    await gd.openGolfEntries(w.client, ORG, { competitionId: gid });
    expect((waCalls[0]!.body as { tiers: unknown[] }).tiers).toEqual([{ name: 'Entry', price: 500, capacity: 3 }]);
    const e = (await gd.enterGolfDay(w.client, P1, { competitionId: gid, playerName: 'Mwila', handicapIndex: 12, phone: '0977000001' }, { now: NOW })) as { entryId: string; checkoutUrl: string };
    expect(e.checkoutUrl).toBe(`https://waitapp.test/checkout/event/ev1/?cref=golf%3A${e.entryId}&qty=1`);
    await gd.confirmGolfFromTicket(w.client, { eventId: 'ev1', paymentId: 'pay1', ticketIds: ['t1'], ref: `golf:${e.entryId}` });
    expect(w.t.golf_entries!.get(e.entryId)!['status']).toBe('confirmed');
    const g = await gd.golfDayForEvent(w.client, 'ev1');
    await gd.golfTicketsRefunded(w.client, g!, ['t1']);
    expect(w.t.golf_entries!.get(e.entryId)!['status']).toBe('refunded');
  });
});

describe('golf days: flights and scoring', () => {
  async function ready() {
    const w = world();
    const gid = await golfDay(w);
    const ids: Record<string, string> = {};
    for (const [u, n, h] of [[P1, 'Mwila', 12], [P2, 'Banda', 20], [P3, 'Phiri', 5]] as const) {
      ids[n] = ((await gd.enterGolfDay(w.client, u, { competitionId: gid, playerName: n, handicapIndex: h, phone: '0977000000' }, { now: NOW })) as { entryId: string }).entryId;
    }
    const built = (await gd.buildFlights(w.client, ORG, { competitionId: gid })) as { flights: { id: string; teeTime: string }[] };
    return { w, gid, ids, flightId: built.flights[0]!.id };
  }

  it('the organiser groups players and each is told their tee time', async () => {
    const { w, gid } = await ready();
    expect(w.t.golf_flights!.size).toBe(1);
    expect(sent.filter((s) => s.type === 'golf_flight')[0]!.payload).toMatchObject({ teeTime: '2026-12-05T06:00:00.000Z' });
    await expect(gd.buildFlights(w.client, P1, { competitionId: gid })).rejects.toMatchObject({ status: 403 });
  });

  it('before anyone keeps the card players enter their own; then only the scorer (or organiser) can', async () => {
    const { w, gid, ids, flightId } = await ready();
    await gd.saveGolfScores(w.client, P1, { competitionId: gid, scores: [{ entryId: ids['Mwila']!, holeNo: 1, strokes: 4 }] });
    await expect(gd.saveGolfScores(w.client, P1, { competitionId: gid, scores: [{ entryId: ids['Banda']!, holeNo: 1, strokes: 5 }] })).rejects.toMatchObject({ status: 403 });
    await gd.claimScorer(w.client, P2, { competitionId: gid, flightId });
    await gd.saveGolfScores(w.client, P2, { competitionId: gid, scores: [{ entryId: ids['Mwila']!, holeNo: 2, strokes: 5 }, { entryId: ids['Phiri']!, holeNo: 1, strokes: 3 }] });
    await expect(gd.saveGolfScores(w.client, P1, { competitionId: gid, scores: [{ entryId: ids['Mwila']!, holeNo: 3, strokes: 4 }] })).rejects.toMatchObject({ status: 403 });
    await expect(gd.saveGolfScores(w.client, P2, { competitionId: gid, scores: [{ entryId: ids['Mwila']!, holeNo: 12, strokes: 4 }] })).rejects.toThrow(/9 holes/);
    await gd.saveGolfScores(w.client, ORG, { competitionId: gid, scores: [{ entryId: ids['Banda']!, holeNo: 1, strokes: null }] });
    const view = await gd.getGolfDayView(w.client, P1, gid);
    expect(view.leaderboard.find((r) => r.name === 'Mwila')!.thru).toBe(2);
    // Stableford: Mwila 3 + 2 points over two holes beats Phiri's 4 on one.
    expect(view.leaderboard.map((r) => r.name).slice(0, 2)).toEqual(['Mwila', 'Phiri']);
  });

  it('publishing puts every complete card on the golfer\'s record, once', async () => {
    const { w, gid, ids } = await ready();
    const all = (entryId: string, strokes: number) => Array.from({ length: 9 }, (_, i) => ({ entryId, holeNo: i + 1, strokes }));
    await gd.saveGolfScores(w.client, ORG, { competitionId: gid, scores: [...all(ids['Mwila']!, 5), ...all(ids['Phiri']!, 4)] });
    await gd.publishGolfResults(w.client, ORG, { competitionId: gid });
    await gd.publishGolfResults(w.client, ORG, { competitionId: gid });
    const rounds = [...w.t.golf_rounds!.values()];
    expect(rounds.map((r) => r['user_id']).sort()).toEqual([P1, P3].sort());
    expect(rounds.find((r) => r['user_id'] === P3)).toMatchObject({ gross: 36, source: 'golf_day', holes: 9 });
  });

  it('publishing locks the scores and tells the field', async () => {
    const { w, gid, ids } = await ready();
    await gd.publishGolfResults(w.client, ORG, { competitionId: gid });
    expect(sent.at(-1)!.type).toBe('golf_results');
    await expect(gd.saveGolfScores(w.client, ORG, { competitionId: gid, scores: [{ entryId: ids['Mwila']!, holeNo: 1, strokes: 4 }] })).rejects.toThrow(/locked/);
  });

  it('side contests: only the ones set up, won by a player in the field', async () => {
    const w = world();
    const gid = await golfDay(w, { sideContests: [{ type: 'nearest_pin', hole: 3 }] });
    const e = (await gd.enterGolfDay(w.client, P1, { competitionId: gid, playerName: 'Mwila', handicapIndex: 12, phone: '0977000001' }, { now: NOW })) as { entryId: string };
    await expect(gd.setSideResult(w.client, ORG, { competitionId: gid, type: 'longest_drive', hole: 1, entryId: e.entryId })).rejects.toThrow(/not part/);
    await gd.setSideResult(w.client, ORG, { competitionId: gid, type: 'nearest_pin', hole: 3, entryId: e.entryId, note: '1.2 m' });
    const view = await gd.getGolfDayView(w.client, P1, gid);
    expect(view.sideResults).toEqual([{ type: 'nearest_pin', hole: 3, winner: 'Mwila', note: '1.2 m' }]);
  });
});
