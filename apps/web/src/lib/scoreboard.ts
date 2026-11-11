import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reduceScoreboard } from '@chabuka/shared';
import type {
  RosterPlayer,
  ScoreboardConfig,
  ScoreboardEventInput,
  ScoreboardEventRecord,
  ScoreboardSport,
  ScoreboardState,
} from '@chabuka/shared';
import { API_BASE } from './api';
import { supabase } from './supabase';

// Client for the scoreboard API, plus the live hook the viewer and the control
// panel share. The reducer from @chabuka/shared runs here too, so what a viewer
// sees is computed exactly the way the server computes it.

export interface PublicBoard {
  shareCode: string;
  sport: ScoreboardSport;
  config: ScoreboardConfig;
  homeName: string;
  awayName: string;
  status: 'setup' | 'live' | 'paused' | 'break' | 'ended';
  homeScore: number;
  awayScore: number;
  officialName: string | null;
  mvpPlayerId: string | null;
  resultPosted: boolean;
  startedAt: string | null;
  endedAt: string | null;
  serverNow: number;
  title: string | null;
}

export interface BoardRoster {
  id: string;
  side: 'home' | 'away';
  name: string;
  number: number | null;
  starter: boolean;
}

export interface BoardBundle {
  board: PublicBoard;
  roster: BoardRoster[];
  events: ScoreboardEventRecord[];
}

export interface ControlBundle extends BoardBundle {
  id: string;
  isOfficial: boolean;
  canManage: boolean;
  fixtureId: string | null;
  matchId: string | null;
  candidates: { userId: string; name: string }[];
  pickup: boolean;
}

export interface TargetInfo {
  canCreate: boolean;
  board: { id: string; shareCode: string; status: PublicBoard['status']; isOfficial: boolean; canManage: boolean } | null;
}

export class ScoreboardApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, method: string, token?: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // Offline or the server is asleep: status 0 tells callers to retry later.
    throw new ScoreboardApiError('Could not reach the Chabuka server.', 0);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new ScoreboardApiError(data?.error ?? 'Something went wrong. Try again.', res.status);
  return data as T;
}

export const fetchPublicBoard = (code: string) => call<BoardBundle>(`/api/public/scoreboard/${encodeURIComponent(code)}`, 'GET');
export const fetchControlBoard = (token: string, id: string) => call<ControlBundle>(`/api/scoreboards/${id}`, 'GET', token);
export const fetchTargetInfo = (token: string, target: { fixtureId?: string; matchId?: string }) =>
  call<TargetInfo>(
    `/api/scoreboards/by-target?${target.fixtureId ? `fixtureId=${target.fixtureId}` : `matchId=${target.matchId}`}`,
    'GET',
    token,
  );
export const createBoard = (token: string, body: unknown) => call<{ id: string; shareCode: string }>('/api/scoreboards', 'POST', token, body);
export const appointOfficialCall = (token: string, id: string, officialId: string) =>
  call<{ ok: true }>(`/api/scoreboards/${id}/appoint`, 'POST', token, { officialId });
export const setLineupCall = (token: string, id: string, starters: string[]) =>
  call<{ ok: true }>(`/api/scoreboards/${id}/lineup`, 'POST', token, { starters });
export const addPlayerCall = (token: string, id: string, body: { side: 'home' | 'away'; name: string; number?: number; starter?: boolean }) =>
  call<{ id: string }>(`/api/scoreboards/${id}/players`, 'POST', token, body);
export const movePlayerCall = (token: string, id: string, playerId: string, side: 'home' | 'away') =>
  call<{ ok: true }>(`/api/scoreboards/${id}/players/${playerId}/side`, 'POST', token, { side });
export const postEventsCall = (token: string, id: string, events: ScoreboardEventInput[]) =>
  call<{
    accepted: { clientId: string; seq: number }[];
    duplicates: number;
    error: { index: number; message: string } | null;
    status: PublicBoard['status'];
    score: { home: number; away: number };
  }>(`/api/scoreboards/${id}/events`, 'POST', token, { events });
