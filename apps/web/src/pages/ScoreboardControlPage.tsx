import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { reduceScoreboard, validateScoreboardEvent } from '@chabuka/shared';
import type { PeriodsConfig, PeriodsState, RosterPlayer, ScoreSide, ScoreboardEventInput, ScoreboardEventRecord } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { Lineups, ScoreFace, Timeline, playerLabel } from '../components/scoreboard/ScoreFace';
import { supabase } from '../lib/supabase';
import {
  ScoreboardApiError,
  addPlayerCall,
  appointOfficialCall,
  fetchControlBoard,
  finishCall,
  movePlayerCall,
  postEventsCall,
  scoreboardUrl,
  setLineupCall,
  undoCall,
  useServerNow,
} from '../lib/scoreboard';
import type { ControlBundle } from '../lib/scoreboard';

type Picker =
  | { kind: 'goal'; side: ScoreSide; points: number; step: 'points' | 'scorer' | 'assist' | 'own'; playerId?: string }
  | { kind: 'sub'; side: ScoreSide; outId?: string }
  | { kind: 'card'; side: ScoreSide; playerId?: string }
  | null;

const queueKey = (id: string) => `chabuka:sb-queue:${id}`;

function loadQueue(id: string): ScoreboardEventInput[] {
  try {
    const raw = window.localStorage.getItem(queueKey(id));
    return raw ? (JSON.parse(raw) as ScoreboardEventInput[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(id: string, q: ScoreboardEventInput[]): void {
  try {
    if (q.length === 0) window.localStorage.removeItem(queueKey(id));
    else window.localStorage.setItem(queueKey(id), JSON.stringify(q));
  } catch {
    // Private mode: the queue just will not survive a refresh.
  }
}

// The scorekeeper's screen. Every tap becomes an event with its own id and is
// queued locally, so a dropped connection never loses a goal: the queue is sent
// in order, retried, and applied once.
export default function ScoreboardControlPage() {
  const { id } = useParams();
  const { session, user } = useAuth();
  const token = session?.access_token;
  const [bundle, setBundle] = useState<ControlBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ScoreboardEventInput[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const flushing = useRef(false);
  const pendingRef = useRef<ScoreboardEventInput[]>([]);
  pendingRef.current = pending;

  const reload = useCallback(async () => {
    if (!token || !id) return;
    try {
      const sentAt = Date.now();
      const data = await fetchControlBoard(token, id);
      setOffset(data.board.serverNow - (sentAt + Date.now()) / 2);
      setBundle(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the scoreboard.');
    }
  }, [token, id]);

  useEffect(() => {
    if (id) setPending(loadQueue(id));
    void reload();
  }, [id, reload]);

  useEffect(() => {
    if (!id) return;
    saveQueue(id, pending);
  }, [id, pending]);

  // Keep the screen fresh (appointments, line-up changes) when nothing is waiting to send.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (pendingRef.current.length === 0) void reload();
    }, 15_000);
    return () => window.clearInterval(t);
  }, [reload]);

  // Send the queue in order. Network trouble keeps it and retries; a refused event is dropped with a message.
  const flush = useCallback(async () => {
    if (!token || !id || flushing.current || pendingRef.current.length === 0) return;
    flushing.current = true;
    try {
      while (pendingRef.current.length > 0) {
        const batch = pendingRef.current.slice(0, 20);
        try {
          const result = await postEventsCall(token, id, batch);
          setOffline(false);
          const handled = result.error ? result.error.index + 1 : batch.length;
          const done = new Set(batch.slice(0, handled).map((e) => e.clientId));
          setPending((q) => q.filter((e) => !done.has(e.clientId)));
          pendingRef.current = pendingRef.current.filter((e) => !done.has(e.clientId));
          if (result.error) setNotice(result.error.message);
        } catch (err) {
          if (err instanceof ScoreboardApiError && err.status > 0 && err.status < 500) {
            // Refused for good (not the official any more, game over...): drop the batch and say why.
            const done = new Set(batch.map((e) => e.clientId));
            setPending((q) => q.filter((e) => !done.has(e.clientId)));
            pendingRef.current = pendingRef.current.filter((e) => !done.has(e.clientId));
            setNotice(err.message);
          } else {
            setOffline(true);
            return;
          }
        }
      }
      await reload();
    } finally {
      flushing.current = false;
    }
  }, [token, id, reload]);

  useEffect(() => {
    if (pending.length === 0) return;
    void flush();
    if (!offline) return;
    const t = window.setInterval(() => void flush(), 3000);
    return () => window.clearInterval(t);
  }, [pending.length, offline, flush]);

  const roster: RosterPlayer[] = useMemo(
    () => (bundle?.roster ?? []).map((r) => ({ id: r.id, side: r.side, name: r.name, number: r.number, starter: r.starter })),
    [bundle?.roster],
  );

  // What the screen shows: the server's log plus the taps still waiting to be sent.
  const records: ScoreboardEventRecord[] = useMemo(() => {
    const base = bundle?.events ?? [];
    const top = base.reduce((m, e) => Math.max(m, e.seq), 0);
    return [...base, ...pending.map((e, i) => ({ ...e, seq: top + i + 1 }))];
  }, [bundle?.events, pending]);

  const state = useMemo(
    () => (bundle ? reduceScoreboard(bundle.board.config, roster, records) : null),
    [bundle, roster, records],
  );
  const running = state?.kind === 'periods' && state.status === 'live';
  const now = useServerNow(offset, running);

  if (!user) return null;
  if (loadError && !bundle) {
    return (
      <div className="page">
        <h1>Scoreboard</h1>
        <p className="error">{loadError}</p>
        <Link className="btn" to="/home">Back to Home</Link>
      </div>
    );
  }
  if (!bundle || !state) return <div className="page"><p className="loading">Loading scoreboard…</p></div>;

  const { board } = bundle;
  const cfg = board.config;
  const byId = new Map(bundle.roster.map((p) => [p.id, p]));
  const isOfficial = bundle.isOfficial;

  const emit = (partial: Omit<ScoreboardEventInput, 'clientId' | 'at'>): boolean => {
    const event: ScoreboardEventInput = { ...partial, clientId: crypto.randomUUID(), at: Date.now() + offset };
    const problem = validateScoreboardEvent(cfg, roster, state, event);
    if (problem) {
      setNotice(problem);
      return false;
    }
    setNotice(null);
    setPending((q) => [...q, event]);
    pendingRef.current = [...pendingRef.current, event];
    setPicker(null);
    return true;
  };

  const undo = () => {
    if (!token || !id) return;
    // A tap that has not been sent yet is simply taken back.
    if (pending.length > 0) {
      setPending((q) => q.slice(0, -1));
      pendingRef.current = pendingRef.current.slice(0, -1);
      setNotice(null);
      return;
    }
    setBusy(true);
    undoCall(token, id)
      .then(() => reload())
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : 'Could not undo.'))
      .finally(() => setBusy(false));
  };

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    fn()
      .then(() => reload())
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : 'Something went wrong.'))
      .finally(() => setBusy(false));
  };

  const periodsState = state.kind === 'periods' ? (state as PeriodsState) : null;
  const periodsCfg = cfg.kind === 'periods' ? (cfg as PeriodsConfig) : null;
  const sideName = (s: ScoreSide) => (s === 'home' ? board.homeName : board.awayName);
  const onCourt = (side: ScoreSide) => (periodsState ? periodsState.onCourt[side] : []).map((pid) => byId.get(pid)).filter((p): p is NonNullable<typeof p> => !!p);
  const bench = (side: ScoreSide) =>
    bundle.roster.filter((p) => p.side === side && !(periodsState?.onCourt[side] ?? []).includes(p.id) && !(periodsState?.sentOff ?? []).includes(p.id));

  const pickList = (players: { id: string; side: ScoreSide; name: string; number: number | null }[], onPick: (pid: string) => void, extra?: { label: string; onClick: () => void }) => (
    <div className="sb-pick">
      {players.map((p) => (
        <button key={p.id} className="btn sb-pick-btn" type="button" onClick={() => onPick(p.id)}>
          {playerLabel(p as never)}
        </button>
      ))}
      {extra ? (
        <button className="btn btn-ghost sb-pick-btn" type="button" onClick={extra.onClick}>
          {extra.label}
        </button>
      ) : null}
      <button className="btn btn-ghost sb-pick-btn" type="button" onClick={() => setPicker(null)}>
        Cancel
      </button>
    </div>
  );

  const renderPicker = () => {
    if (!picker) return null;
    if (picker.kind === 'goal') {
      const { side } = picker;
      if (picker.step === 'points' && periodsCfg) {
        return (
          <div className="card sb-panel">
            <strong>Score for {sideName(side)}</strong>
            <div className="sb-pick">
              {periodsCfg.pointValues.map((v) => (
                <button key={v} className="btn btn-primary sb-pick-btn" type="button" onClick={() => setPicker({ ...picker, points: v, step: 'scorer' })}>
                  {v} {v === 1 ? 'point' : 'points'}
                </button>
              ))}
              <button className="btn btn-ghost sb-pick-btn" type="button" onClick={() => setPicker(null)}>Cancel</button>
            </div>
          </div>
        );
      }
      if (picker.step === 'scorer') {
        return (
          <div className="card sb-panel">
            <strong>Who scored for {sideName(side)}?</strong>
            {pickList(
              onCourt(side),
              (pid) => setPicker({ ...picker, playerId: pid, step: 'assist' }),
              { label: 'Unknown scorer', onClick: () => void emit({ type: 'goal', side, points: picker.points }) },
            )}
            <button className="btn btn-ghost" type="button" onClick={() => setPicker({ ...picker, step: 'own' })}>Own goal</button>
          </div>
        );
      }
      if (picker.step === 'own') {
        const other: ScoreSide = side === 'home' ? 'away' : 'home';
        return (
          <div className="card sb-panel">
            <strong>Own goal by which {sideName(other)} player?</strong>
            {pickList(onCourt(other), (pid) => void emit({ type: 'goal', side, playerId: pid, ownGoal: true, points: picker.points }))}
          </div>
        );
      }
      return (
        <div className="card sb-panel">
          <strong>Assist for {playerLabel(byId.get(picker.playerId ?? ''))}?</strong>
          {pickList(
            onCourt(side).filter((p) => p.id !== picker.playerId),
            (pid) => void emit({ type: 'goal', side, playerId: picker.playerId, assistId: pid, points: picker.points }),
            { label: 'No assist', onClick: () => void emit({ type: 'goal', side, playerId: picker.playerId, points: picker.points }) },
          )}
        </div>
      );
    }
    if (picker.kind === 'sub') {
      const { side } = picker;
      if (!picker.outId) {
        return (
          <div className="card sb-panel">
            <strong>{sideName(side)}: who goes off?</strong>
            {pickList(onCourt(side), (pid) => setPicker({ ...picker, outId: pid }))}
          </div>
        );
      }
      return (
        <div className="card sb-panel">
          <strong>Who comes on for {playerLabel(byId.get(picker.outId))}?</strong>
          {pickList(bench(side), (pid) => void emit({ type: 'sub', side, outId: picker.outId, inId: pid }))}
        </div>
      );
    }
    const { side } = picker;
    if (!picker.playerId) {
      return (
        <div className="card sb-panel">
          <strong>{sideName(side)}: card for whom?</strong>
          {pickList(bundle.roster.filter((p) => p.side === side && !(periodsState?.sentOff ?? []).includes(p.id)), (pid) => setPicker({ ...picker, playerId: pid }))}
        </div>
      );
    }
    return (
      <div className="card sb-panel">
        <strong>Card for {playerLabel(byId.get(picker.playerId))}</strong>
        <div className="sb-pick">
          <button className="btn sb-pick-btn sb-yellow" type="button" onClick={() => void emit({ type: 'card', side, playerId: picker.playerId, card: 'yellow' })}>Yellow card</button>
          <button className="btn sb-pick-btn sb-red" type="button" onClick={() => void emit({ type: 'card', side, playerId: picker.playerId, card: 'red' })}>Red card</button>
          <button className="btn btn-ghost sb-pick-btn" type="button" onClick={() => setPicker(null)}>Cancel</button>
        </div>
      </div>
    );
  };

  const sideButtons = (label: string, make: (side: ScoreSide) => void, primary = false) => (
    <div className="sb-two">
      {(['home', 'away'] as const).map((side) => (
        <button key={side} className={`btn sb-big${primary ? ' btn-primary' : ''}`} type="button" onClick={() => make(side)}>
          {label} {sideName(side)}
        </button>
      ))}
    </div>
  );

  const startGoal = (side: ScoreSide) => {
    if (!periodsCfg) return;
    const single = periodsCfg.pointValues.length === 1;
    setPicker({ kind: 'goal', side, points: single ? (periodsCfg.pointValues[0] ?? 1) : 1, step: single ? 'scorer' : 'points' });
  };

  const controls = () => {
    if (!isOfficial) return null;
    if (state.kind === 'racket') {
      if (state.status === 'setup') {
        return <button className="btn btn-primary sb-big" type="button" onClick={() => void emit({ type: 'period_start' })}>Start match</button>;
      }
      if (state.status === 'ended') return null;
      return (
        <>
          {sideButtons('Point to', (side) => void emit({ type: 'point', side }), true)}
          <button className="btn btn-ghost" type="button" onClick={() => void emit({ type: 'game_end' })}>End match early</button>
        </>
      );
    }
    switch (state.status) {
      case 'setup':
        return <button className="btn btn-primary sb-big" type="button" onClick={() => void emit({ type: 'period_start' })}>Kick off</button>;
      case 'break':
        return <button className="btn btn-primary sb-big" type="button" onClick={() => void emit({ type: 'period_start' })}>Start {periodsCfg?.periodNames[state.period] ?? 'next period'}</button>;
      case 'ended':
        return null;
      default:
        return (
          <>
            {sideButtons('Goal', startGoal, true)}
            <div className="sb-two">
              {sideButtons('Sub', (side) => setPicker({ kind: 'sub', side }))}
            </div>
            {sideButtons('Card', (side) => setPicker({ kind: 'card', side }))}
            {periodsCfg && periodsCfg.timeoutsPerSide > 0 ? sideButtons('Timeout', (side) => void emit({ type: 'timeout', side })) : null}
            <div className="sb-two">
              {state.status === 'live' ? (
                <button className="btn sb-big" type="button" onClick={() => void emit({ type: 'clock_pause' })}>Stop clock</button>
              ) : (
                <button className="btn btn-primary sb-big" type="button" onClick={() => void emit({ type: 'clock_resume' })}>Resume clock</button>
              )}
              <button className="btn sb-big" type="button" onClick={() => void emit({ type: 'period_end' })}>
                End {periodsCfg?.periods === 2 ? (state.period === 1 ? 'first half' : 'second half') : (periodsCfg?.periodNames[state.period - 1] ?? 'period')}
              </button>
            </div>
            <button className="btn btn-ghost" type="button" onClick={() => void emit({ type: 'game_end' })}>Abandon game</button>
          </>
        );
    }
  };

  return (
    <div className="page sb-page">
      <div className="sb-top">
        <Link to="/home">← Home</Link>
        <span className={`sb-live-dot${offline ? '' : ' sb-live-on'}`}>
          {offline ? `Offline · ${pending.length} waiting` : pending.length > 0 ? `Saving ${pending.length}…` : 'All saved'}
        </span>
      </div>
      {board.title ? <p className="muted sb-title">{board.title} · {board.sport}</p> : null}
      <ScoreFace board={board} state={state} now={now} />
      {notice ? <p className="error" role="alert">{notice}</p> : null}

      {state.status === 'setup' && pending.length === 0 ? (
        <SetupPanel
          key={bundle.roster.map((p) => `${p.id}${p.side}${p.starter ? 1 : 0}`).join('|')}
          bundle={bundle}
          token={token}
          userId={user.id}
          busy={busy}
          run={run}
        />
      ) : null}

      {!isOfficial && state.status !== 'setup' ? (
        <p className="hint">
          {board.officialName ? `${board.officialName} is running the scoreboard.` : 'No scorekeeper has been appointed.'}
          {bundle.canManage ? ' You can appoint someone else from the setup panel before kickoff, or watch below.' : ''}
        </p>
      ) : null}

      {picker ? renderPicker() : controls()}

      {isOfficial ? (
        <div className="actions-row">
          <button className="btn btn-ghost" type="button" disabled={busy || records.length === 0} onClick={undo}>Undo last</button>
        </div>
      ) : null}

      {state.status === 'ended' && !board.resultPosted && (isOfficial || bundle.canManage) ? (
        <ResultPanel bundle={bundle} busy={busy} onConfirm={(mvp) => token && id && run(() => finishCall(token, id, mvp))} />
      ) : null}
      {board.resultPosted ? <p className="hint">Result recorded. Undo the last event to reopen the game.</p> : null}

      <div className="actions-row">
        <Link className="btn btn-ghost" to={`/s/${board.shareCode}`}>Open public view</Link>
        <button className="btn btn-ghost" type="button" onClick={() => void navigator.clipboard?.writeText(scoreboardUrl(board.shareCode))}>
          Copy viewer link
        </button>
      </div>

      <h2>Match events</h2>
      <Timeline board={board} state={state} roster={bundle.roster} />
      <h2>Line-ups</h2>
      <Lineups board={board} state={state} roster={bundle.roster} />
    </div>
  );
}

