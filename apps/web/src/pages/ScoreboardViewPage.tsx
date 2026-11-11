import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lineups, ScoreFace, Timeline } from '../components/scoreboard/ScoreFace';
import { scoreboardUrl, useLiveBoard, useServerNow } from '../lib/scoreboard';

// Public scoreboard: anyone with the link can watch, signed in or not. It
// updates live while open; the control panel is a separate screen.
export default function ScoreboardViewPage() {
  const { code } = useParams();
  const { bundle, state, error, offset, live } = useLiveBoard(code);
  const running = state?.kind === 'periods' && state.status === 'live';
  const now = useServerNow(offset, running);
  const [copied, setCopied] = useState(false);

  if (error && !bundle) {
    return (
      <div className="page">
        <h1>Scoreboard</h1>
        <p className="error">{error}</p>
        <Link className="btn" to="/">Chabuka home</Link>
      </div>
    );
  }
  if (!bundle || !state) return <div className="page"><p className="loading">Loading scoreboard…</p></div>;

  const { board, roster } = bundle;
  const url = scoreboardUrl(board.shareCode);
  const share = async () => {
    const text = `${board.homeName} ${board.homeScore} - ${board.awayScore} ${board.awayName}. Follow it live:`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Live scoreboard', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // The person dismissed the share sheet: nothing to do.
    }
  };

  return (
    <div className="page sb-page">
      <div className="sb-top">
        <Link to="/">Chabuka</Link>
        <span className={`sb-live-dot${live ? ' sb-live-on' : ''}`} title={live ? 'Live updates on' : 'Refreshing every few seconds'}>
          {live ? 'Live' : 'Updating'}
        </span>
      </div>
      {board.title ? <p className="muted sb-title">{board.title} · {board.sport}</p> : null}
      <ScoreFace board={board} state={state} now={now} />
      {board.officialName ? <p className="muted sb-official">Scorekeeper: {board.officialName}</p> : null}
      <div className="actions-row">
        <button className="btn" type="button" onClick={() => void share()}>
          {copied ? 'Link copied' : 'Share this scoreboard'}
        </button>
      </div>
      <h2>Match events</h2>
      <Timeline board={board} state={state} roster={roster} />
      <h2>Line-ups</h2>
      <Lineups board={board} state={state} roster={roster} />
    </div>
  );
}
