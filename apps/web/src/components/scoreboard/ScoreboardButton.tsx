import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { createBoard, fetchTargetInfo } from '../../lib/scoreboard';
import type { TargetInfo } from '../../lib/scoreboard';

interface Props {
  target: { fixtureId: string } | { matchId: string };
  /** Past games only offer a way to watch the replay. */
  watchOnly?: boolean;
}

// One button for any game: set a scoreboard up, run it, or just watch it. The
// server decides what this person may do; the button shows only what is open to them.
export default function ScoreboardButton({ target, watchOnly = false }: Props) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const token = session?.access_token;
  const [info, setInfo] = useState<TargetInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fixtureId = 'fixtureId' in target ? target.fixtureId : undefined;
  const matchId = 'matchId' in target ? target.matchId : undefined;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchTargetInfo(token, fixtureId ? { fixtureId } : { matchId })
      .then((r) => {
        if (!cancelled) setInfo(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, fixtureId, matchId]);

  if (!info) return null;

  if (info.board) {
    const b = info.board;
    return (
      <span className="actions-row">
        {b.canManage && !watchOnly ? (
          <Link className="btn" to={`/scoreboard/${b.id}/control`}>
            {b.isOfficial ? 'Run scoreboard' : 'Manage scoreboard'}
          </Link>
        ) : null}
        <Link className="btn btn-ghost" to={`/s/${b.shareCode}`}>
          {b.status === 'ended' ? 'Match report' : b.status === 'setup' ? 'Scoreboard' : 'Watch live'}
        </Link>
      </span>
    );
  }

  if (!info.canCreate || watchOnly) return null;
  return (
    <span>
      <button
        className="btn"
        type="button"
        disabled={busy || !token}
        onClick={() => {
          if (!token) return;
          setBusy(true);
          setError(null);
          createBoard(token, fixtureId ? { fixtureId } : { matchId })
            .then((r) => navigate(`/scoreboard/${r.id}/control`))
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'Could not set up the scoreboard.');
              setBusy(false);
            });
        }}
      >
        {busy ? 'Setting up…' : 'Set up scoreboard'}
      </button>
      {error ? <span className="error"> {error}</span> : null}
    </span>
  );
}
