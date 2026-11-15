import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Plus, Trophy } from 'lucide-react';
import { CATEGORY_LABELS, COMPETITION_CATEGORIES, COMPETITION_STATUS_LABELS, FORMAT_LABELS } from '@chabuka/shared';
import type { CompetitionCategory, Sport } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchCompetitions } from '../lib/competitions';
import type { CompetitionListing } from '../lib/competitions';
import { fetchSports } from '../lib/matches';
import { fetchMyTeams } from '../lib/teams';
import { sportBackdrop, sportLabel } from '../components/GameCard';
import { Badge, ButtonLink, Chip, EmptyState, ErrorNote, PageHeader, Section, Skeleton } from '../components/ui';

export default function CompetitionsPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [list, setList] = useState<CompetitionListing[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [myTeamIds, setMyTeamIds] = useState<Set<string>>(new Set());
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<CompetitionCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void Promise.all([
      fetchCompetitions(),
      fetchSports().catch(() => []),
      fetchMyTeams(user.id).catch(() => []),
      supabase ? supabase.from('follows').select('competition_id').eq('user_id', user.id) : Promise.resolve({ data: [] }),
    ])
      .then(([comps, sp, teams, follows]) => {
        setList(comps);
        setSports(sp);
        setMyTeamIds(new Set(teams.map((t) => t.team.id)));
        setFollowing(new Set(((follows.data ?? []) as { competition_id: string }[]).map((f) => f.competition_id)));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load competitions.'))
      .finally(() => setLoading(false));
  }, [user]);

  const mine = useMemo(
    () =>
      list.filter(
        (l) => l.competition.organiser_id === user?.id || l.entryTeamIds.some((t) => myTeamIds.has(t)) || following.has(l.competition.id),
      ),
    [list, user?.id, myTeamIds, following],
  );
  const discover = list.filter((l) => l.competition.status !== 'cancelled' && (category === 'all' || l.competition.category === category));

  const legacy = params.get('c');
  if (legacy) return <Navigate to={`/competitions/${legacy}`} replace />;

  const sportName = (id: string) => sportLabel(sports.find((s) => s.id === id)?.name);
  const tile = (l: CompetitionListing) => {
    const c = l.competition;
    const role = c.organiser_id === user?.id ? 'Organising' : l.entryTeamIds.some((t) => myTeamIds.has(t)) ? 'Your team is in' : following.has(c.id) ? 'Following' : null;
    return (
      <Link key={c.id} to={`/competitions/${c.id}`} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface text-ink no-underline hover:border-line-strong">
        <span
          className="relative block h-28 bg-cover bg-center"
          style={{ backgroundImage: `url(${c.banner_url || sportBackdrop(sports.find((s) => s.id === c.sport_id)?.name)})` }}
        >
          <span className="absolute inset-0 bg-black/30" aria-hidden="true" />
          <span className="absolute left-3 top-3 flex gap-1.5">
            <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-[#0e1411]">{CATEGORY_LABELS[c.category]}</span>
          </span>
        </span>
        <span className="flex flex-col gap-1 p-3.5">
          <strong className="text-[16px]">{c.name}</strong>
          <span className="text-[13px] text-muted">
            {[sportName(c.sport_id), FORMAT_LABELS[c.format], c.area].filter(Boolean).join(' · ')}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={c.status === 'registration' ? 'hl' : c.status === 'live' ? 'brand' : 'muted'}>{COMPETITION_STATUS_LABELS[c.status]}</Badge>
            <span className="text-[12px] font-semibold text-muted">
              {l.entryTeamIds.length}/{c.max_entries} teams
            </span>
            {role ? <Badge tone="neutral">{role}</Badge> : null}
          </span>
        </span>
      </Link>
    );
  };

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-4">
      <PageHeader
        title="Leagues and tournaments"
        sub="Community, charity, corporate and school events."
        actions={
          <ButtonLink to="/competitions/new" variant="primary" size="sm" icon={<Plus size={16} />}>
            Create
          </ButtonLink>
        }
      />
      <ErrorNote>{error}</ErrorNote>
      {loading ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          {mine.length ? (
            <Section title="Yours" count={mine.length}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{mine.map(tile)}</div>
            </Section>
          ) : null}
          <Section title="Find one">
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Category">
              <Chip on={category === 'all'} onClick={() => setCategory('all')}>
                All
              </Chip>
              {COMPETITION_CATEGORIES.map((cat) => (
                <Chip key={cat} on={category === cat} onClick={() => setCategory(cat)}>
                  {CATEGORY_LABELS[cat]}
                </Chip>
              ))}
            </div>
            {discover.length === 0 ? (
              <EmptyState
                icon={<Trophy size={22} />}
                title={list.length === 0 ? 'No events yet' : 'Nothing in this category'}
                body="Run one: a charity cup, an office league or a weekend tournament."
                action={
                  <ButtonLink to="/competitions/new" variant="primary" size="sm">
                    Create an event
                  </ButtonLink>
                }
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{discover.map(tile)}</div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
