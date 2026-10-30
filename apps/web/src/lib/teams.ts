import { challengeSchema, sportListSchema, teamSchema } from '@chabuka/shared';
import type { Challenge, Sport, Team, TeamRole } from '@chabuka/shared';
import { supabase } from './supabase';

export interface MyTeam {
  team: Team;
  role: TeamRole;
}

export interface ChallengeListing {
  challenge: Challenge;
  team: Team | null;
  opponent: Team | null;
  sport: Sport | null;
  myCaptainTeamIds: string[];
  myTeamIds: string[];
}

export async function fetchMyTeams(userId: string): Promise<MyTeam[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: memberships, error } = await supabase
    .from('team_members')
    .select('team_id,role')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  const rows = (memberships ?? []) as { team_id: string; role: TeamRole }[];
  if (rows.length === 0) return [];
  const { data: teamRows, error: teamErr } = await supabase
    .from('teams')
    .select('*')
    .in('id', rows.map((r) => r.team_id));
  if (teamErr) throw new Error(teamErr.message);
  const byId = new Map<string, Team>();
  for (const row of teamRows ?? []) {
    const parsed = teamSchema.safeParse(row);
    if (parsed.success) byId.set(parsed.data.id, parsed.data);
  }
  return rows
    .map((r) => {
      const team = byId.get(r.team_id);
      return team ? { team, role: r.role } : null;
    })
    .filter((t): t is MyTeam => t !== null);
}

export function isCaptainRole(role: TeamRole): boolean {
  return role === 'owner' || role === 'captain';
}

export async function fetchOpenChallenges(userId: string): Promise<ChallengeListing[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const mine = await fetchMyTeams(userId);
  const myCaptainTeamIds = mine.filter((m) => isCaptainRole(m.role)).map((m) => m.team.id);
  const myTeamIds = mine.map((m) => m.team.id);

  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .in('status', ['open', 'reschedule_proposed'])
    .gte('window_end', new Date().toISOString())
    .order('window_start', { ascending: true });
  if (error) throw new Error(error.message);
  const challenges = (data ?? [])
    .map((row) => {
      const parsed = challengeSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((c): c is Challenge => c !== null);
  if (challenges.length === 0) return [];

  const teamIds = [
    ...new Set(challenges.flatMap((c) => [c.team_id, c.opponent_team_id].filter(Boolean) as string[])),
  ];
  const { data: teamRows } = await supabase.from('teams').select('*').in('id', teamIds);
  const teamById = new Map<string, Team>();
  for (const row of teamRows ?? []) {
    const parsed = teamSchema.safeParse(row);
    if (parsed.success) teamById.set(parsed.data.id, parsed.data);
  }
  const { data: sportRows } = await supabase.from('sports').select('id,name,formats');
  const sports = sportListSchema.safeParse(sportRows);
  const sportById = new Map<string, Sport>(
    sports.success ? sports.data.map((s) => [s.id, s]) : [],
  );

  return challenges.map((challenge) => ({
    challenge,
    team: teamById.get(challenge.team_id) ?? null,
    opponent: challenge.opponent_team_id ? (teamById.get(challenge.opponent_team_id) ?? null) : null,
    sport: sportById.get(challenge.sport_id) ?? null,
    myCaptainTeamIds,
    myTeamIds,
  }));
}
