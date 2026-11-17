import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { completeWaitAppConnect } from '../lib/venueBooking';
import type { WaitAppConnectResult } from '../lib/venueBooking';
import { ButtonLink, Card, ErrorNote, PageHeader } from '../components/ui';

// Where WaitApp sends a venue owner back after "Take paid bookings online". The one-time code is traded for the venue's
// link on Chabuka's server (the browser never holds the token), the venue's spaces, hours, closures and upcoming
// bookings are copied across, and the owner lands back on the venue's Setup.

function summary(r: WaitAppConnectResult): string {
  const c = r.copied;
  if (!c) return 'Linked. Your spaces will appear on WaitApp shortly.';
  const parts = [`${c.spaces} ${c.spaces === 1 ? 'space' : 'spaces'}`, 'your opening hours'];
  if (c.closures) parts.push(`${c.closures} ${c.closures === 1 ? 'closure' : 'closures'}`);
  if (c.bookings) parts.push(`${c.bookings} upcoming ${c.bookings === 1 ? 'booking' : 'bookings'}`);
  const last = parts.pop();
  return `Linked. Copied ${parts.length ? `${parts.join(', ')} and ${last}` : last} to WaitApp.`;
}

export default function VenueWaitAppReturnPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const started = useRef(false);
  const code = params.get('code');
  const state = params.get('state');

  useEffect(() => {
    const token = session?.access_token;
    if (!code || !state || !token || started.current) return;
    started.current = true;
    completeWaitAppConnect(token, code, state)
      .then((r) => {
        setDone(summary(r));
        window.setTimeout(() => navigate(`/venues/${r.venueId}/manage?tab=setup`, { replace: true }), 1800);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not finish the WaitApp link.'));
  }, [code, state, session, navigate]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-16 pt-6">
      <PageHeader title="Paid bookings" />
      <Card className="flex flex-col gap-3 p-4">
        {!code || !state ? (
          <ErrorNote>This link is incomplete. Go back to your venue and press "Take paid bookings online" again.</ErrorNote>
        ) : error ? (
          <>
            <ErrorNote>{error}</ErrorNote>
            <ButtonLink to="/venues/dashboard">Back to my venues</ButtonLink>
          </>
        ) : done ? (
          <p className="m-0 text-[15px]">{done}</p>
        ) : (
          <p className="m-0 text-[15px] text-muted">Linking your venue and copying your spaces, hours and bookings to WaitApp...</p>
        )}
      </Card>
    </div>
  );
}
