import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, MapPin, Users } from 'lucide-react';
import type { InvitePreview } from '@chabuka/shared';
import AuthForm from '../components/AuthForm';
import { useAuth } from '../auth/AuthContext';
import { claimInviteLinkAction, fetchInvitePreview } from '../lib/api';
import { clearPendingInvite, stashPendingInvite } from '../lib/pendingInvite';
import { Avatar, Button, Card, ErrorNote, Skeleton, Wordmark } from '../components/ui';

// Public route: /i/:code (share links) and /invite/:code (older team links).
// Shows what the link is for before anyone signs in: the game (title, time, place, spots) or the team, and the
// first name of whoever sent it. Signed-out visitors sign up right here; the code is stashed so email confirmation
// brings them back. Once signed in, one tap claims it: a game link joins the game, a team link joins the team.

const REASON: Record<string, string> = {
  revoked: 'This invite was switched off by the person who sent it.',
  expired: 'This invite has expired.',
  used: 'This invite has already been used.',
  not_found: 'We could not find this invite. Check the link and try again.',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const inviteCode = (code ?? '').trim();
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [manual, setManual] = useState('');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set when someone signs up or in on this page: claim straight away instead of asking for a second tap.
  const autoClaim = useRef(false);

  useEffect(() => {
    if (!inviteCode) return;
    stashPendingInvite(inviteCode);
    fetchInvitePreview(inviteCode).then(setPreview).catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not open this invite.'));
  }, [inviteCode]);

  const claim = async () => {
    const token = session?.access_token;
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await claimInviteLinkAction(inviteCode, token);
      clearPendingInvite();
      if (out.matchId) {
        if (out.joinError) {
          // Still useful: show the game, and say why they weren't added.
          setNotice(out.joinError);
          navigate(`/games/${out.matchId}`, { replace: true, state: { inviteNotice: out.joinError } });
        } else {
          navigate(`/games/${out.matchId}`, { replace: true });
        }
      } else if (out.teamId) {
        navigate(`/teams/${out.teamId}`, { replace: true });
      } else {
        navigate('/today', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use this invite.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoClaim.current && user && session && preview?.valid) {
      autoClaim.current = false;
      void claim();
    }
    // claim reads the latest session; re-running on those changes is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, session, preview]);

  if (!inviteCode) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const clean = manual.trim();
      if (clean) navigate(`/i/${encodeURIComponent(clean)}`);
    };
    return (
      <div className="page page-narrow">
        <div className="page-head">
          <span className="eyebrow">Invite</span>
          <h1>Join with a code</h1>
          <p>Paste the invite code someone shared with you.</p>
        </div>
        <form className="card" onSubmit={submit}>
          <label className="field">
            Invite code
            <input className="input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="CHB-XXXXXXXX" autoComplete="off" />
          </label>
          <button className="btn btn-primary" type="submit" disabled={!manual.trim()}>
            Continue
          </button>
        </form>
        <p className="muted">
          <Link to="/">Back to Chabuka</Link>
        </p>
      </div>
    );
  }

  const game = preview?.game ?? null;
  const inviter = preview?.inviter?.firstName ?? 'A friend';
  const spotsLeft = game ? Math.max(0, game.capacity - game.joined) : 0;
  const headline = preview?.kind === 'match' && game
    ? `${inviter} invited you to a game`
    : preview?.kind === 'team' && preview.team
      ? `${inviter} invited you to join ${preview.team.name}`
      : `${inviter} invited you to Chabuka`;
  const cta = preview?.kind === 'match' ? 'Join this game' : preview?.kind === 'team' ? 'Join the team' : 'Continue to Chabuka';

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-8">
      <Link to="/" className="self-start no-underline">
        <Wordmark />
      </Link>

      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}
      {!preview && !loadError ? <Skeleton className="h-40" /> : null}

      {preview && !preview.valid ? (
        <Card className="flex flex-col gap-3 p-5">
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Invite not available</h1>
          <p className="text-[14px] text-muted">{REASON[preview.reason ?? 'not_found']}</p>
          <Link to="/" className="font-bold">
            See what is on at Chabuka
          </Link>
        </Card>
      ) : null}

      {preview?.valid ? (
        <>
          <div className="flex items-center gap-3">
            <Avatar name={inviter} src={preview.inviter?.avatarUrl ?? null} size={44} />
            <h1 className="text-[22px] font-extrabold leading-tight tracking-[-0.02em]">{headline}</h1>
          </div>

          {game ? (
            <Card className="flex flex-col gap-3 p-4">
              <div>
                {game.sport ? <span className="text-[12px] font-bold uppercase tracking-wider text-muted">{game.sport}</span> : null}
                <h2 className="text-[19px] font-extrabold leading-snug">{game.title}</h2>
              </div>
              <p className="flex items-center gap-2 text-[14px]">
                <CalendarDays size={16} className="shrink-0 text-muted" /> {when(game.startsAt)}
              </p>
              {game.venueName || game.area ? (
                <p className="flex items-center gap-2 text-[14px]">
                  <MapPin size={16} className="shrink-0 text-muted" /> {[game.venueName, game.area].filter(Boolean).join(', ')}
                </p>
              ) : null}
              <p className="flex items-center gap-2 text-[14px]">
                <Users size={16} className="shrink-0 text-muted" />
                {spotsLeft > 0 ? `${spotsLeft} of ${game.capacity} spots left` : 'Full right now. You can still open the game.'}
                {game.format ? <span className="text-muted"> · {game.format}</span> : null}
              </p>
            </Card>
          ) : !game && preview.kind === 'platform' ? (
            <p className="text-[15px] text-muted">
              Chabuka helps you find games, teams and places to play near you. Join, and you can see what is on this week.
            </p>
          ) : null}

          {notice ? <ErrorNote>{notice}</ErrorNote> : null}
          {error ? <ErrorNote>{error}</ErrorNote> : null}

          {user ? (
            <Button variant="primary" size="lg" block disabled={busy} onClick={() => void claim()}>
              {busy ? 'One moment...' : cta}
            </Button>
          ) : (
            // One sign-up card, not a card inside a card: the form already has its own heading.
            <div className="flex flex-col gap-2">
              <p className="m-0 text-[13px] text-muted">
                {preview.kind === 'match' ? 'Create your account to join. It takes a minute.' : 'Create your account to continue. It takes a minute.'} Already on Chabuka? Choose Log in.
              </p>
              <AuthForm key={inviteCode} initialMode="signup" onAuthenticated={() => { autoClaim.current = true; }} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
