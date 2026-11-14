import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, ChevronDown, ScrollText, Shirt as ShirtIcon } from 'lucide-react';
import type { Availability, LineupSubject } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { answerAvailability, fetchAvailability, fetchLineups, remindAvailability } from '../lib/teamAdmin';
import type { AvailabilityView, LineupsView } from '../lib/teamAdmin';
import { PitchSurface, PlayerToken, toFull } from './Pitch';
import { Avatar, Badge, ButtonLink, Card, ErrorNote, Section, Skeleton, cx, kitColour } from './ui';

const STATUS_LABEL: Record<Availability, string> = { in: 'In', maybe: 'Maybe', out: 'Out' };

// "Are you available?" for a team fixture or team game, with the squad
// picture for captains. Hidden for open pickup games (joining is the answer).
export function AvailabilityCard({ type, id, compact, title }: { type: LineupSubject; id: string; compact?: boolean; title?: string }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [view, setView] = useState<AvailabilityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setView(await fetchAvailability(token, type, id));
  }, [token, type, id]);

  useEffect(() => {
    load().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : '';
      // Not in either team: nothing to show, not an error.
      if (!/Only the players/.test(msg)) setError(msg || 'Could not load availability.');
    });
  }, [load]);

  if (!view || view.subject.pickup) return error ? <ErrorNote>{error}</ErrorNote> : null;
  const mySide = view.sides.find((s) => s.side === view.me.side) ?? view.sides[0];
  if (!mySide) return null;

  const answer = async (status: Availability) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await answerAvailability(token, { subjectType: type, subjectId: id, status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const remind = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const { reminded } = await remindAvailability(token, type, id);
      setNotice(reminded === 0 ? 'Everyone has answered.' : `Reminded ${reminded} player${reminded === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reminders.');
    } finally {
      setBusy(false);
    }
  };

  const c = mySide.counts;
  const total = c.in + c.maybe + c.out + c.none;
  const card = (
    <Card className={cx('flex flex-col gap-3', compact ? 'p-3' : 'p-3.5')}>
      {view.me.side ? (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-bold">{view.me.status ? `You said: ${STATUS_LABEL[view.me.status]}` : `Are you available for ${mySide.name}?`}</span>
          <div role="group" aria-label="Your availability" className="grid grid-cols-3 gap-1.5">
            {(['in', 'maybe', 'out'] as const).map((s) => {
              const on = view.me.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => void answer(s)}
                  className={cx(
                    'h-10 cursor-pointer rounded-[10px] border text-[14px] font-bold',
                    on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink hover:bg-surface-2',
                  )}
                >
                  {STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${c.in} in, ${c.maybe} maybe, ${c.out} out, ${c.none} no reply`}>
          {total === 0 ? <span className="flex-1 bg-surface-3" /> : null}
          {c.in ? <span style={{ flex: c.in }} className="bg-[var(--win)]" /> : null}
          {c.maybe ? <span style={{ flex: c.maybe }} className="bg-[#f2c230]" /> : null}
          {c.out ? <span style={{ flex: c.out }} className="bg-[var(--loss)]" /> : null}
          {c.none ? <span style={{ flex: c.none }} className="bg-surface-3" /> : null}
        </div>
        <div className="flex items-center justify-between text-[12px] text-muted">
          <span>
            <strong className="text-ink">{c.in} in</strong> · {c.maybe} maybe · {c.out} out
          </span>
          <span>{c.none} no reply</span>
        </div>
      </div>
      {mySide.canManage ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-bold text-ink hover:bg-surface-2"
            >
              Squad <ChevronDown size={15} className={cx('transition-transform', open && 'rotate-180')} />
            </button>
            {c.none > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void remind()}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-bold text-ink hover:bg-surface-2"
              >
                <BellRing size={15} /> Remind {c.none}
              </button>
            ) : null}
          </div>
          {notice ? <span className="text-[13px] font-semibold text-brand-text">{notice}</span> : null}
          {open ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {mySide.players.map((p) => (
                <li key={p.userId} className="flex items-center gap-2.5 border-t border-line py-2 text-[14px]">
                  <Avatar name={p.name} src={p.photoUrl} size={28} />
                  <span className="min-w-0 flex-1 truncate">
                    {p.shirt ? <span className="tnum mr-1 font-bold text-muted">#{p.shirt}</span> : null}
                    {p.name}
                  </span>
                  <Badge tone={p.status === 'in' ? 'brand' : p.status === 'maybe' ? 'hl' : 'muted'}>{p.status ? STATUS_LABEL[p.status] : 'No reply'}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
  return title ? <Section title={title}>{card}</Section> : card;
}

// Both published lineups on one pitch, home bottom, away top, with links for
// captains (or the pickup host) to set theirs.
export function LineupsPanel({ type, id, title = 'Lineups' }: { type: LineupSubject; id: string; title?: string }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [view, setView] = useState<LineupsView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchLineups(token, type, id)
      .then(setView)
      .catch(() => setFailed(true));
  }, [token, type, id]);

  if (failed) return null;
  if (!view) return <Skeleton className="h-64" />;
  if (view.formations.length === 0) return null;

  const editable = view.sides.filter((s) => s.canEdit);
  const shown = view.sides.filter((s) => s.lineup);
  const colourOf = (s: (typeof view.sides)[number]) => s.kitColour ?? (s.teamId ? kitColour(s.teamId) : s.side === 'home' ? '#f2c230' : '#1d3f8f');

  return (
    <Section
      title={title}
      action={
        <Link to={`/rules/${type}/${id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-text no-underline">
          <ScrollText size={14} /> Rules
        </Link>
      }
    >
      <Card className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-2 px-1 text-[12px] font-bold">
          {view.sides
            .slice()
            .reverse()
            .map((s) => (
              <span key={s.side} className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-[3px]" style={{ background: colourOf(s) }} />
                {s.name}
                {s.lineup ? (
                  <span className="font-semibold text-muted">
                    · {s.lineup.formation}
                    {!s.lineup.published ? ' (draft)' : ''}
                  </span>
                ) : (
                  <span className="font-semibold text-muted">· not set</span>
                )}
              </span>
            ))}
        </div>
        <PitchSurface sport={view.subject.sport} variant="full" label={`Lineups: ${view.sides.map((s) => `${s.name} ${s.lineup ? s.lineup.formation : 'not set'}`).join(', ')}`}>
          {shown.flatMap((s) =>
            (s.lineup?.slots ?? []).map((slot, i) => {
              const p = toFull(s.side, slot.x, slot.y);
              return (
                <PlayerToken
                  key={`${s.side}-${i}`}
                  x={p.x}
                  y={p.y}
                  colour={slot.role === 'GK' ? (s.side === 'home' ? '#2ba84a' : '#7c3aed') : colourOf(s)}
                  number={slot.shirt}
                  name={slot.name ? slot.name.split(' ')[0] : null}
                  role={slot.role}
                  sport={view.subject.sport}
                  empty={!slot.userId}
                  size={28}
                />
              );
            }),
          )}
        </PitchSurface>
        {shown.some((s) => (s.lineup?.bench.length ?? 0) > 0) ? (
          <div className="flex flex-col gap-1.5 px-1">
            {shown
              .filter((s) => (s.lineup?.bench.length ?? 0) > 0)
              .map((s) => (
                <p key={s.side} className="m-0 text-[13px]">
                  <strong>{s.name} bench:</strong>{' '}
                  <span className="text-muted">{s.lineup?.bench.map((b) => `${b.shirt ? `#${b.shirt} ` : ''}${b.name}`).join(', ')}</span>
                </p>
              ))}
          </div>
        ) : null}
        {shown.length === 0 && editable.length === 0 ? (
          <p className="m-0 px-1 text-[13px] text-muted">Lineups appear here once the captains publish them.</p>
        ) : null}
        {editable.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {editable.map((s) => (
              <ButtonLink key={s.side} to={`/lineup/${type}/${id}?side=${s.side}`} size="sm" variant={s.lineup ? 'secondary' : 'primary'} icon={<ShirtIcon size={15} />}>
                {s.lineup ? `Edit ${s.name}` : `Set ${s.name} lineup`}
              </ButtonLink>
            ))}
          </div>
        ) : null}
      </Card>
    </Section>
  );
}
