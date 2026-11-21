import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDataChanged } from '../lib/dataChanged';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Ban,
  CalendarPlus,
  ChevronLeft,
  Clock,
  Copy,
  MapPin,
  Navigation,
  Pencil,
  Share2,
  Ticket,
  Timer,
  Trophy,
} from 'lucide-react';
import {
  LEVEL_LABELS,
  availableActions,
  formatEventLocation,
  googleCalendarUrl,
  scoreboardSportFor,
} from '@chabuka/shared';
import type { Level } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { downloadMatchIcs, reportScoreAction, updateMatchAction } from '../lib/api';
import { fetchMatchDetail } from '../lib/matches';
import type { MatchDetail } from '../lib/matches';
import { checkoutLink, priceLabel, ticketLookupUrl } from '../lib/waitapp';
import { useMatchActions } from '../lib/useMatchActions';
import MatchFoundOverlay from '../components/MatchFoundOverlay';
import TicketingPanel from '../components/TicketingPanel';
import { BandBadge, FreeNearbyPanel } from '../components/Records';
import { fetchVersus } from '../lib/records';
import GameVenueBooking from '../components/GameVenueBooking';
import ScoreboardButton from '../components/scoreboard/ScoreboardButton';
import { AvailabilityCard, LineupsPanel } from '../components/MatchDay';
import SeriesPanel from '../components/SeriesPanel';
import { ShareInvite } from '../components/ShareInvite';
import { dayLabel, placeLabel, sportBackdrop, sportLabel, statusBadge, timeLabel } from '../components/GameCard';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  Crest,
  ErrorNote,
  FormGuide,
  Meter,
  Section,
  Sheet,
  Skeleton,
  cx,
  kitColour,
} from '../components/ui';

const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

function countdown(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `Starts in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Starts in ${hours} h ${mins % 60} min`;
  const days = Math.round(hours / 24);
  return `In ${days} day${days === 1 ? '' : 's'}`;
}

// <input type="datetime-local"> wants local time without a zone.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type SheetKind = 'edit' | 'result' | 'cancel' | 'postpone' | null;

