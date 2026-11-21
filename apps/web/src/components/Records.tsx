import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Moon, Swords } from 'lucide-react';
import type { Band, Sport } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchFreeNearby, fetchMyFreeTonight, fetchOpponents } from '../lib/records';
import type { BandView, MyRecordView, OpponentSuggestion } from '../lib/records';
import { sportLabel } from './GameCard';
import { Badge, Button, Card, Chip, Crest, ErrorNote, FormGuide, ListRow, Sheet, StatTile, cx } from './ui';

// Records (games and races only), team bands, suggested opponents and Free tonight.

const BAND_TONE: Record<Band, 'muted' | 'neutral' | 'brand' | 'hl'> = { new: 'muted', starter: 'neutral', club: 'neutral', strong: 'brand', elite: 'hl' };

export function BandBadge({ band, className }: { band: BandView | undefined | null; className?: string }) {
  if (!band) return null;
  return (
    <Badge tone={BAND_TONE[band.band]} className={className}>
      {band.label}
      {band.band !== 'new' && band.trend > 0 ? <ArrowUp size={12} aria-label="rising" /> : null}
      {band.band !== 'new' && band.trend < 0 ? <ArrowDown size={12} aria-label="falling" /> : null}
    </Badge>
  );
}

export function ActivityGrid({ grid }: { grid: { week: string; count: number }[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.ceil(grid.length / 2)}, minmax(0, 1fr))`, gridAutoFlow: 'row' }} role="img" aria-label={`Activity over the last ${grid.length} weeks`}>
        {grid.map((g) => (
          <span
            key={g.week}
            title={`Week of ${new Date(`${g.week}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${g.count}`}
            className={cx('aspect-square rounded-[3px]', g.count === 0 ? 'bg-surface-2' : g.count === 1 ? 'bg-brand/45' : g.count === 2 ? 'bg-brand/70' : 'bg-brand')}
          />
        ))}
      </div>
      <span className="text-[11px] text-muted">Last {grid.length} weeks of games and races</span>
    </div>
  );
}

export function RecordCard({ data }: { data: MyRecordView }) {
  const r = data.record;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        <StatTile value={r.played} label="Played" />
        <StatTile value={`${r.won}-${r.drawn}-${r.lost}`} label="W-D-L" />
        <StatTile value={r.winRate == null ? '–' : `${r.winRate}%`} label="Win rate" />
        <StatTile value={data.streak} label="Wk streak" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <StatTile value={r.goals} label="Goals" />
        <StatTile value={r.assists} label="Assists" />
        <StatTile value={r.mvps} label="Best player" />
        <StatTile value={r.longestUnbeaten} label="Unbeaten run" />
      </div>
      {r.form.length ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          Form <FormGuide results={r.form} />
        </div>
      ) : null}
      <ActivityGrid grid={data.grid} />
      {r.bySport.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {r.bySport.map((s) => (
            <Badge key={s.sport}>
              {sportLabel(s.sport)} {s.played}
              {s.won ? `, ${s.won} W` : ''}
              {s.goals ? `, ${s.goals} goals` : ''}
            </Badge>
          ))}
        </div>
      ) : null}
      {data.season.games ? (
        <p className="m-0 rounded-xl bg-brand-soft px-3 py-2 text-[13px] text-brand-text">
          This year: {data.season.games} game{data.season.games === 1 ? '' : 's'}
          {data.season.opponents ? `, ${data.season.opponents} ${data.season.opponents === 1 ? 'team' : 'teams'} faced` : ''}
          {data.season.goals ? `, ${data.season.goals} goals` : ''}
          {data.season.bestMonth ? `. Busiest month: ${data.season.bestMonth}` : ''}.
        </p>
      ) : null}
    </div>
  );
}

