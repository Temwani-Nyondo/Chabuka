import { describe, expect, it } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';
import { readSportFeed } from './sportFeed.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FOOTBALL = id(1);
const RUNNING = id(2);
const ORG = id(50);
const NOW = new Date('2026-11-20T10:00:00Z');

function world() {
  const names = ['sports', 'matches', 'match_participants', 'match_ticketing', 'competitions', 'race_distances', 'competition_entries', 'venues', 'venue_spaces', 'venue_waitapp_links', 'golf_entries'];
  const t: Record<string, Map<string, Row>> = Object.fromEntries(names.map((n) => [n, new Map<string, Row>()]));
  const client = {
    from(table: string) {
      const map = t[table];
      if (!map) throw new Error(`unexpected table ${table}`);
      return new FakeQuery(map, (x) => String(x['id'] ?? `${String(x['match_id'] ?? x['venue_id'] ?? x['competition_id'])}:${String(x['user_id'] ?? x['team_id'] ?? Math.random())}`));
    },
  } as never;
  t.sports!.set(FOOTBALL, { id: FOOTBALL, name: 'Football' });
  t.sports!.set(RUNNING, { id: RUNNING, name: 'running' });
  t.sports!.set(id(3), { id: id(3), name: 'golf' });
  return { t, client };
}

const game = (n: number, extra: Row = {}): Row => ({
  id: id(100 + n), title: `Game ${n}`, sport_id: FOOTBALL, starts_at: '2026-11-21T16:00:00Z', area: 'Kabulonga', venue_name: 'Arena', lat: -15.42, lng: 28.33,
  capacity: 10, visibility: 'public', status: 'open', series_id: null, organiser_id: ORG, ...extra,
});

