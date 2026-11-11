import crypto from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  finalScore,
  presetFor,
  reduceScoreboard,
  scoreboardEventInputSchema,
  scoreboardSportFor,
  validateScoreboardEvent,
} from '@chabuka/shared';
import type {
  RosterPlayer,
  ScoreboardConfig,
  ScoreboardEventInput,
  ScoreboardEventRecord,
  ScoreboardSport,
  ScoreboardState,
} from '@chabuka/shared';
import { ActionError, clearFixtureResult, notifyUsers, recordFixtureResult } from './actions.js';

// Scoreboard: the API is the only door. Tables have no client policies, so every
// permission check lives here. The live state is always computed by the shared
// reducer from the event log, never stored by hand.

const STARTERS: Record<ScoreboardSport, number> = {
  football: 11, futsal: 5, basketball: 5, netball: 7, tennis: 0, padel: 0,
};
const MAX_BACKDATE_MS = 6 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 30_000;

// --- Row types ----------------------------------------------------------------

interface BoardRow {
  id: string;
  share_code: string;
  fixture_id: string | null;
  match_id: string | null;
  sport: ScoreboardSport;
  config: ScoreboardConfig;
  home_name: string;
  away_name: string;
  home_team_id: string | null;
  away_team_id: string | null;
  status: 'setup' | 'live' | 'paused' | 'break' | 'ended';
  official_id: string | null;
  appointed_by: string | null;
  created_by: string;
  home_score: number;
  away_score: number;
  mvp_player_id: string | null;
  result_posted: boolean;
  last_seq: number;
  started_at: string | null;
  ended_at: string | null;
}

interface PlayerRow {
  id: string;
  scoreboard_id: string;
  side: 'home' | 'away';
  user_id: string | null;
  name: string;
  number: number | null;
  starter: boolean;
}

interface EventRow {
  id: string;
  scoreboard_id: string;
  seq: number;
  client_id: string;
  type: ScoreboardEventRecord['type'];
  at: number | string;
  payload: Record<string, unknown>;
  voided: boolean;
}

export interface PublicBoard {
  shareCode: string;
  sport: ScoreboardSport;
  config: ScoreboardConfig;
  homeName: string;
  awayName: string;
  status: BoardRow['status'];
  homeScore: number;
  awayScore: number;
  officialName: string | null;
  mvpPlayerId: string | null;
  resultPosted: boolean;
  startedAt: string | null;
  endedAt: string | null;
  /** Server time when this was read, so viewers can correct their clocks. */
  serverNow: number;
  title: string | null;
}

export interface BoardBundle {
  board: PublicBoard;
  roster: { id: string; side: 'home' | 'away'; name: string; number: number | null; starter: boolean }[];
  events: ScoreboardEventRecord[];
}

export interface ControlBundle extends BoardBundle {
  id: string;
  isOfficial: boolean;
  canManage: boolean;
  fixtureId: string | null;
  matchId: string | null;
  /** People who can be appointed straight from the line-ups (account holders only). */
  candidates: { userId: string; name: string }[];
  /** A pickup game: sides are chosen by hand, so players can swap sides before kickoff. */
  pickup: boolean;
}

// --- Loading ---------------------------------------------------------------------

async function loadBoard(service: SupabaseClient, by: { id?: string; code?: string }): Promise<BoardRow> {
  const q = service.from('scoreboards').select('*');
  const { data, error } = await (by.id ? q.eq('id', by.id) : q.eq('share_code', by.code ?? '')).maybeSingle();
  if (error) throw new ActionError(500, 'Could not load the scoreboard.');
  if (!data) throw new ActionError(404, 'Scoreboard not found.');
  return data as BoardRow;
}

async function loadPlayers(service: SupabaseClient, boardId: string): Promise<PlayerRow[]> {
  const { data, error } = await service.from('scoreboard_players').select('*').eq('scoreboard_id', boardId).order('created_at');
  if (error) throw new ActionError(500, 'Could not load the line-ups.');
  return (data ?? []) as PlayerRow[];
}

async function loadEvents(service: SupabaseClient, boardId: string): Promise<EventRow[]> {
  const { data, error } = await service.from('scoreboard_events').select('*').eq('scoreboard_id', boardId).order('seq');
  if (error) throw new ActionError(500, 'Could not load the events.');
  return (data ?? []) as EventRow[];
}

