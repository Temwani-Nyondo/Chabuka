import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';

const waCalls: { path: string; body?: unknown }[] = [];
vi.mock('./waitapp.js', () => ({
  waitappCall: async (_s: unknown, _u: string, path: string, init: { body?: unknown }) => {
    waCalls.push({ path, body: init.body });
    const tiers = ((init.body as { tiers?: { name: string }[] })?.tiers ?? []).map((t) => ({ id: `tier-${t.name}`, name: t.name }));
    return { status: 200, data: { eventId: 'evt-1', checkoutUrl: 'https://waitapp.online/checkout/event/evt-1/', tiers } };
  },
}));

const r = await import('./races.js');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = id(1);
const RUNNER = id(2);
const OFFICIAL = id(3);
const STRANGER = id(4);
const SPORT = id(40);
const NOW = new Date('2026-11-20T08:00:00Z');

function world() {
  const t: Record<string, Map<string, Row>> = {
    competitions: new Map(),
    race_distances: new Map(),
    race_routes: new Map(),
    race_entries: new Map(),
    race_entry_private: new Map(),
    race_results: new Map(),
    race_finish_marks: new Map(),
    race_officials: new Map(),
    competition_sponsors: new Map(),
    profiles: new Map(),
  };
  const keys: Record<string, (row: Row) => string> = {
    race_routes: (x) => String(x['distance_id']),
    race_entry_private: (x) => String(x['entry_id']),
    race_results: (x) => String(x['entry_id']),
    race_officials: (x) => `${String(x['competition_id'])}:${String(x['user_id'])}:${String(x['role'])}`,
  };
  const client = {
    from(table: string) {
      const map = t[table];
      if (!map) throw new Error(`unexpected table ${table}`);
      return new FakeQuery(map, keys[table] ?? ((x) => String(x['id'])));
    },
    auth: { admin: { listUsers: async () => ({ data: { users: [{ id: OFFICIAL, email: 'line@example.test' }] } }) } },
  } as never;
  return { t, client };
}

const dist = (name: string, km: number, bibFrom: number, extra: Record<string, unknown> = {}) => ({
  name,
  km,
  startsAt: '2026-12-06T05:30:00+02:00',
  fieldLimit: 3,
  bibFrom,
  bibTo: bibFrom + 99,
  ...extra,
});

async function race(distances = [dist('5K', 5, 1), dist('10K', 10, 500)]) {
  const w = world();
  const made = await r.createRace(w.client, ORG, { name: 'Lusaka Fun Run', sportId: SPORT, area: 'Lusaka', startsOn: '2026-12-06', distances });
  return { ...w, ...made };
}

const runner = (competitionId: string, distanceId: string, extra: Record<string, unknown> = {}) => ({
  competitionId,
  distanceId,
  runnerName: 'Ann Banda',
  gender: 'female',
  birthDate: '1990-05-01',
  phone: '0977000000',
  emergencyName: 'Bob Banda',
  emergencyPhone: '0977000001',
  acceptWaiver: true,
  ...extra,
});

beforeEach(() => {
  waCalls.length = 0;
});

describe('setting up a race', () => {
  it('creates the race and its distances; bib ranges may not overlap', async () => {
    const w = await race();
    expect(w.t.competitions!.get(w.competitionId)).toMatchObject({ kind: 'race', format: 'race', status: 'registration' });
    expect(w.distanceIds).toHaveLength(2);
    await expect(race([dist('5K', 5, 1), dist('10K', 10, 50)])).rejects.toThrow(/overlap/);
  });

  it('saves a route, measures it and gives each water station its km', async () => {
    const w = await race();
    const pts = Array.from({ length: 51 }, (_, i) => [-15.4167 + i * 0.1 * 0.0089932, 28.2833]);
    const out = (await r.saveRoute(w.client, ORG, {
      distanceId: w.distanceIds[0],
      points: pts,
      source: 'drawn',
      pois: [{ type: 'water', lat: -15.4167 + 2.5 * 0.0089932, lng: 28.2834, km: 0 }],
    })) as { distanceM: number; warning: string | null };
    expect(out.distanceM).toBeGreaterThan(4950);
    expect(out.warning).toBeNull();
    const route = w.t.race_routes!.get(w.distanceIds[0]!)!;
    expect((route['pois'] as { km: number }[])[0]!.km).toBeCloseTo(2.5, 1);
    await expect(r.saveRoute(w.client, STRANGER, { distanceId: w.distanceIds[0], points: pts, source: 'drawn' })).rejects.toThrow(/organiser/);
  });
});