function ResultPanel({ bundle, busy, onConfirm }: { bundle: ControlBundle; busy: boolean; onConfirm: (mvp?: string) => void }) {
  const [mvp, setMvp] = useState('');
  return (
    <div className="card sb-panel">
      <strong>Confirm the result</strong>
      <p className="muted">
        {bundle.board.homeName} {bundle.board.homeScore} - {bundle.board.awayScore} {bundle.board.awayName}. Confirming sends it to the tournament table and the players.
      </p>
      <label className="field">
        Player of the match (optional)
        <select className="input" value={mvp} onChange={(e) => setMvp(e.target.value)}>
          <option value="">No pick</option>
          {bundle.roster.map((p) => (
            <option key={p.id} value={p.id}>{playerLabel(p)} ({p.side === 'home' ? bundle.board.homeName : bundle.board.awayName})</option>
          ))}
        </select>
      </label>
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => onConfirm(mvp || undefined)}>
        Confirm result
      </button>
    </div>
  );
}

interface SetupProps {
  bundle: ControlBundle;
  token: string | undefined;
  userId: string;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => void;
}

// Before kickoff: who runs it, who starts, and who is playing.
function SetupPanel({ bundle, token, userId, busy, run }: SetupProps) {
  const [starters, setStarters] = useState<Set<string>>(() => new Set(bundle.roster.filter((p) => p.starter).map((p) => p.id)));
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  const [guestName, setGuestName] = useState('');
  const [guestNumber, setGuestNumber] = useState('');
  const [guestSide, setGuestSide] = useState<ScoreSide>('home');
  const { board, id, roster } = bundle;
  const racket = board.config.kind === 'racket';
  const pickup = bundle.pickup;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !supabase) {
      setFound([]);
      return;
    }
    const t = window.setTimeout(() => {
      void supabase!
        .from('profiles')
        .select('id,name')
        .ilike('name', `%${q}%`)
        .limit(6)
        .then(({ data }) => setFound(((data ?? []) as { id: string; name: string | null }[]).map((r) => ({ id: r.id, name: r.name ?? 'Player' }))));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const appoint = (officialId: string) => token && run(() => appointOfficialCall(token, id, officialId));
  const toggle = (pid: string) => {
    setStarters((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  return (
    <div className="card sb-panel">
      <strong>Set up the game</strong>
      <p className="muted">
        Scorekeeper: {board.officialName ?? 'nobody yet'}
        {bundle.isOfficial ? ' (you)' : ''}
      </p>
      {bundle.canManage ? (
        <div>
          <div className="actions-row">
            {!bundle.isOfficial ? (
              <button className="btn" type="button" disabled={busy} onClick={() => appoint(userId)}>I will run it</button>
            ) : null}
            {bundle.candidates
              .filter((c) => c.userId !== userId)
              .map((c) => (
                <button key={c.userId} className="btn btn-ghost" type="button" disabled={busy} onClick={() => appoint(c.userId)}>
                  Appoint {c.name}
                </button>
              ))}
          </div>
          <label className="field">
            Appoint someone else on Chabuka
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" />
          </label>
          {found.map((f) => (
            <button key={f.id} className="btn btn-ghost" type="button" disabled={busy} onClick={() => { appoint(f.id); setQuery(''); }}>
              Appoint {f.name}
            </button>
          ))}
        </div>
      ) : null}

      {!racket ? (
        <>
          <p className="muted">Starting players ({starters.size}). Tap to change.</p>
          {(['home', 'away'] as const).map((side) => (
            <div key={side}>
              <h3>{side === 'home' ? board.homeName : board.awayName}</h3>
              <div className="sb-pick">
                {roster.filter((p) => p.side === side).map((p) => (
                  <span key={p.id} className="sb-setup-player">
                    <button
                      className={`btn sb-pick-btn${starters.has(p.id) ? ' btn-primary' : ''}`}
                      type="button"
                      aria-pressed={starters.has(p.id)}
                      onClick={() => toggle(p.id)}
                    >
                      {playerLabel(p)}
                    </button>
                    {pickup ? (
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => token && run(() => movePlayerCall(token, id, p.id, side === 'home' ? 'away' : 'home'))}
                      >
                        Swap side
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <button
            className="btn"
            type="button"
            disabled={busy || !token}
            onClick={() => token && run(() => setLineupCall(token, id, [...starters]))}
          >
            Save starting line-ups
          </button>
        </>
      ) : null}

      <label className="field">
        Add a player who is not on Chabuka
        <div className="actions-row">
          <input className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Name" maxLength={60} />
          <input className="input" value={guestNumber} onChange={(e) => setGuestNumber(e.target.value)} placeholder="No." inputMode="numeric" style={{ maxWidth: 72 }} />
          <select className="input" value={guestSide} onChange={(e) => setGuestSide(e.target.value as ScoreSide)}>
            <option value="home">{board.homeName}</option>
            <option value="away">{board.awayName}</option>
          </select>
          <button
            className="btn"
            type="button"
            disabled={busy || !token || !guestName.trim()}
            onClick={() => {
              if (!token) return;
              const n = guestNumber.trim() ? Number(guestNumber) : undefined;
              run(() => addPlayerCall(token, id, { side: guestSide, name: guestName.trim(), ...(n !== undefined && Number.isFinite(n) ? { number: n } : {}) }));
              setGuestName('');
              setGuestNumber('');
            }}
          >
            Add
          </button>
        </div>
      </label>
    </div>
  );
}
