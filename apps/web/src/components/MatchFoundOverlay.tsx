interface Props {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  onClose: () => void;
}

// Full-screen result reveal per the Match Found spec: sides slide in, VS
// punches in (~1s total), tap anywhere to skip.
export default function MatchFoundOverlay({ home, away, homeScore, awayScore, onClose }: Props) {
  return (
    <div className="match-found" role="dialog" aria-label="Result" onClick={onClose}>
      <div className="side">{home}</div>
      <div className="versus">
        {homeScore}–{awayScore}
      </div>
      <div className="side">{away}</div>
      <button className="btn btn-primary" type="button" onClick={onClose}>
        Back to the board
      </button>
    </div>
  );
}
