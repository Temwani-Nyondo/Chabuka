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
});
