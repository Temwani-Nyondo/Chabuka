import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Newspaper, Plus, Radio, Trophy } from 'lucide-react';
import { AGE_BANDS, LEVEL_LABELS, circleEligibility } from '@chabuka/shared';
import type { Circle, Level, Profile, Sport } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { createCircleAction, joinCircleAction } from '../lib/api';
import { uploadImage } from '../lib/upload';
import { fetchSports } from '../lib/matches';
import { supabase } from '../lib/supabase';
import { fetchCircleList, fetchFollowing, timeAgo } from '../lib/social';
import type { CircleSummary, FeedItem } from '../lib/social';
import { sportLabel } from '../components/GameCard';
import { ArticleView, PhotoGrid, ReactionBar } from '../components/Social';
import { Avatar, Badge, Button, Card, Chip, CountBadge, EmptyState, ErrorNote, PageHeader, Segmented, Sheet, Skeleton } from '../components/ui';
import { Field, fieldCls } from '../components/CompetitionForms';

// Circles hub: your channels (newest post first, with unread counts), the Following feed (creators, teams, events you
// follow) and Discover. Circles are channels: their admins post, members read, react and vote.

type Tab = 'yours' | 'following' | 'discover';

// Same rules the API enforces on join_circle: show the reason instead of a Join button the server will refuse.
function blockReason(circle: Circle, profile: Profile | null, levels: Record<string, string>): string | null {
  const reason = circleEligibility({ birthYear: profile?.birth_year ?? null, gender: profile?.gender ?? null, ageBands: circle.age_bands, genders: circle.genders });
  if (reason) return reason;
  if (circle.sport_id && circle.levels.length > 0) {
    const level = levels[circle.sport_id];
    if (!level || !(circle.levels as string[]).includes(level)) return `For ${circle.levels.map((l) => LEVEL_LABELS[l as Level] ?? l).join(', ')} players.`;
  }
  return null;
}

function CircleAvatar({ circle, size = 48 }: { circle: Circle; size?: number }) {
  return circle.photo_url ? (
    <img src={circle.photo_url} alt="" className="shrink-0 rounded-2xl object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand-text" style={{ width: size, height: size }}>
      <Radio size={size / 2.2} />
    </span>
  );
}

