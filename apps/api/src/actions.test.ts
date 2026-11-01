import { describe, expect, it } from 'vitest';
import {
  ActionError,
  acceptChallenge,
  answerPoll,
  cancelBooking,
  checkInTicket,
  createMatch,
  createPoll,
  createTeam,
  createVenue,
  createVenueSlot,
  joinMatch,
  postChallenge,
  proposeTime,
  reportScore,
  requestBooking,
  respondBooking,
  withdrawMatch,
} from './actions.js';

type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: unknown; count: number | null; error: null }> {
  private filters: { col: string; val: unknown }[] = [];
  private op: 'select' | 'insert' | 'upsert' | 'update' = 'select';
  private payload: Row | Row[] | null = null;
  private wantCount = false;
  private conflict: string | null = null;

  constructor(
    private table: Map<string, Row>,
    private keyOf: (row: Row) => string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (opts?.count) this.wantCount = true;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ col, val });
    return this;
  }

  insert(row: Row): this {
    this.op = 'insert';
    this.payload = row;
    return this;
  }

  upsert(row: Row, opts?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.payload = row;
    this.conflict = opts?.onConflict ?? null;
    return this;
  }

  update(patch: Row): this {
    this.op = 'update';
    this.payload = patch;
    return this;
  }

  maybeSingle(): PromiseLike<{ data: unknown; count: number | null; error: null }> {
    return Promise.resolve(this.run(true));
  }

  single(): PromiseLike<{ data: unknown; count: number | null; error: null }> {
    return Promise.resolve(this.run(false));
  }

  then<TResult1 = { data: unknown; count: number | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; count: number | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run(false)).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => row[f.col] === f.val);
  }

  private run(single: boolean): { data: unknown; count: number | null; error: null } {
    if (this.op === 'insert' || this.op === 'upsert') {
      const row = { ...(this.payload as Row) };
      if (row['id'] === undefined) row['id'] = crypto.randomUUID();
      const key = this.keyOf(row);
      const existing = this.table.get(key);
      if (this.op === 'insert' && existing && this.conflict === null) {
        return { data: null, count: null, error: null };
      }
      this.table.set(key, { ...(existing ?? {}), ...row });
      return { data: this.table.get(key) ?? null, count: null, error: null };
    }
    if (this.op === 'update') {
      for (const [key, row] of this.table.entries()) {
        if (this.matches(row)) this.table.set(key, { ...row, ...(this.payload as Row) });
      }
      return { data: null, count: null, error: null };
    }
    const rows = [...this.table.values()].filter((r) => this.matches(r));
    if (this.wantCount) return { data: null, count: rows.length, error: null };
    if (single) return { data: rows[0] ?? null, count: null, error: null };
    return { data: rows, count: null, error: null };
  }
}

