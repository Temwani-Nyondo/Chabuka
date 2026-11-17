import { describe, expect, it } from 'vitest';
import { blankCard } from '@chabuka/shared';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';
import { deleteCourse, deleteRound, getCourse, logRound, myGolf, pickableCourses, saveCourse, venueCourses } from './golf.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = id(1);
const STAFF = id(2);
const STRANGER = id(3);
const ORG = id(4);
const VENUE = id(10);

function world(sports = ['golf']) {
  const t = { golf_courses: new Map<string, Row>(), golf_holes: new Map<string, Row>(), venues: new Map<string, Row>(), venue_staff: new Map<string, Row>(), golf_rounds: new Map<string, Row>(), golf_entries: new Map<string, Row>(), competitions: new Map<string, Row>(), bookings: new Map<string, Row>() };
  t.venues.set(VENUE, { id: VENUE, name: 'Lusaka Golf Club', owner_id: OWNER, status: 'approved', sports, opening_hours: {}, waitapp_restaurant_id: null });
  t.venue_staff.set(`${VENUE}:${STAFF}`, { venue_id: VENUE, user_id: STAFF });
  const client = {
    from(table: string) {
      if (table === 'golf_courses') return new FakeQuery(t.golf_courses, (r) => String(r['id']));
      if (table === 'golf_holes') return new FakeQuery(t.golf_holes, (r) => `${String(r['course_id'])}:${String(r['hole_no'])}`);
      if (table === 'venues') return new FakeQuery(t.venues, (r) => String(r['id']));
      if (table === 'venue_staff') return new FakeQuery(t.venue_staff, (r) => `${String(r['venue_id'])}:${String(r['user_id'])}`);
      if (table === 'golf_rounds') return new FakeQuery(t.golf_rounds, (r) => String(r['id']));
      if (table === 'golf_entries') return new FakeQuery(t.golf_entries, (r) => String(r['id']));
      if (table === 'competitions') return new FakeQuery(t.competitions, (r) => String(r['id']));
      if (table === 'bookings') return new FakeQuery(t.bookings, (r) => String(r['id']));
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { t, client: client as never };
}

const card18 = () => blankCard(18).map((h) => (h.holeNo === 3 ? { ...h, par: 3 } : h.holeNo === 7 ? { ...h, par: 5 } : h));

describe('golf course cards', () => {
  it('the venue owner and staff can add and edit the course; others cannot', async () => {
    const w = world();
    const c = await saveCourse(w.client, OWNER, { venueId: VENUE, name: 'Main course', holes: 18, teeSet: 'White', card: card18() });
    expect(c).toMatchObject({ venueId: VENUE, holes: 18, par: 72, teeSet: 'White' });
    expect(c.card).toHaveLength(18);
    const edited = await saveCourse(w.client, STAFF, { courseId: c.id, name: 'Main course', holes: 18, card: card18().map((h) => (h.holeNo === 1 ? { ...h, par: 5 } : h)) });
    expect(edited.par).toBe(73);
    expect(w.t.golf_holes.size).toBe(18);
    await expect(saveCourse(w.client, STRANGER, { courseId: c.id, name: 'Other', holes: 18, card: card18() })).rejects.toMatchObject({ status: 403 });
    await expect(saveCourse(w.client, STRANGER, { venueId: VENUE, name: 'Other', holes: 18, card: card18() })).rejects.toMatchObject({ status: 403 });
    expect((await venueCourses(w.client, VENUE)).map((x) => x.name)).toEqual(['Main course']);
  });

  it('refuses a broken card and a venue that is not a golf venue', async () => {
    const w = world(['football']);
    await expect(saveCourse(w.client, OWNER, { venueId: VENUE, name: 'Main', holes: 18, card: card18().slice(0, 9) })).rejects.toMatchObject({ status: 400 });
    await expect(saveCourse(w.client, OWNER, { venueId: VENUE, name: 'Main', holes: 18, card: card18() })).rejects.toMatchObject({ status: 409 });
  });

  it("an organiser's own off-Chabuka course is theirs alone, and shows only in their picker", async () => {
    const w = world();
    const own = await saveCourse(w.client, ORG, { venueId: null, name: 'Chainama Hills', holes: 9, card: blankCard(9) });
    await saveCourse(w.client, OWNER, { venueId: VENUE, name: 'Main course', holes: 18, card: card18() });
    expect((await pickableCourses(w.client, ORG)).map((c) => c.name).sort()).toEqual(['Chainama Hills', 'Main course']);
    expect((await pickableCourses(w.client, STRANGER)).map((c) => c.name)).toEqual(['Main course']);
    await expect(deleteCourse(w.client, STRANGER, own.id)).rejects.toMatchObject({ status: 403 });
    await deleteCourse(w.client, ORG, own.id);
    await expect(getCourse(w.client, own.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('golf rounds and the record', () => {
  it('a hole-by-hole round works out gross, net and Stableford; a total-only round keeps the total', async () => {
    const w = world();
    const c = await saveCourse(w.client, OWNER, { venueId: VENUE, name: 'Main course', holes: 18, card: card18() });
    const scores = Object.fromEntries(card18().map((h) => [String(h.holeNo), h.par + 1]));
    const r = await logRound(w.client, STRANGER, { courseId: c.id, playedOn: '2026-11-10', handicapIndex: 18, scores }, { now: new Date('2026-11-20T00:00:00Z') });
    expect(r).toMatchObject({ gross: 90, net: 72, points: 36 });
    await logRound(w.client, STRANGER, { courseId: c.id, playedOn: '2026-11-12', total: 85 }, { now: new Date('2026-11-20T00:00:00Z') });
    await expect(logRound(w.client, STRANGER, { courseId: c.id, playedOn: '2026-11-12', scores: { '1': 4 } }, { now: new Date('2026-11-20T00:00:00Z') })).rejects.toThrow(/all 18 holes/);
    await expect(logRound(w.client, STRANGER, { courseId: c.id, playedOn: '2026-12-25', total: 85 }, { now: new Date('2026-11-20T00:00:00Z') })).rejects.toThrow(/future/);
    const mine = await myGolf(w.client, STRANGER, { now: new Date('2026-11-20T00:00:00Z') });
    expect(mine.record).toMatchObject({ rounds: 2, bestGross: 85, bestNet: 72, bestPoints: 36 });
    expect(mine.rounds[0]!.playedOn).toBe('2026-11-12');
    await expect(deleteRound(w.client, OWNER, r.roundId)).rejects.toMatchObject({ status: 403 });
    await deleteRound(w.client, STRANGER, r.roundId);
    expect((await myGolf(w.client, STRANGER)).record.rounds).toBe(1);
  });
});
