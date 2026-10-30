import { useCallback, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { joinMatchAction, withdrawMatchAction } from './api';

// Join/withdraw through the action API, then reload the list so counts and
// buttons reflect the server's returned state, not an optimistic guess.
export function useMatchActions(reload: () => Promise<void>) {
  const { session } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
    (matchId: string) => {
      void run(matchId, joinMatchAction);
    },
    [run],
  );
  const onWithdraw = useCallback(
    (matchId: string) => {
      void run(matchId, withdrawMatchAction);
    },
    [run],
  );

  return { busyId, actionError, onJoin, onWithdraw };
}
