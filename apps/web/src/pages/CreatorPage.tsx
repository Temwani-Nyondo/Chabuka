import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Newspaper, PenLine } from 'lucide-react';
import { readingMinutes } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { fetchCreator, fetchCreatorPost, timeAgo } from '../lib/social';
import type { CreatorPostView, CreatorView } from '../lib/social';
import { ArticleView, FollowButton, PhotoGrid, ReactionBar } from '../components/Social';
import { Avatar, Badge, ButtonLink, Card, EmptyState, ErrorNote, Segmented, Skeleton } from '../components/ui';

// A creator's page: who they are, Follow, and their posts and articles. Followers react; there are no comments.

export default function CreatorPage() {
  const { handle = '' } = useParams();
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [view, setView] = useState<CreatorView | null>(null);
  const [tab, setTab] = useState<'all' | 'articles'>('all');
  const [followers, setFollowers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    fetchCreator(token, handle)
      .then((v) => {
        setView(v);
        setFollowers(v.followers);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Creator not found.'));
  }, [token, handle]);
  if (!view) return <div className="mx-auto max-w-3xl px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-64" />}</div>;
  const c = view.creator;
  const posts = view.posts.filter((p) => tab === 'all' || p.kind === 'article');
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-24">
      <header className="overflow-hidden border-b border-line bg-surface lg:mt-4 lg:rounded-3xl lg:border">
        {c.bannerUrl ? <img src={c.bannerUrl} alt="" className="h-36 w-full object-cover" /> : <div className="h-20 bg-brand-soft" />}
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="-mt-10 flex items-end justify-between gap-3">
            <Avatar name={c.displayName} src={c.avatarUrl} size={84} className="border-4 border-surface" />
            {view.self ? (
              <ButtonLink to="/studio" size="sm" icon={<PenLine size={15} />}>Creator studio</ButtonLink>
            ) : (
              <FollowButton subjectType="creator" subjectId={c.userId} onChange={(_f, n) => setFollowers(n)} />
            )}
          </div>
          <div>
            <h1 className="m-0">{c.displayName}</h1>
            <p className="m-0 text-[14px] text-muted">
              @{c.handle} · {followers} follower{followers === 1 ? '' : 's'}
            </p>
          </div>
          {c.status !== 'approved' ? <Badge tone="hl" className="self-start">{c.status === 'pending' ? 'Waiting for approval: only you can see this page' : `Not public (${c.status})`}</Badge> : null}
          {c.bio ? <p className="m-0 whitespace-pre-line text-[15px]">{c.bio}</p> : null}
          <div className="flex flex-wrap gap-1.5">
            {c.sports.map((s) => (
              <Badge key={s} tone="brand">{s}</Badge>
            ))}
            {c.links.map((l) => (
              <a key={l} href={l} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-text">
                <ExternalLink size={13} />
                {new URL(l).hostname.replace(/^www\./, '')}
              </a>
            ))}
          </div>
        </div>
      </header>
      <div className="flex flex-col gap-3 px-4">
        <Segmented<'all' | 'articles'> label="Posts" value={tab} onChange={setTab} options={[{ value: 'all', label: 'Everything' }, { value: 'articles', label: 'Articles' }]} />
        {posts.length === 0 ? (
          <EmptyState icon={<Newspaper size={22} />} title="Nothing published yet" body={view.self ? 'Write your first post in the creator studio.' : 'Follow to hear when they post.'} />
        ) : (
          posts.map((p) => <CreatorPostCard key={p.id} post={p} handle={c.handle} self={view.self} />)
        )}
      </div>
    </div>
  );
}

function CreatorPostCard({ post, handle, self }: { post: CreatorPostView; handle: string; self: boolean }) {
  return (
    <Card className="flex flex-col gap-2.5 p-3.5">
      <span className="text-[12px] text-muted">
        {post.status === 'draft' ? 'Draft' : post.publishedAt ? timeAgo(post.publishedAt) : ''}
        {post.kind === 'article' ? ` · ${Math.max(1, Math.round(post.words / 200))} min read` : ''}
      </span>
      {post.kind === 'article' ? (
        <Link to={`/c/${handle}/${post.id}`} className="flex flex-col gap-2 text-ink no-underline">
          {post.coverUrl ? <img src={post.coverUrl} alt="" className="max-h-64 w-full rounded-xl object-cover" /> : null}
          <strong className="text-[18px]">{post.title}</strong>
          <span className="text-[14px] text-muted">{post.excerpt}</span>
        </Link>
      ) : (
        <>
          {post.body ? <ArticleView body={post.body} /> : null}
          <PhotoGrid images={post.images} />
        </>
      )}
      {post.status === 'published' ? <ReactionBar postType="creator" postId={post.id} counts={post.reactions} mine={post.myReactions} disabled={self} /> : null}
    </Card>
  );
}

export function CreatorPostPage() {
  const { handle = '', postId = '' } = useParams();
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchCreatorPost>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    fetchCreatorPost(token, postId)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Post not found.'));
  }, [token, postId]);
  if (!data) return <div className="mx-auto max-w-2xl px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-64" />}</div>;
  const p = data.post;
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-24 pt-4">
      <Link to={`/c/${handle}`} className="inline-flex items-center gap-1 text-[14px] font-semibold text-muted no-underline">
        <ChevronLeft size={18} /> {data.creator.displayName}
      </Link>
      {p.coverUrl ? <img src={p.coverUrl} alt="" className="max-h-[420px] w-full rounded-2xl object-cover" /> : null}
      {p.title ? <h1 className="m-0 text-[30px] leading-tight">{p.title}</h1> : null}
      <div className="flex items-center gap-3">
        <Avatar name={data.creator.displayName} src={data.creator.avatarUrl} size={40} />
        <div className="flex-1">
          <strong className="block text-[14px]">{data.creator.displayName}</strong>
          <span className="text-[12px] text-muted">
            {p.publishedAt ? new Date(p.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Draft'}
            {p.kind === 'article' ? ` · ${readingMinutes(p.body)} min read` : ''}
            {p.editedAt ? ' · updated' : ''}
          </span>
        </div>
        {!data.self ? <FollowButton subjectType="creator" subjectId={data.creator.userId} /> : null}
      </div>
      <ArticleView body={p.body} />
      <PhotoGrid images={p.images} />
      {p.status === 'published' ? <ReactionBar postType="creator" postId={p.id} counts={p.reactions} mine={p.myReactions} disabled={data.self} /> : null}
    </article>
  );
}
