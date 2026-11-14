import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';

// Single model wrapper (Amendment 2, section 3). Every AI call in the API
// goes through chatOnce: Baseten first, Meta Model API as fallback.
// The Baseten key never leaves the server: it is read from the API server's
// environment only, never from the web app, the repo, or client code.

export const BASETEN_BASE_URL = 'https://inference.baseten.co/v1';
// Exact slug for the provider key. Baseten's docs name without the -1026
// suffix does NOT work with this key.
export const BASETEN_MODEL_ID = 'meta-models/muse-spark-open-1026';

export type ModelProvider = 'baseten' | 'meta';

export interface ModelTextPart {
  type: 'text';
  text: string;
}

export interface ModelImagePart {
  type: 'image_url';
  image_url: { url: string };
}

// Proven shape for Spark Open audio (Amendment 2 first task). The OpenAI
// `input_audio` part is accepted with HTTP 200 but ignored by the model;
// `audio_url` is what the model actually hears.
export interface ModelAudioPart {
  type: 'audio_url';
  audio_url: { url: string };
}

export type ModelContentPart = ModelTextPart | ModelImagePart | ModelAudioPart;

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ModelContentPart[];
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelResult {
  provider: ModelProvider;
  content: string | null;
  toolCalls: ModelToolCall[];
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Spark Open always reasons. The reasoning rides alongside the answer in a
// non-standard field (`reasoning_content`, sometimes `reasoning`). It is
// dropped here and never reaches callers: the "What I did" trace shows tool
// calls, not reasoning. Vision turns can also return the answer as content
// parts instead of a plain string — join the text parts so those replies
// survive instead of arriving empty.
function extractResult(message: unknown, provider: ModelProvider): ModelResult {
  const msg = isRecord(message) ? message : {};
  const raw = msg['content'] as unknown;
  const content =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw
            .map((p) => (isRecord(p) && typeof p['text'] === 'string' ? (p['text'] as string) : ''))
            .join('') || null
        : null;
  const rawCalls = Array.isArray(msg['tool_calls']) ? (msg['tool_calls'] as unknown[]) : [];
  const toolCalls: ModelToolCall[] = [];
  for (const call of rawCalls) {
    if (!isRecord(call) || !isRecord(call['function'])) continue;
    const fn = call['function'] as Record<string, unknown>;
    if (typeof call['id'] !== 'string' || typeof fn['name'] !== 'string') continue;
    toolCalls.push({
      id: call['id'] as string,
      name: fn['name'] as string,
      arguments: typeof fn['arguments'] === 'string' ? (fn['arguments'] as string) : '{}',
    });
  }
  return { provider, content, toolCalls };
}

// Voice notes (brief section 9): speech to text on the Meta Model API.
// Needs META_API_KEY, META_BASE_URL and META_TRANSCRIBE_MODEL_ID on the
// API server. Throws a 503-style error when the key is missing so the web
// app can say so honestly instead of pretending.
//
// Real contract (Meta speech-to-text docs): multipart POST to
// {META_BASE_URL}/asr/transcribe?sessionId=<uuid> with a `request` JSON
// part {mode, model, audioEncoding} and an `audio` part holding a
// RIFF/WAVE file (mono 16-bit PCM, 16 or 24 kHz). Audio that is not WAV
// must be converted to WAV before calling — the client records WAV.
/** Some transcripts come back with the whole sentence twice ("hello hello"): keep one copy. */
export function collapseRepeat(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length % 2 !== 0) return text.trim();
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  const half = words.length / 2;
  for (let i = 0; i < half; i++) {
    if (norm(words[i] ?? '') !== norm(words[i + half] ?? '')) return text.trim();
  }
  return words.slice(0, half).join(' ');
}

