import { useEffect, useState } from 'react';
import { Check, Dumbbell, Flame, Hand, ThumbsUp, UserPlus, X } from 'lucide-react';
import { REACTIONS, REACTION_LABELS, articleBlocks } from '@chabuka/shared';
import type { FollowSubject, Reaction } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchFollowState } from '../lib/social';
import type { ReactionCounts } from '../lib/social';
import { Button, cx } from './ui';

// Shared pieces for channels and creator pages: reactions (a fixed set, no comments), polls, photo grids, the follow
// button and the article renderer (a safe text format, never HTML).

const ICONS: Record<Reaction, typeof ThumbsUp> = { like: ThumbsUp, fire: Flame, clap: Hand, strong: Dumbbell };

export function ReactionBar({
  postType,
  postId,
  counts,
  mine,
  disabled,
}: {
  postType: 'circle' | 'creator';
  postId: string;
  counts: ReactionCounts;
  mine: Reaction[];
  disabled?: boolean;
}) {
  const { session } = useAuth();
  const [c, setC] = useState(counts);
  const [m, setM] = useState(mine);
  const [busy, setBusy] = useState(false);
  const toggle = async (r: Reaction) => {
    if (!session || busy || disabled) return;
    setBusy(true);
    // Optimistic: flip at once, then settle on the server's numbers.
    const on = m.includes(r);
    setM(on ? m.filter((x) => x !== r) : [...m, r]);
    setC({ ...c, [r]: Math.max(0, c[r] + (on ? -1 : 1)) });
    try {
      const out = await runAction<{ counts: ReactionCounts; mine: Reaction[] }>('react', { postType, postId, reaction: r }, session.access_token);
      setC(out.counts);
      setM(out.mine);
    } catch {
      setC(counts);
      setM(mine);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reactions">
      {REACTIONS.map((r) => {
        const Icon = ICONS[r];
        const on = m.includes(r);
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            aria-label={`${REACTION_LABELS[r]}${c[r] ? `, ${c[r]}` : ''}`}
            disabled={disabled}
            onClick={() => void toggle(r)}
            className={cx(
              'inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[13px] font-bold disabled:cursor-default disabled:opacity-60',
              on ? 'border-brand bg-brand-soft text-brand-text' : 'border-line bg-surface text-muted hover:bg-surface-2',
            )}
          >
            <Icon size={15} />
            {c[r] ? c[r] : null}
          </button>
        );
      })}
    </div>
  );
}

export function PollCard({ postId, poll, canVote, onVoted }: { postId: string; poll: { options: string[]; closesAt: string | null; tally: number[]; myVote: number | null }; canVote: boolean; onVoted: () => void }) {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const total = poll.tally.reduce((a, b) => a + b, 0);
  const closed = !!poll.closesAt && new Date(poll.closesAt) < new Date();
  const showResults = poll.myVote != null || closed || !canVote;
  return (
    <div className="flex flex-col gap-1.5">
      {poll.options.map((o, i) => {
        const pct = total ? Math.round((poll.tally[i]! / total) * 100) : 0;
        return showResults ? (
          <div key={i} className="relative overflow-hidden rounded-lg border border-line px-3 py-2 text-[14px]">
            <span className="absolute inset-y-0 left-0 bg-brand-soft" style={{ width: `${pct}%` }} aria-hidden="true" />
            <span className="relative flex justify-between gap-2">
              <span className={cx(poll.myVote === i && 'font-bold')}>
                {o}
                {poll.myVote === i ? <Check size={14} className="ml-1 inline" /> : null}
              </span>
              <span className="font-bold">{pct}%</span>
            </span>
          </div>
        ) : (
          <button
            key={i}
            type="button"
            className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 text-left text-[14px] font-semibold hover:border-brand"
            onClick={() =>
              session &&
              void runAction('vote_poll', { postId, option: i }, session.access_token)
                .then(onVoted)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not vote.'))
            }
          >
            {o}
          </button>
        );
      })}
      <span className="text-[12px] text-muted">
        {total} vote{total === 1 ? '' : 's'}
        {poll.closesAt ? (closed ? ' · closed' : ` · closes ${new Date(poll.closesAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`) : ''}
      </span>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </div>
  );
}

