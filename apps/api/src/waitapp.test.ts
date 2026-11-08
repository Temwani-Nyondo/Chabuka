import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyTicketsIssued,
  decryptToken,
  encryptToken,
  handleWebhook,
  signState,
  verifyState,
  verifyWebhookSignature,
} from './waitapp.js';

const SECRET = 'test-partner-secret-0123456789';

beforeEach(() => {
  process.env.WAITAPP_PARTNER_SECRET = SECRET;
  process.env.WAITAPP_TOKEN_KEY = crypto.randomBytes(32).toString('base64');
});

function sign(body: string, timestamp: string): string {
  return crypto.createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
}
const nowTs = () => String(Math.floor(Date.now() / 1000));

describe('token encryption', () => {
  it('round-trips and never stores plaintext', () => {
    const stored = encryptToken('cbk_secret');
    expect(stored).not.toContain('cbk_secret');
    expect(decryptToken(stored)).toBe('cbk_secret');
  });

  it('fails on a tampered value', () => {
    const [iv, tag, enc] = encryptToken('cbk_secret').split('.');
    const flipped = Buffer.from(enc!, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => decryptToken([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });
});

describe('link state', () => {
  it('verifies for the same user and rejects another user, expiry and tampering', () => {
    const state = signState('user-1');
    expect(verifyState(state, 'user-1')).toBe(true);
    expect(verifyState(state, 'user-2')).toBe(false);
    expect(verifyState(state, 'user-1', Date.now() + 16 * 60 * 1000)).toBe(false);
    expect(verifyState(`${state}x`, 'user-1')).toBe(false);
    expect(verifyState('nonsense', 'user-1')).toBe(false);
  });
});

describe('webhook signature', () => {
  const body = JSON.stringify({ hello: 'world' });

  it('accepts a correct, fresh signature', () => {
    const ts = nowTs();
    expect(verifyWebhookSignature(body, ts, sign(body, ts))).toBe(true);
  });

  it('rejects a changed body, a wrong secret and a stale timestamp', () => {
    const ts = nowTs();
    expect(verifyWebhookSignature(`${body} `, ts, sign(body, ts))).toBe(false);
    expect(verifyWebhookSignature(body, ts, 'deadbeef')).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 10 * 60);
    expect(verifyWebhookSignature(body, old, sign(body, old))).toBe(false);
  });
});

// A tiny chainable fake: every method returns the builder, awaiting yields `result`.
function fakeService(opts: {
  ticketing?: { waitapp_event_id: string } | null;
  profile?: { id: string } | null;
  emailUser?: string | null;
  updatedRows?: { user_id: string | null }[];
  remainingTickets?: number;
}) {
  const writes: { table: string; op: string; payload: unknown }[] = [];
  const service = {
    from(table: string) {
      const state = { table };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        update: (payload: unknown) => {
          writes.push({ table: state.table, op: 'update', payload });
          return builder;
        },
        upsert: (payload: unknown) => {
          writes.push({ table: state.table, op: 'upsert', payload });
          return Promise.resolve({ error: null });
        },
        maybeSingle: () => {
          if (state.table === 'match_ticketing') return Promise.resolve({ data: opts.ticketing ?? null, error: null });
          if (state.table === 'profiles') return Promise.resolve({ data: opts.profile ?? null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({ count: opts.remainingTickets ?? 1, data: opts.updatedRows ?? [], error: null }),
      };
      return builder;
    },
    rpc: vi.fn(async () => ({ data: opts.emailUser ?? null, error: null })),
  };
  return { service: service as unknown as SupabaseClient, writes };
}

const MATCH = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function payload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt-1',
    type: 'ticket.issued',
    data: {
      eventId: 'wa-event-1',
      chabukaMatchId: MATCH,
      paymentId: 'pay-1',
      ticketIds: ['t1', 't2'],
      tierName: 'General',
      buyer: { email: 'Buyer@Example.com' },
      ref: `chabuka:${USER}`,
      ...overrides,
    },
  });
}

describe('handleWebhook', () => {
  it('rejects a bad signature', async () => {
    const { service } = fakeService({ ticketing: { waitapp_event_id: 'wa-event-1' } });
    await expect(handleWebhook(service, payload(), { timestamp: nowTs(), signature: 'nope' })).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an event that is not the one created for that game', async () => {
    const { service } = fakeService({ ticketing: { waitapp_event_id: 'some-other-event' } });
    const raw = payload();
    const ts = nowTs();
    await expect(handleWebhook(service, raw, { timestamp: ts, signature: sign(raw, ts) })).rejects.toMatchObject({ status: 404 });
  });

  it('records tickets and joins the matched buyer', async () => {
    const { service, writes } = fakeService({ ticketing: { waitapp_event_id: 'wa-event-1' }, profile: { id: USER } });
    const raw = payload();
    const ts = nowTs();
    const result = await handleWebhook(service, raw, { timestamp: ts, signature: sign(raw, ts) });
    expect(result.handled).toBe(true);
    const orders = writes.find((w) => w.table === 'ticket_orders')?.payload as { buyer_email: string; user_id: string }[];
    expect(orders).toHaveLength(2);
    expect(orders[0]?.buyer_email).toBe('buyer@example.com');
    expect(orders[0]?.user_id).toBe(USER);
    expect(writes.some((w) => w.table === 'match_participants')).toBe(true);
  });

  it('ignores unrelated event types', async () => {
    const { service } = fakeService({ ticketing: { waitapp_event_id: 'wa-event-1' } });
    const raw = JSON.stringify({ ...JSON.parse(payload()), type: 'something.else' });
    const ts = nowTs();
    await expect(handleWebhook(service, raw, { timestamp: ts, signature: sign(raw, ts) })).resolves.toEqual({ handled: false });
  });
});

function eventPayload(type: string, data: Record<string, unknown>) {
  return JSON.stringify({
    id: 'evt-x',
    type,
    data: { eventId: 'wa-event-1', chabukaMatchId: MATCH, ...data },
  });
}
async function send(service: SupabaseClient, raw: string) {
  const ts = nowTs();
  return handleWebhook(service, raw, { timestamp: ts, signature: sign(raw, ts) });
}

describe('refunds, check-in, cancel and postpone', () => {
  it('a refund that removes the last ticket takes the player off the roster', async () => {
    const { service, writes } = fakeService({
      ticketing: { waitapp_event_id: 'wa-event-1' },
      updatedRows: [{ user_id: USER }],
      remainingTickets: 0,
    });
    await send(service, eventPayload('ticket.refunded', { ticketIds: ['t1'] }));
    const orderUpdate = writes.find((w) => w.table === 'ticket_orders' && w.op === 'update');
    expect(orderUpdate?.payload).toEqual({ status: 'refunded' });
    const withdrawn = writes.find((w) => w.table === 'match_participants' && w.op === 'update');
    expect(withdrawn?.payload).toEqual({ status: 'withdrawn' });
  });

  it('a refund of one of several tickets keeps the spot', async () => {
    const { service, writes } = fakeService({
      ticketing: { waitapp_event_id: 'wa-event-1' },
      updatedRows: [{ user_id: USER }],
      remainingTickets: 1,
    });
    await send(service, eventPayload('ticket.refunded', { ticketIds: ['t1'] }));
    expect(writes.some((w) => w.table === 'match_participants')).toBe(false);
  });

  it('check-in marks tickets used and never touches the roster', async () => {
    const { service, writes } = fakeService({ ticketing: { waitapp_event_id: 'wa-event-1' }, updatedRows: [{ user_id: USER }] });
    await send(service, eventPayload('ticket.used', { ticketIds: ['t1'] }));
    expect(writes.find((w) => w.table === 'ticket_orders' && w.op === 'update')?.payload).toEqual({ status: 'used' });
    expect(writes.some((w) => w.table === 'match_participants')).toBe(false);
  });

  it('a cancelled event cancels the game', async () => {
    const { service, writes } = fakeService({ ticketing: { waitapp_event_id: 'wa-event-1' } });
    await send(service, eventPayload('event.cancelled', { reason: 'Rain' }));
    expect(writes.find((w) => w.table === 'matches' && w.op === 'update')?.payload).toEqual({ status: 'cancelled' });
    expect(writes.find((w) => w.table === 'match_ticketing' && w.op === 'update')?.payload).toMatchObject({ status: 'cancelled' });
  });

  it('a postponed event moves the game date', async () => {
    const { service, writes } = fakeService({ ticketing: { waitapp_event_id: 'wa-event-1' } });
    await send(service, eventPayload('event.postponed', { newDate: '2027-01-10T15:00:00.000Z' }));
    expect(writes.find((w) => w.table === 'matches' && w.op === 'update')?.payload).toEqual({ starts_at: '2027-01-10T15:00:00.000Z' });
  });

  it('rejects a cancel for an event that is not this game', async () => {
    const { service } = fakeService({ ticketing: { waitapp_event_id: 'another-event' } });
    await expect(send(service, eventPayload('event.cancelled', {}))).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a postponement with no usable date', async () => {
    const { service } = fakeService({ ticketing: { waitapp_event_id: 'wa-event-1' } });
    await expect(send(service, eventPayload('event.postponed', { newDate: 'not-a-date' }))).rejects.toMatchObject({ status: 400 });
  });
});

describe('applyTicketsIssued', () => {
  it('leaves an unmatched buyer claimable instead of joining anyone', async () => {
    const { service, writes } = fakeService({ profile: null, emailUser: null });
    const { userId } = await applyTicketsIssued(service, {
      matchId: MATCH,
      paymentId: 'pay-9',
      ticketIds: ['t9'],
      tierName: null,
      buyerEmail: 'new@person.com',
      ref: null,
    });
    expect(userId).toBeNull();
    expect(writes.some((w) => w.table === 'match_participants')).toBe(false);
    expect(writes.find((w) => w.table === 'ticket_orders')).toBeTruthy();
  });

  it('falls back to a confirmed-email match when there is no usable ref', async () => {
    const { service, writes } = fakeService({ profile: null, emailUser: USER });
    const { userId } = await applyTicketsIssued(service, {
      matchId: MATCH,
      paymentId: 'pay-8',
      ticketIds: ['t8'],
      tierName: null,
      buyerEmail: 'me@example.com',
      ref: 'chabuka:not-a-uuid',
    });
    expect(userId).toBe(USER);
    expect(writes.some((w) => w.table === 'match_participants')).toBe(true);
  });
});
