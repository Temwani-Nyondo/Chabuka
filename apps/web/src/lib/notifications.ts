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
        href: text(p.matchId) ? `/explore?highlight=${encodeURIComponent(text(p.matchId))}` : '/explore',
      };
    case 'player_joined':
      return {
        title: 'A player joined your match',
        body: text(p.title),
        href: text(p.matchId) ? `/explore?highlight=${encodeURIComponent(text(p.matchId))}` : '/explore',
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
    case 'result_posted':
      return { title: 'New result on a board you follow', body: '', href: '/board' };
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
