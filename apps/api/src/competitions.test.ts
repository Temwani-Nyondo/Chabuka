import { describe, expect, it } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';
import {
  confirmResult,
  createCompetitionV2,
  createSeries,
  entriesForOrganiser,
  generateFixtures,
  joinSeries,
  registerTeam,
  reportResult,
  reviewEntry,
  skipOccurrence,
  startKnockout,
  topUpSeries,
  topUpAllSeries,
  cronAllowed,
  updateCompetition,
  upsertSponsor,
  withdrawEntry,
} from './competitions.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = id(1);
const STRANGER = id(2);
const SPORT = id(40);
const OTHER_SPORT = id(41);
const captain = (n: number) => id(100 + n);
const team = (n: number) => id(200 + n);

function world(teams = 4) {
  const t: Record<string, Map<string, Row>> = {
    competitions: new Map(),
    competition_entries: new Map(),
    competition_entry_details: new Map(),
    competition_sponsors: new Map(),
    fixtures: new Map(),
    follows: new Map(),
    user_follows: new Map(),
    teams: new Map(),
    team_members: new Map(),
    profiles: new Map(),
    matches: new Map(),
    match_participants: new Map(),
    match_ticketing: new Map(),
    match_series: new Map(),
    series_regulars: new Map(),
  };
  const keys: Record<string, (r: Row) => string> = {
    competition_entries: (r) => `${String(r['competition_id'])}:${String(r['team_id'])}`,
    competition_entry_details: (r) => `${String(r['competition_id'])}:${String(r['team_id'])}`,
    team_members: (r) => `${String(r['team_id'])}:${String(r['user_id'])}`,
    match_participants: (r) => `${String(r['match_id'])}:${String(r['user_id'])}`,
    series_regulars: (r) => `${String(r['series_id'])}:${String(r['user_id'])}`,
    follows: (r) => `${String(r['user_id'])}:${String(r['competition_id'])}`,
    user_follows: (r) => `${String(r['user_id'])}:${String(r['subject_type'])}:${String(r['subject_id'])}`,
  };
  const client = {
    from(table: string) {
      const map = t[table];
      if (!map) throw new Error(`unexpected table ${table}`);
      return new FakeQuery(map, keys[table] ?? ((r) => String(r['id'])));
    },
  } as never;
  for (let n = 1; n <= teams; n += 1) {
    t.teams!.set(team(n), { id: team(n), name: `Team ${n}`, sport_id: SPORT });
    t.team_members!.set(`${team(n)}:${captain(n)}`, { team_id: team(n), user_id: captain(n), role: 'captain' });
    t.profiles!.set(captain(n), { id: captain(n), name: `Captain ${n}` });
  }
  t.teams!.set(team(99), { id: team(99), name: 'Netball side', sport_id: OTHER_SPORT });
  t.team_members!.set(`${team(99)}:${captain(99)}`, { team_id: team(99), user_id: captain(99), role: 'captain' });
  return { t, client };
}

const base = { name: 'Charity Cup', sportId: SPORT, kind: 'tournament' as const, category: 'charity' as const, area: 'Lusaka', startsOn: '2026-12-05', maxEntries: 8 };
const reg = (n: number, compId: string) => ({
  competitionId: compId,
  teamId: team(n),
  contactName: `Captain ${n}`,
  contactPhone: '0977000000',
  answers: [{ label: 'Company', answer: `Company ${n}` }],
  acceptRules: true as const,
});

async function liveLeague(teams: number, format: 'round_robin' | 'knockout' | 'groups_knockout' = 'round_robin', extra: Record<string, unknown> = {}) {
  const w = world(teams);
  const { competitionId } = await createCompetitionV2(w.client, ORG, { ...base, format, requiresApproval: false, ...extra } as never);
  for (let n = 1; n <= teams; n += 1) await registerTeam(w.client, captain(n), reg(n, competitionId));
  await generateFixtures(w.client, ORG, competitionId);
  const fixtures = () => [...w.t.fixtures!.values()].filter((f) => f['competition_id'] === competitionId);
  return { ...w, competitionId, fixtures };
}

