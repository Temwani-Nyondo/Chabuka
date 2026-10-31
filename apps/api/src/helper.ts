import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTION_NAMES, type ActionName } from '@chabuka/shared';
import { chatOnce, type ModelMessage, type ModelResult } from './model.js';
import { ActionError, runAction, toHttpError } from './actions.js';

// Day 6 Gaffer: "Ask the Gaffer" in the web nav lands here. The model can
// read nothing directly; every fact and every change goes through the one
// action layer as the signed-in user, so RLS applies exactly as in the app.
// Bookings and tickets are free in the MVP; the Gaffer always says so.
const HELPER_SYSTEM_PROMPT = [
  'You are the Gaffer, the Chabuka assistant. Chabuka arranges real-life grassroots sport:',
  'find a game, find an opponent, find a place, and play.',
  'Answer briefly. You help with game plans, sport insight such as rules and trivia,',
  'and briefs or recaps about fixtures, results, standings and statistics.',
  'Only report facts you fetched through an action in this conversation;',
  'never invent scores, standings or statistics, and say plainly what is missing.',
  'When the user wants something done, call the matching',
  'action tool with its arguments as the JSON object. Every booking and',
  'ticket is free while demonstrating; never mention payments.',
  'If a tool call fails, read the error, fix the arguments once, and retry.',
  'If it still fails, say plainly what is missing.',
].join(' ');

// One tool per server action. The tool arguments ARE the action body;
// runAction's zod schemas validate them and return fixable errors.
function actionTool(name: ActionName): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name,
      description: `Chabuka action ${name}. Arguments are the action input object.`,
      parameters: { type: 'object' },
    },
  };
}

const ACTION_TOOLS: OpenAI.Chat.ChatCompletionTool[] = ACTION_NAMES.map(actionTool);

export interface HelperActionTaken {
  name: string;
  ok: boolean;
}

export interface HelperTurn {
  reply: string;
  actionsTaken: HelperActionTaken[];
  provider: string;
}

type ChatFn = typeof chatOnce;
type ExecuteFn = (name: string, body: unknown) => Promise<unknown>;

const MAX_ROUNDS = 5;
const HISTORY_LIMIT = 10;
const TOOL_RESULT_LIMIT = 4000;

function truncateResult(value: unknown): string {
  const text = JSON.stringify(value) ?? 'null';
  return text.length > TOOL_RESULT_LIMIT ? `${text.slice(0, TOOL_RESULT_LIMIT)}…(truncated)` : text;
}

function parseToolArguments(raw: string): unknown {
  try {
    return raw ? (JSON.parse(raw) as unknown) : {};
  } catch {
    throw new ActionError(400, 'The Gaffer sent malformed action arguments.');
  }
}

export async function runHelperTurn(
  params: { db: SupabaseClient; userId: string; message: string; history?: ModelMessage[] },
  deps?: { chat?: ChatFn; execute?: ExecuteFn },
): Promise<HelperTurn> {
  const chat: ChatFn = deps?.chat ?? chatOnce;
  const execute: ExecuteFn = deps?.execute ?? ((name, body) => runAction(params.db, params.userId, name, body));

  const recent = (params.history ?? []).slice(-HISTORY_LIMIT);
  const messages: ModelMessage[] = [
    { role: 'system', content: HELPER_SYSTEM_PROMPT },
    ...recent,
    { role: 'user', content: params.message },
  ];
  const actionsTaken: HelperActionTaken[] = [];
  let provider = 'baseten';
  let reply = '';

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let result: ModelResult;
    try {
      result = await chat({ messages, tools: ACTION_TOOLS });
    } catch (err) {
      if (err instanceof Error && err.message.includes('BASETEN_API_KEY')) {
        throw new ActionError(503, 'The Gaffer is not set up yet. The server is missing its model key.');
      }
      throw err;
    }
    provider = result.provider;
    if (result.toolCalls.length === 0) {
      reply = result.content ?? '';
      break;
    }
    reply = result.content ?? reply;
    const toolMessages: ModelMessage[] = [];
    for (const call of result.toolCalls) {
      let payload: string;
      let ok = true;
      try {
        const outcome = await execute(call.name, parseToolArguments(call.arguments));
        payload = truncateResult(outcome);
      } catch (err) {
        ok = false;
        const { message } = toHttpError(err);
        payload = JSON.stringify({ error: message });
      }
      actionsTaken.push({ name: call.name, ok });
      toolMessages.push({
        role: 'user',
        content: `Result of ${call.name} (${call.id}): ${payload}`,
      });
    }
    messages.push(...toolMessages);
  }
  return { reply, actionsTaken, provider };
}
