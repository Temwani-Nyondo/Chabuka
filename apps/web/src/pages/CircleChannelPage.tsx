import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bell, BellOff, BellRing, CalendarDays, ChevronLeft, ImagePlus, Megaphone, Pin, Settings2, Trash2, Trophy, Vote, X } from 'lucide-react';
import { NOTIFY_LABELS } from '@chabuka/shared';
import type { NotifyLevel } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { joinCircleAction, leaveCircleAction, runAction, updateCircleAction } from '../lib/api';
import { uploadImage } from '../lib/upload';
import { fetchCirclePosts, fetchCircleView, timeAgo } from '../lib/social';
import type { CirclePost, CircleView } from '../lib/social';
import { ArticleView, PhotoGrid, PollCard, ReactionBar } from '../components/Social';
import { Avatar, Badge, Button, Card, EmptyState, ErrorNote, ListRow, Segmented, Sheet, Skeleton, cx } from '../components/ui';
import { Field, ImageField, fieldCls } from '../components/CompetitionForms';

// A circle as a channel: admins post updates, photos and polls; the app posts new games, results and events; members
// read, react and vote. Newest at the bottom like a messaging channel, with the pinned post on top.

export default function CircleChannelPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { session, user } = useAuth();
  const token = session?.access_token ?? '';
  const [view, setView] = useState<CircleView | null>(null);
  const [posts, setPosts] = useState<CirclePost[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [side, setSide] = useState<'posts' | 'games'>('posts');
  const bottom = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [v, p] = await Promise.all([fetchCircleView(token, id), fetchCirclePosts(token, id)]);
      setView(v);
      setPosts(p.posts.slice().reverse());
      setHasMore(p.hasMore);
      if (v.isMember) void runAction('mark_circle_read', { circleId: id }, token).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the circle.');
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [posts.length]);

  const earlier = async () => {
    const oldest = posts[0];
    if (!oldest) return;
    const p = await fetchCirclePosts(token, id, oldest.createdAt);
    setPosts([...p.posts.slice().reverse(), ...posts]);
    setHasMore(p.hasMore);
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  if (!view) return <div className="mx-auto max-w-3xl px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-64" />}</div>;
  const c = view.circle;
  const pinned = posts.find((p) => p.id === view.pinnedPostId) ?? null;
  const canPost = !!view.role;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col pb-28 lg:pb-8">
      <header className="relative overflow-hidden">
        {c.cover_url ? <img src={c.cover_url} alt="" className="h-28 w-full object-cover lg:mt-4 lg:rounded-t-3xl" /> : <div className="h-16 bg-brand-soft lg:mt-4 lg:rounded-t-3xl" />}
        {/* On a phone the name gets its own full-width line under the photo and buttons (it was squeezed to "Avon..."). */}
        <div className="flex flex-wrap items-end gap-3 px-4 pb-3">
          <Link to="/circles" aria-label="Back to circles" className="-ml-2 mb-1 inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink hover:bg-surface-2">
            <ChevronLeft size={22} />
          </Link>
          {c.photo_url ? (
            <img src={c.photo_url} alt="" className="-mt-8 h-16 w-16 rounded-2xl border-4 border-bg object-cover" />
          ) : (
            <span className="-mt-8 flex h-16 w-16 items-center justify-center rounded-2xl border-4 border-bg bg-brand text-on-brand">
              <Megaphone size={26} />
            </span>
          )}
          <div className="order-last min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1">
            <h1 className="m-0 line-clamp-2 text-[22px] leading-tight">{c.name}</h1>
            <p className="m-0 text-[13px] text-muted">
              {[c.area, `${view.memberCount} member${view.memberCount === 1 ? '' : 's'}`, view.role ? (view.role === 'owner' ? 'You own this circle' : 'You are an admin') : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {view.isMember ? <NotifyMenu value={view.notify} onChange={(n) => void act(() => runAction('set_circle_notify', { circleId: id, notify: n }, token))} /> : null}
            {view.role ? <Button size="sm" icon={<Settings2 size={15} />} onClick={() => setAdmin(true)}>Manage</Button> : null}
            {!view.isMember && !view.removed ? (
              <Button size="sm" variant="primary" onClick={() => void act(() => joinCircleAction(id, token))}>Join</Button>
            ) : null}
          </div>
        </div>
      </header>
      {error ? <div className="px-4"><ErrorNote>{error}</ErrorNote></div> : null}
      {view.removed ? <p className="mx-4 rounded-xl bg-surface-2 p-3 text-[14px] text-muted">The admins removed you from this circle.</p> : null}

      <div className="px-4 lg:hidden">
        <Segmented<'posts' | 'games'> label="Circle sections" value={side} onChange={setSide} options={[{ value: 'posts', label: 'Posts' }, { value: 'games', label: `Games${view.games.length ? ` (${view.games.length})` : ''}` }]} />
      </div>

      <div className="grid gap-4 px-4 pt-3 lg:grid-cols-[1fr_300px]">
        <section className={cx('flex min-w-0 flex-col gap-3', side !== 'posts' && 'hidden lg:flex')} aria-label="Posts">
          {pinned ? (
            <Card className="flex items-start gap-2 border-brand p-3">
              <Pin size={16} className="mt-0.5 shrink-0 text-brand-text" />
              <span className="line-clamp-2 text-[14px]">{pinned.body || (pinned.poll ? 'Poll' : 'Photo')}</span>
            </Card>
          ) : null}
          {hasMore ? <Button size="sm" className="self-center" onClick={() => void earlier()}>Load earlier posts</Button> : null}
          {posts.length === 0 ? (
            <EmptyState icon={<Megaphone size={22} />} title="No posts yet" body={canPost ? 'Post the first update: a meet-up time, a photo or a poll.' : 'Updates from the circle admins appear here.'} />
          ) : (
            posts.map((p) => <PostCard key={p.id} post={p} view={view} token={token} onChanged={() => void load()} canReact={view.isMember || !!view.role} />)
          )}
          <div ref={bottom} />
          {canPost ? <Composer circleId={id} token={token} userId={user?.id ?? 'me'} onPosted={() => void load()} /> : null}
          {view.isMember && view.role !== 'owner' ? (
            <button type="button" className="cursor-pointer self-center border-0 bg-transparent text-[13px] text-muted underline" onClick={() => void act(() => leaveCircleAction(id, token)).then(() => navigate('/circles'))}>
              Leave this circle
            </button>
          ) : null}
        </section>

        <aside className={cx('flex flex-col gap-3', side !== 'games' && 'hidden lg:flex')} aria-label="Upcoming games and events">
          <strong className="text-[15px]">Upcoming games</strong>
          {view.games.length === 0 ? (
            <p className="m-0 text-[14px] text-muted">No games in this circle yet.</p>
          ) : (
            <Card>
              {view.games.map((g) => (
                <ListRow key={g.id} to={`/games/${g.id}`} leading={<CalendarDays size={18} className="text-muted" />} title={g.title} sub={`${new Date(g.starts_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${g.venue_name ? ` · ${g.venue_name}` : ''}`} />
              ))}
            </Card>
          )}
          {view.events.length ? (
            <>
              <strong className="text-[15px]">Events</strong>
              <Card>
                {view.events.map((e) => (
                  <ListRow key={e.id} to={e.kind === 'race' ? `/races/${e.id}` : `/competitions/${e.id}`} leading={<Trophy size={18} className="text-muted" />} title={e.name} sub={e.starts_on} />
                ))}
              </Card>
            </>
          ) : null}
          {c.description ? (
            <>
              <strong className="text-[15px]">About</strong>
              <p className="m-0 whitespace-pre-line text-[14px] text-muted">{c.description}</p>
            </>
          ) : null}
          <strong className="text-[15px]">Admins</strong>
          <div className="flex flex-wrap gap-2">
            {view.admins.map((a) => (
              <Link key={a.userId} to={`/players/${a.userId}`} className="flex items-center gap-1.5 text-[13px] text-ink no-underline">
                <Avatar name={a.name} src={a.photo} size={24} />
                {a.name}
              </Link>
            ))}
          </div>
        </aside>
      </div>

      {view.role ? <AdminSheet open={admin} view={view} token={token} onClose={() => setAdmin(false)} onChanged={() => void load()} /> : null}
    </div>
  );
}

