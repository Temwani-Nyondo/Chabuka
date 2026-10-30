import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { actionNameSchema } from '@chabuka/shared';
import { runAction, toHttpError } from './actions.js';
import { createUserClient } from './supabase.js';

// Load the repo-root .env when present (local dev); deployed hosts set real
// environment variables and this is a no-op there.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // A malformed .env should not stop the server booting.
    }
    break;
  }
}

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

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'chabuka-api' });
});

// One action layer: the web app, the helper and the MCP tools all land
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

app.listen(port, () => {
  console.log(`chabuka api listening on ${port}`);
});
