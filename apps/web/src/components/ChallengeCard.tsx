import { useState } from 'react';
import { CTA_LABELS, LEVEL_LABELS } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { acceptChallengeAction, declineChallengeAction, proposeTimeAction } from '../lib/api';
import type { ChallengeListing } from '../lib/teams';

function when(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ChallengeCard({
  listing,
  onChanged,
}: {
  listing: ChallengeListing;
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposeAt, setProposeAt] = useState('');
  const { challenge, team, opponent, sport } = listing;

  const isMine = listing.myTeamIds.includes(challenge.team_id);
  const myOpponentTeamId = listing.myCaptainTeamIds.find((id) => id !== challenge.team_id) ?? null;
  const canRespond =
    challenge.status === 'open' && !isMine && myOpponentTeamId !== null;
  const canAcceptProposal =
    challenge.status === 'reschedule_proposed' &&
    listing.myCaptainTeamIds.includes(challenge.team_id);

  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const token = session?.access_token ?? '';

  return (
    <div className="card">
      <div className="row">
        <strong>{team?.name ?? 'A team'} is looking for an opponent</strong>
        <span className="tag">{challenge.status === 'open' ? 'Open' : 'New time proposed'}</span>
      </div>
      <p className="muted">
        {sport?.name ?? 'Sport'}
        {challenge.format ? ` · ${challenge.format}` : ''}
        {challenge.level ? ` · ${LEVEL_LABELS[challenge.level]}` : ''}
        {challenge.area ? ` · ${challenge.area}` : ''}
      </p>
      <p className="muted">
        {when(challenge.window_start)} – {when(challenge.window_end)}
        {challenge.radius_km ? ` · within ${challenge.radius_km} km` : ''}
      </p>
      {challenge.status === 'reschedule_proposed' && challenge.proposed_starts_at ? (
        <p>
          {opponent?.name ?? 'An opponent'} proposed {when(challenge.proposed_starts_at)}
        </p>
      ) : null}
      {isMine ? <p className="hint">Your team posted this.</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {canRespond ? (
        <div className="actions-row">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy !== null}
            onClick={() => {
              void act(
                () =>
                  acceptChallengeAction(
                    { challengeId: challenge.id, opponentTeamId: myOpponentTeamId },
                    token,
                  ),
                'accept',
              );
            }}
          >
            {busy === 'accept' ? 'Accepting…' : CTA_LABELS['accept_challenge']}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy !== null}
            onClick={() => {
              void act(() => declineChallengeAction(challenge.id, token), 'decline');
            }}
          >
            {CTA_LABELS['decline_challenge']}
          </button>
          <input
            className="input"
            type="datetime-local"
            value={proposeAt}
            onChange={(e) => setProposeAt(e.target.value)}
            aria-label="Propose another time"
          />
          <button
            className="btn"
            type="button"
            disabled={busy !== null || !proposeAt}
            onClick={() => {
              void act(
                () =>
                  proposeTimeAction(
                    {
                      challengeId: challenge.id,
                      opponentTeamId: myOpponentTeamId,
                      proposedStartsAt: new Date(proposeAt).toISOString(),
                    },
                    token,
                  ),
                'propose',
              );
            }}
          >
            {CTA_LABELS['propose_time']}
          </button>
        </div>
      ) : null}
      {canAcceptProposal ? (
        <div className="actions-row">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy !== null}
            onClick={() => {
              void act(
                () =>
                  acceptChallengeAction(
                    { challengeId: challenge.id, opponentTeamId: challenge.team_id },
                    token,
                  ),
                'accept',
              );
            }}
          >
            {busy === 'accept' ? 'Accepting…' : 'Accept new time'}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy !== null}
            onClick={() => {
              void act(() => declineChallengeAction(challenge.id, token), 'decline');
            }}
          >
            {CTA_LABELS['decline_challenge']}
          </button>
        </div>
      ) : null}
    </div>
  );
}