export function PhotoGrid({ images }: { images: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  const many = images.length > 1;
  return (
    <>
      <div className={cx('grid gap-1 overflow-hidden rounded-xl', many ? 'grid-cols-2' : 'grid-cols-1')}>
        {images.slice(0, 4).map((src, i) => (
          <button key={src} type="button" onClick={() => setOpen(i)} className="relative cursor-pointer border-0 bg-surface-2 p-0">
            <img src={src} alt="" loading="lazy" className={cx('block w-full object-cover', many ? 'aspect-square' : 'max-h-[420px]')} />
            {i === 3 && images.length > 4 ? <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[20px] font-bold text-white">+{images.length - 4}</span> : null}
          </button>
        ))}
      </div>
      {open != null ? (
        <div className="fixed inset-0 z-[2500] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-label="Photo" onClick={() => setOpen(null)}>
          <img src={images[open]} alt="" className="max-h-full max-w-full object-contain" />
          <button type="button" aria-label="Close" className="absolute right-4 top-4 cursor-pointer rounded-full border-0 bg-white/15 p-2 text-white" onClick={() => setOpen(null)}>
            <X size={22} />
          </button>
          {images.length > 1 ? (
            <div className="absolute inset-x-0 bottom-6 flex justify-center gap-2" onClick={(e) => e.stopPropagation()}>
              {images.map((_, i) => (
                <button key={i} type="button" aria-label={`Photo ${i + 1}`} onClick={() => setOpen(i)} className={cx('h-2.5 w-2.5 cursor-pointer rounded-full border-0', i === open ? 'bg-white' : 'bg-white/40')} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function FollowButton({ subjectType, subjectId, size = 'sm', onChange }: { subjectType: FollowSubject; subjectId: string; size?: 'sm' | 'md'; onChange?: (following: boolean, followers: number) => void }) {
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [state, setState] = useState<{ following: boolean; followers: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return;
    fetchFollowState(token, subjectType, subjectId).then(setState).catch(() => setState({ following: false, followers: 0 }));
  }, [token, subjectType, subjectId]);
  if (!state) return null;
  const toggle = async () => {
    setBusy(true);
    try {
      const out = await runAction<{ state: string; followers: number }>(state.following ? 'unfollow' : 'follow', { subjectType, subjectId }, token);
      const next = { following: out.state === 'following', followers: out.followers };
      setState(next);
      onChange?.(next.following, next.followers);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size={size} variant={state.following ? 'secondary' : 'primary'} icon={state.following ? <Check size={15} /> : <UserPlus size={15} />} disabled={busy} onClick={() => void toggle()}>
      {state.following ? 'Following' : 'Follow'}
    </Button>
  );
}

/** Renders the article format as text and safe elements only: tags typed into an article show as text. */
export function ArticleView({ body }: { body: string }) {
  const blocks = articleBlocks(body);
  return (
    <div className="flex flex-col gap-4 text-[16px] leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === 'heading') return <h2 key={i} className="m-0 mt-2 text-[20px] font-bold">{b.text}</h2>;
        if (b.type === 'quote') return <blockquote key={i} className="m-0 border-l-4 border-brand pl-4 text-[17px] italic text-muted">{b.text}</blockquote>;
        if (b.type === 'list') {
          return (
            <ul key={i} className="m-0 flex flex-col gap-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>{it}</li>
              ))}
            </ul>
          );
        }
        if (b.type === 'image') {
          return (
            <figure key={i} className="m-0">
              <img src={b.url} alt={b.caption} loading="lazy" className="w-full rounded-xl" />
              {b.caption ? <figcaption className="mt-1 text-[13px] text-muted">{b.caption}</figcaption> : null}
            </figure>
          );
        }
        return (
          <p key={i} className="m-0">
            {b.parts.map((p, j) =>
              p.href ? (
                <a key={j} href={p.href} target="_blank" rel="noreferrer noopener" className="font-semibold text-brand-text">
                  {p.text}
                </a>
              ) : p.bold ? (
                <strong key={j}>{p.text}</strong>
              ) : (
                <span key={j}>{p.text}</span>
              ),
            )}
          </p>
        );
      })}
    </div>
  );
}