function toRecord(row: EventRow): ScoreboardEventRecord {
  const p = row.payload ?? {};
  return {
    seq: row.seq,
    clientId: row.client_id,
    type: row.type,
    at: Number(row.at),
    ...(row.voided ? { voided: true } : {}),
    ...(p['side'] ? { side: p['side'] as 'home' | 'away' } : {}),
    ...(p['playerId'] ? { playerId: String(p['playerId']) } : {}),
    ...(p['assistId'] ? { assistId: String(p['assistId']) } : {}),
    ...(p['inId'] ? { inId: String(p['inId']) } : {}),
    ...(p['outId'] ? { outId: String(p['outId']) } : {}),
    ...(p['card'] ? { card: p['card'] as 'yellow' | 'red' } : {}),
    ...(typeof p['points'] === 'number' ? { points: p['points'] } : {}),
    ...(p['ownGoal'] ? { ownGoal: true } : {}),
    ...(p['note'] ? { note: String(p['note']) } : {}),
  };
}

function toRoster(rows: PlayerRow[]): RosterPlayer[] {
  return rows.map((p) => ({ id: p.id, side: p.side, name: p.name, number: p.number, starter: p.starter }));
}

function stateOf(board: BoardRow, players: PlayerRow[], events: ScoreboardEventRecord[]): ScoreboardState {
  return reduceScoreboard(board.config, toRoster(players), events);
}

async function gameTitle(service: SupabaseClient, board: BoardRow): Promise<string | null> {
  if (board.match_id) {
    const { data } = await service.from('matches').select('title').eq('id', board.match_id).maybeSingle();
    return (data as { title?: string } | null)?.title ?? null;
  }
  return `${board.home_name} vs ${board.away_name}`;
}

async function publicBoard(service: SupabaseClient, board: BoardRow): Promise<PublicBoard> {
  let officialName: string | null = null;
  if (board.official_id) {
    const { data } = await service.from('profiles').select('name').eq('id', board.official_id).maybeSingle();
    officialName = (data as { name?: string | null } | null)?.name ?? null;
  }
  return {
    shareCode: board.share_code,
    sport: board.sport,
    config: board.config,
    homeName: board.home_name,
    awayName: board.away_name,
    status: board.status,
    homeScore: board.home_score,
    awayScore: board.away_score,
    officialName,
    mvpPlayerId: board.mvp_player_id,
    resultPosted: board.result_posted,
    startedAt: board.started_at,
    endedAt: board.ended_at,
    serverNow: Date.now(),
    title: await gameTitle(service, board),
  };
}

async function bundleOf(service: SupabaseClient, board: BoardRow): Promise<BoardBundle> {
  const [players, events, pub] = await Promise.all([loadPlayers(service, board.id), loadEvents(service, board.id), publicBoard(service, board)]);
  return {
    board: pub,
    roster: players.map((p) => ({ id: p.id, side: p.side, name: p.name, number: p.number, starter: p.starter })),
    events: events.map(toRecord),
  };
}

export async function getPublicScoreboard(service: SupabaseClient, code: string): Promise<BoardBundle> {
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(code)) throw new ActionError(404, 'Scoreboard not found.');
  return bundleOf(service, await loadBoard(service, { code }));
}

// --- Permissions ------------------------------------------------------------------

interface GameContext {
  organiserId: string;
  teamIds: string[];
  sportId: string;
  title: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeName: string | null;
  awayName: string | null;
  fixtureId: string | null;
  matchId: string | null;
}

