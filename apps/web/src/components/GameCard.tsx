import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { LEVEL_LABELS } from '@chabuka/shared';
import type { MatchListing } from '../lib/matches';
import { priceLabel } from '../lib/waitapp';
import { Badge, Meter, cx } from './ui';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// Sport names are stored lower-case ("basketball"); show them as names.
export function sportLabel(name: string | null | undefined): string {
  return (name ?? '').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Atmosphere photo for a sport (match centre, onboarding). Decorative only:
// never presented as a picture of a real venue.
const BACKDROPS: [RegExp, string][] = [
  [/futsal|5.?a.?side|five/i, '/sports/futsal.jpg'],
  [/football|soccer/i, '/sports/football.jpg'],
  [/basket/i, '/sports/basketball.jpg'],
  [/netball/i, '/sports/netball.jpg'],
  [/padel/i, '/sports/padel.jpg'],
  [/tennis/i, '/sports/tennis.jpg'],
  [/hik|trail|run|walk|marathon|cycl/i, '/sports/trail.jpg'],
];
export function sportBackdrop(name: string | null | undefined, format?: string | null): string {
  const key = `${format ?? ''} ${name ?? ''}`;
  return BACKDROPS.find(([re]) => re.test(key))?.[1] ?? '/brand/hero-pitch.jpg';
}

// "Today", "Tomorrow", or "Sat 16 Nov".
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return dayFmt.format(d);
}

// Fits a 44px date block: "Today", "Tmrw", or the weekday ("Sat").
export function dayShort(iso: string): string {
  const label = dayLabel(iso);
  if (label === 'Today' || label === 'Yesterday') return label === 'Today' ? 'Today' : 'Yday';
  if (label === 'Tomorrow') return 'Tmrw';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(iso));
}

export function timeLabel(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function placeLabel(l: MatchListing): string {
  return [l.venue?.name ?? l.match.venue_name, l.match.area ?? l.venue?.area].filter(Boolean).join(' · ') || 'Place to be confirmed';
}

// Status word for a game, or null when it is simply open with room.
export function statusBadge(l: MatchListing): { label: string; tone: 'live' | 'hl' | 'muted' | 'brand' } | null {
  const m = l.match;
  if (m.status === 'cancelled') return { label: 'Cancelled', tone: 'live' };
  if (m.status === 'postponed') return { label: 'Postponed', tone: 'hl' };
  if (m.status === 'finished') return { label: 'Finished', tone: 'muted' };
  const startedAgo = Date.now() - new Date(m.starts_at).getTime();
  if (startedAgo > 4 * 3600 * 1000) return { label: 'Awaiting result', tone: 'muted' };
  if (startedAgo >= 0) return { label: 'Under way', tone: 'live' };
  if (m.kind === 'players' && (m.status === 'full' || l.joinedCount >= m.capacity)) return { label: 'Full', tone: 'muted' };
  return null;
}

interface Props {
  listing: MatchListing;
  // Tile: fixed-width card for horizontal carousels. Row: full-width list item.
  variant?: 'tile' | 'row';
  onJoin?: (listing: MatchListing) => void;
  busy?: boolean;
}

export default function GameCard({ listing, variant = 'row', onJoin, busy }: Props) {
  const { match, sport, joinedCount, isParticipant, isOrganiser, ticketing } = listing;
  const status = statusBadge(listing);
  const open = !status && match.kind === 'players';
  const spotsLeft = Math.max(0, match.capacity - joinedCount);
  const href = `/games/${match.id}`;
  const canJoin = open && !isParticipant && !ticketing && onJoin;

  const mine = isOrganiser ? 'You host' : isParticipant ? 'You’re in' : null;

  return (
    <article
      className={cx(
        'relative flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5',
        variant === 'tile' ? 'w-[272px] shrink-0' : 'w-full',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Badge tone="brand">
            {sport ? sportLabel(sport.name) : 'Game'}
            {match.format ? ` · ${match.format}` : ''}
          </Badge>
          {match.kind === 'team-vs-team' ? <Badge tone="muted">Team game</Badge> : null}
        </span>
        {status ? (
          <Badge tone={status.tone}>{status.label}</Badge>
        ) : (
          <span className={cx('text-[12px] font-bold', dayLabel(match.starts_at) === 'Today' ? 'rounded-full bg-hl px-2 py-0.5 text-hl-text' : 'text-muted')}>
            {dayLabel(match.starts_at)}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2.5">
        <span className="tnum text-[24px] font-extrabold leading-none tracking-[-0.03em]">{timeLabel(match.starts_at)}</span>
        {status || dayLabel(match.starts_at) === 'Today' ? <span className="text-[13px] font-semibold text-muted">{dayLabel(match.starts_at)}</span> : null}
      </div>

      <Link to={href} className="font-bold text-ink no-underline after:absolute after:inset-0 after:rounded-2xl after:content-['']">
        {match.title}
      </Link>

      <span className="flex items-center gap-1.5 text-[13px] text-muted">
        <MapPin size={14} aria-hidden="true" />
        <span className="truncate">{placeLabel(listing)}</span>
      </span>

      {match.kind === 'players' ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="text-muted">
              <strong className="tnum text-ink">
                {joinedCount}/{match.capacity}
              </strong>{' '}
              in{open ? ` · ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left` : ''}
              {match.level ? ` · ${LEVEL_LABELS[match.level]}` : ''}
            </span>
            {ticketing ? <span className="font-bold text-ink">{priceLabel(ticketing)}</span> : null}
          </div>
          <Meter value={joinedCount} max={match.capacity} />
        </div>
      ) : null}

      {mine || canJoin ? (
        <div className="relative z-10 flex items-center justify-between gap-2">
          {mine ? <span className="text-[13px] font-bold text-brand-text">{mine}</span> : <span />}
          {canJoin ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onJoin?.(listing)}
              className="h-9 cursor-pointer rounded-[10px] border-0 bg-brand px-4 text-[13px] font-bold text-on-brand disabled:opacity-50"
            >
              {busy ? 'Joining…' : 'Join'}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