export default function GamePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user, session } = useAuth();
  const token = session?.access_token;
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    if (!user || !id) return;
    const d = await fetchMatchDetail(id, user.id);
    setDetail(d);
    if (!d) setError('This game does not exist or is private.');
  }, [id, user]);
  useDataChanged(useCallback(() => { void reload().catch(() => undefined); }, [reload]));

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load this game.'))
      .finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  // Deep link from "Needs you": open the result sheet straight away.
  useEffect(() => {
    if (params.get('result') === '1' && detail?.listing.isOrganiser) {
      setSheet('result');
      params.delete('result');
      setParams(params, { replace: true });
    }
  }, [params, setParams, detail]);

  const { busyId, actionError, onJoin, onWithdraw, celebration, dismissCelebration } = useMatchActions(reload);

  const run = async (fn: (t: string) => Promise<unknown>) => {
    if (!token) {
      setSheetError('You are signed out. Sign in again.');
      return;
    }
    setBusy(true);
    setSheetError(null);
    try {
      await fn(token);
      await reload();
      setSheet(null);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const url = window.location.href.split('?')[0] ?? window.location.href;
    const title = detail?.listing.match.title ?? 'Game on Chabuka';
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Share sheet dismissed: nothing to do.
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-4 pt-4">
        <Skeleton className="h-44" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="mx-auto max-w-[720px] px-4 pt-6">
        <ErrorNote>{error ?? 'This game could not be found.'}</ErrorNote>
        <ButtonLink to="/explore" className="mt-4">
          Back to Explore
        </ButtonLink>
      </div>
    );
  }

  const { listing, players, organiser, sides } = detail;
  const { match, sport, venue, joinedCount, isParticipant, isOrganiser, ticketing, myTickets } = listing;
  const status = statusBadge(listing);
  const started = new Date(match.starts_at).getTime() <= now;
  const finished = match.status === 'finished';
  const cancelled = match.status === 'cancelled';
  const hasScore = match.home_score != null && match.away_score != null;
  const actions = availableActions({
    status: match.status,
    kind: match.kind,
    isOrganiser,
    isParticipant,
    joinedCount,
    capacity: match.capacity,
  });
  const lat = match.lat ?? venue?.lat;
  const lng = match.lng ?? venue?.lng;
  const directionsUrl = lat != null && lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null;
  const calendarUrl = googleCalendarUrl({
    title: match.title,
    startsAt: match.starts_at,
    location: formatEventLocation({ name: venue?.name ?? match.venue_name, area: match.area ?? venue?.area, lat: lat ?? null, lng: lng ?? null }),
  });
  const showScoreboard =
    !!scoreboardSportFor(sport?.name) && !cancelled && (isOrganiser || isParticipant || Math.abs(now - new Date(match.starts_at).getTime()) < 6 * 3600 * 1000);
  const spotsLeft = Math.max(0, match.capacity - joinedCount);
  const sideNames = sides ? [sides.home.name, sides.away.name] : ['Bibs', 'No bibs'];
  const backdrop = sportBackdrop(sport?.name, match.format);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 pb-6">
      {celebration ? <MatchFoundOverlay title={celebration.title} onClose={dismissCelebration} /> : null}

      {/* Header */}
      {sides ? (
        <section
          aria-label={`${sides.home.name} versus ${sides.away.name}`}
          className="relative grid grid-cols-2 bg-cover bg-center text-white lg:mt-4 lg:overflow-hidden lg:rounded-3xl"
          style={{ backgroundImage: `url(${backdrop})` }}
        >
          {[sides.home, sides.away].map((s, i) => (
            <Link
              key={s.teamId}
              to={`/teams/${s.teamId}`}
              style={{ background: `color-mix(in srgb, ${kitColour(s.teamId)} 80%, transparent)` }}
              className="flex flex-col items-center gap-2 px-3 pb-6 pt-16 text-center text-white no-underline"
            >
              <Crest id={s.teamId} name={s.name} src={s.logoUrl} size={64} className="border-2 border-white/80" />
              <strong className="text-[16px] leading-tight">{s.name}</strong>
              <span className="text-[11px] font-bold tracking-[0.08em] opacity-80">{i === 0 ? 'HOME' : 'AWAY'}</span>
            </Link>
          ))}
          <TopBar onBack={() => navigate(-1)} onShare={share} label={sport ? sportLabel(sport.name) : 'Game'} light />
          <div className="absolute left-1/2 top-[84px] flex min-w-[84px] -translate-x-1/2 flex-col items-center rounded-2xl bg-surface px-3 py-2 text-ink shadow-[var(--shadow-lg)]">
            {hasScore ? (
              <>
                <span className="text-[11px] font-extrabold tracking-[0.1em] text-muted">{finished ? 'FULL TIME' : 'SCORE'}</span>
                <span className="tnum text-[24px] font-extrabold tracking-[-0.02em]">
                  {match.home_score}–{match.away_score}
                </span>
              </>
            ) : (
              <>
                <span className="text-[11px] font-extrabold tracking-[0.12em] text-muted">VS</span>
                <span className="tnum text-[22px] font-extrabold tracking-[-0.02em]">{timeLabel(match.starts_at)}</span>
                <span className="text-[11px] font-bold">{dayLabel(match.starts_at)}</span>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="overflow-hidden border-b border-line bg-surface lg:mt-4 lg:rounded-3xl lg:border">
          <div className="relative h-44 bg-cover bg-center" style={{ backgroundImage: `url(${backdrop})` }}>
            <div className="absolute inset-0 bg-black/35" aria-hidden="true" />
            <TopBar onBack={() => navigate(-1)} onShare={share} label={sport ? sportLabel(sport.name) : 'Game'} light />
          </div>
          <div className="px-4 pb-5 pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">
              {sport ? sportLabel(sport.name) : 'Game'}
              {match.format ? ` · ${match.format}` : ''}
            </Badge>
            {match.level ? <Badge tone="muted">{LEVEL_LABELS[match.level]}</Badge> : null}
            {match.visibility === 'private' ? <Badge tone="muted">Invite only</Badge> : null}
            {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
          </div>
          <h1 className="mb-1 mt-2.5">{match.title}</h1>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tnum text-[30px] font-extrabold leading-none tracking-[-0.03em]">{timeLabel(match.starts_at)}</span>
            <span className="text-[15px] font-semibold">{fullDate.format(new Date(match.starts_at))}</span>
          </div>
          {!cancelled && !finished ? <p className="mt-1.5 text-[13px] font-semibold text-brand-text">{started ? (status?.label ?? 'Under way') : countdown(match.starts_at, now)}</p> : null}
          {hasScore ? (
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
              <Trophy size={18} className="text-brand-text" />
              <span className="text-[13px] font-bold text-muted">{finished ? 'Final score' : 'Score'}</span>
              <span className="tnum ml-auto text-[22px] font-extrabold">
                {match.home_score} – {match.away_score}
              </span>
            </div>
          ) : null}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-5 px-4">
        {sides ? <VersusStrip home={sides.home.teamId} away={sides.away.teamId} /> : null}
        {isOrganiser && !cancelled && !finished ? <FreeNearbyPanel matchId={match.id} /> : null}
        {/* Share link: anyone can pass on a public game; a private one only its players. */}
        {match.kind === 'players' && !cancelled && !finished && !started && (isOrganiser || isParticipant || match.visibility !== 'private') ? (
          <Card className="flex items-center justify-between gap-3 p-3.5">
            <span className="min-w-0 text-[14px]">
              <strong className="block">{spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left` : 'Game is full'}</strong>
              <span className="text-muted">Send the link to friends. They can sign up and join from it.</span>
            </span>
            <ShareInvite matchId={match.id} canNotify={isOrganiser || isParticipant} size="sm" variant={isOrganiser ? 'primary' : 'secondary'} />
          </Card>
        ) : null}
        {cancelled ? (
          <Card className="border-live p-3.5 text-[14px]">
            <strong className="text-danger">This game was cancelled.</strong>
            {ticketing ? <span className="text-muted"> Ticket holders are refunded by WaitApp.</span> : null}
          </Card>
        ) : null}
        {match.status === 'postponed' ? (
          <Card className="p-3.5 text-[14px]">
            <strong>Postponed.</strong> <span className="text-muted">The host will set a new time; you will get a notification.</span>
          </Card>
        ) : null}
        <ErrorNote>{actionError ?? error}</ErrorNote>

        {/* Where and when */}
        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 p-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2">
              <MapPin size={20} />
            </span>
            <span className="min-w-0 flex-1">
              {venue ? (
                <Link to={`/venues/${venue.id}`} className="font-bold text-ink">
                  {venue.name}
                </Link>
              ) : (
                <strong>{match.venue_name ?? 'Place to be confirmed'}</strong>
              )}
              {(() => {
                // The second line adds the area; it used to repeat the place name already shown above it.
                const name = venue?.name ?? match.venue_name ?? '';
                const rest = placeLabel(listing).split(' · ').filter((p) => p && p !== name).join(' · ');
                return rest ? (
                  <>
                    <br />
                    <span className="text-[13px] text-muted">{rest}</span>
                  </>
                ) : null;
              })()}
            </span>
            {directionsUrl ? (
              <ButtonLink href={directionsUrl} size="sm" icon={<Navigation size={15} />}>
                Directions
              </ButtonLink>
            ) : null}
          </div>
          <div className="flex items-center gap-3 border-t border-line p-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2">
              <Clock size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <strong>
                {dayLabel(match.starts_at)}, {timeLabel(match.starts_at)}
              </strong>
              <br />
              <span className="text-[13px] text-muted">Add it to your calendar</span>
            </span>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                icon={<CalendarPlus size={15} />}
                disabled={!token}
                onClick={() => {
                  if (token) void downloadMatchIcs(match.id, token).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not download the calendar file.'));
                }}
              >
                .ics
              </Button>
              <ButtonLink href={calendarUrl} size="sm">
                Google
              </ButtonLink>
            </div>
          </div>
        </Card>

        {/* Who's in */}
        {match.kind === 'players' ? (
          <Section
            title="Who’s in"
            action={
              <span className="tnum text-[13px] font-bold text-muted">
                {joinedCount}/{match.capacity}
                {!cancelled && !finished && spotsLeft > 0 ? ` · ${spotsLeft} left` : ''}
              </span>
            }
          >
            <Card className="flex flex-col gap-3 p-3.5">
              <Meter value={joinedCount} max={match.capacity} />
              {players.length === 0 ? (
                <p className="m-0 text-[14px] text-muted">Nobody yet. Be the first in.</p>
              ) : (
                <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-3 p-0">
                  {players.map((p) => (
                    <li key={p.id}>
                      <Link to={`/players/${p.id}`} className="flex flex-col items-center gap-1 text-center text-ink no-underline">
                        <Avatar name={p.name} src={p.photoUrl} size={44} />
                        <span className="w-full truncate text-[12px] font-semibold">{p.id === user?.id ? 'You' : (p.name ?? 'Player')}</span>
                        {p.id === match.organiser_id ? <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-brand-text">Host</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>
        ) : null}

        {match.series_id ? <SeriesPanel seriesId={match.series_id} matchId={match.id} onChanged={() => void reload()} /> : null}

        {!cancelled ? (
          <>
            {sides && !finished ? <AvailabilityCard type="match" id={match.id} title="Availability" /> : null}
            <LineupsPanel type="match" id={match.id} title={sides ? 'Lineups' : 'Sides'} />
          </>
        ) : null}

        {/* About */}
        <Section title="About this game">
          <Card className="overflow-hidden">
            <InfoRow k="Host" v={organiser?.name ?? 'Organiser'} />
            <InfoRow k="Sport" v={[sport ? sportLabel(sport.name) : null, match.format].filter(Boolean).join(' · ') || '—'} />
            {match.level ? <InfoRow k="Level" v={LEVEL_LABELS[match.level]} /> : null}
            <InfoRow k="Type" v={match.kind === 'team-vs-team' ? 'Team vs team' : 'Open game, join as a player'} />
            <InfoRow k="Entry" v={ticketing ? priceLabel(ticketing) : 'Free'} />
            <InfoRow
              k="Rules"
              v={
                <Link to={`/rules/match/${match.id}`} className="text-brand-text">
                  {isOrganiser ? 'View and edit' : 'Read the rule book'}
                </Link>
              }
            />
            {match.notes ? (
              <div className="border-t border-line px-3.5 py-3 text-[14px]">
                <span className="mb-1 block text-[13px] text-muted">Notes from the host</span>
                <span className="whitespace-pre-line">{match.notes}</span>
              </div>
            ) : null}
          </Card>
        </Section>

        {ticketing && myTickets ? (
          <Card className="flex items-center gap-3 p-3.5">
            <Ticket size={20} className="text-brand-text" />
            <span className="flex-1 text-[14px]">
              You have {myTickets.total} ticket{myTickets.total === 1 ? '' : 's'}
              {myTickets.checkedIn > 0 ? ` (${myTickets.checkedIn} checked in)` : ''}. The QR code was emailed to you.
            </span>
            <ButtonLink href={ticketLookupUrl(ticketing)} size="sm">
              Find ticket
            </ButtonLink>
          </Card>
        ) : null}

        {showScoreboard ? (
          <Section title="Officials">
            <Card className="flex flex-col gap-3 p-3.5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
                  <Timer size={20} />
                </span>
                <span className="flex-1 text-[14px] text-muted">
                  Live score, match clock, cards and the rule book. A scorekeeper and a timekeeper can share the job; everyone can follow.
                </span>
              </div>
              <ScoreboardButton target={{ matchId: match.id }} />
            </Card>
          </Section>
        ) : null}

        {/* Host tools */}
        {isOrganiser && !cancelled ? (
          <Section title="Host tools">
            <Card className="overflow-hidden">
              {!finished ? <ToolRow icon={<Pencil size={18} />} title="Edit game" sub="Time, spots, level and notes" onClick={() => setSheet('edit')} /> : null}
              {started ? (
                <ToolRow
                  icon={<Trophy size={18} />}
                  title={hasScore ? 'Change the score' : 'Record the result'}
                  sub={finished ? 'Final score' : 'Closes the game and counts it in everyone’s record'}
                  onClick={() => setSheet('result')}
                />
              ) : null}
              {!started && match.status !== 'postponed' ? (
                <ToolRow icon={<Clock size={18} />} title="Postpone" sub="Keep the players, set a time later" onClick={() => setSheet('postpone')} />
              ) : null}
              {!finished ? <ToolRow icon={<Ban size={18} />} title="Cancel game" sub="Everyone who joined is told" onClick={() => setSheet('cancel')} danger /> : null}
              <ToolRow icon={copied ? <Copy size={18} /> : <Share2 size={18} />} title={copied ? 'Link copied' : 'Share game link'} sub="Send it to your group" onClick={() => void share()} />
            </Card>
            {venue?.waitapp_restaurant_id ? <GameVenueBooking matchId={match.id} venueId={venue.id} startsAt={match.starts_at} /> : null}
            {match.kind === 'players' && !finished ? <TicketingPanel matchId={match.id} ticketing={ticketing} onChanged={() => void reload()} /> : null}
          </Section>
        ) : null}
      </div>

      {/* Action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 lg:sticky lg:mx-4 lg:rounded-2xl lg:border">
        <div className="mx-auto flex max-w-[720px] items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <strong className="truncate">
              {cancelled
                ? 'Cancelled'
                : finished
                  ? 'Full time'
                  : isOrganiser
                    ? 'You’re hosting'
                    : isParticipant
                      ? 'You’re in'
                      : match.kind === 'team-vs-team'
                        ? 'Team game'
                        : spotsLeft > 0
                          ? `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`
                          : 'Game is full'}
            </strong>
            <span className="truncate text-[13px] text-muted">
              {dayLabel(match.starts_at)} {timeLabel(match.starts_at)} · {placeLabel(listing)}
            </span>
          </span>
          {actions.includes('join') && ticketing ? (
            ticketing.status === 'on_sale' && user ? (
              <ButtonLink href={checkoutLink(ticketing, user.id)} variant="primary" size="lg">
                Buy ticket
              </ButtonLink>
            ) : (
              <span className="text-[13px] text-muted">Tickets not on sale yet</span>
            )
          ) : null}
          {actions.includes('join') && !ticketing ? (
            <Button variant="primary" size="lg" disabled={busyId === match.id} onClick={() => onJoin(match.id, joinedCount, match.title)}>
              {busyId === match.id ? 'Joining…' : 'Join game'}
            </Button>
          ) : null}
          {actions.includes('withdraw') && !ticketing && !isOrganiser ? (
            <Button size="lg" disabled={busyId === match.id} onClick={() => onWithdraw(match.id)}>
              Leave
            </Button>
          ) : null}
          {isOrganiser && started && !finished && !cancelled ? (
            <Button variant="primary" size="lg" onClick={() => setSheet('result')}>
              Add result
            </Button>
          ) : null}
        </div>
      </div>

      {/* Sheets */}
      <Sheet open={sheet === 'edit'} onClose={() => setSheet(null)} title="Edit game">
        <EditForm
          key={match.id + match.starts_at}
          initial={{ title: match.title, startsAt: match.starts_at, capacity: match.capacity, level: match.level ?? null, notes: match.notes ?? '' }}
          minCapacity={Math.max(2, joinedCount)}
          busy={busy}
          error={sheetError}
          teamGame={match.kind !== 'players'}
          onSubmit={(v) =>
            void run((t) =>
              updateMatchAction(
                {
                  matchId: match.id,
                  title: v.title,
                  startsAt: v.startsAt !== match.starts_at ? v.startsAt : undefined,
                  capacity: match.kind === 'players' ? v.capacity : undefined,
                  level: v.level ?? undefined,
                  notes: v.notes,
                },
                t,
              ),
            )
          }
        />
      </Sheet>

      <Sheet open={sheet === 'result'} onClose={() => setSheet(null)} title={hasScore ? 'Change the score' : 'Record the result'}>
        <ResultForm
          names={sideNames}
          initial={[match.home_score ?? 0, match.away_score ?? 0]}
          busy={busy}
          error={sheetError}
          onSubmit={(home, away) => void run((t) => reportScoreAction({ matchId: match.id, homeScore: home, awayScore: away }, t))}
          onNoScore={finished ? undefined : () => void run((t) => updateMatchAction({ matchId: match.id, status: 'finished' }, t))}
        />
      </Sheet>

      <Sheet open={sheet === 'cancel' || sheet === 'postpone'} onClose={() => setSheet(null)} title={sheet === 'cancel' ? 'Cancel this game?' : 'Postpone this game?'}>
        <ReasonForm
          kind={sheet === 'cancel' ? 'cancel' : 'postpone'}
          players={Math.max(0, joinedCount - 1)}
          busy={busy}
          error={sheetError}
          onSubmit={(reason) =>
            void run((t) => updateMatchAction({ matchId: match.id, status: sheet === 'cancel' ? 'cancelled' : 'postponed', reason: reason || undefined }, t))
          }
        />
      </Sheet>
    </div>
  );
}

function TopBar({ onBack, onShare, label, light }: { onBack: () => void; onShare: () => void; label: string; light?: boolean }) {
  return (
    <div className={cx('flex h-14 items-center justify-between', light ? 'absolute inset-x-0 top-0 z-10 px-1.5 text-white' : '-mx-2.5')}>
      <button type="button" aria-label="Back" onClick={onBack} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-inherit">
        <ChevronLeft size={22} />
      </button>
      <span className={cx('text-[12px] font-bold uppercase tracking-[0.08em]', light ? 'text-white' : 'text-muted')}>{label}</span>
      <button type="button" aria-label="Share" onClick={onShare} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-inherit">
        <Share2 size={19} />
      </button>
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 text-[14px] [&+&]:border-t [&+&]:border-line">
      <span className="text-muted">{k}</span>
      <strong className="text-right">{v}</strong>
    </div>
  );
}

function ToolRow({ icon, title, sub, onClick, danger }: { icon: ReactNode; title: string; sub: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 border-0 bg-surface px-3.5 py-3 text-left hover:bg-surface-2 [&+&]:border-t [&+&]:border-line"
    >
      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2', danger ? 'text-danger' : 'text-ink')}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <strong className={danger ? 'text-danger' : 'text-ink'}>{title}</strong>
        <span className="text-[13px] text-muted">{sub}</span>
      </span>
    </button>
  );
}

const fieldCls = 'h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-brand';
const labelCls = 'flex flex-col gap-1.5 text-[13px] font-semibold';

function EditForm({
  initial,
  minCapacity,
  busy,
  error,
  teamGame,
  onSubmit,
}: {
  initial: { title: string; startsAt: string; capacity: number; level: Level | null; notes: string };
  minCapacity: number;
  busy: boolean;
  error: string | null;
  teamGame: boolean;
  onSubmit: (v: { title: string; startsAt: string; capacity: number; level: Level | null; notes: string }) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [when, setWhen] = useState(toLocalInput(initial.startsAt));
  const [capacity, setCapacity] = useState(initial.capacity);
  const [level, setLevel] = useState<Level | null>(initial.level);
  const [notes, setNotes] = useState(initial.notes);
  const minWhen = useMemo(() => toLocalInput(new Date(Date.now() + 5 * 60000).toISOString()), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const iso = new Date(when).toISOString();
    const changedTime = toLocalInput(initial.startsAt) !== when;
    onSubmit({ title: title.trim(), startsAt: changedTime ? iso : initial.startsAt, capacity, level, notes: notes.trim() });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <label className={labelCls}>
        Title
        <input className={fieldCls} value={title} maxLength={80} required onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={labelCls}>
        Date and time
        <input className={fieldCls} type="datetime-local" value={when} min={minWhen} required onChange={(e) => setWhen(e.target.value)} />
        <span className="font-normal text-muted">Players who joined get a notification if the time changes.</span>
      </label>
      {!teamGame ? (
        <label className={labelCls}>
          Spots
          <input className={fieldCls} type="number" min={minCapacity} max={100} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
          <span className="font-normal text-muted">At least {minCapacity}: that many are already in.</span>
        </label>
      ) : null}
      <label className={labelCls}>
        Level
        <select className={fieldCls} value={level ?? ''} onChange={(e) => setLevel((e.target.value || null) as Level | null)}>
          <option value="">Any level</option>
          {(Object.keys(LEVEL_LABELS) as Level[]).map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABELS[l]}
            </option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        Notes for players
        <textarea className={cx(fieldCls, 'h-24 py-2')} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bring a dark and a light shirt. Parking at the back." />
      </label>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="primary" size="lg" block disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}

function ResultForm({
  names,
  initial,
  busy,
  error,
  onSubmit,
  onNoScore,
}: {
  names: string[];
  initial: [number, number];
  busy: boolean;
  error: string | null;
  onSubmit: (home: number, away: number) => void;
  onNoScore?: () => void;
}) {
  const [home, setHome] = useState(initial[0]);
  const [away, setAway] = useState(initial[1]);
  const stepper = (value: number, set: (n: number) => void, name: string) => (
    <div className="flex flex-col items-center gap-2">
      <span className="max-w-[140px] truncate text-center text-[13px] font-bold">{name}</span>
      <div className="flex items-center gap-2">
        <Button aria-label={`One less for ${name}`} size="md" onClick={() => set(Math.max(0, value - 1))}>
          −
        </Button>
        <span className="tnum w-12 text-center text-[36px] font-extrabold">{value}</span>
        <Button aria-label={`One more for ${name}`} size="md" onClick={() => set(Math.min(99, value + 1))}>
          +
        </Button>
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        {stepper(home, setHome, names[0] ?? 'Home')}
        {stepper(away, setAway, names[1] ?? 'Away')}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button variant="primary" size="lg" block disabled={busy} onClick={() => onSubmit(home, away)}>
        {busy ? 'Saving…' : 'Save final score'}
      </Button>
      {onNoScore ? (
        <Button variant="ghost" block disabled={busy} onClick={onNoScore}>
          Finish without a score
        </Button>
      ) : null}
    </div>
  );
}

function ReasonForm({
  kind,
  players,
  busy,
  error,
  onSubmit,
}: {
  kind: 'cancel' | 'postpone';
  players: number;
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-col gap-3.5">
      <p className="m-0 text-[14px] text-muted">
        {players > 0 ? `${players} player${players === 1 ? '' : 's'} will get a notification.` : 'Nobody else has joined yet.'}{' '}
        {kind === 'cancel' ? 'A cancelled game cannot be brought back.' : 'Set a new time later from Edit game.'}
      </p>
      <label className={labelCls}>
        Reason (optional)
        <input className={fieldCls} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'cancel' ? 'Pitch flooded' : 'Waiting on the venue'} />
      </label>
      <ErrorNote>{error}</ErrorNote>
      <Button variant={kind === 'cancel' ? 'danger' : 'primary'} size="lg" block disabled={busy} onClick={() => onSubmit(reason.trim())}>
        {busy ? 'Saving…' : kind === 'cancel' ? 'Cancel game' : 'Postpone game'}
      </Button>
    </div>
  );
}

// Both teams' level bands and how they have done against each other.
function VersusStrip({ home, away }: { home: string; away: string }) {
  const { session } = useAuth();
  const [v, setV] = useState<Awaited<ReturnType<typeof fetchVersus>> | null>(null);
  useEffect(() => {
    if (!session) return;
    fetchVersus(session.access_token, home, away).then(setV).catch(() => setV(null));
  }, [session, home, away]);
  if (!v) return null;
  const h = v.headToHead;
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-3 py-2 text-[13px]">
      <BandBadge band={v.home} />
      <span className="flex items-center gap-2 text-muted">
        {h.played ? (
          <>
            Head to head {h.won}-{h.drawn}-{h.lost}
            <FormGuide results={h.last} size={16} />
          </>
        ) : (
          'First meeting'
        )}
      </span>
      <BandBadge band={v.away} />
    </div>
  );
}