export default function CirclesPage() {
  const { session, user, profile } = useAuth();
  const token = session?.access_token ?? '';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'yours';
  const [data, setData] = useState<{ yours: CircleSummary[]; discover: CircleSummary[] } | null>(null);
  const [sports, setSports] = useState<Sport[]>([]);
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(() => params.get('create') === '1');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await fetchCircleList(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load circles.');
    }
  }, [token]);

  useEffect(() => {
    void load();
    fetchSports().then(setSports).catch(() => setSports([]));
  }, [load]);

  useEffect(() => {
    if (!user || !supabase) return;
    void supabase
      .from('user_sports')
      .select('sport_id,level')
      .eq('user_id', user.id)
      .then(({ data: rows }) => setLevels(Object.fromEntries(((rows ?? []) as { sport_id: string; level: string }[]).map((r) => [r.sport_id, r.level]))));
  }, [user]);

  const setTab = (t: Tab) =>
    setParams((p) => {
      p.set('tab', t);
      p.delete('create');
      return p;
    });
  const sportName = (id: string | null | undefined) => (id ? sportLabel(sports.find((s) => s.id === id)?.name) : null);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-24 pt-4">
      <PageHeader
        title="Circles"
        sub="Channels for your sport and area, and the people and teams you follow."
        actions={<Button size="sm" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New circle</Button>}
      />
      <Segmented<Tab>
        label="Circles sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'yours', label: `Your circles${data?.yours.some((c) => c.unread) ? ` (${data.yours.reduce((n, c) => n + c.unread, 0)})` : ''}` },
          { value: 'following', label: 'Following' },
          { value: 'discover', label: 'Discover' },
        ]}
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {tab === 'yours' ? (
        !data ? (
          <Skeleton className="h-48" />
        ) : data.yours.length === 0 ? (
          <EmptyState icon={<Radio size={22} />} title="No circles yet" body="Join a circle for your sport and area to hear about its games and news." action={<Button variant="primary" onClick={() => setTab('discover')}>Find circles</Button>} />
        ) : (
          <Card className="overflow-hidden">
            {data.yours.map((c) => (
              <Link key={c.circle.id} to={`/circles/${c.circle.id}`} className="flex items-center gap-3 px-3.5 py-3 text-ink no-underline hover:bg-surface-2/60 [&+&]:border-t [&+&]:border-line">
                <CircleAvatar circle={c.circle} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-baseline justify-between gap-2">
                    <strong className="truncate">{c.circle.name}</strong>
                    {c.last ? <span className="shrink-0 text-[12px] text-muted">{timeAgo(c.last.at)}</span> : null}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] text-muted">{c.last?.body || `${c.memberCount} member${c.memberCount === 1 ? '' : 's'}`}</span>
                    {c.unread ? <CountBadge n={c.unread} className="static border-0" /> : c.notify === 'none' ? <Badge tone="muted">Muted</Badge> : null}
                  </span>
                </span>
              </Link>
            ))}
          </Card>
        )
      ) : null}

      {tab === 'following' ? <FollowingFeed token={token} /> : null}

      {tab === 'discover' ? (
        !data ? (
          <Skeleton className="h-48" />
        ) : data.discover.length === 0 ? (
          <EmptyState icon={<Radio size={22} />} title="Nothing new to join" body="Start a circle for your sport and area." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.discover.map((c) => {
              const reason = blockReason(c.circle, profile, levels);
              return (
                <Card key={c.circle.id} className="flex flex-col gap-2 p-3.5">
                  <Link to={`/circles/${c.circle.id}`} className="flex items-center gap-3 text-ink no-underline">
                    <CircleAvatar circle={c.circle} size={44} />
                    <span className="min-w-0">
                      <strong className="block truncate">{c.circle.name}</strong>
                      <span className="text-[13px] text-muted">{[sportName(c.circle.sport_id), c.circle.area, `${c.memberCount} members`].filter(Boolean).join(' · ')}</span>
                    </span>
                  </Link>
                  {c.circle.description ? <p className="m-0 line-clamp-2 text-[14px] text-muted">{c.circle.description}</p> : null}
                  {reason ? (
                    <span className="text-[13px] text-muted">{reason}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      className="self-start"
                      onClick={() =>
                        void joinCircleAction(c.circle.id, token)
                          .then(() => navigate(`/circles/${c.circle.id}`))
                          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not join.'))
                      }
                    >
                      Join
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      <NewCircleSheet open={creating} sports={sports} token={token} userId={user?.id ?? 'me'} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/circles/${id}`)} />
    </div>
  );
}

function FollowingFeed({ token }: { token: string }) {
  const [feed, setFeed] = useState<{ items: FeedItem[]; follows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    fetchFollowing(token)
      .then(setFeed)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load your feed.'));
  }, [token]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!feed) return <Skeleton className="h-48" />;
  if (feed.items.length === 0) {
    return (
      <EmptyState
        icon={<Newspaper size={22} />}
        title={feed.follows ? 'Nothing new yet' : 'Follow teams, events and creators'}
        body="Tap Follow on a team, a league or race, a venue or a creator's page. Their news shows up here."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {feed.items.map((it, i) => <FeedCard key={i} item={it} />)}
    </div>
  );
}

export function FeedCard({ item }: { item: FeedItem }) {
  if (item.type === 'creator_post') {
    const p = item.post;
    return (
      <Card className="flex flex-col gap-2.5 p-3.5">
        <Link to={`/c/${item.creator.handle}`} className="flex items-center gap-2 text-ink no-underline">
          <Avatar name={item.creator.displayName} src={item.creator.avatarUrl} size={32} />
          <strong className="text-[14px]">{item.creator.displayName}</strong>
          <span className="text-[12px] text-muted">@{item.creator.handle} · {timeAgo(item.at)}</span>
        </Link>
        {p.kind === 'article' ? (
          <Link to={`/c/${item.creator.handle}/${p.id}`} className="flex flex-col gap-2 text-ink no-underline">
            {p.coverUrl ? <img src={p.coverUrl} alt="" className="max-h-56 w-full rounded-xl object-cover" /> : null}
            <strong className="text-[17px]">{p.title}</strong>
            <span className="text-[14px] text-muted">{p.excerpt}</span>
          </Link>
        ) : (
          <>
            {p.body ? <ArticleView body={p.body} /> : null}
            <PhotoGrid images={p.images} />
          </>
        )}
        <ReactionBar postType="creator" postId={p.id} counts={p.reactions} mine={p.myReactions} />
      </Card>
    );
  }
  if (item.type === 'team_result' || item.type === 'team_fixture') {
    return (
      <Link to={`/competitions/${item.competitionId}`} className="no-underline">
        <Card className="flex items-center gap-3 p-3.5 text-ink">
          <Trophy size={20} className="shrink-0 text-muted" />
          <span className="flex-1 text-[14px]">
            <strong>{item.home}</strong> {item.type === 'team_result' && item.homeScore != null ? `${item.homeScore}-${item.awayScore}` : 'v'} <strong>{item.away}</strong>
          </span>
          <span className="text-[12px] text-muted">{item.type === 'team_result' ? 'Result' : new Date(item.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </Card>
      </Link>
    );
  }
  if (item.type === 'race_results') {
    return (
      <Link to={`/races/${item.competitionId}?tab=results`} className="no-underline">
        <Card className="flex items-center gap-3 p-3.5 text-ink">
          <Trophy size={20} className="shrink-0 text-muted" />
          <span className="flex-1 text-[14px]">
            <strong>{item.name}</strong>: {item.distance} results are out
          </span>
        </Card>
      </Link>
    );
  }
  return (
    <Link to={item.kind === 'race' ? `/races/${item.competitionId}` : `/competitions/${item.competitionId}?tab=news`} className="no-underline">
      <Card className="flex flex-col gap-1 p-3.5 text-ink">
        <span className="text-[12px] font-semibold text-muted">
          {item.name} · {timeAgo(item.at)}
        </span>
        <span className="text-[14px]">{item.text}</span>
      </Card>
    </Link>
  );
}

function NewCircleSheet({ open, sports, token, userId, onClose, onCreated }: { open: boolean; sports: Sport[]; token: string; userId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [sportId, setSportId] = useState('');
  const [description, setDescription] = useState('');
  const [ageBand, setAgeBand] = useState('');
  const [level, setLevel] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const photoUrl = photo ? await uploadImage(`circle-photos/${userId}`, photo) : undefined;
      const out = (await createCircleAction(
        { name: name.trim(), area: area.trim(), sportId: sportId || undefined, description: description.trim() || undefined, ageBands: ageBand ? [ageBand] : [], levels: level ? [level] : [], photoUrl },
        token,
      )) as { circle?: { id: string } };
      if (out.circle?.id) onCreated(out.circle.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the circle.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="New circle">
      <form className="flex flex-col gap-3.5" onSubmit={(e) => void submit(e)}>
        <p className="m-0 text-[13px] text-muted">A circle is a channel: you and the admins you choose post; members read, react and vote.</p>
        <Field label="Name">
          <input className={fieldCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Lusaka Sunday Runners" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Area">
            <input className={fieldCls} value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} />
          </Field>
          <Field label="Sport (optional)">
            <select className={fieldCls} value={sportId} onChange={(e) => setSportId(e.target.value)}>
              <option value="">Any sport</option>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {sportLabel(s.name)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="About (optional)">
          <textarea className={`${fieldCls} h-20 py-2`} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Who can join (optional)
          <div className="flex flex-wrap gap-2">
            {AGE_BANDS.map((b) => (
              <Chip key={b} on={ageBand === b} onClick={() => setAgeBand(ageBand === b ? '' : b)}>
                {b}
              </Chip>
            ))}
          </div>
          {sportId ? (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LEVEL_LABELS) as Level[]).map((l) => (
                <Chip key={l} on={level === l} onClick={() => setLevel(level === l ? '' : l)}>
                  {LEVEL_LABELS[l]}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
        <Field label="Photo (optional)">
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button type="submit" variant="primary" block disabled={busy || !name.trim() || !area.trim()}>
          {busy ? 'Creating…' : 'Create circle'}
        </Button>
      </form>
    </Sheet>
  );
}
