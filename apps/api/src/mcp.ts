import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  competitionSchema,
  computeStandings,
  createMatchSchema,
  googleCalendarUrl,
  matchSchema,
  teamSchema,
} from '@chabuka/shared';
import type { CreateMatchInput, Match } from '@chabuka/shared';
import { runAction } from './actions.js';
import { createServiceClient } from './supabase.js';
import { resolveAgentUser } from './tokens.js';

// MCP server (brief section 10): every tool calls the same action layer as
// the web buttons, as the user who owns the access token. Writes by draft
// then confirm wherever something gets created.

export interface AgentContext {
  db: SupabaseClient;
  userId: string;
}

const SEARCH_LIMIT = 25;

function textResult(payload: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

async function searchMatches(db: SupabaseClient, input: { sportId?: string; level?: string; before?: string }) {
  let query = db
    .from('matches')
    .select('*')
    .eq('status', 'open')
    .order('starts_at')
    .limit(SEARCH_LIMIT);
  if (input.sportId) query = query.eq('sport_id', input.sportId);
  if (input.level) query = query.eq('level', input.level);
  if (input.before) query = query.lte('starts_at', input.before);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown[];
  return rows
    .map((row) => {
      const parsed = matchSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((m): m is Match => m !== null);
}

interface Draft {
  userId: string;
  input: CreateMatchInput;
  expiresAt: number;
}

const drafts = new Map<string, Draft>();
const DRAFT_TTL_MS = 30 * 60 * 1000;

export function buildMcpServer(ctx: AgentContext): McpServer {
  const { db, userId } = ctx;
  const server = new McpServer({ name: 'chabuka', version: '0.1.0' });

  server.tool(
    'search_matches',
    'Find open Chabuka matches anyone can join. Filter by sport, level, or a latest start date (ISO). Example: {"level":"intermediate"}.',
    { sportId: z.string().uuid().optional(), level: z.string().optional(), before: z.string().optional() },
    async (input) => textResult(await searchMatches(db, input)),
  );

  server.tool(
    'get_match',
    'Get one match by ID with its player count. Example: {"matchId":"<uuid>"}.',
    { matchId: z.string().uuid() },
    async ({ matchId }) => {
      const { data, error } = await db.from('matches').select('*').eq('id', matchId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Match not found.');
      const { count } = await db
        .from('match_participants')
        .select('user_id', { count: 'exact', head: true })
        .eq('match_id', matchId)
        .eq('status', 'joined');
      return textResult({ match: matchSchema.parse(data), joinedCount: count ?? 0 });
    },
  );

  server.tool(
    'draft_match',
    'Validate a new match and return a summary to confirm. Saves nothing. Example: {"sportId":"<uuid>","title":"5v5 Saturday","startsAt":"2026-11-07T10:00:00+02:00","area":"Woodlands","capacity":10,"level":"intermediate"}.',
    {
      sportId: z.string().uuid(),
      title: z.string(),
      startsAt: z.string(),
      area: z.string(),
      capacity: z.number(),
      level: z.string(),
    },
    async (input) => {
      const parsed = createMatchSchema.parse(input);
      const draftId = randomUUID();
      drafts.set(draftId, { userId, input: parsed, expiresAt: Date.now() + DRAFT_TTL_MS });
      return textResult({ draftId, summary: parsed, note: 'Review it, then call confirm_match.' });
    },
  );

  server.tool(
    'confirm_match',
    'Create the match from a draft ID returned by draft_match. Example: {"draftId":"<uuid>"}.',
    { draftId: z.string().uuid() },
    async ({ draftId }) => {
      const draft = drafts.get(draftId);
      if (!draft || draft.userId !== userId || draft.expiresAt < Date.now()) {
        throw new Error('Draft not found (it may have expired). Call draft_match again.');
      }
      drafts.delete(draftId);
      return textResult(await runAction(db, userId, 'create_match', draft.input));
    },
  );

  server.tool(
    'join_match',
    'Join the signed-in user to a match. Example: {"matchId":"<uuid>"}.',
    { matchId: z.string().uuid() },
    async ({ matchId }) => textResult(await runAction(db, userId, 'join_match', { matchId })),
  );

  server.tool(
    'withdraw_from_match',
    'Withdraw the signed-in user from a match. Example: {"matchId":"<uuid>"}.',
    { matchId: z.string().uuid() },
    async ({ matchId }) => textResult(await runAction(db, userId, 'withdraw_match', { matchId })),
  );

  server.tool(
    'search_challenges',
    'Find open challenges from teams looking for opponents.',
    {},
    async () => {
      const { data, error } = await db
        .from('challenges')
        .select('*')
        .eq('status', 'open')
        .order('window_start')
        .limit(SEARCH_LIMIT);
      if (error) throw new Error(error.message);
      return textResult(data ?? []);
    },
  );

  server.tool(
    'post_challenge',
    'Post a "looking for opponent" challenge for a team the user captains. Example: {"teamId":"<uuid>","format":"5v5","level":"intermediate","windowStart":"2026-11-07T09:00:00+02:00","windowEnd":"2026-11-07T13:00:00+02:00","area":"Woodlands","radiusKm":10}.',
    {
      teamId: z.string().uuid(),
      format: z.string().optional(),
      level: z.string(),
      windowStart: z.string(),
      windowEnd: z.string(),
      area: z.string(),
      radiusKm: z.number().optional(),
    },
    async (input) => textResult(await runAction(db, userId, 'post_challenge', input)),
  );

  server.tool(
    'respond_to_challenge',
    'Accept, decline, or propose another time on a challenge, as captain of the opponent team. Example: {"challengeId":"<uuid>","opponentTeamId":"<uuid>","decision":"accept","startsAt":"2026-11-07T10:00:00+02:00"}.',
    {
      challengeId: z.string().uuid(),
      opponentTeamId: z.string().uuid(),
      decision: z.enum(['accept', 'decline', 'propose']),
      startsAt: z.string().optional(),
      proposedStartsAt: z.string().optional(),
    },
    async (input) => {
      if (input.decision === 'accept') {
        return textResult(
          await runAction(db, userId, 'accept_challenge', {
            challengeId: input.challengeId,
            opponentTeamId: input.opponentTeamId,
            startsAt: input.startsAt,
          }),
        );
      }
      if (input.decision === 'decline') {
        return textResult(
          await runAction(db, userId, 'decline_challenge', { challengeId: input.challengeId }),
        );
      }
      if (!input.proposedStartsAt) throw new Error('proposedStartsAt is required to propose a time.');
      return textResult(
        await runAction(db, userId, 'propose_time', {
          challengeId: input.challengeId,
          opponentTeamId: input.opponentTeamId,
          proposedStartsAt: input.proposedStartsAt,
        }),
      );
    },
  );

  server.tool(
    'search_venues',
    'Find listed venues (places to play) by sport name if given. Example: {"sport":"basketball"}.',
    { sport: z.string().optional() },
    async ({ sport }) => {
      let query = db.from('venues').select('*').limit(SEARCH_LIMIT);
      if (sport) query = query.contains('sports', [sport]);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return textResult(data ?? []);
    },
  );

  server.tool(
    'request_booking',
    'Request a free venue booking by slot or requested time. Example: {"venueId":"<uuid>","requestedStartsAt":"2026-11-07T10:00:00+02:00"}.',
    {
      venueId: z.string().uuid(),
      slotId: z.string().uuid().optional(),
      requestedStartsAt: z.string().optional(),
    },
    async (input) => textResult(await runAction(db, userId, 'request_booking', input)),
  );

  server.tool(
    'get_board',
    'Get a tournament board: fixtures, results, standings (calculated from finished fixtures) and announcements. Example: {"competitionId":"<uuid>"}.',
    { competitionId: z.string().uuid() },
    async ({ competitionId }) => {
      const { data, error } = await db.from('competitions').select('*').eq('id', competitionId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Tournament not found.');
      const competition = competitionSchema.parse(data);
      const { data: entries } = await db.from('competition_entries').select('team_id').eq('competition_id', competitionId);
      const entryIds = ((entries ?? []) as { team_id: string }[]).map((e) => e.team_id);
      const { data: teamRows } = await db.from('teams').select('*').in('id', entryIds.length ? entryIds : ['00000000-0000-0000-0000-000000000000']);
      const teamNames = new Map<string, string>();
      for (const row of teamRows ?? []) {
        const parsed = teamSchema.safeParse(row);
        if (parsed.success) teamNames.set(parsed.data.id, parsed.data.name);
      }
      const { data: fixtures } = await db.from('fixtures').select('*').eq('competition_id', competitionId).order('created_at');
      const fixtureRows = (fixtures as { home_team_id: string; away_team_id: string; home_score: number | null; away_score: number | null; status: 'scheduled' | 'finished' }[] | null) ?? [];
      const { data: announcements } = await db.from('announcements').select('*').eq('competition_id', competitionId).order('created_at', { ascending: false });
      return textResult({
        competition,
        teams: Object.fromEntries(teamNames),
        fixtures: fixtureRows,
        standings: computeStandings(entryIds, fixtureRows),
        announcements: announcements ?? [],
      });
    },
  );

  server.tool(
    'follow_board',
    'Follow a tournament so its board is yours to check back on. Example: {"competitionId":"<uuid>"}.',
    { competitionId: z.string().uuid() },
    async ({ competitionId }) =>
      textResult(await runAction(db, userId, 'follow_competition', { competitionId })),
  );

  server.tool(
    'search_circles',
    'Find Chabuka circles (interest groups) by area or name. Example: {"area":"Lusaka"}.',
    { area: z.string().optional() },
    async ({ area }) => {
      let query = db.from('circles').select('*').order('created_at', { ascending: false }).limit(SEARCH_LIMIT);
      if (area) query = query.ilike('area', `%${area}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return textResult(data ?? []);
    },
  );

  server.tool(
    'join_circle',
    'Join a circle. Prerequisites (age group, gender, level) are checked against the user profile. Example: {"circleId":"<uuid>"}.',
    { circleId: z.string().uuid() },
    async ({ circleId }) => textResult(await runAction(db, userId, 'join_circle', { circleId })),
  );

  server.tool(
    'get_my_profile',
    'Get the signed-in user\'s Chabuka profile (town, area, sports level context). Example: {}.',
    {},
    async () => {
      const { data, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Profile not found.');
      return textResult(data);
    },
  );

  server.tool(
    'search_nearby',
    'Find open matches near the user, sorted by distance from their saved place when coordinates exist. Example: {"radiusKm":15}.',
    { radiusKm: z.number().optional() },
    async ({ radiusKm }) => {
      const { data: profile } = await db.from('profiles').select('lat,lng,area').eq('id', userId).maybeSingle();
      const matches = await searchMatches(db, {});
      const p = profile as { lat: number | null; lng: number | null; area: string | null } | null;
      const dist = (m: Match) => {
        if (p?.lat == null || p?.lng == null || m.lat == null || m.lng == null) return null;
        const dLat = m.lat - p.lat;
        const dLng = m.lng - p.lng;
        return Math.sqrt(dLat * dLat + dLng * dLng) * 111;
      };
      const sorted = matches
        .map((m) => ({ match: m, distanceKm: dist(m) }))
        .filter((x) => radiusKm == null || x.distanceKm == null || x.distanceKm <= radiusKm)
        .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
      return textResult({ area: p?.area ?? null, results: sorted });
    },
  );

  server.tool(
    'get_calendar_link',
    'Get calendar links for a match: a Google Calendar add link plus the ICS download path. Example: {"matchId":"<uuid>"}.',
    { matchId: z.string().uuid() },
    async ({ matchId }) => {
      const { data, error } = await db.from('matches').select('*').eq('id', matchId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Match not found.');
      const match = matchSchema.parse(data);
      return textResult({
        googleCalendarUrl: googleCalendarUrl({ title: match.title, startsAt: match.starts_at, location: match.venue_name ?? match.area ?? null }),
        icsPath: `/api/calendar/${match.id}.ics`,
      });
    },
  );

  server.tool(
    'get_my_schedule',
    'Get the signed-in user\'s upcoming joined matches. Example: {}.',
    {},
    async () => {
      const { data, error } = await db
        .from('match_participants')
        .select('match_id')
        .eq('user_id', userId)
        .eq('status', 'joined');
      if (error) throw new Error(error.message);
      const ids = ((data ?? []) as { match_id: string }[]).map((r) => r.match_id);
      if (ids.length === 0) return textResult([]);
      const { data: matchRows } = await db
        .from('matches')
        .select('*')
        .in('id', ids)
        .gte('starts_at', new Date().toISOString())
        .order('starts_at');
      return textResult(matchRows ?? []);
    },
  );

  return server;
}

// Express handler for POST /mcp. Stateless: one transport per request, so
// no session table to keep. Auth is the agent access token as Bearer.
export async function handleMcpRequest(
  req: { header(name: string): string | undefined; body?: unknown },
  res: {
    status(code: number): { json(body: unknown): void };
    json(body: unknown): void;
    writeHead(code: number, headers: Record<string, string>): void;
    end(chunk?: string): void;
    flushHeaders?: () => void;
    on(event: string, cb: () => void): void;
  },
): Promise<void> {
  const auth = req.header('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/.exec(auth)?.[1];
  if (!token) {
    res.status(401).json({ error: 'Missing agent token.' });
    return;
  }
  const service = createServiceClient();
  const userId = await resolveAgentUser(service, token).catch(() => null);
  if (!userId) {
    res.status(401).json({ error: 'Invalid or revoked agent token.' });
    return;
  }
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildMcpServer({ db: service, userId });
  res.on('close', () => {
    void transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(
    req as never,
    res as never,
    (req as { body?: unknown }).body,
  );
}
