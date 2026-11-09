import { describe, expect, it } from 'vitest';
import {
  ActionError,
  acceptChallenge,
  addDiscipline,
  addPlace,
  answerPoll,
  blockUser,
  cancelBooking,
  checkInTicket,
  claimInviteLink,
  createCircle,
  createInviteLink,
  createMatch,
  createPoll,
  createTeam,
  createVenue,
  createVenueSlot,
  deleteTeam,
  joinMatch,
  postChallenge,
  proposeTime,
  removeMember,
  removePlace,
  reportScore,
  reportTeam,
  reportUser,
  requestBooking,
  respondBooking,
  revokeInviteLink,
  setAvailability,
  setGameTypes,
  setPosition,
  setRole,
  setSports,
  unblockUser,
  updateCircle,
  updateProfile,
  updateTeam,
  withdrawMatch,
} from './actions.js';

type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: unknown; count: number | null; error: null }> {
  private filters: { col: string; val: unknown }[] = [];
  private inFilters: { col: string; vals: unknown[] }[] = [];
  private nullFilters: string[] = [];
  private take: number | null = null;
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
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

  is(col: string, val: null): this {
    if (val === null) this.nullFilters.push(col);
    else this.filters.push({ col, val });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this.inFilters.push({ col, vals });
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  limit(n: number): this {
    this.take = n;
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
    return Promise.resolve(this.run(true));
  }

  then<TResult1 = { data: unknown; count: number | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; count: number | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run(false)).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return (
      this.filters.every((f) => row[f.col] === f.val) &&
      this.inFilters.every((f) => f.vals.includes(row[f.col])) &&
      this.nullFilters.every((c) => row[c] == null)
    );
  }

  private run(single: boolean): { data: unknown; count: number | null; error: null } {
    if (this.op === 'insert' || this.op === 'upsert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const written: Row[] = [];
      for (const item of rows) {
        const row = { ...item };
        if (row['id'] === undefined) row['id'] = crypto.randomUUID();
        const key = this.keyOf(row);
        const existing = this.table.get(key);
        if (this.op === 'insert' && existing && this.conflict === null) {
          return { data: null, count: null, error: null };
        }
        this.table.set(key, { ...(existing ?? {}), ...row });
        written.push(this.table.get(key) ?? row);
      }
      if (single) return { data: written[written.length - 1] ?? null, count: null, error: null };
      // Like the real client: an array insert always returns a list.
      if (Array.isArray(this.payload)) return { data: written, count: null, error: null };
      return { data: written.length === 1 ? (written[0] ?? null) : written, count: null, error: null };
    }
    if (this.op === 'update') {
      // Match first, like WHERE, then return the updated rows the way
      // RETURNING does — never re-filter on the new values.
      const matched = [...this.table.entries()].filter(([, row]) => this.matches(row));
      for (const [key, row] of matched) this.table.set(key, { ...row, ...(this.payload as Row) });
      const rows = matched.map(([, row]) => ({ ...row, ...(this.payload as Row) }));
      if (single) return { data: rows[0] ?? null, count: null, error: null };
      return { data: rows, count: null, error: null };
    }
    if (this.op === 'delete') {
      for (const [key, row] of this.table.entries()) {
        if (this.matches(row)) this.table.delete(key);
      }
      return { data: null, count: null, error: null };
    }
    let rows = [...this.table.values()].filter((r) => this.matches(r));
    if (this.take != null) rows = rows.slice(0, this.take);
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
  const entries = new Map<string, Row>();
  const profiles = new Map<string, Row>();
  const availability = new Map<string, Row>();
  const places = new Map<string, Row>();
  const gameTypes = new Map<string, Row>();
  const circles = new Map<string, Row>();
  const circleMembers = new Map<string, Row>();
  const sports = new Map<string, Row>();
  const userSports = new Map<string, Row>();
  const invites = new Map<string, Row>();
  const reports = new Map<string, Row>();
  const blocks = new Map<string, Row>();
  const ticketing = new Map<string, Row>();
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
      if (table === 'competition_entries') return new FakeQuery(entries, (r) => String(r['id']));
      if (table === 'profiles') return new FakeQuery(profiles, (r) => String(r['id']));
      if (table === 'user_availability') {
        return new FakeQuery(availability, (r) => `${String(r['user_id'])}:${String(r['day'])}:${String(r['time_band'])}`);
      }
      if (table === 'user_places') return new FakeQuery(places, (r) => String(r['id']));
      if (table === 'user_game_types') {
        return new FakeQuery(gameTypes, (r) => `${String(r['user_id'])}:${String(r['game_type'])}`);
      }
      if (table === 'sports') return new FakeQuery(sports, (r) => String(r['id']));
      if (table === 'user_sports') {
        return new FakeQuery(userSports, (r) => `${String(r['user_id'])}:${String(r['sport_id'])}`);
      }
      if (table === 'circles') return new FakeQuery(circles, (r) => String(r['id']));
      if (table === 'circle_members') {
        return new FakeQuery(circleMembers, (r) => `${String(r['circle_id'])}:${String(r['user_id'])}`);
      }
      if (table === 'match_ticketing') return new FakeQuery(ticketing, (r) => String(r['match_id']));
      if (table === 'invite_links') return new FakeQuery(invites, (r) => String(r['code']));
      if (table === 'reports') return new FakeQuery(reports, (r) => String(r['id']));
      if (table === 'blocks') {
        return new FakeQuery(blocks, (r) => `${String(r['blocker_id'])}:${String(r['blocked_user_id'])}`);
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, matches, participants, teams, members, challenges, venues, slots, bookings, tickets, polls, pollResponses, profiles, availability, places, gameTypes, sports, userSports, invites, reports, blocks, entries, circles, circleMembers, ticketing };
}

const ORGANISER = '11111111-1111-4111-8111-111111111111';
const PLAYER_A = '22222222-2222-4222-8222-222222222222';
const PLAYER_B = '33333333-3333-4333-8333-333333333333';
const SPORT_ID = '123e4567-e89b-12d3-a456-426614174000';

// A week from now, so these games stay joinable whenever the suite runs.
const nextWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function matchInput(capacity = 2, startsAt: string = nextWeek()) {
  return {
    sportId: SPORT_ID,
    title: 'Saturday football',
    startsAt,
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
  it('refuses a game that has already started, even if it is still marked open', async () => {
    const { client, matches } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(2));
    // The game's time passes while its status stays "open".
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    for (const row of matches.values()) row['starts_at'] = past;
    await expect(joinMatch(client, PLAYER_A, created.matchId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('already started'),
    });
  });

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

  it('refuses the free join on a game that sells tickets', async () => {
    const { client, ticketing } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(5));
    ticketing.set(created.matchId, { match_id: created.matchId, waitapp_event_id: 'wa-1' });
    await expect(joinMatch(client, PLAYER_A, created.matchId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Buy a ticket'),
    });
  });

  it('refuses the free withdraw on a game that sells tickets', async () => {
    const { client, ticketing } = fakeDb();
    const created = await createMatch(client, ORGANISER, matchInput(5));
    await joinMatch(client, PLAYER_A, created.matchId);
    ticketing.set(created.matchId, { match_id: created.matchId, waitapp_event_id: 'wa-1' });
    await expect(withdrawMatch(client, PLAYER_A, created.matchId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('refund'),
    });
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

async function oneTeam(client: never, owner: string) {
  const t = (await createTeam(client, owner, {
    name: 'Avondale Hoops',
    sportId: SPORT_ID,
    category: 'neighbourhood',
    area: 'Avondale',
  })) as TeamResult;
  return t.team.id;
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

// Venues start pending until a platform admin approves them; most tests want a live one.
async function venueWithSlot(client: never, capacity = 1, approveIn?: Map<string, Record<string, unknown>>) {
  const created = (await createVenue(client, ORGANISER, {
    name: 'Woodlands Community Pitch',
    area: 'Woodlands',
    sports: ['Football'],
    facilityTypes: ['grass pitch'],
    priceNote: 'Free — MVP demo',
  })) as VenueResult;
  if (approveIn) {
    const row = approveIn.get(created.venue.id);
    if (row) row['status'] = 'approved';
  }
  const slot = (await createVenueSlot(client, ORGANISER, {
    venueId: created.venue.id,
    startsAt: '2026-11-07T13:00:00.000Z',
    endsAt: '2026-11-07T15:00:00.000Z',
    capacity,
    repeatWeeks: 1,
  })) as { slot: { id: string } };
  return { venueId: created.venue.id, slotId: slot.slot.id };
}

describe('venue bookings (free)', () => {
  it('confirming a booking issues a free ticket the owner can check in', async () => {
    const { client, tickets, venues } = fakeDb();
    const { venueId, slotId } = await venueWithSlot(client, 1, venues);
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
    const { client, venues } = fakeDb();
    const { venueId, slotId } = await venueWithSlot(client, 1, venues);
    const first = (await requestBooking(client, PLAYER_A, { venueId, slotId })) as BookingResult;
    await expect(requestBooking(client, PLAYER_A, { venueId, slotId })).rejects.toMatchObject({ status: 409 });
    const second = (await requestBooking(client, PLAYER_B, { venueId, slotId })) as BookingResult;
    await respondBooking(client, ORGANISER, first.booking.id, 'confirm');
    await expect(respondBooking(client, ORGANISER, second.booking.id, 'confirm')).rejects.toMatchObject({ status: 409 });
  });

  it('only the venue owner can add slots or confirm, and cancelling voids the ticket', async () => {
    const { client, tickets, venues } = fakeDb();
    const { venueId, slotId } = await venueWithSlot(client, 1, venues);
    await expect(
      createVenueSlot(client, PLAYER_A, {
        venueId,
        startsAt: '2026-11-08T13:00:00.000Z',
        endsAt: '2026-11-08T15:00:00.000Z',
        capacity: 1,
        repeatWeeks: 1,
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

describe('venue approval and slot prices', () => {
  it('a new venue starts pending and cannot take bookings', async () => {
    const { client, venues } = fakeDb();
    const { venueId, slotId } = await venueWithSlot(client);
    expect(venues.get(venueId)?.['status']).toBe('pending');
    await expect(requestBooking(client, PLAYER_A, { venueId, slotId })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('waiting for approval'),
    });
  });

  it('createVenue reports the pending state', async () => {
    const { client } = fakeDb();
    const created = (await createVenue(client, ORGANISER, {
      name: 'New Court',
      area: 'Kabulonga',
      sports: ['Tennis'],
      facilityTypes: [],
      priceNote: 'Free',
    })) as { state: string };
    expect(created.state).toBe('pending_review');
  });

  it('repeatWeeks creates one slot per week', async () => {
    const { client, slots, venues } = fakeDb();
    const { venueId } = await venueWithSlot(client, 1, venues);
    slots.clear();
    const made = (await createVenueSlot(client, ORGANISER, {
      venueId,
      startsAt: '2026-12-01T16:00:00.000Z',
      endsAt: '2026-12-01T18:00:00.000Z',
      capacity: 1,
      repeatWeeks: 3,
    })) as { created: number };
    expect(made.created).toBe(3);
    const starts = [...slots.values()].map((r) => String(r['starts_at'])).sort();
    expect(starts).toEqual(['2026-12-01T16:00:00.000Z', '2026-12-08T16:00:00.000Z', '2026-12-15T16:00:00.000Z']);
  });

  it('a priced slot needs a currency and is not bookable for free', async () => {
    const { client, venues } = fakeDb();
    const { venueId } = await venueWithSlot(client, 1, venues);
    await expect(
      createVenueSlot(client, ORGANISER, {
        venueId,
        startsAt: '2026-12-02T16:00:00.000Z',
        endsAt: '2026-12-02T18:00:00.000Z',
        capacity: 1,
        repeatWeeks: 1,
        price: 150,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const priced = (await createVenueSlot(client, ORGANISER, {
      venueId,
      startsAt: '2026-12-02T16:00:00.000Z',
      endsAt: '2026-12-02T18:00:00.000Z',
      capacity: 1,
      repeatWeeks: 1,
      price: 150,
      currency: 'ZMW',
    })) as { slot: { id: string } };
    await expect(requestBooking(client, PLAYER_A, { venueId, slotId: priced.slot.id })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('paid'),
    });
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

describe('onboarding profile (Amendment 3)', () => {
  it('updates only the fields given', async () => {
    const { client, profiles } = fakeDb();
    profiles.set(PLAYER_A, { id: PLAYER_A, name: 'Old', area: 'Old Area' });
    const out = (await updateProfile(client, PLAYER_A, {
      area: 'Kabulonga',
      travelKm: 5,
      termsAcceptedAt: '2026-11-01T00:00:00.000Z',
    })) as { profile: Record<string, unknown> };
    expect(out.profile['area']).toBe('Kabulonga');
    expect(out.profile['travel_km']).toBe(5);
    expect(out.profile['terms_accepted_at']).toBe('2026-11-01T00:00:00.000Z');
    expect(out.profile['name']).toBe('Old');
    await expect(updateProfile(client, PLAYER_A, {})).rejects.toMatchObject({ status: 400 });
  });

  it('replaces the sports lineup with one level', async () => {
    const { client, userSports } = fakeDb();
    const out = (await setSports(client, PLAYER_A, {
      sportIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
      level: 'recreational',
    })) as { state: string; sports: number };
    expect(out.state).toBe('saved');
    expect(out.sports).toBe(2);
    expect(userSports.size).toBe(2);
    const out2 = (await setSports(client, PLAYER_A, {
      sportIds: ['33333333-3333-4333-8333-333333333333'],
      level: 'competitive',
    })) as { state: string; sports: number };
    expect(out2.sports).toBe(1);
    expect(userSports.size).toBe(1);
  });

  it('replaces availability slots', async () => {
    const { client, availability } = fakeDb();
    await setAvailability(client, PLAYER_A, {
      slots: [
        { day: 6, timeBand: 'evening' },
        { day: 0, timeBand: 'morning' },
      ],
    });
    expect(availability.size).toBe(2);
    await setAvailability(client, PLAYER_A, { slots: [{ day: 3, timeBand: 'afternoon' }] });
    expect(availability.size).toBe(1);
  });

  it('adds and removes places, and replaces game types', async () => {
    const { client, places, gameTypes } = fakeDb();
    const added = (await addPlace(client, PLAYER_A, { label: 'Home court', area: 'Avondale' })) as {
      place: { id: string };
    };
    expect(places.size).toBe(1);
    await removePlace(client, PLAYER_A, added.place.id);
    expect(places.size).toBe(0);
    const saved = (await setGameTypes(client, PLAYER_A, { gameTypes: ['corporate', 'routine'] })) as {
      gameTypes: string[];
    };
    expect(saved.gameTypes).toEqual(['corporate', 'routine']);
    expect(gameTypes.size).toBe(2);
  });

  it('sets a position and joins the team when needed', async () => {
    const { client, members } = fakeDb();
    const TEAM = await oneTeam(client, ORGANISER);
    const out = (await setPosition(client, PLAYER_A, { teamId: TEAM, position: 'Point guard' })) as {
      position: string;
    };
    expect(out.position).toBe('Point guard');
    expect(members.get(`${TEAM}:${PLAYER_A}`)?.['role']).toBe('player');
    expect(members.get(`${TEAM}:${PLAYER_A}`)?.['position']).toBe('Point guard');
  });

  it('dedups disciplines by normalised name', async () => {
    const { client, sports } = fakeDb();
    sports.set('s1', { id: 's1', name: 'Hiking', formats: [] });
    const same = (await addDiscipline(client, PLAYER_A, { name: 'hikes' })) as { state: string };
    expect(same.state).toBe('exists');
    expect(sports.size).toBe(1);
    const created = (await addDiscipline(client, PLAYER_A, { name: 'Chess' })) as {
      state: string;
      sport: { name: string };
    };
    expect(created.state).toBe('created');
    expect(created.sport.name).toBe('Chess');
  });
});

describe('invites, reports and blocks (Amendment 4)', () => {
  it('runs the invite link lifecycle', async () => {
    const { client, members } = fakeDb();
    const TEAM = await oneTeam(client, PLAYER_A);
    const created = (await createInviteLink(client, PLAYER_A, { teamId: TEAM })) as {
      invite: { code: string };
    };
    expect(created.invite.code).toMatch(/^CHB-/);
    const claimed = (await claimInviteLink(client, PLAYER_B, created.invite.code)) as {
      teamId: string;
    };
    expect(claimed.teamId).toBe(TEAM);
    expect(members.get(`${TEAM}:${PLAYER_B}`)?.['role']).toBe('player');
    await expect(claimInviteLink(client, ORGANISER, created.invite.code)).rejects.toMatchObject({
      status: 409,
    });
    const revoked = (await revokeInviteLink(client, PLAYER_A, created.invite.code)) as {
      state: string;
    };
    expect(revoked.state).toBe('revoked');
  });

  it('rejects expired and foreign invite links', async () => {
    const { client, invites } = fakeDb();
    invites.set('OLD', {
      code: 'OLD',
      created_by: PLAYER_A,
      team_id: null,
      expires_at: '2020-01-01T00:00:00.000Z',
      revoked_at: null,
      claimed_by: null,
    });
    await expect(claimInviteLink(client, PLAYER_B, 'OLD')).rejects.toMatchObject({ status: 410 });
    await expect(claimInviteLink(client, PLAYER_B, 'NOPE')).rejects.toMatchObject({ status: 404 });
    await expect(revokeInviteLink(client, PLAYER_B, 'OLD')).rejects.toMatchObject({ status: 404 });
  });

  it('requires team membership to mint a team link', async () => {
    const { client } = fakeDb();
    const TEAM = await oneTeam(client, PLAYER_A);
    await expect(createInviteLink(client, PLAYER_B, { teamId: TEAM })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('records reports and blocks, never against yourself', async () => {
    const { client, profiles, reports, blocks } = fakeDb();
    profiles.set(PLAYER_A, { id: PLAYER_A });
    profiles.set(PLAYER_B, { id: PLAYER_B });
    const TEAM = await oneTeam(client, PLAYER_A);
    await reportUser(client, PLAYER_A, { userId: PLAYER_B, reason: 'spam' });
    await reportTeam(client, PLAYER_A, { teamId: TEAM, reason: 'no-show' });
    expect(reports.size).toBe(2);
    await expect(reportUser(client, PLAYER_A, { userId: PLAYER_A, reason: 'x' })).rejects.toMatchObject({
      status: 400,
    });
    await blockUser(client, PLAYER_A, { userId: PLAYER_B });
    expect(blocks.size).toBe(1);
    await expect(blockUser(client, PLAYER_A, { userId: PLAYER_A })).rejects.toMatchObject({
      status: 400,
    });
    await unblockUser(client, PLAYER_A, { userId: PLAYER_B });
    expect(blocks.size).toBe(0);
  });
});

describe('team management (Amendment 4, section 1)', () => {
  it('lets captains edit the team profile', async () => {
    const { client, teams } = fakeDb();
    const TEAM = await oneTeam(client, ORGANISER);
    await setRole(client, ORGANISER, { teamId: TEAM, userId: ORGANISER, role: 'owner' });
    const out = (await updateTeam(client, ORGANISER, {
      teamId: TEAM,
      name: 'Avondale Hoops Elite',
      area: 'Avondale',
    })) as { team: { name: string } };
    expect(out.team.name).toBe('Avondale Hoops Elite');
    expect(teams.get(TEAM)?.['area']).toBe('Avondale');
    await expect(updateTeam(client, PLAYER_B, { teamId: TEAM, name: 'Hijack' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(updateTeam(client, ORGANISER, { teamId: TEAM })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('lets owners delete an unused team but guards history', async () => {
    const { client, teams, challenges, entries } = fakeDb();
    const TEAM = await oneTeam(client, ORGANISER);
    const gone = (await deleteTeam(client, ORGANISER, TEAM)) as { state: string };
    expect(gone.state).toBe('deleted');
    expect(teams.has(TEAM)).toBe(false);

    const TEAM2 = await oneTeam(client, ORGANISER);
    challenges.set('c1', { id: 'c1', team_id: TEAM2, status: 'open' });
    await expect(deleteTeam(client, ORGANISER, TEAM2)).rejects.toMatchObject({ status: 409 });
    challenges.delete('c1');
    entries.set('e1', { id: 'e1', team_id: TEAM2 });
    await expect(deleteTeam(client, ORGANISER, TEAM2)).rejects.toMatchObject({ status: 409 });
    entries.delete('e1');
    await expect(deleteTeam(client, PLAYER_B, TEAM2)).rejects.toMatchObject({ status: 403 });
  });

  it('manages members and protects the last owner', async () => {
    const { client, members } = fakeDb();
    const TEAM = await oneTeam(client, ORGANISER);
    members.set(`${TEAM}:${PLAYER_A}`, { team_id: TEAM, user_id: PLAYER_A, role: 'player' });
    await setRole(client, ORGANISER, { teamId: TEAM, userId: PLAYER_A, role: 'captain' });
    expect(members.get(`${TEAM}:${PLAYER_A}`)?.['role']).toBe('captain');
    await removeMember(client, ORGANISER, { teamId: TEAM, userId: PLAYER_A });
    expect(members.has(`${TEAM}:${PLAYER_A}`)).toBe(false);
    await expect(removeMember(client, ORGANISER, { teamId: TEAM, userId: ORGANISER })).rejects.toMatchObject({
      status: 409,
    });
    await expect(setRole(client, ORGANISER, { teamId: TEAM, userId: ORGANISER, role: 'player' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(setRole(client, PLAYER_B, { teamId: TEAM, userId: ORGANISER, role: 'player' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('lets captains set positions for teammates', async () => {
    const { client, members } = fakeDb();
    const TEAM = await oneTeam(client, ORGANISER);
    members.set(`${TEAM}:${PLAYER_A}`, { team_id: TEAM, user_id: PLAYER_A, role: 'player' });
    const out = (await setPosition(client, ORGANISER, {
      teamId: TEAM,
      userId: PLAYER_A,
      position: 'Keeper',
    })) as { userId: string };
    expect(out.userId).toBe(PLAYER_A);
    expect(members.get(`${TEAM}:${PLAYER_A}`)?.['position']).toBe('Keeper');
    await expect(
      setPosition(client, PLAYER_A, { teamId: TEAM, userId: ORGANISER, position: 'Striker' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('stores profile and team covers', async () => {
    const { client, profiles, teams } = fakeDb();
    profiles.set(ORGANISER, { id: ORGANISER });
    await updateProfile(client, ORGANISER, { coverUrl: 'https://example.com/me-cover.jpg' });
    expect(profiles.get(ORGANISER)?.['cover_url']).toBe('https://example.com/me-cover.jpg');
    const TEAM = await oneTeam(client, ORGANISER);
    await updateTeam(client, ORGANISER, { teamId: TEAM, coverUrl: 'https://example.com/team-cover.jpg' });
    expect(teams.get(TEAM)?.['cover_url']).toBe('https://example.com/team-cover.jpg');
  });

  it('stores circle photo and cover, members only for updates', async () => {
    const { client, circles } = fakeDb();
    const created = (await createCircle(client, ORGANISER, {
      name: 'Lusaka Hiking',
      area: 'Lusaka',
      ageBands: [],
      genders: [],
      levels: [],
      photoUrl: 'https://example.com/circle.jpg',
      coverUrl: 'https://example.com/circle-cover.jpg',
    })) as { circle: { id: string } };
    expect(circles.get(created.circle.id)?.['photo_url']).toBe('https://example.com/circle.jpg');
    await expect(
      updateCircle(client, PLAYER_A, { circleId: created.circle.id, photoUrl: 'https://example.com/x.jpg' }),
    ).rejects.toMatchObject({ status: 403 });
    const out = (await updateCircle(client, ORGANISER, {
      circleId: created.circle.id,
      coverUrl: 'https://example.com/circle-cover-2.jpg',
    })) as { circle: { cover_url: string } };
    expect(out.circle.cover_url).toBe('https://example.com/circle-cover-2.jpg');
    await expect(updateCircle(client, ORGANISER, { circleId: created.circle.id })).rejects.toMatchObject({
      status: 400,
    });
  });
});
