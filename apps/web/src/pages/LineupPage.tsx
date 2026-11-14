import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WandSparkles } from 'lucide-react';
import type { Formation, LineupSubject } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { fetchLineups, saveLineup } from '../lib/teamAdmin';
import type { LineupSideView, LineupsView, SquadPlayer } from '../lib/teamAdmin';
import { PitchSurface, PlayerToken } from '../components/Pitch';
import { Avatar, Badge, Button, Card, ErrorNote, PageHeader, Segmented, Skeleton, cx, kitColour } from '../components/ui';

type Pick = { kind: 'pool'; userId: string } | { kind: 'slot'; index: number } | null;

const STATUS_RANK = { in: 0, maybe: 1, out: 3 } as const;

export default function LineupPage() {
  const { type = 'match', id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const token = session?.access_token;
  const [view, setView] = useState<LineupsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [formationKey, setFormationKey] = useState<string>('');
  const [slots, setSlots] = useState<(string | null)[]>([]);
  const [bench, setBench] = useState<string[]>([]);
  const [pick, setPick] = useState<Pick>(null);
  const [dirty, setDirty] = useState(false);

  const subjectType = (type === 'fixture' ? 'fixture' : 'match') as LineupSubject;
  const load = useCallback(async () => {
    if (!token) return;
    setView(await fetchLineups(token, subjectType, id));
  }, [token, subjectType, id]);

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load lineups.'));
  }, [load]);

  const editable = view?.sides.filter((s) => s.canEdit) ?? [];
  const sideKey = (params.get('side') === 'away' ? 'away' : 'home') as 'home' | 'away';
  const side: LineupSideView | undefined = editable.find((s) => s.side === sideKey) ?? editable[0];
  const formations: Formation[] = view?.formations ?? [];
  const formation = formations.find((f) => f.key === formationKey) ?? formations[0];

  // Start from the saved lineup, or an empty first formation.
  useEffect(() => {
    if (!side || !view) return;
    const saved = side.lineup;
    const f = (saved && formations.find((x) => x.key === saved.formation)) || formations[0];
    if (!f) return;
    setFormationKey(f.key);
    setSlots(saved && saved.formation === f.key ? saved.slots.map((s) => s.userId) : f.slots.map(() => null));
    setBench(saved?.bench.map((b) => b.userId) ?? []);
    setPick(null);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the side or data changes
  }, [side?.side, view]);

  // Pickup: players already placed on the other side are not available here.
  const takenElsewhere = useMemo(() => {
    const other = view?.sides.find((s) => s.side !== side?.side);
    const set = new Set<string>();
    if (view?.subject.pickup && other?.lineup) {
      for (const s of other.lineup.slots) if (s.userId) set.add(s.userId);
      for (const b of other.lineup.bench) set.add(b.userId);
    }
    return set;
  }, [view, side?.side]);

  const pool: SquadPlayer[] = useMemo(
    () =>
      (side?.pool ?? [])
        .filter((p) => !takenElsewhere.has(p.userId))
        .sort((a, b) => (a.status ? STATUS_RANK[a.status] : 2) - (b.status ? STATUS_RANK[b.status] : 2) || (a.shirt ?? 999) - (b.shirt ?? 999)),
    [side?.pool, takenElsewhere],
  );
  const byId = useMemo(() => new Map(pool.map((p) => [p.userId, p])), [pool]);
  const onPitch = new Set(slots.filter((x): x is string => !!x));
  const unpicked = pool.filter((p) => !onPitch.has(p.userId) && !bench.includes(p.userId));

  if (error && !view) {
    return (
      <div className="mx-auto max-w-[720px] px-4 pt-4">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="mx-auto max-w-[720px] px-4 pt-4">
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!side || !formation) {
    return (
      <div className="mx-auto max-w-[720px] px-4 pt-4">
        <PageHeader title="Lineup" back="/today" />
        <ErrorNote>{formations.length === 0 ? 'This sport has no lineup.' : 'Only a captain of one of these teams can set a lineup.'}</ErrorNote>
      </div>
    );
  }

  const colour = side.kitColour ?? (side.teamId ? kitColour(side.teamId) : side.side === 'home' ? '#f2c230' : '#1d3f8f');
  const touch = () => {
    setDirty(true);
    setNotice(null);
  };

  const placeInSlot = (index: number, userId: string) => {
    const next = slots.slice();
    const from = next.indexOf(userId);
    if (from >= 0) next[from] = next[index] ?? null;
    next[index] = userId;
    setSlots(next);
    setBench((b) => b.filter((x) => x !== userId));
    touch();
  };

  const tapSlot = (index: number) => {
    const occupant = slots[index] ?? null;
    if (pick?.kind === 'pool') {
      placeInSlot(index, pick.userId);
      setPick(null);
    } else if (pick?.kind === 'slot') {
      if (pick.index !== index) {
        const next = slots.slice();
        [next[pick.index], next[index]] = [next[index] ?? null, next[pick.index] ?? null];
        setSlots(next);
        touch();
      }
      setPick(null);
    } else if (occupant) {
      setPick({ kind: 'slot', index });
    }
  };

  const takeOff = (index: number) => {
    const next = slots.slice();
    next[index] = null;
    setSlots(next);
    setPick(null);
    touch();
  };

  const changeFormation = (key: string) => {
    const f = formations.find((x) => x.key === key);
    if (!f) return;
    // Keep everyone picked, in order; extras go to the bench.
    const placed = slots.filter((x): x is string => !!x);
    const next = f.slots.map((_, i) => placed[i] ?? null);
    const overflow = placed.slice(f.slots.length);
    setFormationKey(key);
    setSlots(next);
    if (overflow.length) setBench((b) => [...b, ...overflow]);
    touch();
  };

  // Fill empty positions: keepers in goal first, then players who said In,
  // then Maybe, by position name where it helps.
  const autoFill = () => {
    const next = slots.slice();
    const used = new Set(next.filter((x): x is string => !!x));
    const candidates = pool.filter((p) => !used.has(p.userId) && p.status !== 'out');
    const take = (pred: (p: SquadPlayer) => boolean) => {
      const i = candidates.findIndex((p) => !used.has(p.userId) && pred(p));
      if (i < 0) return null;
      const p = candidates[i]!;
      used.add(p.userId);
      return p.userId;
    };
    formation.slots.forEach((s, i) => {
      if (next[i]) return;
      const wanted = s.role.toLowerCase();
      next[i] =
        (wanted === 'gk' ? take((p) => /keep|gk|goal/i.test(p.position ?? '')) : take((p) => (p.position ?? '').toLowerCase().startsWith(wanted.slice(0, 3)))) ??
        take((p) => p.status === 'in' && !/keep|gk|goal/i.test(p.position ?? '')) ??
        take((p) => p.status === 'in') ??
        take(() => true);
    });
    setSlots(next);
    touch();
  };

  const save = async (publish: boolean) => {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const res = await saveLineup(token, {
        subjectType,
        subjectId: id,
        side: side.side,
        formation: formation.key,
        slots: formation.slots.map((s, i) => ({ role: s.role, x: s.x, y: s.y, userId: slots[i] ?? null })),
        bench,
        publish,
      });
      setDirty(false);
      setNotice(publish ? `Published${res.notified ? `: ${res.notified} player${res.notified === 1 ? '' : 's'} told` : ''}.` : 'Draft saved. Only captains can see it.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the lineup.');
    } finally {
      setSaving(false);
    }
  };

  const filled = slots.filter(Boolean).length;
  const pickName = pick?.kind === 'pool' ? byId.get(pick.userId)?.name : pick?.kind === 'slot' ? byId.get(slots[pick.index] ?? '')?.name : null;

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-4 pb-32 pt-4">
      <header className="flex items-start gap-2">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="-ml-2 mt-0.5 flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-ink hover:bg-surface-2">
          <span aria-hidden="true" className="text-[22px] leading-none">‹</span>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="m-0">{view.subject.pickup ? 'Pick the sides' : `${side.name} lineup`}</h1>
          <p className="m-0 text-[13px] text-muted">
            {view.subject.title}
            {view.subject.startsAt ? ` · ${new Date(view.subject.startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>
        <Badge tone={side.lineup?.published && !dirty ? 'brand' : 'muted'}>{side.lineup?.published && !dirty ? 'Published' : dirty ? 'Unsaved' : side.lineup ? 'Draft' : 'New'}</Badge>
      </header>

      {editable.length > 1 ? (
        <Segmented
          label="Side"
          value={side.side}
          onChange={(v) => {
            if (dirty) {
              setNotice('Save this side first (draft or publish), then switch.');
              return;
            }
            params.set('side', v);
            setParams(params, { replace: true });
          }}
          options={editable.map((s) => ({ value: s.side, label: s.name }))}
        />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Formation</span>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {formations.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={f.key === formation.key}
              onClick={() => changeFormation(f.key)}
              className={cx(
                'tnum h-10 shrink-0 cursor-pointer rounded-[10px] border px-4 text-[14px] font-extrabold',
                f.key === formation.key ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink hover:bg-surface-2',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <PitchSurface sport={view.subject.sport} variant="half" label={`${side.name} in ${formation.label}: ${filled} of ${formation.slots.length} positions filled`}>
        {formation.slots.map((s, i) => {
          const uid = slots[i] ?? null;
          const p = uid ? byId.get(uid) : null;
          return (
            <PlayerToken
              key={i}
              x={s.x}
              y={s.y}
              colour={s.role === 'GK' ? '#2ba84a' : colour}
              number={p?.shirt ?? null}
              name={p ? p.name.split(' ')[0] : null}
              role={s.role}
              sport={view.subject.sport}
              empty={!uid}
              selected={(pick?.kind === 'slot' && pick.index === i) || (!uid && pick?.kind === 'pool')}
              onClick={() => tapSlot(i)}
              size={36}
            />
          );
        })}
      </PitchSurface>

      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-[13px] text-muted" role="status">
          {pickName
            ? pick?.kind === 'pool'
              ? `Tap a position for ${pickName}.`
              : `Tap another position to swap ${pickName}, or take them off below.`
            : `${filled}/${formation.slots.length} placed. Tap a player, then a position.`}
        </p>
        <Button size="sm" icon={<WandSparkles size={15} />} onClick={autoFill} disabled={filled === formation.slots.length || pool.length === 0}>
          Auto-fill
        </Button>
      </div>
      {pick?.kind === 'slot' ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => takeOff(pick.index)}>
            Take off the pitch
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const uid = slots[pick.index];
              if (uid) {
                takeOff(pick.index);
                setBench((b) => [...b, uid]);
              }
            }}
          >
            Move to bench
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPick(null)}>
            Cancel
          </Button>
        </div>
      ) : null}

      <PlayerList
        title="Bench"
        empty="Nobody on the bench."
        players={bench.map((u) => byId.get(u)).filter((p): p is SquadPlayer => !!p)}
        pick={pick}
        onPick={(u) => setPick(pick?.kind === 'pool' && pick.userId === u ? null : { kind: 'pool', userId: u })}
        action={{ label: 'Remove', run: (u) => { setBench((b) => b.filter((x) => x !== u)); touch(); } }}
      />
      <PlayerList
        title={view.subject.pickup ? 'Players in the game' : 'Squad'}
        empty={view.subject.pickup ? 'Everyone who joined is placed.' : 'Everyone is picked.'}
        players={unpicked}
        pick={pick}
        onPick={(u) => setPick(pick?.kind === 'pool' && pick.userId === u ? null : { kind: 'pool', userId: u })}
        action={{ label: 'Bench', run: (u) => { setBench((b) => [...b, u]); touch(); } }}
      />

      <ErrorNote>{error}</ErrorNote>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 lg:left-64">
        <div className="mx-auto flex max-w-[720px] flex-col gap-2">
          {notice ? <span className="text-[13px] font-semibold text-brand-text" role="status">{notice}</span> : null}
          <div className="flex gap-2">
            <Button className="flex-1" size="lg" disabled={saving} onClick={() => void save(false)}>
              Save draft
            </Button>
            <Button className="flex-[2]" size="lg" variant="primary" disabled={saving} onClick={() => void save(true)}>
              {saving ? 'Saving…' : view.subject.pickup ? 'Publish sides' : 'Publish to squad'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerList({
  title,
  empty,
  players,
  pick,
  onPick,
  action,
}: {
  title: string;
  empty: string;
  players: SquadPlayer[];
  pick: Pick;
  onPick: (userId: string) => void;
  action: { label: string; run: (userId: string) => void };
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="m-0 text-[15px]">
        {title} <span className="font-semibold text-muted">{players.length}</span>
      </h2>
      {players.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">{empty}</p>
      ) : (
        <Card className="overflow-hidden">
          {players.map((p) => {
            const on = pick?.kind === 'pool' && pick.userId === p.userId;
            return (
              <div key={p.userId} className={cx('flex items-center gap-2 px-3 py-2 [&+&]:border-t [&+&]:border-line', on && 'bg-brand-soft')}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onPick(p.userId)}
                  className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-ink"
                >
                  <Avatar name={p.name} src={p.photoUrl} size={32} />
                  <span className="flex min-w-0 flex-col">
                    <strong className="truncate text-[14px]">
                      {p.shirt ? <span className="tnum mr-1 text-muted">#{p.shirt}</span> : null}
                      {p.name}
                    </strong>
                    <span className="text-[12px] text-muted">{p.position ?? 'No position'}</span>
                  </span>
                </button>
                <Badge tone={p.status === 'in' ? 'brand' : p.status === 'maybe' ? 'hl' : 'muted'}>{p.status ? (p.status === 'in' ? 'In' : p.status === 'maybe' ? 'Maybe' : 'Out') : 'No reply'}</Badge>
                <button
                  type="button"
                  onClick={() => action.run(p.userId)}
                  className="h-8 cursor-pointer rounded-[9px] border border-line bg-surface px-2.5 text-[12px] font-bold text-ink hover:bg-surface-2"
                >
                  {action.label}
                </button>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}