function fakeDb() {
  const matches = new Map<string, Row>();
  const participants = new Map<string, Row>();
  const teams = new Map<string, Row>();
  const members = new Map<string, Row>();
  const challenges = new Map<string, Row>();
  const venues = new Map<string, Row>();
  const slots = new Map<string, Row>();
  const bookings = new Map<string, Row>();
  const tickets = new Map<string, Row>();
  const polls = new Map<string, Row>();
  const pollResponses = new Map<string, Row>();
  const client = {
    from(table: string) {
      if (table === 'matches') return new FakeQuery(matches, (r) => String(r['id']));
      if (table === 'match_participants') {
        return new FakeQuery(participants, (r) => `${String(r['match_id'])}:${String(r['user_id'])}`);
      }
      if (table === 'teams') return new FakeQuery(teams, (r) => String(r['id']));
      if (table === 'team_members') {
        return new FakeQuery(members, (r) => `${String(r['team_id'])}:${String(r['user_id'])}`);
      }
      if (table === 'challenges') return new FakeQuery(challenges, (r) => String(r['id']));
      if (table === 'venues') return new FakeQuery(venues, (r) => String(r['id']));
      if (table === 'venue_slots') return new FakeQuery(slots, (r) => String(r['id']));
      if (table === 'bookings') return new FakeQuery(bookings, (r) => String(r['id']));
      if (table === 'tickets') return new FakeQuery(tickets, (r) => String(r['id']));
      if (table === 'polls') return new FakeQuery(polls, (r) => String(r['id']));
      if (table === 'poll_responses') {
        return new FakeQuery(pollResponses, (r) => `${String(r['poll_id'])}:${String(r['user_id'])}`);
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, matches, participants, teams, members, challenges, venues, slots, bookings, tickets, polls, pollResponses };
}

const ORGANISER = '11111111-1111-4111-8111-111111111111';
const PLAYER_A = '22222222-2222-4222-8222-222222222222';
const PLAYER_B = '33333333-3333-4333-8333-333333333333';
const SPORT_ID = '123e4567-e89b-12d3-a456-426614174000';

function matchInput(capacity = 2) {
  return {
    sportId: SPORT_ID,
    title: 'Saturday football',
    startsAt: '2026-10-31T13:00:00.000Z',
    area: 'Woodlands',
    capacity,
    level: 'intermediate' as const,
    visibility: 'public' as const,
  };
}

describe('createMatch', () => {
  it('auto-joins the organiser as the first player', async () => {
    const { client, matches } = fakeDb();
    const result = await createMatch(client, ORGANISER, matchInput());
    expect(result.state).toBe('organiser');
    expect(result.joinedCount).toBe(1);
    expect(result.actions).toContain('withdraw');
    expect(matches.size).toBe(1);
  });
});

describe('joinMatch', () => {
  it('fills to capacity then refuses the next join', async () => {
    const { client } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(2));
    const joined = await joinMatch(client, PLAYER_A, created.matchId);
    expect(joined.state).toBe('joined');
    expect(joined.joinedCount).toBe(2);
    expect(joined.actions).toEqual(['withdraw', 'directions']);
    await expect(joinMatch(client, PLAYER_B, created.matchId)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('is idempotent for someone already in', async () => {
    const { client } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(3));
    await joinMatch(client, PLAYER_A, created.matchId);
    const again = await joinMatch(client, PLAYER_A, created.matchId);
    expect(again.joinedCount).toBe(2);
  });

  it('refuses team-vs-team matches', async () => {
    const { client, matches } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(3));
    const row = matches.get(created.matchId);
    if (row) row['kind'] = 'team-vs-team';
    await expect(joinMatch(client, PLAYER_A, created.matchId)).rejects.toBeInstanceOf(ActionError);
  });
});

type TeamResult = { team: { id: string } };
type ChallengeResult = { state: string; challenge: { id: string }; matchId?: string };

async function twoTeams(client: never) {
  const a = (await createTeam(client, ORGANISER, {
    name: 'Finance FC',
    sportId: SPORT_ID,
    category: 'corporate',
    area: 'Woodlands',
  })) as TeamResult;
  const b = (await createTeam(client, PLAYER_A, {
    name: 'Riverside United',
    sportId: SPORT_ID,
    category: 'neighbourhood',
    area: 'Riverside',
  })) as TeamResult;
  return { homeId: a.team.id, awayId: b.team.id };
}

function challengeInput(teamId: string) {
  return {
    teamId,
    level: 'intermediate' as const,
    windowStart: '2026-10-31T13:00:00.000Z',
    windowEnd: '2026-10-31T17:00:00.000Z',
    area: 'Woodlands',
    radiusKm: 10,
  };
}

describe('teams and challenges', () => {
  it('creates a team with the creator as owner', async () => {
    const { client, members } = fakeDb();
    const { homeId } = await twoTeams(client);
    expect(members.get(`${homeId}:${ORGANISER}`)?.['role']).toBe('owner');
  });

  it('accepting a challenge creates the team-vs-team match', async () => {
    const { client, matches, challenges } = fakeDb();
    const { homeId, awayId } = await twoTeams(client);
    const posted = (await postChallenge(client, ORGANISER, challengeInput(homeId))) as ChallengeResult;
    const accepted = (await acceptChallenge(client, PLAYER_A, posted.challenge.id, awayId)) as ChallengeResult;
    expect(accepted.state).toBe('accepted');
    expect(accepted.matchId).toBeTruthy();
    expect(matches.get(String(accepted.matchId))?.['kind']).toBe('team-vs-team');
    expect(challenges.get(posted.challenge.id)?.['status']).toBe('accepted');
  });

  it('refuses a team accepting its own challenge', async () => {
    const { client } = fakeDb();
    const { homeId } = await twoTeams(client);
    const posted = (await postChallenge(client, ORGANISER, challengeInput(homeId))) as ChallengeResult;
    await expect(acceptChallenge(client, ORGANISER, posted.challenge.id, homeId)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('lets the posting captain accept a proposed new time', async () => {
    const { client, matches } = fakeDb();
    const { homeId, awayId } = await twoTeams(client);
    const posted = (await postChallenge(client, ORGANISER, challengeInput(homeId))) as ChallengeResult;
    await proposeTime(client, PLAYER_A, posted.challenge.id, awayId, '2026-11-01T10:00:00.000Z');
    const accepted = (await acceptChallenge(client, ORGANISER, posted.challenge.id, homeId)) as ChallengeResult;
    expect(matches.get(String(accepted.matchId))?.['starts_at']).toBe('2026-11-01T10:00:00.000Z');
  });
});

type VenueResult = { venue: { id: string }; slot?: { id: string } };
type BookingResult = { state: string; booking: { id: string }; ticket?: { id: string; code: string; status: string } | null };

async function venueWithSlot(client: never, capacity = 1) {
  const created = (await createVenue(client, ORGANISER, {
    name: 'Woodlands Community Pitch',
    area: 'Woodlands',
    sports: ['Football'],
    facilityTypes: ['grass pitch'],
    priceNote: 'Free — MVP demo',
  })) as VenueResult;
  const slot = (await createVenueSlot(client, ORGANISER, {
    venueId: created.venue.id,
    startsAt: '2026-11-07T13:00:00.000Z',
    endsAt: '2026-11-07T15:00:00.000Z',
    capacity,
  })) as { slot: { id: string } };
  return { venueId: created.venue.id, slotId: slot.slot.id };
}

describe('venue bookings (free)', () => {
  it('confirming a booking issues a free ticket the owner can check in', async () => {
    const { client, tickets } = fakeDb();
    const { venueId, slotId } = await venueWithSlot(client);
    const asked = (await requestBooking(client, PLAYER_A, { venueId, slotId })) as BookingResult;
    expect(asked.state).toBe('requested');
    const confirmed = (await respondBooking(client, ORGANISER, asked.booking.id, 'confirm')) as BookingResult;
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.ticket?.code).toMatch(/^CHB-/);
    expect(confirmed.ticket?.status).toBe('issued');
    const used = (await checkInTicket(client, ORGANISER, String(confirmed.ticket?.id))) as BookingResult;
    expect(used.state).toBe('used');
    expect([...tickets.values()][0]?.['status']).toBe('used');
  });

  it('refuses to confirm past slot capacity and refuses duplicate requests', async () => {
    const { client } = fakeDb();
    const { venueId, slotId } = await venueWithSlot(client, 1);
    const first = (await requestBooking(client, PLAYER_A, { venueId, slotId })) as BookingResult;
    await expect(requestBooking(client, PLAYER_A, { venueId, slotId })).rejects.toMatchObject({ status: 409 });
    const second = (await requestBooking(client, PLAYER_B, { venueId, slotId })) as BookingResult;
    await respondBooking(client, ORGANISER, first.booking.id, 'confirm');
    await expect(respondBooking(client, ORGANISER, second.booking.id, 'confirm')).rejects.toMatchObject({ status: 409 });
  });

  it('only the venue owner can add slots or confirm, and cancelling voids the ticket', async () => {
    const { client, tickets } = fakeDb();
    const { venueId, slotId } = await venueWithSlot(client);
    await expect(
      createVenueSlot(client, PLAYER_A, {
        venueId,
        startsAt: '2026-11-08T13:00:00.000Z',
        endsAt: '2026-11-08T15:00:00.000Z',
        capacity: 1,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const asked = (await requestBooking(client, PLAYER_A, { venueId, slotId })) as BookingResult;
    await expect(respondBooking(client, PLAYER_B, asked.booking.id, 'confirm')).rejects.toMatchObject({ status: 403 });
    await respondBooking(client, ORGANISER, asked.booking.id, 'confirm');
    const cancelled = (await cancelBooking(client, PLAYER_A, asked.booking.id)) as BookingResult;
    expect(cancelled.state).toBe('cancelled');
    expect([...tickets.values()][0]?.['status']).toBe('cancelled');
  });
});

describe('withdrawMatch', () => {
  it('frees a seat so someone else can take it', async () => {
    const { client } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(2));
    await joinMatch(client, PLAYER_A, created.matchId);
    const left = await withdrawMatch(client, PLAYER_A, created.matchId);
    expect(left.state).toBe('not_joined');
    expect(left.joinedCount).toBe(1);
    const taken = await joinMatch(client, PLAYER_B, created.matchId);
    expect(taken.joinedCount).toBe(2);
  });

  it('keeps an organiser who steps out as organiser', async () => {
    const { client } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(3));
    const left = await withdrawMatch(client, ORGANISER, created.matchId);
    expect(left.state).toBe('organiser');
  });
});

const TEAM_ID = '44444444-4444-4444-8444-444444444444';

describe('availability polls', () => {
  it('lets a member poll the team', async () => {
    const { client, members, polls } = fakeDb();
    members.set(`${TEAM_ID}:${ORGANISER}`, { team_id: TEAM_ID, user_id: ORGANISER, role: 'captain' });
    members.set(`${TEAM_ID}:${PLAYER_A}`, { team_id: TEAM_ID, user_id: PLAYER_A, role: 'player' });
    const result = (await createPoll(client, ORGANISER, {
      teamId: TEAM_ID,
      question: 'In for Saturday 9am?',
    })) as { state: string; poll: { id: string } };
    expect(result.state).toBe('open');
    expect(polls.size).toBe(1);
  });

  it('refuses polls from non-members', async () => {
    const { client } = fakeDb();
    await expect(
      createPoll(client, PLAYER_B, { teamId: TEAM_ID, question: 'In?' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('records and updates answers, and refuses closed polls', async () => {
    const { client, members, polls } = fakeDb();
    members.set(`${TEAM_ID}:${ORGANISER}`, { team_id: TEAM_ID, user_id: ORGANISER, role: 'captain' });
    members.set(`${TEAM_ID}:${PLAYER_A}`, { team_id: TEAM_ID, user_id: PLAYER_A, role: 'player' });
    const created = (await createPoll(client, ORGANISER, { teamId: TEAM_ID, question: 'In?' })) as {
      poll: { id: string };
    };
    const first = (await answerPoll(client, PLAYER_A, { pollId: created.poll.id, response: 'in' })) as {
      response: string;
    };
    expect(first.response).toBe('in');
    const changed = (await answerPoll(client, PLAYER_A, { pollId: created.poll.id, response: 'out' })) as {
      response: string;
    };
    expect(changed.response).toBe('out');
    const poll = polls.get(created.poll.id);
    if (poll) poll['status'] = 'closed';
    await expect(
      answerPoll(client, PLAYER_A, { pollId: created.poll.id, response: 'in' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses answers from non-members', async () => {
    const { client, members } = fakeDb();
    members.set(`${TEAM_ID}:${ORGANISER}`, { team_id: TEAM_ID, user_id: ORGANISER, role: 'captain' });
    const created = (await createPoll(client, ORGANISER, { teamId: TEAM_ID, question: 'In?' })) as {
      poll: { id: string };
    };
    await expect(
      answerPoll(client, PLAYER_B, { pollId: created.poll.id, response: 'in' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('reportScore', () => {
  it('lets the organiser report the score', async () => {
    const { client, matches } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(4));
    const result = (await reportScore(client, ORGANISER, {
      matchId: created.matchId,
      homeScore: 3,
      awayScore: 2,
    })) as { state: string; match: { home_score: number; away_score: number } };
    expect(result.state).toBe('reported');
    expect(result.match.home_score).toBe(3);
    expect(matches.get(created.matchId)?.['away_score']).toBe(2);
  });

  it('refuses scores from non-organisers', async () => {
    const { client } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(4));
    await expect(
      reportScore(client, PLAYER_A, { matchId: created.matchId, homeScore: 1, awayScore: 0 }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
