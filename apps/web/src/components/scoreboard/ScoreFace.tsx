import { displayClock, gamePointLabel } from '@chabuka/shared';
import type { PeriodsConfig, PeriodsState, RacketConfig, RacketState, ScoreboardState, TimelineItem } from '@chabuka/shared';
import type { BoardRoster, PublicBoard } from '../../lib/scoreboard';

export function playerLabel(p: BoardRoster | undefined): string {
  if (!p) return 'Unknown';
  return p.number != null ? `#${p.number} ${p.name}` : p.name;
}

export function statusText(board: PublicBoard, state: ScoreboardState): string {
  if (state.kind === 'racket') {
    return state.status === 'setup' ? 'Not started' : state.status === 'ended' ? 'Match over' : 'Live';
  }
  const cfg = board.config as PeriodsConfig;
  switch (state.status) {
    case 'setup':
      return 'Not started';
    case 'live':
      return cfg.periodNames[state.period - 1] ?? 'Live';
    case 'paused':
      return 'Play stopped';
    case 'break':
      return cfg.periods === 2 ? 'Half time' : `End of ${cfg.periodNames[state.period - 1] ?? 'period'}`;
    case 'ended':
      return 'Full time';
  }
}

export function describeItem(item: TimelineItem, board: PublicBoard, byId: Map<string, BoardRoster>): string {
  const side = item.side === 'home' ? board.homeName : item.side === 'away' ? board.awayName : '';
  const name = (id?: string) => playerLabel(id ? byId.get(id) : undefined);
  const cfg = board.config;
  switch (item.type) {
    case 'period_start':
      if (cfg.kind === 'racket') return 'Match started';
      return item.period === 1 ? 'Kick-off' : `${cfg.periodNames[item.period - 1] ?? 'Next period'} starts`;
    case 'period_end': {
      if (cfg.kind === 'racket') return 'Match over';
      return item.period >= cfg.periods ? 'Full time' : cfg.periods === 2 ? 'Half time' : `End of ${cfg.periodNames[item.period - 1] ?? 'period'}`;
    }
    case 'game_end':
      return 'Game ended';
    case 'clock_pause':
      return 'Play stopped';
    case 'clock_resume':
      return 'Play resumes';
    case 'goal': {
      const pts = item.points ?? 1;
      const what = cfg.kind === 'periods' && cfg.pointValues.length > 1 ? `${pts}-point basket` : 'Goal';
      if (item.ownGoal) return `Own goal (${name(item.playerId)}) for ${side}`;
      const who = item.playerId ? name(item.playerId) : side;
      const assist = item.assistId ? `, assist ${name(item.assistId)}` : '';
      return `${what}: ${who}${assist}`;
    }
    case 'sub':
      return `${side} sub: ${name(item.inId)} on, ${name(item.outId)} off`;
    case 'card':
      return `${item.card === 'red' ? 'Red' : 'Yellow'} card: ${name(item.playerId)}`;
    case 'timeout':
      return `Timeout: ${side}`;
    case 'point':
      return `Point: ${side}`;
    case 'note':
      return item.note ?? 'Note';
    default:
      return item.type;
  }
}

interface FaceProps {
  board: PublicBoard;
  state: ScoreboardState;
  now: number;
}