function NotifyMenu({ value, onChange }: { value: NotifyLevel; onChange: (n: NotifyLevel) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = value === 'none' ? BellOff : value === 'important' ? Bell : BellRing;
  return (
    <div className="relative">
      <Button size="sm" icon={<Icon size={15} />} onClick={() => setOpen(!open)} aria-label={`Notifications: ${NOTIFY_LABELS[value]}`}>
        <span className="hidden sm:inline">{value === 'none' ? 'Muted' : value === 'important' ? 'Important' : 'All posts'}</span>
      </Button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 flex w-56 flex-col rounded-xl border border-line bg-surface p-1 shadow-lg">
          {(['all', 'important', 'none'] as NotifyLevel[]).map((n) => (
            <button key={n} type="button" className={cx('cursor-pointer rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[14px] hover:bg-surface-2', n === value && 'font-bold')} onClick={() => { setOpen(false); onChange(n); }}>
              {NOTIFY_LABELS[n]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PostCard({ post, view, token, onChanged, canReact }: { post: CirclePost; view: CircleView; token: string; onChanged: () => void; canReact: boolean }) {
  const auto = !post.author;
  const isAdmin = !!view.role;
  const link = post.link;
  const linkTo = link ? (link.type === 'match' ? `/games/${link.id}` : link.type === 'race' ? `/races/${link.id}` : `/competitions/${link.id}`) : null;
  return (
    <Card className={cx('flex flex-col gap-2.5 p-3.5', post.important && 'border-hl-text')}>
      <div className="flex items-center gap-2">
        {auto ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand-text">{link?.type === 'match' ? <CalendarDays size={16} /> : <Trophy size={16} />}</span>
        ) : (
          <Avatar name={post.author!.name} src={post.author!.photo} size={32} />
        )}
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-[14px]">{auto ? view.circle.name : post.author!.name}</strong>
          <span className="text-[12px] text-muted">
            {timeAgo(post.createdAt)}
            {post.editedAt ? ' · edited' : ''}
          </span>
        </div>
        {post.important ? <Badge tone="hl">Important</Badge> : null}
        {post.pinned ? <Pin size={15} className="text-brand-text" aria-label="Pinned" /> : null}
      </div>
      {post.body ? <ArticleView body={post.body} /> : null}
      <PhotoGrid images={post.images} />
      {post.poll ? <PollCard postId={post.id} poll={post.poll} canVote={view.isMember} onVoted={onChanged} /> : null}
      {link && linkTo ? (
        <Link to={linkTo} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[14px] font-semibold text-ink no-underline hover:bg-surface-2">
          {link.type === 'match' ? <CalendarDays size={16} className="text-muted" /> : <Trophy size={16} className="text-muted" />}
          <span className="flex-1 truncate">{String((link.data?.['title'] ?? link.data?.['name'] ?? 'Open')) }</span>
          {link.data?.['home_score'] != null ? <span className="font-mono">{String(link.data['home_score'])}-{String(link.data['away_score'])}</span> : null}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReactionBar postType="circle" postId={post.id} counts={post.reactions} mine={post.myReactions} disabled={!canReact} />
        {isAdmin || post.mine ? (
          <div className="flex gap-1">
            {isAdmin ? (
              <Button size="sm" variant="ghost" aria-label={post.pinned ? 'Unpin' : 'Pin'} onClick={() => void runAction('pin_circle_post', { postId: post.id, pinned: !post.pinned }, token).then(onChanged)}>
                <Pin size={15} />
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" aria-label="Delete post" onClick={() => void runAction('delete_circle_post', { postId: post.id }, token).then(onChanged)}>
              <Trash2 size={15} />
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Composer({ circleId, token, userId, onPosted }: { circleId: string; token: string; userId: string; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [poll, setPoll] = useState<string[] | null>(null);
  const [important, setImportant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await runAction(
        'post_to_circle',
        { circleId, body: body.trim(), images, important, ...(poll ? { poll: { options: poll.map((o) => o.trim()).filter(Boolean) } } : {}) },
        token,
      );
      setBody('');
      setImages([]);
      setPoll(null);
      setImportant(false);
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="sticky bottom-20 flex flex-col gap-2 p-3 shadow-sm lg:bottom-4">
      <textarea className={`${fieldCls} h-20 py-2`} placeholder="Post to the circle" maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Post text" />
      {images.length ? (
        <div className="flex flex-wrap gap-2">
          {images.map((src) => (
            <span key={src} className="relative">
              <img src={src} alt="" className="h-16 w-16 rounded-lg object-cover" />
              <button type="button" aria-label="Remove photo" className="absolute -right-1.5 -top-1.5 cursor-pointer rounded-full border-0 bg-ink p-0.5 text-bg" onClick={() => setImages(images.filter((x) => x !== src))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {poll ? (
        <div className="flex flex-col gap-1.5">
          {poll.map((o, i) => (
            <input key={i} className={`${fieldCls} h-10`} placeholder={`Option ${i + 1}`} maxLength={80} value={o} onChange={(e) => setPoll(poll.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
          <div className="flex gap-2">
            {poll.length < 6 ? <Button size="sm" onClick={() => setPoll([...poll, ''])}>Add option</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setPoll(null)}>Remove poll</Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] font-bold hover:bg-surface-2">
          <ImagePlus size={15} /> Photo
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={images.length >= 6}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void uploadImage(`circle-posts/${userId}`, f).then((url) => setImages((l) => [...l, url])).catch(() => setError('Upload failed.'));
            }}
          />
        </label>
        {!poll ? <Button size="sm" icon={<Vote size={15} />} onClick={() => setPoll(['', ''])}>Poll</Button> : null}
        <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} className="h-4 w-4" />
          Important
        </label>
        <Button variant="primary" size="sm" className="ml-auto" disabled={busy || (!body.trim() && !images.length && !poll)} onClick={() => void send()}>
          {busy ? 'Posting…' : 'Post'}
        </Button>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Card>
  );
}

function AdminSheet({ open, view, token, onClose, onChanged }: { open: boolean; view: CircleView; token: string; onClose: () => void; onChanged: () => void }) {
  const c = view.circle;
  const [name, setName] = useState(c.name);
  const [area, setArea] = useState(c.area ?? '');
  const [about, setAbout] = useState(c.description ?? '');
  const [photo, setPhoto] = useState<string | null>(c.photo_url ?? null);
  const [cover, setCover] = useState<string | null>(c.cover_url ?? null);
  const [error, setError] = useState<string | null>(null);
  const owner = view.role === 'owner';
  const adminIds = new Set(view.admins.map((a) => a.userId));
  const run = (fn: () => Promise<unknown>) =>
    void fn()
      .then(onChanged)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'));
  return (
    <Sheet open={open} onClose={onClose} title="Manage circle" wide>
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <input className={fieldCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Area">
          <input className={fieldCls} value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} />
        </Field>
        <Field label="About">
          <textarea className={`${fieldCls} h-24 py-2`} value={about} maxLength={1000} onChange={(e) => setAbout(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <ImageField label="Photo" value={photo} folder="circle-photos" onChange={setPhoto} />
          <ImageField label="Cover" value={cover} folder="circle-covers" wide onChange={setCover} />
        </div>
        <Button variant="primary" onClick={() => run(() => updateCircleAction({ circleId: c.id, name: name.trim(), area: area.trim(), description: about.trim() || null, photoUrl: photo, coverUrl: cover } as never, token))}>
          Save details
        </Button>
        <strong className="text-[15px]">Members ({view.members.length})</strong>
        <Card>
          {view.members.map((m) => {
            const role = view.admins.find((a) => a.userId === m.userId)?.role;
            return (
              <ListRow
                key={m.userId}
                leading={<Avatar name={m.name} src={m.photo} size={32} />}
                title={m.name}
                sub={role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member'}
                trailing={
                  role === 'owner' ? null : (
                    <div className="flex gap-1">
                      {owner ? (
                        adminIds.has(m.userId) ? (
                          <Button size="sm" variant="ghost" onClick={() => run(() => runAction('remove_circle_admin', { circleId: c.id, userId: m.userId }, token))}>Remove admin</Button>
                        ) : (
                          <Button size="sm" onClick={() => run(() => runAction('add_circle_admin', { circleId: c.id, userId: m.userId }, token))}>Make admin</Button>
                        )
                      ) : null}
                      {owner ? (
                        <Button size="sm" variant="ghost" onClick={() => run(() => runAction('transfer_circle_ownership', { circleId: c.id, userId: m.userId }, token))}>Make owner</Button>
                      ) : null}
                      {owner || !adminIds.has(m.userId) ? (
                        <Button size="sm" variant="danger" onClick={() => run(() => runAction('remove_circle_member', { circleId: c.id, userId: m.userId }, token))}>Remove</Button>
                      ) : null}
                    </div>
                  )
                }
              />
            );
          })}
        </Card>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>
    </Sheet>
  );
}