async function loadGameContext(
  service: SupabaseClient,
  target: { fixtureId?: string; matchId?: string },
  requireOpen = true,
): Promise<GameContext> {
  if (target.fixtureId) {
    const { data: f } = await service
      .from('fixtures')
      .select('id,competition_id,home_team_id,away_team_id,status')
      .eq('id', target.fixtureId)
      .maybeSingle();
    const fixture = f as { id: string; competition_id: string; home_team_id: string; away_team_id: string; status: string } | null;
    if (!fixture) throw new ActionError(404, 'Fixture not found.');
    const { data: c } = await service.from('competitions').select('organiser_id,sport_id,name,status').eq('id', fixture.competition_id).maybeSingle();
    const comp = c as { organiser_id: string; sport_id: string; name: string; status: string } | null;
    if (!comp) throw new ActionError(404, 'Tournament not found.');
    if (requireOpen && fixture.status !== 'scheduled') throw new ActionError(409, 'This fixture already has a result.');
    if (requireOpen && comp.status !== 'live') throw new ActionError(409, 'This tournament is not live.');
    const { data: teams } = await service.from('teams').select('id,name').in('id', [fixture.home_team_id, fixture.away_team_id]);
    const names = new Map(((teams ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
    return {
      organiserId: comp.organiser_id,
      teamIds: [fixture.home_team_id, fixture.away_team_id],
      sportId: comp.sport_id,
      title: comp.name,
      homeTeamId: fixture.home_team_id,
      awayTeamId: fixture.away_team_id,
      homeName: names.get(fixture.home_team_id) ?? 'Home',
      awayName: names.get(fixture.away_team_id) ?? 'Away',
      fixtureId: fixture.id,
      matchId: null,
    };
  }
  if (!target.matchId) throw new ActionError(400, 'Pick a fixture or a game.');
  const { data: m } = await service.from('matches').select('id,organiser_id,sport_id,title,kind').eq('id', target.matchId).maybeSingle();
  const match = m as { id: string; organiser_id: string; sport_id: string; title: string; kind: string } | null;
  if (!match) throw new ActionError(404, 'Game not found.');
  let homeTeamId: string | null = null;
  let awayTeamId: string | null = null;
  let homeName: string | null = null;
  let awayName: string | null = null;
  if (match.kind === 'team-vs-team') {
    const { data: ch } = await service.from('challenges').select('team_id,opponent_team_id').eq('match_id', match.id).maybeSingle();
    const c = ch as { team_id: string; opponent_team_id: string | null } | null;
    if (c?.opponent_team_id) {
      homeTeamId = c.team_id;
      awayTeamId = c.opponent_team_id;
      const { data: teams } = await service.from('teams').select('id,name').in('id', [homeTeamId, awayTeamId]);
      const names = new Map(((teams ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
      homeName = names.get(homeTeamId) ?? 'Home';
      awayName = names.get(awayTeamId) ?? 'Away';
    }
  }
  return {
    organiserId: match.organiser_id,
    teamIds: [homeTeamId, awayTeamId].filter((x): x is string => !!x),
    sportId: match.sport_id,
    title: match.title,
    homeTeamId,
    awayTeamId,
    homeName,
    awayName,
    fixtureId: null,
    matchId: match.id,
  };
}

async function isTeamLeader(service: SupabaseClient, teamIds: string[], userId: string): Promise<boolean> {
  if (teamIds.length === 0) return false;
  const { data } = await service
    .from('team_members')
    .select('role')
    .in('team_id', teamIds)
    .eq('user_id', userId)
    .in('role', ['owner', 'captain']);
  return ((data ?? []) as unknown[]).length > 0;
}

async function canManageGame(service: SupabaseClient, ctx: GameContext, userId: string): Promise<boolean> {
  return ctx.organiserId === userId || (await isTeamLeader(service, ctx.teamIds, userId));
}

async function managerOf(service: SupabaseClient, board: BoardRow, userId: string): Promise<boolean> {
  if (board.created_by === userId) return true;
  const ctx = await loadGameContext(service, board.fixture_id ? { fixtureId: board.fixture_id } : { matchId: board.match_id ?? '' }, false).catch(() => null);
  if (ctx) return canManageGame(service, ctx, userId);
  return isTeamLeader(service, [board.home_team_id, board.away_team_id].filter((x): x is string => !!x), userId);
}

// --- Create ----------------------------------------------------------------------

export const createScoreboardSchema = z
  .object({
    fixtureId: z.string().uuid().optional(),
    matchId: z.string().uuid().optional(),
    homeName: z.string().trim().min(1).max(60).optional(),
    awayName: z.string().trim().min(1).max(60).optional(),
    home: z.array(z.string().uuid()).max(40).optional(),
    away: z.array(z.string().uuid()).max(40).optional(),
    config: z
      .object({
        periodMinutes: z.number().int().min(1).max(90).optional(),
        goldenPoint: z.boolean().optional(),
        matchTiebreak: z.boolean().optional(),
        bestOf: z.union([z.literal(3), z.literal(5)]).optional(),
      })
      .optional(),
    officialId: z.string().uuid().optional(),
  })
  .refine((v) => !!v.fixtureId !== !!v.matchId, { message: 'Pick a fixture or a game, not both.' });
export type CreateScoreboardInput = z.infer<typeof createScoreboardSchema>;

function applyOverrides(config: ScoreboardConfig, o: CreateScoreboardInput['config']): ScoreboardConfig {
  if (!o) return config;
  if (config.kind === 'periods') {
    return { ...config, ...(o.periodMinutes ? { periodMinutes: o.periodMinutes } : {}) };
  }
  return {
    ...config,
    ...(o.goldenPoint !== undefined ? { goldenPoint: o.goldenPoint } : {}),
    ...(o.matchTiebreak !== undefined ? { matchTiebreak: o.matchTiebreak } : {}),
    ...(o.bestOf ? { bestOf: o.bestOf } : {}),
  };
}

async function namesFor(service: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const { data } = await service.from('profiles').select('id,name').in('id', userIds);
  for (const p of (data ?? []) as { id: string; name: string | null }[]) out.set(p.id, p.name?.trim() || 'Player');
  return out;
}

export async function createScoreboard(
  service: SupabaseClient,
  userId: string,
  raw: CreateScoreboardInput,
): Promise<{ id: string; shareCode: string }> {
  const input = createScoreboardSchema.parse(raw);
  const ctx = await loadGameContext(service, input.fixtureId ? { fixtureId: input.fixtureId } : { matchId: input.matchId ?? '' });
  if (!(await canManageGame(service, ctx, userId))) {
    throw new ActionError(403, 'Only the organiser or a team captain can set up the scoreboard.');
  }
  const { data: sportRow } = await service.from('sports').select('name').eq('id', ctx.sportId).maybeSingle();
  const sport = scoreboardSportFor((sportRow as { name?: string } | null)?.name);
  if (!sport) throw new ActionError(400, 'This sport does not have a scoreboard yet.');
  const config = applyOverrides(presetFor(sport), input.config);

  // Rosters: team members for team games; for a pickup game, the joined players split into sides.
  const sides: { side: 'home' | 'away'; userId: string }[] = [];
  if (ctx.homeTeamId && ctx.awayTeamId) {
    for (const [side, teamId] of [['home', ctx.homeTeamId], ['away', ctx.awayTeamId]] as const) {
      const { data } = await service.from('team_members').select('user_id').eq('team_id', teamId);
      for (const m of (data ?? []) as { user_id: string }[]) sides.push({ side, userId: m.user_id });
    }
  } else if (ctx.matchId) {
    const { data } = await service.from('match_participants').select('user_id').eq('match_id', ctx.matchId).eq('status', 'joined');
    const joined = ((data ?? []) as { user_id: string }[]).map((p) => p.user_id);
    const homePick = (input.home ?? []).filter((id) => joined.includes(id));
    const awayPick = (input.away ?? []).filter((id) => joined.includes(id) && !homePick.includes(id));
    if (homePick.length + awayPick.length > 0) {
      for (const id of homePick) sides.push({ side: 'home', userId: id });
      for (const id of awayPick) sides.push({ side: 'away', userId: id });
    } else {
      joined.forEach((id, i) => sides.push({ side: i % 2 === 0 ? 'home' : 'away', userId: id }));
    }
  }
  const names = await namesFor(service, sides.map((s) => s.userId));

  if (input.officialId) {
    const { data } = await service.from('profiles').select('id').eq('id', input.officialId).maybeSingle();
    if (!data) throw new ActionError(404, 'That person is not on Chabuka.');
  }

  let created: { id: string; share_code: string } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const shareCode = crypto.randomBytes(6).toString('base64url');
    const { data, error } = await service
      .from('scoreboards')
      .insert({
        share_code: shareCode,
        fixture_id: ctx.fixtureId,
        match_id: ctx.matchId,
        sport,
        config,
        home_name: input.homeName ?? ctx.homeName ?? 'Side A',
        away_name: input.awayName ?? ctx.awayName ?? 'Side B',
        home_team_id: ctx.homeTeamId,
        away_team_id: ctx.awayTeamId,
        official_id: input.officialId ?? null,
        appointed_by: input.officialId ? userId : null,
        created_by: userId,
        status: 'setup',
        home_score: 0,
        away_score: 0,
        result_posted: false,
        last_seq: 0,
      })
      .select('id,share_code')
      .single();
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        const existing = await service
          .from('scoreboards')
          .select('id,share_code')
          .eq(ctx.fixtureId ? 'fixture_id' : 'match_id', ctx.fixtureId ?? ctx.matchId ?? '')
          .maybeSingle();
        if ((existing.data as { id: string } | null)) throw new ActionError(409, 'This game already has a scoreboard.');
        continue; // share code clash: try another
      }
      throw new ActionError(500, 'Could not create the scoreboard.');
    }
    created = data as { id: string; share_code: string };
  }
  if (!created) throw new ActionError(500, 'Could not create the scoreboard.');

  const starters = STARTERS[sport];
  const rows = (['home', 'away'] as const).flatMap((side) =>
    sides
      .filter((s) => s.side === side)
      .map((s, i) => ({
        scoreboard_id: created!.id,
        side,
        user_id: s.userId,
        name: names.get(s.userId) ?? 'Player',
        number: null as number | null,
        starter: i < starters,
      })),
  );
  if (rows.length > 0) {
    const { error } = await service.from('scoreboard_players').insert(rows);
    if (error) throw new ActionError(500, 'Could not save the line-ups.');
  }
  if (input.officialId && input.officialId !== userId) {
    await notifyUsers([input.officialId], 'scoreboard_appointed', {
      boardId: created.id,
      shareCode: created.share_code,
      title: `${input.homeName ?? ctx.homeName ?? 'Side A'} vs ${input.awayName ?? ctx.awayName ?? 'Side B'}`,
    });
  }
  return { id: created.id, shareCode: created.share_code };
}

// --- Reading for the control panel and entry points -------------------------------

export async function getControlScoreboard(service: SupabaseClient, userId: string, boardId: string): Promise<ControlBundle> {
  const board = await loadBoard(service, { id: boardId });
  const bundle = await bundleOf(service, board);
  const isOfficial = board.official_id === userId;
  const canManage = isOfficial || (await managerOf(service, board, userId));
  if (!canManage) throw new ActionError(403, 'You are not part of this game.');
  const players = await loadPlayers(service, board.id);
  const candidates = players
    .filter((p): p is PlayerRow & { user_id: string } => !!p.user_id)
    .map((p) => ({ userId: p.user_id, name: p.name }));
  return { ...bundle, id: board.id, isOfficial, canManage, fixtureId: board.fixture_id, matchId: board.match_id, candidates, pickup: !board.home_team_id || !board.away_team_id };
}

export interface TargetInfo {
  canCreate: boolean;
  board: { id: string; shareCode: string; status: BoardRow['status']; isOfficial: boolean; canManage: boolean } | null;
}

/** For the buttons on a fixture or game: is there a scoreboard, and may this person set one up or run it? */
export async function scoreboardForTarget(
  service: SupabaseClient,
  userId: string,
  target: { fixtureId?: string; matchId?: string },
): Promise<TargetInfo> {
  const col = target.fixtureId ? 'fixture_id' : 'match_id';
  const id = target.fixtureId ?? target.matchId;
  if (!id) throw new ActionError(400, 'Pick a fixture or a game.');
  const { data } = await service.from('scoreboards').select('id,share_code,status,official_id').eq(col, id).maybeSingle();
  const b = data as { id: string; share_code: string; status: BoardRow['status']; official_id: string | null } | null;
  if (b) {
    const isOfficial = b.official_id === userId;
    let canManage = isOfficial;
    if (!canManage) {
      const full = await loadBoard(service, { id: b.id });
      canManage = await managerOf(service, full, userId);
    }
    return { canCreate: false, board: { id: b.id, shareCode: b.share_code, status: b.status, isOfficial, canManage } };
  }
  const ctx = await loadGameContext(service, target).catch(() => null);
  return { canCreate: ctx ? await canManageGame(service, ctx, userId) : false, board: null };
}

// --- Appointment, line-ups --------------------------------------------------------

export async function appointOfficial(service: SupabaseClient, userId: string, boardId: string, officialId: string): Promise<void> {
  const board = await loadBoard(service, { id: boardId });
  if (!(await managerOf(service, board, userId))) {
    throw new ActionError(403, 'Only the organiser or a team captain can appoint the official.');
  }
  if (board.status === 'ended') throw new ActionError(409, 'This game has ended.');
  const { data } = await service.from('profiles').select('id').eq('id', officialId).maybeSingle();
  if (!data) throw new ActionError(404, 'That person is not on Chabuka.');
  const { error } = await service.from('scoreboards').update({ official_id: officialId, appointed_by: userId }).eq('id', board.id);
  if (error) throw new ActionError(500, 'Could not appoint the official.');
  const title = `${board.home_name} vs ${board.away_name}`;
  if (officialId !== userId) {
    await notifyUsers([officialId], 'scoreboard_appointed', { boardId: board.id, shareCode: board.share_code, title });
  }
  if (board.official_id && board.official_id !== officialId && board.official_id !== userId) {
    await notifyUsers([board.official_id], 'scoreboard_replaced', { shareCode: board.share_code, title });
  }
  await broadcast(service, board.share_code, { board: await publicBoard(service, { ...board, official_id: officialId }), add: [], voided: [] });
}

export const lineupSchema = z.object({ starters: z.array(z.string().uuid()).max(60) });
export const addPlayerSchema = z.object({
  side: z.enum(['home', 'away']),
  name: z.string().trim().min(1).max(60),
  number: z.number().int().min(0).max(999).optional(),
  starter: z.boolean().optional(),
});

async function requireRunner(service: SupabaseClient, userId: string, board: BoardRow): Promise<void> {
  if (board.official_id === userId) return;
  if (await managerOf(service, board, userId)) return;
  throw new ActionError(403, 'Only the official or a team captain can change the line-ups.');
}

export async function setLineup(service: SupabaseClient, userId: string, boardId: string, starters: string[]): Promise<void> {
  const board = await loadBoard(service, { id: boardId });
  await requireRunner(service, userId, board);
  if (board.status !== 'setup') throw new ActionError(409, 'The game has started. Use substitutions.');
  const players = await loadPlayers(service, board.id);
  const valid = new Set(players.map((p) => p.id));
  const picked = starters.filter((id) => valid.has(id));
  for (const p of players) {
    const want = picked.includes(p.id);
    if (want !== p.starter) {
      const { error } = await service.from('scoreboard_players').update({ starter: want }).eq('id', p.id);
      if (error) throw new ActionError(500, 'Could not save the line-up.');
    }
  }
}

export async function addScoreboardPlayer(
  service: SupabaseClient,
  userId: string,
  boardId: string,
  input: z.infer<typeof addPlayerSchema>,
): Promise<{ id: string }> {
  const board = await loadBoard(service, { id: boardId });
  await requireRunner(service, userId, board);
  if (board.status === 'ended') throw new ActionError(409, 'This game has ended.');
  const { data, error } = await service
    .from('scoreboard_players')
    .insert({
      scoreboard_id: board.id,
      side: input.side,
      user_id: null,
      name: input.name,
      number: input.number ?? null,
      starter: board.status === 'setup' ? (input.starter ?? false) : false,
    })
    .select('id')
    .single();
  if (error) throw new ActionError(500, 'Could not add the player.');
  const bundle = await bundleOf(service, board);
  await broadcast(service, board.share_code, { board: bundle.board, roster: bundle.roster, add: [], voided: [] });
  return { id: (data as { id: string }).id };
}

/** Pickup games only: move a player to the other side before kickoff. */
export async function setPlayerSide(
  service: SupabaseClient,
  userId: string,
  boardId: string,
  playerId: string,
  side: 'home' | 'away',
): Promise<void> {
  const board = await loadBoard(service, { id: boardId });
  await requireRunner(service, userId, board);
  if (board.home_team_id && board.away_team_id) throw new ActionError(409, 'Team players stay on their own team.');
  if (board.status !== 'setup') throw new ActionError(409, 'The game has started.');
  const { data } = await service.from('scoreboard_players').select('id').eq('id', playerId).eq('scoreboard_id', board.id).maybeSingle();
  if (!data) throw new ActionError(404, 'Player not found.');
  const { error } = await service.from('scoreboard_players').update({ side, starter: false }).eq('id', playerId);
  if (error) throw new ActionError(500, 'Could not move the player.');
}

// --- Events --------------------------------------------------------------------------

export interface AddEventsResult {
  accepted: { clientId: string; seq: number }[];
  duplicates: number;
  error: { index: number; message: string } | null;
  status: BoardRow['status'];
  score: { home: number; away: number };
}

function payloadOf(e: ScoreboardEventInput): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const k of ['side', 'playerId', 'assistId', 'inId', 'outId', 'card', 'points', 'ownGoal', 'note'] as const) {
    if (e[k] !== undefined) p[k] = e[k];
  }
  return p;
}

export async function addScoreboardEvents(
  service: SupabaseClient,
  userId: string,
  boardId: string,
  rawEvents: unknown[],
  now: number = Date.now(),
): Promise<AddEventsResult> {
  let board = await loadBoard(service, { id: boardId });
  if (board.official_id !== userId) throw new ActionError(403, 'Only the appointed official can record events.');
  const players = await loadPlayers(service, board.id);
  const roster = toRoster(players);
  const existing = (await loadEvents(service, board.id)).map(toRecord);
  const known = new Set(existing.map((e) => e.clientId));
  let live = existing.filter((e) => !e.voided);
  let lastAt = live.length > 0 ? Math.max(...live.map((e) => e.at)) : 0;
  let lastSeq = board.last_seq;

  const result: AddEventsResult = { accepted: [], duplicates: 0, error: null, status: board.status, score: { home: board.home_score, away: board.away_score } };
  const added: ScoreboardEventRecord[] = [];

  for (let i = 0; i < rawEvents.length; i++) {
    const parsed = scoreboardEventInputSchema.safeParse(rawEvents[i]);
    if (!parsed.success) {
      result.error = { index: i, message: parsed.error.issues[0]?.message ?? 'That event is not valid.' };
      break;
    }
    const input = parsed.data;
    if (known.has(input.clientId)) {
      result.duplicates += 1;
      continue;
    }
    // A queued tap keeps its own time, kept close to ours and never before the last event.
    const at = Math.max(Math.min(input.at, now + MAX_FUTURE_MS), now - MAX_BACKDATE_MS, lastAt);
    const event: ScoreboardEventInput = { ...input, at };
    const state = reduceScoreboard(board.config, roster, live);
    const problem = validateScoreboardEvent(board.config, roster, state, event);
    if (problem) {
      result.error = { index: i, message: problem };
      break;
    }
    const seq = lastSeq + 1;
    const { error } = await service.from('scoreboard_events').insert({
      scoreboard_id: board.id,
      seq,
      client_id: event.clientId,
      type: event.type,
      at,
      payload: payloadOf(event),
      created_by: userId,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        result.duplicates += 1; // same tap arrived twice at once
        known.add(event.clientId);
        continue;
      }
      throw new ActionError(500, 'Could not save the event.');
    }
    const record: ScoreboardEventRecord = { ...event, seq };
    known.add(event.clientId);
    live = [...live, record];
    added.push(record);
    result.accepted.push({ clientId: event.clientId, seq });
    lastAt = at;
    lastSeq = seq;
  }

  if (added.length > 0) {
    const state = reduceScoreboard(board.config, roster, live);
    const score = finalScore(state);
    const first = added.find((e) => e.type === 'period_start');
    const patch: Record<string, unknown> = {
      status: state.status,
      home_score: score.home,
      away_score: score.away,
      last_seq: lastSeq,
    };
    if (first && !board.started_at) patch['started_at'] = new Date(first.at).toISOString();
    if (state.status === 'ended') patch['ended_at'] = new Date(added[added.length - 1]!.at).toISOString();
    const { error } = await service.from('scoreboards').update(patch).eq('id', board.id);
    if (error) throw new ActionError(500, 'Could not update the scoreboard.');
    board = { ...board, ...(patch as Partial<BoardRow>) } as BoardRow;
    result.status = state.status;
    result.score = score;
    await broadcast(service, board.share_code, { board: await publicBoard(service, board), add: added, voided: [] });
  }
  return result;
}

export async function undoLastEvent(service: SupabaseClient, userId: string, boardId: string): Promise<{ voidedSeq: number | null; status: BoardRow['status'] }> {
  let board = await loadBoard(service, { id: boardId });
  if (board.official_id !== userId) throw new ActionError(403, 'Only the appointed official can undo.');
  const players = await loadPlayers(service, board.id);
  const events = (await loadEvents(service, board.id)).map(toRecord);
  const last = [...events].reverse().find((e) => !e.voided);
  if (!last) return { voidedSeq: null, status: board.status };
  const { error } = await service
    .from('scoreboard_events')
    .update({ voided: true, voided_by: userId })
    .eq('scoreboard_id', board.id)
    .eq('seq', last.seq);
  if (error) throw new ActionError(500, 'Could not undo.');
  const remaining = events.filter((e) => !e.voided && e.seq !== last.seq);
  const state = stateOf(board, players, remaining);
  const score = finalScore(state);
  const patch: Record<string, unknown> = {
    status: state.status,
    home_score: score.home,
    away_score: score.away,
    ...(state.status !== 'ended' ? { ended_at: null } : {}),
    ...(remaining.length === 0 ? { started_at: null } : {}),
  };
  // Reopening a finished game takes its posted result back out of the tables.
  if (board.result_posted && state.status !== 'ended') {
    if (board.fixture_id) await clearFixtureResult(service, board.fixture_id);
    if (board.match_id) await service.from('matches').update({ home_score: null, away_score: null }).eq('id', board.match_id);
    patch['result_posted'] = false;
    patch['mvp_player_id'] = null;
  }
  const { error: updErr } = await service.from('scoreboards').update(patch).eq('id', board.id);
  if (updErr) throw new ActionError(500, 'Could not update the scoreboard.');
  board = { ...board, ...(patch as Partial<BoardRow>) } as BoardRow;
  await broadcast(service, board.share_code, { board: await publicBoard(service, board), add: [], voided: [last.seq] });
  return { voidedSeq: last.seq, status: state.status };
}

// --- Finish: write the result into the rest of the app --------------------------------

export async function finishScoreboard(
  service: SupabaseClient,
  userId: string,
  boardId: string,
  opts: { mvpPlayerId?: string } = {},
): Promise<{ homeScore: number; awayScore: number }> {
  const board = await loadBoard(service, { id: boardId });
  const isOfficial = board.official_id === userId;
  if (!isOfficial && !(await managerOf(service, board, userId))) {
    throw new ActionError(403, 'Only the official or the organiser can confirm the result.');
  }
  if (board.result_posted) throw new ActionError(409, 'The result is already in.');
  const players = await loadPlayers(service, board.id);
  const events = (await loadEvents(service, board.id)).map(toRecord);
  const state = stateOf(board, players, events);
  if (state.status !== 'ended') throw new ActionError(409, 'The game is not over yet.');
  const score = finalScore(state);
  if (opts.mvpPlayerId && !players.some((p) => p.id === opts.mvpPlayerId)) {
    throw new ActionError(400, 'That player is not in this game.');
  }

  if (board.fixture_id) {
    const { data } = await service.from('fixtures').select('status').eq('id', board.fixture_id).maybeSingle();
    if ((data as { status?: string } | null)?.status === 'finished') {
      throw new ActionError(409, 'This fixture already has a result.');
    }
    await recordFixtureResult(service, board.fixture_id, score.home, score.away, userId);
  } else if (board.match_id) {
    const { error } = await service.from('matches').update({ home_score: score.home, away_score: score.away }).eq('id', board.match_id);
    if (error) throw new ActionError(500, 'Could not save the score on the game.');
    const recipients = players.map((p) => p.user_id).filter((id): id is string => !!id && id !== userId);
    await notifyUsers(recipients, 'game_result', {
      matchId: board.match_id,
      title: await gameTitle(service, board),
      home: score.home,
      away: score.away,
      homeName: board.home_name,
      awayName: board.away_name,
    });
  }
  const { error } = await service
    .from('scoreboards')
    .update({ result_posted: true, home_score: score.home, away_score: score.away, mvp_player_id: opts.mvpPlayerId ?? null })
    .eq('id', board.id);
  if (error) throw new ActionError(500, 'Could not save the result.');
  const fresh = await loadBoard(service, { id: board.id });
  await broadcast(service, board.share_code, { board: await publicBoard(service, fresh), add: [], voided: [] });
  return { homeScore: score.home, awayScore: score.away };
}

// --- Live updates ------------------------------------------------------------------------

/** Pushes a change to everyone watching this scoreboard. Best effort: viewers also poll. */
export async function broadcast(
  _service: SupabaseClient,
  shareCode: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url.replace(/\/+$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `scoreboard:${shareCode}`, event: 'update', payload, private: false }] }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The page keeps itself fresh by polling.
  }
}
