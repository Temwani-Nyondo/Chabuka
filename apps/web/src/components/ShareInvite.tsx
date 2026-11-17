import { useEffect, useState } from 'react';
import { Check, Copy, Link2, MessageCircle, Send, Share2, UserPlus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { inviteToMatchAction, shareLinkAction, type ShareLinkResult } from '../lib/api';
import { fetchCircles } from '../lib/circles';
import { fetchMyTeams } from '../lib/teams';
import { Button, ErrorNote, Sheet } from './ui';

// One share sheet for both kinds of link:
// - a game (matchId): a link anyone can open to see the game and join it, plus (for players in it) a nudge to one
//   of their circles or teams inside Chabuka;
// - no matchId: the player's personal link that brings friends onto Chabuka.
// The server returns the same live link every time, so sharing twice never makes a second one.
export function ShareInvite({
  matchId = null,
  canNotify = false,
  label,
  variant = 'secondary',
  size = 'md',
  block,
}: {
  matchId?: string | null;
  /** The player is in this game, so they may nudge their circles and teams. */
  canNotify?: boolean;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
}) {
  const { session, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<ShareLinkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [groups, setGroups] = useState<{ kind: 'circle' | 'team'; id: string; name: string }[] | null>(null);
  const [sentTo, setSentTo] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const token = session?.access_token;

  useEffect(() => {
    if (!open || !token || link) return;
    setError(null);
    shareLinkAction(matchId, token).then(setLink).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not make the link.'));
  }, [open, token, matchId, link]);

  useEffect(() => {
    if (!open || !matchId || !canNotify || !user || groups) return;
    Promise.all([fetchCircles(user.id).catch(() => []), fetchMyTeams(user.id).catch(() => [])]).then(([circles, teams]) => {
      setGroups([
        ...circles.filter((c) => c.isMember).map((c) => ({ kind: 'circle' as const, id: c.circle.id, name: c.circle.name })),
        ...teams.map((t) => ({ kind: 'team' as const, id: t.team.id, name: t.team.name })),
      ]);
    });
  }, [open, matchId, canNotify, user, groups]);

  if (!token) return null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Copy did not work here. Press and hold the link to copy it.');
    }
  };

  const nativeShare = async () => {
    if (!link || !navigator.share) return;
    try {
      await navigator.share({ title: 'Chabuka', text: link.text.replace(link.url, '').trim(), url: link.url });
    } catch {
      // Closing the share sheet is not an error.
    }
  };

  const notify = async (g: { kind: 'circle' | 'team'; id: string; name: string }) => {
    if (!matchId || busy) return;
    setBusy(g.id);
    setError(null);
    try {
      const out = await inviteToMatchAction(g.kind === 'circle' ? { matchId, circleId: g.id } : { matchId, teamId: g.id }, token);
      setSentTo((s) => ({ ...s, [g.id]: out.recipients === 1 ? 'Sent to 1 player' : `Sent to ${out.recipients} players` }));
    } catch (e) {
      setSentTo((s) => ({ ...s, [g.id]: e instanceof Error ? e.message : 'Could not send.' }));
    } finally {
      setBusy(null);
    }
  };

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <>
      <Button variant={variant} size={size} block={block} icon={matchId ? <UserPlus size={16} /> : <Share2 size={16} />} onClick={() => setOpen(true)}>
        {label ?? (matchId ? 'Invite players' : 'Invite friends')}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={matchId ? 'Invite players' : 'Invite friends to Chabuka'}>
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-muted">
            {matchId
              ? 'Anyone with this link can see the game and join it. New players sign up on the way in.'
              : 'Friends who sign up with your link land straight in Chabuka, and you will see when they join.'}
          </p>

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 h-11 min-w-0">
            <Link2 size={16} className="shrink-0 text-muted" />
            <input
              readOnly
              value={link?.url ?? 'Making your link...'}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 bg-transparent text-[14px] text-ink outline-none"
              aria-label="Invite link"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" icon={copied ? <Check size={16} /> : <Copy size={16} />} disabled={!link} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a
              className={`inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-line bg-surface text-ink font-bold text-[14px] no-underline hover:bg-surface-2 ${link ? '' : 'pointer-events-none opacity-50'}`}
              href={link ? `https://wa.me/?text=${encodeURIComponent(link.text)}` : undefined}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={16} /> WhatsApp
            </a>
          </div>
          {canNativeShare ? (
            <Button icon={<Send size={16} />} disabled={!link} onClick={() => void nativeShare()}>
              More ways to share
            </Button>
          ) : null}

          {!matchId && link && link.uses > 0 ? (
            <p className="text-[13px] text-muted">{link.uses === 1 ? '1 person has joined with your link.' : `${link.uses} people have joined with your link.`}</p>
          ) : null}

          {matchId && canNotify ? (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="text-[13px] font-bold text-ink">Tell people on Chabuka</p>
              {groups === null ? (
                <p className="text-[13px] text-muted">Loading your circles and teams...</p>
              ) : groups.length === 0 ? (
                <p className="text-[13px] text-muted">Join a circle or team to invite it here. You can still share the link above.</p>
              ) : (
                groups.map((g) => (
                  <div key={`${g.kind}:${g.id}`} className="flex items-center justify-between gap-3 min-w-0">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold text-ink truncate">{g.name}</span>
                      <span className="block text-[12px] text-muted">{sentTo[g.id] ?? (g.kind === 'circle' ? 'Circle' : 'Team')}</span>
                    </span>
                    <Button size="sm" disabled={!!sentTo[g.id] || busy === g.id} onClick={() => void notify(g)}>
                      {busy === g.id ? 'Sending...' : sentTo[g.id] ? 'Done' : 'Invite'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