describe('entering', () => {
  it('a free distance confirms at once with the first bib, age group and private details stored', async () => {
    const w = await race();
    const out = (await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!), { now: NOW })) as { state: string; bib: number; entryId: string };
    expect(out).toMatchObject({ state: 'confirmed', bib: 1 });
    expect(w.t.race_entries!.get(out.entryId)).toMatchObject({ age_group: '30-39', status: 'confirmed' });
    expect(w.t.race_entry_private!.get(out.entryId)).toMatchObject({ emergency_name: 'Bob Banda' });
    const again = (await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!, { runnerName: 'Child Banda', birthDate: '2014-01-01' }), { now: NOW })) as { bib: number };
    expect(again.bib).toBe(2);
  });

  it('refuses duplicates, a full field and runners under the minimum age', async () => {
    const w = await race([dist('5K', 5, 1), dist('Half', 21.1, 500, { minAge: 18 })]);
    await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!), { now: NOW });
    await expect(r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!), { now: NOW })).rejects.toThrow(/already entered/);
    await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!, { runnerName: 'B Two' }), { now: NOW });
    await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!, { runnerName: 'C Three' }), { now: NOW });
    await expect(r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!, { runnerName: 'D Four' }), { now: NOW })).rejects.toThrow(/full/);
    await expect(r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[1]!, { birthDate: '2012-01-01' }), { now: NOW })).rejects.toThrow(/at least 18/);
  });

  it('a paid distance: on sale on WaitApp, entry pending with a checkout link, ticket.issued confirms once', async () => {
    const w = await race([dist('10K', 10, 500, { price: 250 })]);
    await expect(r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!), { now: NOW })).rejects.toThrow(/not open yet/);
    await r.openRaceEntries(w.client, ORG, { competitionId: w.competitionId });
    expect(waCalls[0]!.body).toMatchObject({ chabukaMatchId: w.competitionId, tiers: [{ name: '10K', price: 250, capacity: 3 }] });
    const out = (await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!, { runnerName: 'Paid Runner' }), { now: NOW })) as { state: string; entryId: string; checkoutUrl: string };
    expect(out.state).toBe('pending_payment');
    expect(out.checkoutUrl).toContain(`cref=race%3A${out.entryId}`);
    expect(out.checkoutUrl).toContain('tier=tier-10K&qty=1');
    const ticket = { eventId: 'evt-1', paymentId: 'pay-1', ticketIds: ['t1'], ref: `race:${out.entryId}` };
    await r.confirmRaceFromTicket(w.client, ticket);
    await r.confirmRaceFromTicket(w.client, ticket);
    expect(w.t.race_entries!.get(out.entryId)).toMatchObject({ status: 'confirmed', bib: 500, paid_ref: 'pay-1' });
    const raceRow = (await r.raceForEvent(w.client, 'evt-1'))!;
    await r.raceTicketsRefunded(w.client, raceRow as never, ['t1']);
    expect(w.t.race_entries!.get(out.entryId)!['status']).toBe('refunded');
    // A runner cannot cancel a paid entry themselves.
    const other = (await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!, { runnerName: 'Second Payer' }), { now: NOW })) as { entryId: string };
    await r.confirmRaceFromTicket(w.client, { eventId: 'evt-1', paymentId: 'pay-2', ticketIds: ['t2'], ref: `race:${other.entryId}` });
    await expect(r.cancelRaceEntry(w.client, RUNNER, { entryId: other.entryId })).rejects.toThrow(/organiser/);
  });

  it('paying for a different ticket type puts the runner in the distance they paid for', async () => {
    const w = await race([dist('10K', 10, 500, { price: 250 }), dist('Half', 21.1, 1000, { price: 400 })]);
    await r.openRaceEntries(w.client, ORG, { competitionId: w.competitionId });
    const out = (await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[1]!), { now: NOW })) as { entryId: string };
    await r.confirmRaceFromTicket(w.client, { eventId: 'evt-1', paymentId: 'pay-9', ticketIds: ['t9'], ref: `race:${out.entryId}`, tierName: '10K' });
    expect(w.t.race_entries!.get(out.entryId)).toMatchObject({ distance_id: w.distanceIds[0], bib: 500, status: 'confirmed' });
  });

  it('an unpaid entry stops holding a place after two hours', async () => {
    const w = await race([dist('10K', 10, 500, { price: 250, fieldLimit: 1 })]);
    await r.openRaceEntries(w.client, ORG, { competitionId: w.competitionId });
    await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!), { now: NOW });
    await expect(r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!, { runnerName: 'Late One' }), { now: NOW })).rejects.toThrow(/full/);
    const later = new Date(NOW.getTime() + 3 * 3600_000);
    await expect(r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!, { runnerName: 'Late One' }), { now: later })).resolves.toMatchObject({ state: 'pending_payment' });
  });
});

