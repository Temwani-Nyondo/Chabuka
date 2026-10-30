import { describe, expect, it } from 'vitest';
import { ActionError, createMatch, joinMatch, withdrawMatch } from './actions.js';

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
  const client = {
    from(table: string) {
      if (table === 'matches') return new FakeQuery(matches, (r) => String(r['id']));
      if (table === 'match_participants') {
        return new FakeQuery(participants, (r) => `${String(r['match_id'])}:${String(r['user_id'])}`);
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, matches, participants };
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
