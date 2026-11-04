import { useEffect } from 'react';

interface Props {
  onClose: () => void;
  // Tournament score reveal: both sides and the score.
  home?: string;
  away?: string;
  homeScore?: number;
  awayScore?: number;
  // Casual game fill: the game title shown when the last seat is taken.
  title?: string;
}

// Full-screen Match Found reveal per the spec: sides slide in, VS punches in
// (~1s total), tap anywhere to skip. A game fill also dismisses itself.
export default function MatchFoundOverlay({ home, away, homeScore, awayScore, title, onClose }: Props) {
  const isScore =
    home !== undefined && away !== undefined && homeScore !== undefined && awayScore !== undefined;

  useEffect(() => {
    if (isScore) return;
    const timer = window.setTimeout(onClose, 4000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [isScore, onClose]);

  return (
    <div
      className="match-found"
      role="dialog"
      aria-label={isScore ? 'Result' : 'Match found'}
      onClick={onClose}
    >
      {isScore ? (
        <>
          <div className="side">{home}</div>
          <div className="versus">
            {homeScore}–{awayScore}
          </div>
          <div className="side">{away}</div>
        </>
      ) : (
        <>
          <div className="versus">Match found</div>
          <div className="side">{title ?? 'Your game is on'}</div>
        </>
      )}
      <button className="btn btn-primary" type="button" onClick={onClose}>
        {isScore ? 'Back to the board' : 'Game on'}
      </button>
    </div>
  );
}
