import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from './supabase';

export interface Note {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

const READ_EVENT = 'chabuka:notifications-read';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// One place that turns a stored notification into words and a destination.
// Every type the server writes (see notifyUsers in apps/api/src/actions.ts)
// is covered; anything new still renders as a generic update.
export function describeNote(n: Note): { title: string; body: string; href: string | null } {
  const p = n.payload;
  switch (n.type) {
    case 'circle_event':
      return {
        title: 'New event in your circle',
        body: text(p.title),
        href: text(p.matchId) ? `/games/${encodeURIComponent(text(p.matchId))}` : '/explore',
      };
    case 'player_joined':
      return {
        title: 'A player joined your match',
        body: text(p.title),
        href: text(p.matchId) ? `/games/${encodeURIComponent(text(p.matchId))}` : '/explore',
      };
    case 'poll_created':
      return {
        title: 'New team poll',
        body: text(p.question),
        href: text(p.teamId) ? `/teams/${text(p.teamId)}` : '/teams',
      };
    case 'booking_answered': {
      const decision = text(p.decision);
      return {
        title:
          decision === 'confirm'
            ? 'Your booking was confirmed'
            : decision === 'decline'
              ? 'Your booking was declined'
              : 'Your booking was answered',
        body: '',
        href: text(p.venueId) ? `/venues/${text(p.venueId)}` : '/explore',
      };
    }
    case 'ticket_refunded':
      return {
        title: 'Your ticket was refunded',
        body: text(p.title),
        href: text(p.matchId) ? `/games/${encodeURIComponent(text(p.matchId))}` : '/explore',
      };
    case 'game_cancelled':
      return {
        title: 'A game you joined was cancelled',
        body: [text(p.title), text(p.reason)].filter(Boolean).join(' - '),
        href: text(p.matchId) ? `/games/${encodeURIComponent(text(p.matchId))}` : null,
      };
    case 'game_postponed': {
      const when = text(p.newDate) ? new Date(text(p.newDate)).toLocaleString() : '';
      return {
        title: text(p.newDate) ? 'A game you joined has a new time' : 'A game you joined was postponed',
        body: [text(p.title), when ? `now ${when}` : '', text(p.reason)].filter(Boolean).join(' - '),
        href: text(p.matchId) ? `/games/${encodeURIComponent(text(p.matchId))}` : '/explore',
      };
    }
    case 'scoreboard_appointed':
      return {
        title: 'You are running a scoreboard',
        body: text(p.title),
        href: text(p.boardId) ? `/scoreboard/${text(p.boardId)}/control` : null,
      };
    case 'scoreboard_replaced':
      return { title: 'Someone else is now running the scoreboard', body: text(p.title), href: null };
    case 'game_result':
      return {
        title: 'Final score',
        body: `${text(p.homeName)} ${text(p.home)} - ${text(p.away)} ${text(p.awayName)}`,
        href: text(p.matchId) ? `/games/${encodeURIComponent(text(p.matchId))}` : '/explore',
      };
    case 'game_venue_booked':
      return {
        title: 'The venue is booked for your game',
        body: [text(p.title), text(p.venue), text(p.spaceName)].filter(Boolean).join(' - '),
        href: text(p.matchId) ? `/games/${encodeURIComponent(text(p.matchId))}` : '/explore',
      };
    case 'space_booking_requested':
      return {
        title: p.instant ? 'New booking, waiting for payment' : 'New booking request',
        body: [text(p.title), text(p.spaceName), text(p.startsAt) ? new Date(text(p.startsAt)).toLocaleString() : ''].filter(Boolean).join(' - '),
        href: '/venues/dashboard',
      };
    case 'space_booking_accepted':
      return { title: 'The venue accepted your booking', body: [text(p.title), text(p.spaceName)].filter(Boolean).join(' - '), href: '/venues/dashboard' };
    case 'space_booking_paid':
      return { title: 'Your booking is confirmed', body: [text(p.title), text(p.spaceName), text(p.startsAt) ? new Date(text(p.startsAt)).toLocaleString() : ''].filter(Boolean).join(' - '), href: '/venues/dashboard' };
    case 'space_booking_cancelled':
      return { title: 'Your booking was cancelled', body: [text(p.title), text(p.spaceName)].filter(Boolean).join(' - '), href: '/venues/dashboard' };
    case 'space_booking_paid_owner':
      return { title: 'A booking was paid', body: [text(p.title), text(p.spaceName), text(p.startsAt) ? new Date(text(p.startsAt)).toLocaleString() : ''].filter(Boolean).join(' - '), href: '/venues/dashboard' };
    case 'booking_requested':
      return {
        title: 'New booking request',
        body: [text(p.title), text(p.startsAt) ? new Date(text(p.startsAt)).toLocaleString() : ''].filter(Boolean).join(' - '),
        href: '/venues/dashboard',
      };
    case 'venue_claim_pending':
      return { title: 'Someone claimed a venue', body: text(p.title), href: '/admin/venues' };
    case 'venue_claim_approved':
      return { title: 'Your venue claim was approved', body: text(p.title), href: '/venues/dashboard' };
    case 'venue_claim_rejected':
      return {
        title: 'Your venue claim was not approved',
        body: [text(p.title), text(p.note)].filter(Boolean).join(' - '),
        href: null,
      };
    case 'venue_pending':
      return { title: 'A venue is waiting for approval', body: text(p.title), href: '/admin/venues' };
    case 'venue_approved':
      return {
        title: 'Your venue was approved',
        body: text(p.title),
        href: text(p.venueId) ? `/venues/${text(p.venueId)}` : '/venues/dashboard',
      };
    case 'venue_rejected':
      return {
        title: 'Your venue was not approved',
        body: [text(p.title), text(p.note)].filter(Boolean).join(' - '),
        href: '/venues/dashboard',
      };
    case 'lineup_published': {
      const type = text(p.subjectType);
      const id = text(p.subjectId);
      return {
        title: text(p.teamName) ? `${text(p.teamName)} lineup is out` : 'The sides are picked',
        body: text(p.title),
        href: type === 'match' && id ? `/games/${id}` : type && id ? `/lineup/${type}/${id}` : null,
      };
    }
    case 'availability_requested':
      return {
        title: 'Are you available?',
        body: [text(p.title), text(p.startsAt) ? new Date(text(p.startsAt)).toLocaleString() : ''].filter(Boolean).join(' - '),
        href: text(p.subjectType) === 'match' && text(p.subjectId) ? `/games/${text(p.subjectId)}` : text(p.teamId) ? `/teams/${text(p.teamId)}` : null,
      };
    case 'team_join_request':
      return { title: `Someone wants to join ${text(p.teamName) || 'your team'}`, body: '', href: text(p.teamId) ? `/teams/${text(p.teamId)}?tab=admin` : null };
    case 'team_joined':
      return { title: `A new player joined ${text(p.teamName) || 'your team'}`, body: '', href: text(p.teamId) ? `/teams/${text(p.teamId)}?tab=squad` : null };
    case 'team_join_answered':
      return {
        title: text(p.decision) === 'accepted' ? `You are in ${text(p.teamName) || 'the team'}` : `${text(p.teamName) || 'The team'} said not this time`,
        body: '',
        href: text(p.decision) === 'accepted' && text(p.teamId) ? `/teams/${text(p.teamId)}` : null,
      };
    case 'team_ownership':
      return { title: `You now own ${text(p.teamName) || 'a team'}`, body: '', href: text(p.teamId) ? `/teams/${text(p.teamId)}` : null };
    case 'timekeeper_appointed':
      return { title: 'You are the timekeeper', body: text(p.title), href: text(p.boardId) ? `/scoreboard/${text(p.boardId)}/control` : null };
    case 'entry_received':
      return { title: `${text(p.teamName) || 'A team'} entered ${text(p.name)}`, body: text(p.status) === 'pending' ? 'Waiting for your approval.' : '', href: `/competitions/${text(p.competitionId)}?tab=manage` };
    case 'entry_reviewed':
      return {
        title: text(p.decision) === 'approved' ? `${text(p.teamName) || 'Your team'} is in ${text(p.name)}` : `${text(p.name)}: entry not accepted`,
        body: text(p.note),
        href: `/competitions/${text(p.competitionId)}`,
      };
    case 'entry_withdrawn':
      return { title: `A team withdrew from ${text(p.name)}`, body: '', href: `/competitions/${text(p.competitionId)}?tab=manage` };
    case 'competition_started':
      return { title: `${text(p.name)}: the fixtures are out`, body: '', href: `/competitions/${text(p.competitionId)}?tab=fixtures` };
    case 'knockout_drawn':
      return { title: `${text(p.name)}: the knockout is drawn`, body: '', href: `/competitions/${text(p.competitionId)}?tab=table` };
    case 'competition_cancelled':
      return { title: `${text(p.name)} was cancelled`, body: '', href: `/competitions/${text(p.competitionId)}` };
    case 'competition_won':
      return { title: `Champions of ${text(p.name)}`, body: 'Your team won it.', href: `/competitions/${text(p.competitionId)}?tab=table` };
    case 'fixture_scheduled':
    case 'fixture_postponed':
    case 'fixture_cancelled':
      return {
        title: n.type === 'fixture_cancelled' ? `${text(p.name)}: a game was cancelled` : n.type === 'fixture_postponed' ? `${text(p.name)}: a game was postponed` : `${text(p.name)}: game scheduled`,
        body: text(p.startsAt) ? new Date(text(p.startsAt)).toLocaleString() : '',
        href: `/competitions/${text(p.competitionId)}?tab=fixtures`,
      };
    case 'result_to_confirm':
      return { title: 'Confirm the result', body: `${text(p.name)}: reported ${String(p.home ?? '')}–${String(p.away ?? '')}`, href: `/competitions/${text(p.competitionId)}?tab=fixtures` };
    case 'result_disputed':
      return { title: 'A result is disputed', body: text(p.name), href: `/competitions/${text(p.competitionId)}?tab=manage` };
    case 'game_result_final':
      return { title: 'Result confirmed', body: `${text(p.name)}: ${String(p.home ?? '')}–${String(p.away ?? '')}`, href: `/competitions/${text(p.competitionId)}?tab=fixtures` };
    case 'series_game_added':
      return { title: `You’re in next week: ${text(p.title)}`, body: 'As a regular you’re added to each new game.', href: text(p.matchId) ? `/games/${text(p.matchId)}` : null };
    case 'result_posted':
      return { title: 'New result in a competition you follow', body: '', href: text(p.competitionId) ? `/competitions/${text(p.competitionId)}?tab=fixtures` : '/competitions' };
    default:
      return { title: 'Update', body: text(p.title), href: null };
  }
}

// Unread count for the nav badge. Refreshes on every route change and when
// the notifications page marks things read.
export function useUnreadCount(): number {
  const { user } = useAuth();
  const location = useLocation();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user || !supabase) {
      setCount(0);
      return;
    }
    const { count: n } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null);
    setCount(n ?? 0);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh, location.pathname]);

  useEffect(() => {
    const onRead = () => void refresh();
    window.addEventListener(READ_EVENT, onRead);
    return () => window.removeEventListener(READ_EVENT, onRead);
  }, [refresh]);

  return count;
}

export async function markAllRead(userId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (!error) window.dispatchEvent(new Event(READ_EVENT));
}