export function OpponentSuggestions({ teamId, onChallenge }: { teamId: string; onChallenge: (s: OpponentSuggestion) => void }) {
  const { session } = useAuth();
  const [list, setList] = useState<OpponentSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    fetchOpponents(session.access_token, teamId)
      .then(setList)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load suggestions.'));
  }, [session, teamId]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!list) return null;
  if (list.length === 0) return <p className="m-0 text-[14px] text-muted">No other teams in this sport yet. Post an open challenge and anyone can take it.</p>;
  return (
    <Card>
      {list.slice(0, 5).map((s) => (
        <ListRow
          key={s.team.id}
          to={`/teams/${s.team.id}`}
          leading={<Crest id={s.team.id} name={s.team.name} src={s.team.logo_url} />}
          title={
            <span className="inline-flex items-center gap-1.5">
              {s.team.name} <BandBadge band={s.band} />
            </span>
          }
          sub={s.reasons.join(' · ') || s.team.area || ''}
          trailing={
            <Button size="sm" icon={<Swords size={14} />} onClick={(e) => { e.preventDefault(); onChallenge(s); }}>
              Challenge
            </Button>
          }
          chevron={false}
        />
      ))}
    </Card>
  );
}

export function FreeTonightCard({ sports }: { sports: Sport[] }) {
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [state, setState] = useState<{ on: boolean; sports?: string[]; radius_km?: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [radius, setRadius] = useState(10);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    fetchMyFreeTonight(token)
      .then((s) => {
        setState(s);
        if (s.sports) setPicked(s.sports);
        if (s.radius_km) setRadius(s.radius_km);
      })
      .catch(() => setState({ on: false }));
  }, [token]);
  if (!state) return null;
  const save = async () => {
    setError(null);
    try {
      await runAction('set_free_tonight', { sports: picked, radiusKm: radius }, token);
      setState({ on: true, sports: picked, radius_km: radius });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch it on.');
    }
  };
  return (
    <>
      <Card className="flex items-center gap-3 p-3.5">
        <Moon size={20} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <strong className="block text-[14px]">Free tonight</strong>
          <span className="text-[13px] text-muted">
            {state.on ? `On until midnight, within ${state.radius_km ?? radius} km. Organisers nearby can invite you; they never see your name.` : 'Let organisers nearby know you could play tonight.'}
          </span>
        </div>
        {state.on ? (
          <Button size="sm" onClick={() => void runAction('clear_free_tonight', {}, token).then(() => setState({ on: false }))}>Turn off</Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>Turn on</Button>
        )}
      </Card>
      <Sheet open={open} onClose={() => setOpen(false)} title="Free tonight">
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold">Which sports?</span>
          <div className="flex flex-wrap gap-2">
            {sports.map((s) => (
              <Chip key={s.id} on={picked.includes(s.id)} onClick={() => setPicked(picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id])}>
                {sportLabel(s.name)}
              </Chip>
            ))}
          </div>
          <label className="flex items-center gap-3 text-[14px]">
            Within
            <input type="range" min={2} max={30} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="flex-1" />
            <strong className="w-14 text-right">{radius} km</strong>
          </label>
          <p className="m-0 text-[13px] text-muted">Switches itself off at midnight. Organisers see only how many players are free, never who, and can send you one invite per evening.</p>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button variant="primary" disabled={picked.length === 0} onClick={() => void save()}>
            I'm free tonight
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/** For an organiser's game starting later today: how many players are free nearby, and a button to tell them. */
export function FreeNearbyPanel({ matchId }: { matchId: string }) {
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchFreeNearby>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    fetchFreeNearby(token, matchId).then(setData).catch(() => setData(null));
  }, [token, matchId]);
  if (!data || !data.eligible || (data.count === 0 && !data.alreadyTold)) return null;
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <Moon size={20} className="shrink-0 text-brand-text" />
      <span className="flex-1 text-[14px]">
        <strong>{data.count}</strong> player{data.count === 1 ? '' : 's'} free tonight nearby.
      </span>
      {data.alreadyTold ? (
        <Badge tone="muted">Told tonight</Badge>
      ) : (
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            void runAction<{ count: number }>('notify_free_players', { matchId }, token)
              .then((r) => {
                setMsg(`Told ${r.count}.`);
                setData({ ...data, alreadyTold: true });
              })
              .catch((e: unknown) => setMsg(e instanceof Error ? e.message : 'Could not send.'))
          }
        >
          Tell them about this game
        </Button>
      )}
      {msg ? <span className="text-[12px] text-muted">{msg}</span> : null}
    </Card>
  );
}