export const undoCall = (token: string, id: string) =>
  call<{ voidedSeq: number | null; status: PublicBoard['status'] }>(`/api/scoreboards/${id}/undo`, 'POST', token, {});
export const finishCall = (token: string, id: string, mvpPlayerId?: string) =>
  call<{ homeScore: number; awayScore: number }>(`/api/scoreboards/${id}/finish`, 'POST', token, mvpPlayerId ? { mvpPlayerId } : {});

export function scoreboardUrl(code: string): string {
  return `${window.location.origin}/s/${code}`;
}

// --- Live updates ---------------------------------------------------------------

interface Update {
  board: PublicBoard;
  roster?: BoardRoster[];
  add: ScoreboardEventRecord[];
  voided: number[];
}

/** Merge one broadcast into what we already hold. Returns null when events are missing (refetch). */
function mergeUpdate(prev: BoardBundle, u: Update): BoardBundle | null {
  const bySeq = new Map(prev.events.map((e) => [e.seq, e]));
  for (const e of u.add) bySeq.set(e.seq, e);
  const seqs = [...bySeq.keys()].sort((a, b) => a - b);
  for (let i = 1; i < seqs.length; i++) if (seqs[i] !== (seqs[i - 1] ?? 0) + 1) return null;
  for (const v of u.voided) {
    const e = bySeq.get(v);
    if (e) bySeq.set(v, { ...e, voided: true });
  }
  return { board: u.board, roster: u.roster ?? prev.roster, events: seqs.map((s) => bySeq.get(s)!) };
}

export interface LiveBoard {
  bundle: BoardBundle | null;
  state: ScoreboardState | null;
  error: string | null;
  /** Server clock estimate: add to Date.now() to get server time. */
  offset: number;
  live: boolean;
  refresh: () => void;
}

/** Watches one scoreboard: first load, live pushes, and a polling fallback. */
export function useLiveBoard(code: string | undefined): LiveBoard {
  const [bundle, setBundle] = useState<BoardBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [live, setLive] = useState(false);
  const bundleRef = useRef<BoardBundle | null>(null);
  bundleRef.current = bundle;

  const load = useCallback(async () => {
    if (!code) return;
    try {
      const sentAt = Date.now();
      const data = await fetchPublicBoard(code);
      setOffset(data.board.serverNow - (sentAt + Date.now()) / 2);
      setBundle(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the scoreboard.');
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live push over Supabase Realtime broadcast: no table is exposed.
  useEffect(() => {
    if (!code || !supabase) return;
    const client = supabase;
    const channel = client.channel(`scoreboard:${code}`);
    channel
      .on('broadcast', { event: 'update' }, (msg) => {
        const u = msg.payload as Update;
        const prev = bundleRef.current;
        if (!prev) {
          void load();
          return;
        }
        const merged = mergeUpdate(prev, u);
        if (merged) {
          setBundle({ ...merged, board: { ...u.board } });
          setOffset(u.board.serverNow - Date.now());
        } else {
          void load();
        }
      })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      setLive(false);
      void client.removeChannel(channel);
    };
  }, [code, load]);

  // Polling keeps the page right if the live connection drops.
  useEffect(() => {
    const status = bundle?.board.status;
    const every = live ? 30_000 : status === 'ended' ? 60_000 : 10_000;
    const t = window.setInterval(() => void load(), every);
    return () => window.clearInterval(t);
  }, [bundle?.board.status, live, load]);

  const state = useMemo(
    () =>
      bundle
        ? reduceScoreboard(
            bundle.board.config,
            bundle.roster.map((r): RosterPlayer => ({ id: r.id, side: r.side, name: r.name, number: r.number, starter: r.starter })),
            bundle.events,
          )
        : null,
    [bundle],
  );

  return { bundle, state, error, offset, live, refresh: () => void load() };
}

/** A ticking "now" in server time, for running clocks. */
export function useServerNow(offset: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now() + offset), 250);
    return () => window.clearInterval(t);
  }, [offset, running]);
  return now;
}
