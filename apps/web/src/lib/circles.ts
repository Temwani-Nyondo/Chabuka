import { circleSchema, matchSchema } from '@chabuka/shared';
import type { Circle, Match } from '@chabuka/shared';
import { supabase } from './supabase';

export interface CircleListing {
  circle: Circle;
  memberCount: number;
  isMember: boolean;
}

export async function fetchCircles(userId: string): Promise<CircleListing[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('circles').select('*').order('created_at', { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  const circles = (data ?? [])
    .map((row) => {
      const parsed = circleSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((c): c is Circle => c !== null);
  if (circles.length === 0) return [];
  const { data: memberRows } = await supabase
    .from('circle_members')
    .select('circle_id,user_id')
    .in('circle_id', circles.map((c) => c.id));
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const row of (memberRows ?? []) as { circle_id: string; user_id: string }[]) {
    counts.set(row.circle_id, (counts.get(row.circle_id) ?? 0) + 1);
    if (row.user_id === userId) mine.add(row.circle_id);
  }
  return circles.map((circle) => ({
    circle,
    memberCount: counts.get(circle.id) ?? 0,
    isMember: mine.has(circle.id),
  }));
}

export async function fetchCircleEvents(circleId: string): Promise<Match[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('circle_id', circleId)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => {
      const parsed = matchSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((m): m is Match => m !== null);
}
