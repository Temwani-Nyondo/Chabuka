import express from 'express';
import { z } from 'zod';
import { actionNameSchema } from '@chabuka/shared';
import { runAction, toHttpError } from './actions.js';
import { runHelperTurn } from './helper.js';
import { transcribeVoice } from './model.js';
import { handleMcpRequest } from './mcp.js';
import { createAgentToken, listAgentTokens, revokeAgentToken } from './tokens.js';
import { createServiceClient, createUserClient } from './supabase.js';
import { isPlatformAdmin, listVenuesForReview, requireAdmin, reviewVenue } from './venues.js';
import { reviewVenueSchema } from '@chabuka/shared';
import {
  buildConnectUrl,
  claimTickets,
  completeLink,
  createTicketing,
  getLinkSummary,
  handleWebhook,
  refreshTicketing,
  removeLink,
  ticketingInputSchema,
} from './waitapp.js';
import { buildIcs, formatEventLocation, googleCalendarUrl, matchSchema } from '@chabuka/shared';
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

// Per-IP rate limit on /api (in-memory, one Render instance). Behind
// Cloudflare the real client IP is CF-Connecting-IP; Cloudflare's own WAF
// rules are the main defence, this is the backstop.
app.set('trust proxy', 1);
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const hits = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
}, RATE_WINDOW_MS).unref();
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }
  const key = req.header('cf-connecting-ip') ?? req.ip ?? 'unknown';
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) {
    res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' });
    return;
  }
  next();
});

// Model routes cost real money per call, so they get a much tighter
// per-user limit than the general per-IP one above.
const MODEL_RATE_MAX = 20;
const userHits = new Map<string, { count: number; resetAt: number }>();
function modelRateLimited(userId: string, res: express.Response): boolean {
  const now = Date.now();
  const entry = userHits.get(userId);
  if (!entry || entry.resetAt <= now) {
    userHits.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  if (entry.count <= MODEL_RATE_MAX) return false;
  res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
  res.status(429).json({ error: 'Slow down: too many Gaffer requests this minute. Try again shortly.' });
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of userHits) if (v.resetAt <= now) userHits.delete(k);
}, RATE_WINDOW_MS).unref();

// Voice notes arrive as base64 (~4/3 wire size), so this route is
// registered BEFORE the default-limit parser and parses its own body.
app.post('/api/helper/transcribe', express.json({ limit: '15mb' }), async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  if (modelRateLimited(userId, res)) return;
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
    // Gaffer page converts recordings to WAV before sending; anything
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

// WaitApp -> Chabuka ticket notifications. The signature covers the exact raw
// bytes, so this route reads the body raw instead of through express.json.
app.post('/api/webhooks/waitapp', express.raw({ type: '*/*', limit: '100kb' }), async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const result = await handleWebhook(createServiceClient(), raw, {
      timestamp: req.header('x-waitapp-timestamp') ?? '',
      signature: req.header('x-waitapp-signature') ?? '',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error('waitapp webhook failed:', err);
    res.status(status).json({ error: message });
  }
});

// Gaffer takes up to 3 attached photos (data URLs), well past the 100 KB
// default, so it parses its own larger body before the default parser runs.
app.use('/api/helper', express.json({ limit: '16mb' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'chabuka-api' });
});

// One action layer: the web app, Gaffer and the MCP tools all land
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
    // 'system' is deliberately not accepted: clients cannot write the rules.
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(10)
    .optional(),
  // Optional attached photos as data URLs (jpeg/png/webp, max 3).
  images: z.array(z.string().max(5_000_000)).max(3).optional(),
  // 'onboarding' runs the first-time setup agent instead of the general Gaffer.
  mode: z.enum(['general', 'onboarding']).optional(),
});

// "Ask Gaffer" in the web nav lands here. Same auth shape as the
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
    if (modelRateLimited(data.user.id, res)) return;
    const turn = await runHelperTurn({
      db,
      userId: data.user.id,
      message: parsed.data.message,
      history: parsed.data.history,
      images: parsed.data.images,
      mode: parsed.data.mode,
    });
    res.json(turn);
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  }
});

