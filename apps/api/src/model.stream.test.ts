import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatOnce, chatStream } from './model.js';

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const delta = (d: Record<string, unknown>) => ({ choices: [{ index: 0, delta: d }] });

describe('chatStream', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env['BASETEN_API_KEY'] = 'test-key';
    delete process.env['META_API_KEY'];
    delete process.env['META_MODEL_ID'];
    delete process.env['META_BASE_URL'];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('hands text to onDelta piece by piece and returns the whole reply', async () => {
    const fetchMock = vi.fn(async () =>
      sse([delta({ role: 'assistant' }), delta({ reasoning_content: 'thinking...' }), delta({ content: 'Wow, ' }), delta({ content: 'five sports.' })]),
    );
    const seen: string[] = [];
    const result = await chatStream({ messages: [{ role: 'user', content: 'hi' }] }, (t) => seen.push(t), {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(seen).toEqual(['Wow, ', 'five sports.']);
    expect(result).toEqual({ provider: 'baseten', content: 'Wow, five sports.', toolCalls: [] });
  });

  it('assembles tool calls that arrive in pieces, in index order', async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        delta({ tool_calls: [{ index: 1, id: 'c2', function: { name: 'set_sports', arguments: '{"a"' } }] }),
        delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'update_profile', arguments: '{"name":' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"Sam"}' } }] }),
        delta({ tool_calls: [{ index: 1, function: { arguments: ':1}' } }] }),
      ]),
    );
    const seen: string[] = [];
    const result = await chatStream({ messages: [{ role: 'user', content: 'hi' }] }, (t) => seen.push(t), {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(seen).toEqual([]);
    expect(result.content).toBeNull();
    expect(result.toolCalls).toEqual([
      { id: 'c1', name: 'update_profile', arguments: '{"name":"Sam"}' },
      { id: 'c2', name: 'set_sports', arguments: '{"a":1}' },
    ]);
  });

  it('falls back to Meta when Baseten fails before sending any text', async () => {
    process.env['META_API_KEY'] = 'm';
    process.env['META_MODEL_ID'] = 'meta-model';
    process.env['META_BASE_URL'] = 'https://meta.example/v1';
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('baseten')) return new Response('nope', { status: 500 });
      return sse([delta({ content: 'From Meta.' })]);
    });
    const seen: string[] = [];
    const result = await chatStream({ messages: [{ role: 'user', content: 'hi' }] }, (t) => seen.push(t), {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result.provider).toBe('meta');
    expect(seen).toEqual(['From Meta.']);
  });

  it('chatOnce still behaves the same after the shared setup was extracted', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'Hello.' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await chatOnce({ messages: [{ role: 'user', content: 'hi' }] }, { fetch: fetchMock as unknown as typeof fetch });
    expect(result).toEqual({ provider: 'baseten', content: 'Hello.', toolCalls: [] });
  });

  it('throws when Baseten fails and Meta is not configured', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      chatStream({ messages: [{ role: 'user', content: 'hi' }] }, () => undefined, { fetch: fetchMock as unknown as typeof fetch }),
    ).rejects.toBeTruthy();
  });
});