export function ScoreFace({ board, state, now }: FaceProps) {
  const winner = state.status === 'ended' ? state.winner : null;
  const head = (
    <div className="sb-teams">
      <div className={`sb-team${winner === 'home' ? ' sb-team-win' : ''}`}>
        <span className="sb-team-name">{board.homeName}</span>
        <span className="sb-score">{state.score.home}</span>
      </div>
      <div className="sb-mid">
        {state.kind === 'periods' ? (
          <span className="sb-clock" aria-label="Game clock">
            {displayClock(board.config as PeriodsConfig, state as PeriodsState, now)}
          </span>
        ) : null}
        <span className={`sb-status${state.status === 'live' ? ' sb-status-live' : ''}`}>{statusText(board, state)}</span>
      </div>
      <div className={`sb-team${winner === 'away' ? ' sb-team-win' : ''}`}>
        <span className="sb-team-name">{board.awayName}</span>
        <span className="sb-score">{state.score.away}</span>
      </div>
    </div>
  );
  if (state.kind === 'racket') return <RacketDetail board={board} state={state}>{head}</RacketDetail>;
  const periods = state as PeriodsState;
  return (
    <div className="sb-face">
      {head}
      {periods.periodScores.length > 1 ? (
        <p className="sb-periods">
          {periods.periodScores.map((p, i) => (
            <span key={i}>
              {(board.config as PeriodsConfig).periodNames[i] ?? `P${i + 1}`} {p.home}-{p.away}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function RacketDetail({ board, state, children }: { board: PublicBoard; state: RacketState; children: React.ReactNode }) {
  const cfg = board.config as RacketConfig;
  const points = gamePointLabel(state, cfg.goldenPoint);
  return (
    <div className="sb-face">
      {children}
      <table className="sb-sets" aria-label="Set scores">
        <tbody>
          {(['home', 'away'] as const).map((side) => (
            <tr key={side}>
              <th scope="row">{side === 'home' ? board.homeName : board.awayName}</th>
              {state.sets.map((s, i) => (
                <td key={i}>{s[side]}</td>
              ))}
              {state.status !== 'ended' ? <td className="sb-set-now">{state.games[side]}</td> : null}
              {state.status === 'live' ? <td className="sb-point-now">{points[side]}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {state.status === 'live' && state.inTiebreak ? <p className="sb-periods"><span>Tie-break to {state.tiebreakTarget}</span></p> : null}
    </div>
  );
}

interface TimelineProps {
  board: PublicBoard;
  state: ScoreboardState;
  roster: BoardRoster[];
}

export function Timeline({ board, state, roster }: TimelineProps) {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const items = [...state.timeline].reverse().filter((t) => t.type !== 'clock_pause' && t.type !== 'clock_resume');
  if (items.length === 0) return <p className="muted">Nothing has happened yet.</p>;
  return (
    <ol className="sb-timeline">
      {items.map((t) => (
        <li key={t.seq} className={`sb-event sb-event-${t.type}${t.card ? ` sb-card-${t.card}` : ''}`}>
          <span className="sb-event-time">{t.label}</span>
          <span>{describeItem(t, board, byId)}</span>
          {t.type === 'goal' ? (
            <span className="sb-event-score">
              {t.score.home}-{t.score.away}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function Lineups({ board, state, roster }: TimelineProps) {
  if (roster.length === 0) return null;
  const stats = state.kind === 'periods' ? state.stats : {};
  const onCourt = state.kind === 'periods' ? state.onCourt : { home: [], away: [] };
  return (
    <div className="sb-lineups">
      {(['home', 'away'] as const).map((side) => (
        <div key={side}>
          <h3>{side === 'home' ? board.homeName : board.awayName}</h3>
          <ul>
            {roster
              .filter((p) => p.side === side)
              .map((p) => {
                const st = stats[p.id];
                const on = onCourt[side].includes(p.id);
                const sentOff = state.kind === 'periods' && state.sentOff.includes(p.id);
                return (
                  <li key={p.id} className={on ? 'sb-on' : 'sb-off'}>
                    <span>{playerLabel(p)}</span>
                    <span className="muted">
                      {st && st.goals > 0 ? ` ${st.goals} ${board.config.kind === 'periods' && board.config.pointValues.length > 1 ? `(${st.points} pts)` : 'goals'}` : ''}
                      {st && st.assists > 0 ? ` ${st.assists} ast` : ''}
                      {st && st.yellow > 0 ? ' Y' : ''}
                      {st && st.red > 0 ? ' R' : ''}
                      {sentOff ? ' off' : ''}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </div>
  );
}