// Same turn as /api/helper, delivered as server-sent events so the reply can be
// shown and spoken while it is still being written. Events: `delta` {text},
// `retract` (take back the text of this round: it turned into actions), `done`
// {the whole turn}, `error` {error}. Validation and sign-in failures happen before
// the stream opens and are ordinary JSON errors.
app.post('/api/helper/stream', async (req, res) => {
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
  let opened = false;
  let gone = false;
  res.on('close', () => {
    gone = true;
  });
  const send = (event: string, data: unknown) => {
    if (gone) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const open = () => {
    if (opened) return;
    opened = true;
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
  };
  try {
    const db = createUserClient(token);
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired sign-in.' });
      return;
    }
    if (modelRateLimited(data.user.id, res)) return;
    open();
    const turn = await runHelperTurn({
      db,
      userId: data.user.id,
      message: parsed.data.message,
      history: parsed.data.history,
      images: parsed.data.images,
      mode: parsed.data.mode,
      onDelta: (text) => send('delta', { text }),
      onRetract: () => send('retract', {}),
    });
    send('done', turn);
    res.end();
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error(err);
    if (!opened) {
      res.status(status).json({ error: message });
      return;
    }
    send('error', { error: message });
    res.end();
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

// --- Venue approval (platform admins only) -----------------------------------
app.get('/api/admin/me', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    res.json({ admin: await isPlatformAdmin(createServiceClient(), userId) });
  } catch (err) {
    const { status, message } = toHttpError(err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/admin/venues', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  const status = z.enum(['pending', 'approved', 'rejected']).catch('pending').parse(req.query['status']);
  try {
    const service = createServiceClient();
    await requireAdmin(service, userId);
    res.json({ venues: await listVenuesForReview(service, status) });
  } catch (err) {
    const { status: code, message } = toHttpError(err);
    if (code >= 500) console.error('admin venues failed:', err);
    res.status(code).json({ error: message });
  }
});

app.post('/api/admin/venues/:id/review', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  const parsed = reviewVenueSchema.safeParse(req.body ?? {});
  const venueId = z.string().uuid().safeParse(req.params['id']);
  if (!parsed.success || !venueId.success) {
    res.status(400).json({ error: 'Choose approve or reject for a valid venue.' });
    return;
  }
  try {
    const service = createServiceClient();
    await requireAdmin(service, userId);
    res.json(await reviewVenue(service, userId, venueId.data, parsed.data));
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error('venue review failed:', err);
    res.status(status).json({ error: message });
  }
});

// --- Ticketed games (WaitApp ticket engine) ---------------------------------
// All writes go through the service role inside waitapp.ts, after the caller
// is identified and checked as the game's organiser.
function sendError(res: express.Response, err: unknown, label: string): void {
  const { status, message } = toHttpError(err);
  if (status >= 500) console.error(`${label} failed:`, err);
  res.status(status).json({ error: message });
}

app.get('/api/waitapp/link', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    res.json({ link: await getLinkSummary(createServiceClient(), userId) });
  } catch (err) {
    sendError(res, err, 'waitapp link read');
  }
});

app.post('/api/waitapp/connect-url', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    res.json({ url: buildConnectUrl(userId) });
  } catch (err) {
    sendError(res, err, 'waitapp connect-url');
  }
});

app.post('/api/waitapp/link', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  const parsed = z.object({ code: z.string().min(10).max(200), state: z.string().min(10).max(400) }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing link details.' });
    return;
  }
  try {
    res.json({ link: await completeLink(createServiceClient(), userId, parsed.data.code, parsed.data.state) });
  } catch (err) {
    sendError(res, err, 'waitapp link');
  }
});

app.delete('/api/waitapp/link', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    await removeLink(createServiceClient(), userId);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'waitapp unlink');
  }
});

app.post('/api/waitapp/ticketing', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  const parsed = ticketingInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Check the ticket details.' });
    return;
  }
  try {
    res.json({ ticketing: await createTicketing(createServiceClient(), userId, parsed.data) });
  } catch (err) {
    sendError(res, err, 'waitapp ticketing');
  }
});

app.post('/api/waitapp/ticketing/refresh', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  const parsed = z.object({ matchId: z.string().uuid() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing game.' });
    return;
  }
  try {
    res.json({ ticketing: await refreshTicketing(createServiceClient(), userId, parsed.data.matchId) });
  } catch (err) {
    sendError(res, err, 'waitapp refresh');
  }
});

// Called once after sign-in: attaches tickets bought before the account existed.
app.post('/api/waitapp/claim', async (req, res) => {
  const userId = await authedUserId(req, res);
  if (!userId) return;
  try {
    res.json(await claimTickets(createServiceClient(), userId));
  } catch (err) {
    sendError(res, err, 'waitapp claim');
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
    const location = formatEventLocation({
      name: match.venue_name,
      area: match.area,
      lat: match.lat ?? null,
      lng: match.lng ?? null,
    });
    const ics = buildIcs({
      id: match.id,
      title: match.title,
      startsAt: match.starts_at,
      location,
      description: `Chabuka match. Add to Google Calendar: ${googleCalendarUrl({ title: match.title, startsAt: match.starts_at, location })}`,
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
