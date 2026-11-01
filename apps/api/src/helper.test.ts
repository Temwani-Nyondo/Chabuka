import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ActionError } from './actions.js';
import { runHelperTurn } from './helper.js';
import type { ModelResult } from './model.js';

const db = {} as SupabaseClient;

function result(over: Partial<ModelResult> = {}): ModelResult {
  return { provider: 'baseten', content: null, toolCalls: [], ...over };
}

describe('runHelperTurn', () => {
  it('answers directly when the model makes no tool calls', async () => {
    const chat = vi.fn(async () => result({ content: 'Two games are open near you.' }));
    const execute = vi.fn(async () => {
      throw new Error('must not be called');
    });

    const turn = await runHelperTurn({ db, userId: 'u1', message: 'Any games?' }, { chat, execute });

    expect(turn.reply).toBe('Two games are open near you.');
    expect(turn.actionsTaken).toEqual([]);
    expect(turn.provider).toBe('baseten');
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs the action and returns the follow-up answer', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        result({
          toolCalls: [{ id: 'c1', name: 'join_match', arguments: '{"matchId":"m1"}' }],
        }),
      )
      .mockResolvedValueOnce(result({ content: 'You joined the game.' }));
    const execute = vi.fn(async () => ({ state: 'joined', actions: ['withdraw'] }));

    const turn = await runHelperTurn({ db, userId: 'u1', message: 'Join it.' }, { chat, execute });

    expect(execute).toHaveBeenCalledWith('join_match', { matchId: 'm1' });
    expect(turn.reply).toBe('You joined the game.');
    expect(turn.actionsTaken).toEqual([{ name: 'join_match', ok: true }]);
  });

  it('feeds action errors back instead of crashing', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        result({
          toolCalls: [{ id: 'c1', name: 'join_match', arguments: '{"matchId":"full"}' }],
        }),
      )
      .mockResolvedValueOnce(result({ content: 'That game is full.' }));
    const execute = vi.fn(async () => {
      throw new ActionError(400, 'That game is full.');
    });

    const turn = await runHelperTurn({ db, userId: 'u1', message: 'Join it.' }, { chat, execute });

    expect(turn.actionsTaken).toEqual([{ name: 'join_match', ok: false }]);
    expect(turn.reply).toBe('That game is full.');
    const calls = chat.mock.calls as unknown[][];
    const followUp = calls[1]?.[0] as { messages: { content: string }[] };
    expect(JSON.stringify(followUp.messages)).toContain('That game is full.');
  });

  it('reports setup-not-ready when the model key is missing', async () => {
    const chat = vi.fn(async () => {
      throw new Error('BASETEN_API_KEY is not set (API server environment only).');
    });

    await expect(runHelperTurn({ db, userId: 'u1', message: 'Hi.' }, { chat })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('attaches photos as image parts', async () => {
    const chat = vi.fn(async () => result({ content: 'Nice court.' }));
    const execute = vi.fn(async () => {
      throw new Error('must not be called');
    });

    await runHelperTurn(
      { db, userId: 'u1', message: 'Book this court.', images: ['data:image/jpeg;base64,AAA'] },
      { chat, execute },
    );

    const sent = (chat.mock.calls as unknown[][])[0]?.[0] as {
      messages: { role: string; content: unknown }[];
    };
    const last = sent.messages[sent.messages.length - 1];
    expect(JSON.stringify(last?.content)).toContain('image_url');
    expect(execute).not.toHaveBeenCalled();
  });

  it('offers context reads alongside the actions', async () => {
    const chat = vi.fn(async () => result({ content: 'ok' }));

    await runHelperTurn({ db, userId: 'u1', message: 'Plan something.' }, { chat });

    const sent = (chat.mock.calls as unknown[][])[0]?.[0] as {
      tools: { function: { name: string } }[];
    };
    const names = sent.tools.map((t) => t.function.name);
    for (const read of [
      'get_my_profile',
      'get_my_teams',
      'get_my_schedule',
      'search_matches',
      'search_venues',
      'venue_slots',
      'get_my_memories',
      'save_memory',
      'forget_memory',
      'get_my_brief',
      'get_my_results',
      'poll_status',
      'get_my_venues',
    ]) {
      expect(names).toContain(read);
    }
    expect(names).toContain('request_booking');
    expect(names).toContain('create_match');
  });

  it('routes read-only calls to the reader, not the action layer', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        result({
          toolCalls: [{ id: 'c1', name: 'search_venues', arguments: '{"sport":"football","area":"Woodlands"}' }],
        }),
      )
      .mockResolvedValueOnce(result({ content: 'Found one venue.' }));
    const execute = vi.fn(async () => {
      throw new Error('must not be called');
    });
    const read = vi.fn(async () => [{ id: 'v1', name: 'Woodlands Stadium' }]);

    const turn = await runHelperTurn({ db, userId: 'u1', message: 'Find a pitch.' }, { chat, execute, read });

    expect(read).toHaveBeenCalledWith('search_venues', { sport: 'football', area: 'Woodlands' });
    expect(execute).not.toHaveBeenCalled();
    expect(turn.actionsTaken).toEqual([{ name: 'search_venues', ok: true }]);
    expect(turn.reply).toBe('Found one venue.');
    const calls = chat.mock.calls as unknown[][];
    const followUp = calls[1]?.[0] as { messages: { content: string }[] };
    expect(JSON.stringify(followUp.messages)).toContain('Woodlands Stadium');
  });

  it('keeps only recent history', async () => {
    const chat = vi.fn(async () => result({ content: 'ok' }));
    const history = Array.from({ length: 14 }, (_, i) => ({ role: 'user' as const, content: `old ${i}` }));

    await runHelperTurn({ db, userId: 'u1', message: 'new', history }, { chat });

    const sent = (chat.mock.calls as unknown[][])[0]?.[0] as { messages: { content: string }[] };
    const texts = sent.messages.map((m) => m.content);
    expect(texts).not.toContain('old 0');
    expect(texts).toContain('old 13');
    expect(texts.at(-1)).toBe('new');
  });

  it('never returns an empty reply when the model only calls tools', async () => {
    const toolOnly = result({
      toolCalls: [{ id: 'c1', name: 'get_my_brief', arguments: '{}' }],
    });
    const chat = vi.fn(async (params: { tools?: unknown[] }) =>
      params.tools !== undefined && (params.tools as unknown[]).length === 0
        ? result({ content: 'Checked your week — nothing new.' })
        : toolOnly,
    );
    const read = vi.fn(async () => ({ schedule: [] }));

    const turn = await runHelperTurn({ db, userId: 'u1', message: 'Anything on?' }, { chat, read });

    expect(turn.reply).toBe('Checked your week — nothing new.');
    const calls = chat.mock.calls as { tools?: unknown[] }[][];
    expect((calls[calls.length - 1]?.[0]?.tools as unknown[]).length).toBe(0);
  });

  it('falls back to an action summary when even the closing round is empty', async () => {
    const chat = vi.fn(async () =>
      result({ toolCalls: [{ id: 'c1', name: 'get_my_brief', arguments: '{}' }] }),
    );
    const read = vi.fn(async () => ({ schedule: [] }));

    const turn = await runHelperTurn({ db, userId: 'u1', message: 'Anything on?' }, { chat, read });

    expect(turn.reply).toContain('get_my_brief');
    expect(turn.actionsTaken.length).toBeGreaterThan(1);
    expect(turn.actionsTaken.every((a) => a.name === 'get_my_brief' && a.ok)).toBe(true);
  });

  it('keeps team memberships when the teams lookup is denied', async () => {
    const teamsDeniedDb = {
      from: (table: string) => ({
        select: () =>
          table === 'team_members'
            ? { eq: async () => ({ data: [{ team_id: 't1', role: 'player' }], error: null }) }
            : { in: async () => ({ data: null, error: { message: 'denied' } }) },
      }),
    } as unknown as SupabaseClient;
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        result({ toolCalls: [{ id: 'c1', name: 'get_my_teams', arguments: '{}' }] }),
      )
      .mockResolvedValueOnce(result({ content: 'You play for one team.' }));

    const turn = await runHelperTurn(
      { db: teamsDeniedDb, userId: 'u1', message: 'My teams?' },
      { chat },
    );

    expect(turn.actionsTaken).toEqual([{ name: 'get_my_teams', ok: true }]);
    expect(turn.reply).toBe('You play for one team.');
  });
});
