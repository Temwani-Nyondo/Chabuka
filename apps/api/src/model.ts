import OpenAI from 'openai';

// Single model wrapper (Amendment 2, section 3). Every AI call in the API
// goes through chatOnce: Baseten first, Meta Model API as fallback.
// The Baseten key never leaves the server: it is read from the API server's
// environment only, never from the web app, the repo, or client code.

export const BASETEN_BASE_URL = 'https://inference.baseten.co/v1';
// Exact slug for the hackathon key. Baseten's docs name without the -1026
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
  role: 'system' | 'user';
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
// calls, not reasoning.
function extractResult(message: unknown, provider: ModelProvider): ModelResult {
  const msg = isRecord(message) ? message : {};
  const content = typeof msg['content'] === 'string' ? (msg['content'] as string) : null;
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

export async function chatOnce(
  params: {
    messages: ModelMessage[];
    tools?: OpenAI.Chat.ChatCompletionTool[];
    toolChoice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
  },
  deps?: { fetch?: typeof fetch },
): Promise<ModelResult> {
  const fetchImpl = deps?.fetch ?? fetch;
  const basetenKey = readEnv('BASETEN_API_KEY');
  if (!basetenKey) {
    throw new Error('BASETEN_API_KEY is not set (API server environment only).');
  }
  const baseten = new OpenAI({
    baseURL: BASETEN_BASE_URL,
    apiKey: basetenKey,
    fetch: fetchImpl,
    timeout: 60_000,
    maxRetries: 0,
  });
  const basetenModel = readEnv('BASETEN_MODEL_ID') ?? BASETEN_MODEL_ID;
  const body = {
    model: basetenModel,
    messages: params.messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
    ...(params.tools !== undefined ? { tools: params.tools } : {}),
    ...(params.toolChoice !== undefined ? { tool_choice: params.toolChoice } : {}),
  };
  try {
    const res = await baseten.chat.completions.create(body);
    return extractResult(res.choices[0]?.message, 'baseten');
  } catch (basetenError) {
    // Fallback: Muse Spark on the Meta Model API, used only if Baseten
    // fails or is down. The Meta credit is mainly a backup now.
    const metaKey = readEnv('META_API_KEY');
    const metaModel = readEnv('META_MODEL_ID');
    const metaBaseUrl = readEnv('META_BASE_URL');
    if (!metaKey || !metaModel || !metaBaseUrl) throw basetenError;
    const meta = new OpenAI({
      baseURL: metaBaseUrl,
      apiKey: metaKey,
      fetch: fetchImpl,
      timeout: 60_000,
      maxRetries: 0,
    });
    const res = await meta.chat.completions.create({ ...body, model: metaModel });
    return extractResult(res.choices[0]?.message, 'meta');
  }
}