export async function transcribeVoice(
  params: { audio: Buffer; mimeType: string },
  deps?: { fetch?: typeof fetch; sessionId?: string },
): Promise<string> {
  const metaKey = readEnv('META_API_KEY');
  const metaBaseUrl = readEnv('META_BASE_URL');
  const metaModel = readEnv('META_TRANSCRIBE_MODEL_ID');
  if (!metaKey || !metaBaseUrl || !metaModel) {
    throw new Error('Voice notes need the server model key (META_TRANSCRIBE_MODEL_ID).');
  }
  const fetchImpl = deps?.fetch ?? fetch;
  const sessionId = deps?.sessionId ?? randomUUID();
  const url = `${metaBaseUrl.replace(/\/+$/, '')}/asr/transcribe?sessionId=${encodeURIComponent(sessionId)}`;
  const form = new FormData();
  form.append(
    'request',
    new Blob([JSON.stringify({ mode: 'PUSH_TO_TALK', model: metaModel, audioEncoding: 'WAV' })], {
      type: 'application/json',
    }),
  );
  form.append(
    'audio',
    new Blob([Uint8Array.from(params.audio)], { type: 'audio/wav' }),
    'voice-note.wav',
  );
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${metaKey}`, Accept: 'application/json' },
      body: form,
    });
  } catch (err) {
    throw new Error(`Transcription request failed: ${err instanceof Error ? err.message : 'network error'}.`);
  }
  if (!res.ok) {
    throw new Error(`Transcription failed (HTTP ${res.status}). Try again.`);
  }
  const data: unknown = await res.json();
  let text = isRecord(data) && typeof data['transcript'] === 'string' ? (data['transcript'] as string).trim() : '';
  if (!text && isRecord(data) && Array.isArray(data['turns'])) {
    text = (data['turns'] as unknown[])
      .map((turn) => (isRecord(turn) && typeof turn['transcript'] === 'string' ? turn['transcript'] : ''))
      .join(' ')
      .trim();
  }
  if (!text) {
    throw new Error('Transcription came back empty. Try again.');
  }
  return collapseRepeat(text);
}

interface ChatParams {
  messages: ModelMessage[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
}

function chatBody(params: ChatParams, model: string) {
  return {
    model,
    messages: params.messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
    ...(params.tools !== undefined ? { tools: params.tools } : {}),
    ...(params.toolChoice !== undefined ? { tool_choice: params.toolChoice } : {}),
  };
}

function basetenClient(fetchImpl: typeof fetch): { client: OpenAI; model: string } {
  const basetenKey = readEnv('BASETEN_API_KEY');
  if (!basetenKey) {
    throw new Error('BASETEN_API_KEY is not set (API server environment only).');
  }
  return {
    client: new OpenAI({ baseURL: BASETEN_BASE_URL, apiKey: basetenKey, fetch: fetchImpl, timeout: 60_000, maxRetries: 0 }),
    model: readEnv('BASETEN_MODEL_ID') ?? BASETEN_MODEL_ID,
  };
}

// Fallback: Muse Spark on the Meta Model API, used only if Baseten fails or is
// down. Null when Meta is not configured, so the caller rethrows the Baseten error.
function metaClient(fetchImpl: typeof fetch): { client: OpenAI; model: string } | null {
  const metaKey = readEnv('META_API_KEY');
  const metaModel = readEnv('META_MODEL_ID');
  const metaBaseUrl = readEnv('META_BASE_URL');
  if (!metaKey || !metaModel || !metaBaseUrl) return null;
  return {
    client: new OpenAI({ baseURL: metaBaseUrl, apiKey: metaKey, fetch: fetchImpl, timeout: 60_000, maxRetries: 0 }),
    model: metaModel,
  };
}

// Spark Open reasons before it writes, and on the Meta endpoint nothing is sent until that
// is done (7-12 s), after which the whole answer lands at once. META_REASONING_EFFORT
// (minimal | low | medium | high) asks Meta for less reasoning: measured 4 s to the first
// words, arriving in several pieces. Unset = the provider default. Meta calls only: Baseten
// is not sent the parameter.
type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
function metaExtra(): { reasoning_effort?: ReasoningEffort } {
  const value = (readEnv('META_REASONING_EFFORT') ?? '').toLowerCase();
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'
    ? { reasoning_effort: value }
    : {};
}

// Log the shape that failed (roles + tool count only, never content or keys) so a
// provider-side rejection is diagnosable from the terminal.
function logBasetenFailure(error: unknown, params: ChatParams): void {
  try {
    const roles = params.messages.map((m) => m.role).join(',');
    const toolCount = params.tools?.length ?? 0;
    console.error(
      `Baseten chat failed: ${error instanceof Error ? error.message : 'unknown'} (roles=${roles} tools=${toolCount})`,
    );
  } catch {
    // Logging must never break the fallback path.
  }
}

// When Baseten refuses for a reason that will not fix itself in seconds (the deployment is
// switched off, the key is wrong or out of credit), every message would otherwise pay for a
// doomed call before reaching the fallback. Remember it for a few minutes and go straight to Meta.
let basetenSkipUntil = 0;
const BASETEN_SKIP_MS = 5 * 60_000;

// BASETEN_DISABLED=true takes Baseten offline on purpose (for example while its deployment is
// switched off): no call is made to it at all. Ignored when Meta is not configured, so Gaffer
// is never left with no model.
function basetenDisabled(): boolean {
  return /^(1|true|yes)$/i.test(readEnv('BASETEN_DISABLED') ?? '');
}

function skipBaseten(): boolean {
  return basetenDisabled() || Date.now() < basetenSkipUntil;
}

export function isBasetenUnavailable(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : '';
  if (status === 401 || status === 402 || status === 403 || status === 404) return true;
  return status === 400 && /deactivat|not active|inactive|needs to be activated/i.test(message);
}

/** For tests: forget that Baseten was switched off. */
export function resetBasetenSkip(): void {
  basetenSkipUntil = 0;
}

function noteBasetenFailure(error: unknown): void {
  if (isBasetenUnavailable(error) && Date.now() >= basetenSkipUntil) {
    basetenSkipUntil = Date.now() + BASETEN_SKIP_MS;
    console.error('Baseten is unavailable (switched off or refused). Using Meta for the next few minutes.');
  }
}

export async function chatOnce(params: ChatParams, deps?: { fetch?: typeof fetch }): Promise<ModelResult> {
  const fetchImpl = deps?.fetch ?? fetch;
  if (skipBaseten()) {
    const meta = metaClient(fetchImpl);
    if (meta) {
      const res = await meta.client.chat.completions.create({ ...chatBody(params, meta.model), ...metaExtra() });
      return extractResult(res.choices[0]?.message, 'meta');
    }
  }
  const baseten = basetenClient(fetchImpl);
  const body = chatBody(params, baseten.model);
  try {
    const res = await baseten.client.chat.completions.create(body);
    return extractResult(res.choices[0]?.message, 'baseten');
  } catch (basetenError) {
    logBasetenFailure(basetenError, params);
    noteBasetenFailure(basetenError);
    const meta = metaClient(fetchImpl);
    if (!meta) throw basetenError;
    const res = await meta.client.chat.completions.create({ ...body, model: meta.model, ...metaExtra() });
    return extractResult(res.choices[0]?.message, 'meta');
  }
}

// Same call as chatOnce, but the answer text is handed to onDelta as it is written,
// so a caller can show it (and start speaking it) before the model has finished.
// Reasoning rides in other fields and is ignored, as in chatOnce. Tool calls arrive
// in pieces and are assembled by index. The Meta fallback is used only when the
// first provider failed before it produced any text: once something has been
// delivered, switching providers would repeat or contradict it, so the error is thrown.
export async function chatStream(
  params: ChatParams,
  onDelta: (text: string) => void,
  deps?: { fetch?: typeof fetch },
): Promise<ModelResult> {
  const fetchImpl = deps?.fetch ?? fetch;
  let delivered = false;
  const emit = (text: string) => {
    delivered = true;
    onDelta(text);
  };
  if (skipBaseten()) {
    const meta = metaClient(fetchImpl);
    if (meta) return await readStream(meta.client, { ...chatBody(params, meta.model), ...metaExtra() }, 'meta', emit);
  }
  const baseten = basetenClient(fetchImpl);
  const body = chatBody(params, baseten.model);
  try {
    return await readStream(baseten.client, body, 'baseten', emit);
  } catch (basetenError) {
    logBasetenFailure(basetenError, params);
    noteBasetenFailure(basetenError);
    const meta = metaClient(fetchImpl);
    if (!meta || delivered) throw basetenError;
    return await readStream(meta.client, { ...body, model: meta.model, ...metaExtra() }, 'meta', emit);
  }
}

async function readStream(
  client: OpenAI,
  body: ReturnType<typeof chatBody>,
  provider: ModelProvider,
  emit: (text: string) => void,
): Promise<ModelResult> {
  const stream = await client.chat.completions.create({ ...body, stream: true });
  let content = '';
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content;
      emit(delta.content);
    }
    for (const piece of delta.tool_calls ?? []) {
      const entry = calls.get(piece.index) ?? { id: '', name: '', arguments: '' };
      if (piece.id) entry.id = piece.id;
      if (piece.function?.name) entry.name += piece.function.name;
      if (piece.function?.arguments) entry.arguments += piece.function.arguments;
      calls.set(piece.index, entry);
    }
  }
  const toolCalls: ModelToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c)
    .filter((c) => c.id && c.name)
    .map((c) => ({ id: c.id, name: c.name, arguments: c.arguments || '{}' }));
  return { provider, content: content.length > 0 ? content : null, toolCalls };
}
