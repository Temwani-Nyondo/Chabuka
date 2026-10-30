import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASETEN_BASE_URL, BASETEN_MODEL_ID, chatOnce } from './model.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chatBody(message: unknown): Response {
  return jsonResponse({ choices: [{ message }] });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('chatOnce', () => {
  it('uses the exact Baseten slug and strips reasoning from the answer', async () => {
    vi.stubEnv('BASETEN_API_KEY', 'test-key');
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const fetchStub = async (url: unknown, init?: RequestInit): Promise<Response> => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return chatBody({
        content: 'Found two games.',
        reasoning_content: 'secret chain of thought',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_games', arguments: '{"sport":"football"}' } }],
      });
    };

    const result = await chatOnce(
      { messages: [{ role: 'user', content: 'Find a game.' }] },
      { fetch: fetchStub as typeof fetch },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${BASETEN_BASE_URL}/chat/completions`);
    expect(seen[0]?.body['model']).toBe(BASETEN_MODEL_ID);
    expect(result.provider).toBe('baseten');
    expect(result.content).toBe('Found two games.');
    expect(JSON.stringify(result)).not.toContain('secret chain of thought');
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'search_games', arguments: '{"sport":"football"}' }]);
  });

  it('falls back to the Meta API when Baseten fails', async () => {
    vi.stubEnv('BASETEN_API_KEY', 'test-key');
    vi.stubEnv('META_API_KEY', 'meta-key');
    vi.stubEnv('META_MODEL_ID', 'meta-spark');
    vi.stubEnv('META_BASE_URL', 'https://meta.example/v1');
    const urls: string[] = [];
    const fetchStub = async (url: unknown): Promise<Response> => {
      urls.push(String(url));
      if (String(url).startsWith(BASETEN_BASE_URL)) {
        return jsonResponse({ error: { message: 'down' } }, 500);
      }
      return chatBody({ content: 'Meta answer.' });
    };

    const result = await chatOnce(
      { messages: [{ role: 'user', content: 'Hi.' }] },
      { fetch: fetchStub as typeof fetch },
    );

    expect(result.provider).toBe('meta');
    expect(result.content).toBe('Meta answer.');
    expect(urls).toEqual([`${BASETEN_BASE_URL}/chat/completions`, 'https://meta.example/v1/chat/completions']);
  });

  it('throws the Baseten error when no Meta fallback is configured', async () => {
    vi.stubEnv('BASETEN_API_KEY', 'test-key');
    const fetchStub = async (): Promise<Response> => jsonResponse({ error: { message: 'down' } }, 500);
    await expect(
      chatOnce({ messages: [{ role: 'user', content: 'Hi.' }] }, { fetch: fetchStub as typeof fetch }),
    ).rejects.toThrow();
  });

  it('throws without contacting anyone when the key is missing', async () => {
    const fetchStub = async (): Promise<Response> => {
      throw new Error('must not be called');
    };
    await expect(
      chatOnce({ messages: [{ role: 'user', content: 'Hi.' }] }, { fetch: fetchStub as typeof fetch }),
    ).rejects.toThrow('BASETEN_API_KEY');
  });
});
