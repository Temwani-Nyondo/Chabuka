import express from 'express';
import { z } from 'zod';
import { actionNameSchema } from '@chabuka/shared';
import { runAction, toHttpError } from './actions.js';
import { runHelperTurn } from './helper.js';
import { transcribeVoice } from './model.js';
import { handleMcpRequest } from './mcp.js';
import { createAgentToken, listAgentTokens, revokeAgentToken } from './tokens.js';
import { createUserClient } from './supabase.js';
import { buildIcs, googleCalendarUrl, matchSchema } from '@chabuka/shared';
import { loadServerEnv } from './env.js';

// Load the repo-root .env when present (local dev); deployed hosts set real
// environment variables and this is a no-op there.
loadServerEnv();

const app = express();
const port = Number(process.env.PORT ?? 3001);

// The web app runs on a different origin in dev, so the action API answers
// CORS for the app origins only.
const appUrl = process.env.APP_URL;
const localhostOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && (origin === appUrl || localhostOrigin.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Voice notes arrive as base64 (~4/3 wire size), so this route is
// registered BEFORE the default-limit parser and parses its own body.
app.post('/api/helper/transcribe', express.json({ limit: '15mb' }), async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    const audio = typeof req.body?.audio === 'string' ? req.body.audio : '';
    const match = /^data:(audio\/[^;,]+(?:;[^;,=]+=[^;,]+)*);base64,([\s\S]+)$/.exec(audio);
    const payload = (match?.[2] ?? '').replace(/\s/g, '');
    if (!match || payload.length === 0 || payload.length > 12_000_000) {
      res.status(400).json({ error: 'Send a base64 audio data URL (max ~9 MB).' });
      return;
    }
    const mimeType = (match[1] ?? 'audio/webm').split(';')[0] ?? 'audio/webm';
    const audioBytes = Buffer.from(payload, 'base64');
    // Meta's transcribe endpoint only takes RIFF/WAVE (mono 16-bit PCM).
    // The Gaffer page converts recordings to WAV before sending; anything
    // else is rejected here instead of failing obscurely upstream.
    const isWav =
      audioBytes.length > 12 &&
      audioBytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      audioBytes.subarray(8, 12).toString('ascii') === 'WAVE';
    if (!isWav) {
      res.status(400).json({ error: 'Voice note must be WAV audio. Record it again in the app and retry.' });
      return;
    }
    const text = await transcribeVoice({ audio: audioBytes, mimeType });
    res.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription failed.';
    if (message.includes('META_TRANSCRIBE_MODEL_ID')) {
      res.status(503).json({ error: 'Voice notes are not set up yet. The server is missing its transcription key.' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Transcription failed. Try again.' });
  }
});

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'chabuka-api' });
});

// One action layer: the web app, the Gaffer and the MCP tools all land
// here. Writes run as the signed-in user so RLS enforces permissions.
app.post('/api/actions/:name', async (req, res) => {
  const parsedName = actionNameSchema.safeParse(req.params['name']);
  if (!parsedName.success) {
    res.status(404).json({ error: 'Unknown action.' });
    return;
  }
  const auth = req.header('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/.exec(auth)?.[1];
  if (!token) {
    res.status(401).json({ error: 'Missing sign-in token.' });
    return;
  }
  try {
    const db = createUserClient(token);
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired sign-in.' });
      return;
    }
    const result = await runAction(db, data.user.id, parsedName.data, req.body ?? {});
    res.json(result);
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  }
});

const helperBodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(4000) }))
    .max(10)
    .optional(),
  // Optional attached photos as data URLs (jpeg/png/webp, max 3).
  images: z.array(z.string().max(5_000_000)).max(3).optional(),
});

// "Ask the Gaffer" in the web nav lands here. Same auth shape as the
// action layer; the model acts as the signed-in user via runAction.
app.post('/api/helper', async (req, res) => {
  const auth = req.header('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/.exec(auth)?.[1];
  if (!token) {
    res.status(401).json({ error: 'Missing sign-in token.' });
    return;
  }
  const parsed = helperBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Check the input and try again.' });
    return;
  }
  try {
    const db = createUserClient(token);
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired sign-in.' });
      return;
    }
    const turn = await runHelperTurn({
      db,
      userId: data.user.id,
      message: parsed.data.message,
      history: parsed.data.history,
      images: parsed.data.images,
    });
    res.json(turn);
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  }
});

// Agent access tokens (brief section 10): the profile page mints these (JWT
// auth here), MCP requests present them as Bearer. Raw shown once at mint.
async function authedUserId(req: express.Request, res: express.Response): Promise<string | null> {
  const auth = req.header('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/.exec(auth)?.[1];
  if (!token) {
    res.status(401).json({ error: 'Missing sign-in token.' });
    return null;
  }
  const db = createUserClient(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired sign-in.' });
    return null;
  }
  return data.user.id;
}

app.post('/api/agent-tokens', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    const db = createUserClient((/^Bearer\s+(.+)$/.exec(req.header('authorization') ?? '')?.[1] ?? ''));
    const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim().slice(0, 60) : 'Agent';
    const { token } = await createAgentToken(db, userId, label);
    res.json({ token, note: 'Copy it now. It will not be shown again.' });
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error('agent-token mint failed:', err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/agent-tokens', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    const db = createUserClient((/^Bearer\s+(.+)$/.exec(req.header('authorization') ?? '')?.[1] ?? ''));
    res.json(await listAgentTokens(db, userId));
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error('agent-token list failed:', err);
    res.status(status).json({ error: message });
  }
});

app.delete('/api/agent-tokens/:id', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    const db = createUserClient((/^Bearer\s+(.+)$/.exec(req.header('authorization') ?? '')?.[1] ?? ''));
    await revokeAgentToken(db, userId, req.params['id'] ?? '');
    res.json({ revoked: true });
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error('agent-token revoke failed:', err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/calendar/:matchId.ics', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    const db = createUserClient((/^Bearer\s+(.+)$/.exec(req.header('authorization') ?? '')?.[1] ?? ''));
    const { data, error } = await db.from('matches').select('*').eq('id', req.params['matchId'] ?? '').maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Match not found.' });
      return;
    }
    const match = matchSchema.parse(data);
    const ics = buildIcs({
      id: match.id,
      title: match.title,
      startsAt: match.starts_at,
      location: match.venue_name ?? match.area ?? null,
      description: `Chabuka match. Add to Google Calendar: ${googleCalendarUrl({ title: match.title, startsAt: match.starts_at, location: match.venue_name ?? match.area ?? null })}`,
    });
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="chabuka-${match.id}.ics"`);
    res.send(ics);
  } catch (err) {
    const { status, message } = toHttpError(err);
    res.status(status).json({ error: message });
  }
});

app.post('/mcp', async (req, res) => {
  try {
    await handleMcpRequest(req, res as never);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
  }
});

app.listen(port, () => {
  console.log(`chabuka api listening on ${port}`);
});