describe('race day', () => {
  async function field() {
    const w = await race([dist('5K', 5, 1, { fieldLimit: 10 }), dist('10K', 10, 500)]);
    const names: [string, 'female' | 'male', string][] = [
      ['Ann', 'female', '1990-01-01'],
      ['Ben', 'male', '1985-01-01'],
      ['Cat', 'female', '1970-01-01'],
      ['Dan', 'male', '2000-01-01'],
    ];
    for (const [n, g, b] of names) await r.enterRace(w.client, RUNNER, runner(w.competitionId, w.distanceIds[0]!, { runnerName: n, gender: g, birthDate: b }), { now: NOW });
    await r.appointRaceOfficial(w.client, ORG, { competitionId: w.competitionId, email: 'line@example.test', role: 'finish' });
    return w;
  }

  it('officials start the clock and record bibs; blank marks are fixed later; wrong distance is flagged', async () => {
    const w = await field();
    const D = w.distanceIds[0]!;
    await expect(r.finishMark(w.client, OFFICIAL, { distanceId: D, bib: 1, clientId: 'm-000001', deviceAt: NOW.toISOString() }, { now: NOW })).rejects.toThrow(/Start the clock/);
    await r.startGun(w.client, OFFICIAL, { distanceId: D, at: '2026-12-06T03:30:00Z' });
    const at = (min: number) => new Date(Date.parse('2026-12-06T03:30:00Z') + min * 60_000);
    const m1 = (await r.finishMark(w.client, OFFICIAL, { distanceId: D, bib: 2, clientId: 'm-000001', deviceAt: at(20).toISOString() }, { now: at(20) })) as { position: number; time: string; runner: string };
    expect(m1).toMatchObject({ position: 1, time: '20:00', runner: 'Ben' });
    const dup = (await r.finishMark(w.client, OFFICIAL, { distanceId: D, bib: 2, clientId: 'm-000001', deviceAt: at(20).toISOString() }, { now: at(20) })) as { state: string };
    expect(dup.state).toBe('duplicate');
    const blank = (await r.finishMark(w.client, OFFICIAL, { distanceId: D, bib: null, clientId: 'm-000002', deviceAt: at(22).toISOString() }, { now: at(22) })) as { markId: string };
    await r.finishMark(w.client, OFFICIAL, { distanceId: D, bib: 1, clientId: 'm-000003', deviceAt: at(25).toISOString() }, { now: at(25) });
    await r.resolveMark(w.client, OFFICIAL, { markId: blank.markId, bib: 3 });
    const wrong = (await r.finishMark(w.client, OFFICIAL, { distanceId: D, bib: 999, clientId: 'm-000004', deviceAt: at(26).toISOString() }, { now: at(26) })) as { warning: string };
    expect(wrong.warning).toMatch(/No confirmed runner/);
    await expect(r.finishMark(w.client, STRANGER, { distanceId: D, bib: 4, clientId: 'm-000005', deviceAt: at(27).toISOString() }, { now: at(27) })).rejects.toThrow(/officials/);

    await r.setResult(w.client, ORG, { entryId: [...w.t.race_entries!.values()].find((e) => e['runner_name'] === 'Dan')!['id'], status: 'dnf' });
    const pub = (await r.publishResults(w.client, ORG, { distanceId: D })) as { finishers: number };
    expect(pub.finishers).toBe(3);
    const res = await r.getRaceResults(w.client, STRANGER, w.competitionId);
    expect(res.results.map((x) => [x.name, x.overall, x.genderPos])).toEqual([
      ['Ben', 1, 1],
      ['Cat', 2, 1],
      ['Ann', 3, 2],
      ['Dan', null, null],
    ]);
  });

  it('a timing CSV replaces results and reports unknown bibs', async () => {
    const w = await field();
    const out = (await r.importResults(w.client, ORG, {
      distanceId: w.distanceIds[0],
      mode: 'replace',
      rows: [
        { bib: 1, gunSeconds: 1500, chipSeconds: 1490, status: 'finished' },
        { bib: 77, gunSeconds: 1600, chipSeconds: null, status: 'finished' },
      ],
    })) as { imported: number; unknownBibs: number[] };
    expect(out).toMatchObject({ imported: 1, unknownBibs: [77] });
    await expect(r.importResults(w.client, OFFICIAL, { distanceId: w.distanceIds[0], rows: [{ bib: 1, gunSeconds: 1, chipSeconds: null, status: 'finished' }] })).rejects.toThrow(/organiser/);
  });

  it('results stay hidden from others until published; my races shows the time once published', async () => {
    const w = await field();
    await r.importResults(w.client, ORG, { distanceId: w.distanceIds[0], rows: [{ bib: 1, gunSeconds: 1500, chipSeconds: null, status: 'finished' }] });
    expect((await r.getRaceResults(w.client, STRANGER, w.competitionId)).results).toHaveLength(0);
    expect((await r.myRaces(w.client, RUNNER)).find((x) => x.bib === 1)!.result).toBeNull();
    await r.publishResults(w.client, ORG, { distanceId: w.distanceIds[0] });
    expect((await r.myRaces(w.client, RUNNER)).find((x) => x.bib === 1)!.result).toMatchObject({ seconds: 1500, overall: 1 });
  });
});