describe('creating and editing an event', () => {
  it('stores charity details, host and sponsors; only the organiser can edit', async () => {
    const { t, client } = world();
    const { competitionId } = await createCompetitionV2(client, ORG, {
      ...base,
      format: 'round_robin',
      hostName: 'Lusaka Rotary',
      causeName: 'Kids Sports Fund',
      fundraisingNote: 'Raising K20,000 for school kits',
      registrationQuestions: [{ label: 'Company', required: true }],
    } as never);
    const row = t.competitions!.get(competitionId)!;
    expect(row['category']).toBe('charity');
    expect(row['host_name']).toBe('Lusaka Rotary');
    expect(row['cause_name']).toBe('Kids Sports Fund');
    await upsertSponsor(client, ORG, { competitionId, name: 'Zambeef', tier: 'title' });
    expect([...t.competition_sponsors!.values()][0]?.['tier']).toBe('title');
    await expect(upsertSponsor(client, STRANGER, { competitionId, name: 'X', tier: 'partner' })).rejects.toMatchObject({ status: 403 });
    await updateCompetition(client, ORG, { competitionId, description: 'A day of 5-a-side for a good cause', bannerUrl: 'https://example.com/b.jpg' });
    expect(t.competitions!.get(competitionId)?.['banner_url']).toBe('https://example.com/b.jpg');
    await expect(updateCompetition(client, STRANGER, { competitionId, name: 'Mine' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('team registration', () => {
  it('needs approval when the organiser asks for it, and keeps contact details private', async () => {
    const { client } = world();
    const { competitionId } = await createCompetitionV2(client, ORG, { ...base, format: 'round_robin', registrationQuestions: [{ label: 'Company', required: true }] } as never);
    expect((await registerTeam(client, captain(1), reg(1, competitionId))).status).toBe('pending');
    const entries = await entriesForOrganiser(client, ORG, competitionId);
    expect(entries[0]).toMatchObject({ teamName: 'Team 1', contactPhone: '0977000000', status: 'pending' });
    expect(entries[0]?.answers[0]?.answer).toBe('Company 1');
    await expect(entriesForOrganiser(client, captain(1), competitionId)).rejects.toMatchObject({ status: 403 });
    expect((await reviewEntry(client, ORG, { competitionId, teamId: team(1), decision: 'approve' })).status).toBe('approved');
    await expect(reviewEntry(client, captain(1), { competitionId, teamId: team(1), decision: 'reject' })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses players, other sports, missing answers, closed and full competitions', async () => {
    const { t, client } = world(3);
    t.team_members!.set(`${team(1)}:${STRANGER}`, { team_id: team(1), user_id: STRANGER, role: 'player' });
    const { competitionId } = await createCompetitionV2(client, ORG, { ...base, format: 'round_robin', maxEntries: 2, registrationQuestions: [{ label: 'Company', required: true }] } as never);
    await expect(registerTeam(client, STRANGER, reg(1, competitionId))).rejects.toMatchObject({ status: 403 });
    await expect(registerTeam(client, captain(99), { ...reg(1, competitionId), teamId: team(99) })).rejects.toMatchObject({ status: 409 });
    await expect(registerTeam(client, captain(1), { ...reg(1, competitionId), answers: [] })).rejects.toMatchObject({ status: 400 });
    await registerTeam(client, captain(1), reg(1, competitionId));
    await registerTeam(client, captain(2), reg(2, competitionId));
    await expect(registerTeam(client, captain(3), reg(3, competitionId))).rejects.toMatchObject({ status: 409 });
    await withdrawEntry(client, captain(2), { competitionId, teamId: team(2) });
    expect((await registerTeam(client, captain(3), reg(3, competitionId))).status).toBe('pending');
    t.competitions!.get(competitionId)!['registration_closes_at'] = new Date(Date.now() - 1000).toISOString();
    await expect(registerTeam(client, captain(2), reg(2, competitionId))).rejects.toMatchObject({ status: 409 });
  });
});

describe('making the fixtures', () => {
  it('builds a full league and starts the competition', async () => {
    const { t, competitionId, fixtures } = await liveLeague(4);
    expect(fixtures()).toHaveLength(6);
    expect(t.competitions!.get(competitionId)?.['status']).toBe('live');
    expect(fixtures().every((f) => f['stage'] === 'league' && f['round'])).toBe(true);
  });

  it('builds a knockout with byes going straight through', async () => {
    const { fixtures } = await liveLeague(5, 'knockout');
    const r1 = fixtures().filter((f) => f['round'] === 1);
    const r2 = fixtures().filter((f) => f['round'] === 2);
    const final = fixtures().filter((f) => f['round'] === 3);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(2);
    expect(final).toHaveLength(1);
    const placed = r2.flatMap((f) => [f['home_team_id'], f['away_team_id']]).filter(Boolean);
    expect(placed).toHaveLength(3);
  });

  it('draws groups, then the knockout once the groups are played', async () => {
    const w = await liveLeague(8, 'groups_knockout', { groupCount: 2, advancePerGroup: 2 });
    const groupGames = w.fixtures().filter((f) => f['stage'] === 'group');
    expect(groupGames).toHaveLength(12);
    await expect(startKnockout(w.client, ORG, w.competitionId)).rejects.toMatchObject({ status: 409 });
    for (const f of groupGames) {
      f['status'] = 'finished';
      f['home_score'] = 1;
      f['away_score'] = 0;
    }
    await startKnockout(w.client, ORG, w.competitionId);
    const ko = w.fixtures().filter((f) => f['stage'] === 'knockout');
    expect(ko.filter((f) => f['round'] === 1)).toHaveLength(2);
    expect(ko.filter((f) => f['round'] === 2)).toHaveLength(1);
  });
});

describe('results', () => {
  it('one captain reports, the other confirms, and it counts', async () => {
    const { t, client, fixtures } = await liveLeague(2);
    const f = fixtures()[0]!;
    const home = String(f['home_team_id']);
    const away = String(f['away_team_id']);
    const capOf = (teamId: string) => captain(Number(teamId.slice(-3)) - 200);
    expect((await reportResult(client, capOf(home), { fixtureId: String(f['id']), homeScore: 2, awayScore: 1 })).state).toBe('awaiting_confirmation');
    await expect(confirmResult(client, capOf(home), String(f['id']))).rejects.toMatchObject({ status: 403 });
    expect((await confirmResult(client, capOf(away), String(f['id']))).state).toBe('final');
    const after = t.fixtures!.get(String(f['id']))!;
    expect(after).toMatchObject({ status: 'finished', home_score: 2, away_score: 1 });
  });

  it('marks a disagreement as disputed and lets the organiser settle it', async () => {
    const { t, client, fixtures } = await liveLeague(2);
    const f = fixtures()[0]!;
    const capOf = (teamId: string) => captain(Number(teamId.slice(-3)) - 200);
    await reportResult(client, capOf(String(f['home_team_id'])), { fixtureId: String(f['id']), homeScore: 2, awayScore: 1 });
    expect((await reportResult(client, capOf(String(f['away_team_id'])), { fixtureId: String(f['id']), homeScore: 1, awayScore: 1 })).state).toBe('disputed');
    expect(t.fixtures!.get(String(f['id']))?.['status']).toBe('disputed');
    await expect(reportResult(client, STRANGER, { fixtureId: String(f['id']), homeScore: 0, awayScore: 0 })).rejects.toMatchObject({ status: 403 });
    expect((await reportResult(client, ORG, { fixtureId: String(f['id']), homeScore: 2, awayScore: 1 })).state).toBe('final');
    expect(t.fixtures!.get(String(f['id']))?.['status']).toBe('finished');
  });

  it('needs a shoot-out winner in a level knockout game and moves winners through to a champion', async () => {
    const { t, client, competitionId, fixtures } = await liveLeague(4, 'knockout');
    const semis = fixtures().filter((f) => f['round'] === 1);
    await expect(reportResult(client, ORG, { fixtureId: String(semis[0]!['id']), homeScore: 1, awayScore: 1 })).rejects.toMatchObject({ status: 400 });
    await reportResult(client, ORG, { fixtureId: String(semis[0]!['id']), homeScore: 1, awayScore: 1, winnerTeamId: String(semis[0]!['away_team_id']) });
    await reportResult(client, ORG, { fixtureId: String(semis[1]!['id']), homeScore: 3, awayScore: 0 });
    const final = fixtures().find((f) => f['round'] === 2)!;
    expect(final['home_team_id']).toBe(semis[0]!['away_team_id']);
    expect(final['away_team_id']).toBe(semis[1]!['home_team_id']);
    expect(t.competitions!.get(competitionId)?.['status']).toBe('live');
    await reportResult(client, ORG, { fixtureId: String(final['id']), homeScore: 2, awayScore: 0 });
    expect(t.competitions!.get(competitionId)?.['status']).toBe('finished');
  });
});

describe('weekly series', () => {
  const series = {
    sportId: SPORT,
    title: 'Tuesday 5s',
    weekday: 2,
    time: '18:00',
    intervalWeeks: 1 as const,
    startsOn: '2026-11-01',
    area: 'Woodlands',
    capacity: 3,
    level: 'recreational' as const,
    visibility: 'public' as const,
  };

  it('keeps four games ahead, with the host and regulars already in', async () => {
    const { t, client } = world();
    const { seriesId, matchIds } = await createSeries(client, ORG, series);
    expect(matchIds).toHaveLength(4);
    expect(t.match_participants!.get(`${matchIds[0]}:${ORG}`)?.['status']).toBe('joined');
    expect((await joinSeries(client, captain(1), seriesId)).joined).toBe(4);
    expect(await topUpSeries(client, seriesId)).toEqual([]);
  });

  it('the daily job tops up every active series and skips ended ones', async () => {
    const { t, client } = world();
    const a = await createSeries(client, ORG, series);
    const b = await createSeries(client, ORG, { ...series, title: 'Thursday 5s', weekday: 4 });
    t.match_series!.get(b.seriesId)!['status'] = 'ended';
    const later = new Date(Date.now() + 15 * 86400000);
    const out = await topUpAllSeries(client, later);
    expect(out.series).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.created).toBeGreaterThan(0);
    expect([...t.matches!.values()].filter((m) => m['series_id'] === b.seriesId)).toHaveLength(4);
    expect([...t.matches!.values()].filter((m) => m['series_id'] === a.seriesId).length).toBeGreaterThan(4);
  });

  it('the job endpoint needs the scheduler secret', () => {
    const before = process.env['CRON_SECRET'];
    process.env['CRON_SECRET'] = 'a-long-cron-secret-123';
    expect(cronAllowed('a-long-cron-secret-123')).toBe(true);
    expect(cronAllowed('wrong')).toBe(false);
    expect(cronAllowed(undefined)).toBe(false);
    process.env['CRON_SECRET'] = 'short';
    expect(cronAllowed('short')).toBe(false);
    if (before === undefined) delete process.env['CRON_SECRET']; else process.env['CRON_SECRET'] = before;
  });

  it('skips a week without recreating it, and fills games only up to capacity', async () => {
    const { t, client } = world();
    const { seriesId, matchIds } = await createSeries(client, ORG, series);
    await skipOccurrence(client, ORG, { matchId: matchIds[0]! });
    expect(t.matches!.get(matchIds[0]!)?.['status']).toBe('cancelled');
    expect(await topUpSeries(client, seriesId)).toEqual([]);
    await joinSeries(client, captain(1), seriesId);
    await joinSeries(client, captain(2), seriesId);
    const later = new Date(Date.now() + 40 * 86400000);
    const added = await topUpSeries(client, seriesId, later);
    expect(added.length).toBeGreaterThan(0);
    expect(t.matches!.get(added[0]!)?.['status']).toBe('full');
    await expect(skipOccurrence(client, STRANGER, { matchId: matchIds[1]! })).rejects.toMatchObject({ status: 403 });
  });
});