describe('the public sport feed', () => {
  it('lists public open upcoming games only, with spots left and no people', async () => {
    const w = world();
    w.t.matches!.set('a', game(1));
    w.t.matches!.set('b', game(2, { visibility: 'private' }));
    w.t.matches!.set('c', game(3, { starts_at: '2026-11-19T16:00:00Z' }));
    w.t.matches!.set('d', game(4, { status: 'finished' }));
    w.t.matches!.set('e', game(5, { starts_at: '2026-12-30T16:00:00Z' }));
    w.t.match_participants!.set('p1', { match_id: id(101), user_id: ORG, status: 'joined' });
    const feed = await readSportFeed(w.client, {}, NOW);
    expect(feed.items.map((i) => i.title)).toEqual(['Game 1']);
    expect(feed.items[0]).toMatchObject({ kind: 'game', sport: 'Football', spotsLeft: 9, priceLabel: 'Free', checkoutUrl: null });
    expect(JSON.stringify(feed)).not.toContain(ORG);
  });

  it('shows only the next game of a weekly series', async () => {
    const w = world();
    w.t.matches!.set('a', game(1, { series_id: 's1', starts_at: '2026-11-21T16:00:00Z' }));
    w.t.matches!.set('b', game(2, { series_id: 's1', starts_at: '2026-11-28T16:00:00Z' }));
    const feed = await readSportFeed(w.client, {}, NOW);
    expect(feed.items).toHaveLength(1);
  });

  it('a paid race checks out on WaitApp; a tournament shows spots left', async () => {
    const w = world();
    w.t.competitions!.set(id(200), { id: id(200), name: 'City 10K', kind: 'race', sport_id: RUNNING, starts_on: '2026-11-28', status: 'registration', area: 'Lusaka', location: 'Showgrounds', banner_url: 'https://img.test/r.jpg', max_entries: 500, waitapp_checkout_url: 'https://waitapp.test/checkout/event/e1/' });
    w.t.race_distances!.set('d1', { id: 'd1', competition_id: id(200), starts_at: '2026-11-28T05:00:00Z', price: 150, currency: 'ZMW' });
    w.t.race_distances!.set('d2', { id: 'd2', competition_id: id(200), starts_at: '2026-11-28T06:00:00Z', price: 100, currency: 'ZMW' });
    w.t.competitions!.set(id(201), { id: id(201), name: 'Cup', kind: 'tournament', sport_id: FOOTBALL, starts_on: '2026-11-25', status: 'registration', area: 'Lusaka', location: null, banner_url: null, max_entries: 8, waitapp_checkout_url: null });
    w.t.competition_entries!.set('e1', { competition_id: id(201), team_id: 't1', status: 'approved' });
    w.t.competition_entries!.set('e2', { competition_id: id(201), team_id: 't2', status: 'rejected' });
    const feed = await readSportFeed(w.client, {}, NOW);
    const race = feed.items.find((i) => i.kind === 'race')!;
    // Never a bare ticket link: a race is entered through the form (date of birth for the age rule).
    expect(race).toMatchObject({ priceLabel: 'From K100', checkoutUrl: null, entry: 'race', startsAt: '2026-11-28T05:00:00Z', image: 'https://img.test/r.jpg' });
    expect(feed.items.find((i) => i.kind === 'event')).toMatchObject({ spotsLeft: 7, checkoutUrl: null });
  });

  it('a race with a free and a paid distance is not called free', async () => {
    const w = world();
    w.t.competitions!.set(id(210), { id: id(210), name: 'Fun Run', kind: 'race', sport_id: RUNNING, starts_on: '2026-11-28', status: 'registration', area: 'Lusaka', location: null, banner_url: null, max_entries: 500, waitapp_checkout_url: null });
    w.t.race_distances!.set('f1', { id: 'f1', competition_id: id(210), name: '5K', starts_at: '2026-11-28T05:00:00Z', price: 0, currency: 'ZMW' });
    w.t.race_distances!.set('f2', { id: 'f2', competition_id: id(210), name: '10K', starts_at: '2026-11-28T05:30:00Z', price: 150, currency: 'ZMW', min_age: 16 });
    const race = (await readSportFeed(w.client, {}, NOW)).items.find((i) => i.kind === 'race')!;
    expect(race).toMatchObject({ priceLabel: 'Free to K150', rules: ['10K: 16+'] });
  });

  it("a venue appears for each of its sports, and a linked one books on WaitApp", async () => {
    const w = world();
    w.t.venues!.set(id(300), { id: id(300), name: 'Arena Five', area: 'Kabulonga', lat: -15.42, lng: 28.33, sports: ['Football'], photos: ['https://img.test/v.jpg'], price_note: null, status: 'approved' });
    w.t.venues!.set(id(301), { id: id(301), name: 'No spaces', area: 'X', lat: null, lng: null, sports: ['Football'], photos: [], price_note: null, status: 'approved' });
    w.t.venue_spaces!.set('s1', { id: 's1', venue_id: id(300), hourly_price: 300, currency: 'ZMW', active: true });
    w.t.venue_spaces!.set('s2', { id: 's2', venue_id: id(300), hourly_price: 200, currency: 'ZMW', active: true });
    w.t.venue_waitapp_links!.set(id(300), { venue_id: id(300), booking_page: 'https://waitapp.test/book/arena-five' });
    const feed = await readSportFeed(w.client, {}, NOW);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ kind: 'venue', title: 'Arena Five', priceLabel: 'From K200 an hour', bookingUrl: 'https://waitapp.test/book/arena-five', startsAt: null });
  });

  it('one card per sport with a count of dated things, and a sport filter', async () => {
    const w = world();
    w.t.matches!.set('a', game(1));
    w.t.matches!.set('b', game(2, { starts_at: '2026-11-22T16:00:00Z' }));
    w.t.matches!.set('c', game(3, { sport_id: RUNNING }));
    const feed = await readSportFeed(w.client, {}, NOW);
    expect(feed.sports).toEqual([{ name: 'Football', count: 2, image: null }, { name: 'running', count: 1, image: null }]);
    const running = await readSportFeed(w.client, { sport: 'Running' }, NOW);
    expect(running.items.map((i) => i.title)).toEqual(['Game 3']);
    expect((await readSportFeed(w.client, { sport: 'curling' }, NOW)).items).toEqual([]);
  });

  it('golf: a golf day under Compete and a course selling tee times, priced per player', async () => {
    const w = world();
    w.t.competitions!.set(id(210), { id: id(210), name: 'Charity Golf Day', kind: 'golf_day', sport_id: id(3), starts_on: '2026-11-28', status: 'registration', area: 'Lusaka', location: 'Lusaka GC', banner_url: null, max_entries: 72, waitapp_checkout_url: 'https://waitapp.test/checkout/event/g1/', golf_settings: { entryFee: 500, currency: 'ZMW', firstTeeAt: '2026-11-28T05:00:00Z', fieldLimit: 72 } });
    w.t.golf_entries!.set('ge1', { id: 'ge1', competition_id: id(210), status: 'confirmed' });
    w.t.venues!.set(id(310), { id: id(310), name: 'Lusaka Golf Club', area: 'Lusaka', lat: -15.4, lng: 28.3, sports: ['golf'], photos: [], price_note: null, status: 'approved' });
    w.t.venue_spaces!.set('tee', { id: 'tee', venue_id: id(310), hourly_price: null, currency: 'ZMW', active: true, booking_kind: 'tee', tee: { intervalMin: 10, playersPerSlot: 4, pricePerPlayer: 250 } });
    const feed = await readSportFeed(w.client, { sport: 'golf' }, NOW);
    expect(feed.items.find((i) => i.title === 'Charity Golf Day')).toMatchObject({ kind: 'event', priceLabel: 'K500', spotsLeft: 71, checkoutUrl: null, entry: 'golf_day' });
    expect(feed.items.find((i) => i.title === 'Lusaka Golf Club')).toMatchObject({ kind: 'venue', priceLabel: 'K250 per player, pay at the course' });
    expect(feed.items.find((i) => i.title === 'Charity Golf Day')!.chabukaUrl).toMatch(/\/golf\//);
  });
});
