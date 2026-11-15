import { knockoutWinner, roundName } from '@chabuka/shared';
import type { Fixture, Team } from '@chabuka/shared';
import { Crest, cx } from './ui';

// Knockout tree: one column per round, scrolling sideways on phones. Each tie
// shows both teams, the score, and who went through.
export default function Bracket({
  rounds,
  byRound,
  teams,
  highlightTeamIds = [],
  onOpen,
}: {
  rounds: number;
  byRound: Fixture[][];
  teams: Map<string, Team>;
  highlightTeamIds?: string[];
  onOpen?: (f: Fixture) => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4 pb-2" role="region" aria-label="Knockout bracket">
      <div className="flex min-w-max gap-4">
        {byRound.map((ties, i) => (
          <div key={i} className="flex w-[220px] flex-col">
            <span className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">{roundName(i + 1, rounds)}</span>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {ties.map((f) => (
                <Tie key={f.id} f={f} teams={teams} highlight={highlightTeamIds} onOpen={onOpen} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tie({ f, teams, highlight, onOpen }: { f: Fixture; teams: Map<string, Team>; highlight: string[]; onOpen?: (f: Fixture) => void }) {
  const winner = knockoutWinner(f);
  const scored = f.status === 'finished' && f.home_score != null && f.away_score != null;
  const pens = scored && f.home_score === f.away_score && winner;
  const row = (teamId: string | null, score: number | null | undefined) => {
    const team = teamId ? teams.get(teamId) : null;
    const won = winner && winner === teamId;
    return (
      <div className={cx('flex items-center gap-2 px-2.5 py-2', winner && !won && 'opacity-55')}>
        {team ? <Crest id={team.id} name={team.name} src={team.logo_url} size={22} /> : <span className="h-[22px] w-[22px] rounded-md border border-dashed border-line-strong" />}
        <span className={cx('min-w-0 flex-1 truncate text-[13px]', won ? 'font-extrabold' : 'font-semibold', !team && 'text-muted', teamId && highlight.includes(teamId) && 'text-brand-text')}>
          {team?.name ?? 'To be decided'}
        </span>
        {scored ? <span className="tnum text-[14px] font-extrabold">{score}</span> : null}
      </div>
    );
  };
  const body = (
    <>
      {row(f.home_team_id, f.home_score)}
      <div className="h-px bg-line" />
      {row(f.away_team_id, f.away_score)}
      {pens ? <div className="border-t border-line px-2.5 py-1 text-[11px] font-semibold text-muted">Won on penalties</div> : null}
      {!scored && f.starts_at ? (
        <div className="border-t border-line px-2.5 py-1 text-[11px] font-semibold text-muted">
          {new Date(f.starts_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
      ) : null}
    </>
  );
  const cls = 'overflow-hidden rounded-xl border border-line bg-surface text-left text-ink';
  if (onOpen) {
    return (
      <button type="button" onClick={() => onOpen(f)} className={cx(cls, 'w-full cursor-pointer p-0 hover:border-line-strong')}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}
