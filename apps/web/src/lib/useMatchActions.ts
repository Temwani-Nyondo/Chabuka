import { useCallback, useState } from 'react';
import { didFillMatch } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { joinMatchAction, withdrawMatchAction } from './api';

// Join/withdraw through the action API, then reload the list so counts and
// buttons reflect the server's returned state, not an optimistic guess.
// When a join fills the last seat, the caller gets a Match Found moment:
// MatchCard passes its current count and title so the overlay can fire.
export function useMatchActions(reload: () => Promise<void>) {
  const { session } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ matchId: string; title: string } | null>(null);

  const run = useCallback(
    async (matchId: string, fn: (id: string, token: string) => Promise<unknown>) => {
      const token = session?.access_token;
      if (!token) {
        setActionError('Not signed in.');
        return;
      }
      setBusyId(matchId);
      setActionError(null);
      try {
        await fn(matchId, token);
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      } finally {
        setBusyId(null);
      }
    },
    [session, reload],
  );

  const onJoin = useCallback(
    (matchId: string, before?: number, title?: string) => {
      const token = session?.access_token;
      if (!token) {
        setActionError('Not signed in.');
        return;
      }
      setBusyId(matchId);
      setActionError(null);
      void joinMatchAction(matchId, token)
        .then((res) => {
          if (before !== undefined && didFillMatch(before, res.joinedCount, res.capacity)) {
            setCelebration({ matchId, title: title ?? 'Your game is on' });
          }
          return reload();
        })
        .catch((err: unknown) => {
          setActionError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
        })
        .finally(() => setBusyId(null));
    },
    [session, reload],
  );

  const onWithdraw = useCallback(
    (matchId: string) => {
      void run(matchId, withdrawMatchAction);
    },
    [run],
  );

  const dismissCelebration = useCallback(() => setCelebration(null), []);

  return { busyId, actionError, onJoin, onWithdraw, celebration, dismissCelebration };
}
