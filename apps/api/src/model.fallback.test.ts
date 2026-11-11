import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatOnce, collapseRepeat, isBasetenUnavailable, resetBasetenSkip } from './model.js';

const completion = (text: string) =>
  new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('provider that is switched off', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env['BASETEN_API_KEY'] = 'test-key';
    process.env['META_API_KEY'] = 'meta-key';
    process.env['META_MODEL_ID'] = 'meta-model';
    process.env['META_BASE_URL'] = 'https://meta.example/v1';
    resetBasetenSkip();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...saved };
    resetBasetenSkip();
    vi.restoreAllMocks();
  });

  it('recognises a deactivated deployment and credentials problems, but not a passing hiccup', () => {
    expect(isBasetenUnavailable(Object.assign(new Error('Model version abc is deactivated. It needs to be activated'), { status: 400 }))).toBe(true);
    expect(isBasetenUnavailable(Object.assign(new Error('nope'), { status: 401 }))).toBe(true);
    expect(isBasetenUnavailable(Object.assign(new Error('out of credit'), { status: 402 }))).toBe(true);
    expect(isBasetenUnavailable(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
    expect(isBasetenUnavailable(Object.assign(new Error('overloaded'), { status: 503 }))).toBe(false);
    expect(isBasetenUnavailable(new Error('socket hang up'))).toBe(false);
  });

  it('after Baseten refuses once, the next calls go straight to Meta', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url.includes('baseten') ? 'baseten' : 'meta');
      if (url.includes('baseten')) {
        return new Response(JSON.stringify({ error: { message: 'Model version wpgy40e is deactivated. It needs to be activated before running predictions' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return completion('hello from meta');
    });
    const deps = { fetch: fetchMock as unknown as typeof fetch };
    const first = await chatOnce({ messages: [{ role: 'user', content: 'hi' }] }, deps);
    expect(first.provider).toBe('meta');
    expect(calls).toEqual(['baseten', 'meta']);
    calls.length = 0;
    const second = await chatOnce({ messages: [{ role: 'user', content: 'hi again' }] }, deps);
    expect(second.provider).toBe('meta');
    expect(calls).toEqual(['meta']);
  });

  it('a one-off server error does not switch Baseten off', async () => {
    const calls: string[] = [];
    let n = 0;
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url.includes('baseten') ? 'baseten' : 'meta');
      if (url.includes('baseten') && n++ === 0) return new Response('{"error":{"message":"overloaded"}}', { status: 503, headers: { 'content-type': 'application/json' } });
      return completion('ok');
    });
    const deps = { fetch: fetchMock as unknown as typeof fetch };
    await chatOnce({ messages: [{ role: 'user', content: 'one' }] }, deps);
    calls.length = 0;
    const next = await chatOnce({ messages: [{ role: 'user', content: 'two' }] }, deps);
    expect(next.provider).toBe('baseten');
    expect(calls).toEqual(['baseten']);
  });
});

describe('BASETEN_DISABLED', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env['META_API_KEY'] = 'meta-key';
    process.env['META_MODEL_ID'] = 'meta-model';
    process.env['META_BASE_URL'] = 'https://meta.example/v1';
    delete process.env['BASETEN_API_KEY'];
    resetBasetenSkip();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetBasetenSkip();
  });

  it('never calls Baseten, and needs no Baseten key, when it is taken offline', async () => {
    process.env['BASETEN_DISABLED'] = 'true';
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return completion('from meta');
    });
    const r = await chatOnce({ messages: [{ role: 'user', content: 'hi' }] }, { fetch: fetchMock as unknown as typeof fetch });
    expect(r.provider).toBe('meta');
    expect(urls.every((u) => !u.includes('baseten'))).toBe(true);
  });

  it('is ignored when Meta is not configured, so Gaffer still has a model', async () => {
    process.env['BASETEN_DISABLED'] = 'true';
    process.env['BASETEN_API_KEY'] = 'k';
    delete process.env['META_API_KEY'];
    const fetchMock = vi.fn(async () => completion('from baseten'));
    const r = await chatOnce({ messages: [{ role: 'user', content: 'hi' }] }, { fetch: fetchMock as unknown as typeof fetch });
    expect(r.provider).toBe('baseten');
  });
});

describe('collapseRepeat', () => {
  it('keeps one copy of a sentence the transcriber said twice', () => {
    expect(collapseRepeat('Hey Gaffer how you doing? Hey Gaffer how you doing?')).toBe('Hey Gaffer how you doing?');
    expect(collapseRepeat('hello hello')).toBe('hello');
  });
  it('leaves ordinary speech alone, including deliberate repeats inside a longer sentence', () => {
    expect(collapseRepeat('Find me a game on Saturday')).toBe('Find me a game on Saturday');
    expect(collapseRepeat('no no no')).toBe('no no no');
    expect(collapseRepeat('Yes please book it, yes')).toBe('Yes please book it, yes');
    expect(collapseRepeat('  ')).toBe('');
  });
});
