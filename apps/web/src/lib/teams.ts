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

export interface TeamMemberDetail {
  userId: string;
  role: TeamRole;
  position: string | null;
  name: string | null;
  photoUrl: string | null;
}

export interface TeamFixture {
  kind: 'challenge' | 'fixture';
  id: string;
  startsAt: string | null;
  competition: string | null;
  opponentId: string | null;
  opponentName: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  isHome: boolean | null;
}

export interface TeamDetail {
  team: Team;
  myRole: TeamRole | null;
  members: TeamMemberDetail[];
  fixtures: TeamFixture[];
}

export async function fetchTeamDetail(teamId: string, userId: string): Promise<TeamDetail> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: teamRow, error: teamErr } = await supabase
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .maybeSingle();
  if (teamErr) throw new Error(teamErr.message);
  const team = teamSchema.safeParse(teamRow);
  if (!team.success) throw new Error('Team not found.');

  const { data: memberRows, error: memberErr } = await supabase
    .from('team_members')
    .select('user_id,role,position')
    .eq('team_id', teamId);
  if (memberErr) throw new Error(memberErr.message);
  const memberList = (memberRows ?? []) as {
    user_id: string;
    role: TeamRole;
    position: string | null;
  }[];
  const myRole = memberList.find((m) => m.user_id === userId)?.role ?? null;

  const profileMap = new Map<string, { name: string | null; photoUrl: string | null }>();
  const ids = memberList.map((m) => m.user_id);
  if (ids.length > 0) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id,name,photo_url')
      .in('id', ids);
    for (const p of (profileRows ?? []) as { id: string; name: string | null; photo_url: string | null }[]) {
      profileMap.set(p.id, { name: p.name, photoUrl: p.photo_url });
    }
  }
  const members: TeamMemberDetail[] = memberList.map((m) => ({
    userId: m.user_id,
    role: m.role,
    position: m.position,
    name: profileMap.get(m.user_id)?.name ?? null,
    photoUrl: profileMap.get(m.user_id)?.photoUrl ?? null,
  }));

  const { data: challengeRows } = await supabase
    .from('challenges')
    .select('*')
    .or(`team_id.eq.${teamId},opponent_team_id.eq.${teamId}`)
    .order('window_start', { ascending: false })
    .limit(20);
  const challengeList = (challengeRows ?? [])
    .map((row) => challengeSchema.safeParse(row))
    .filter((p) => p.success)
    .map((p) => p.data);

  const entryCompIds = new Set<string>();
  const { data: entryRows } = await supabase
    .from('competition_entries')
    .select('competition_id')
    .eq('team_id', teamId);
  for (const e of (entryRows ?? []) as { competition_id: string }[]) {
    entryCompIds.add(e.competition_id);
  }
  const compNames = new Map<string, string>();
  let fixtureRows: {
    id: string;
    competition_id: string;
    home_team_id: string;
    away_team_id: string;
    starts_at: string | null;
    home_score: number | null;
    away_score: number | null;
    status: string;
  }[] = [];
  if (entryCompIds.size > 0) {
    const ids_ = [...entryCompIds];
    const [{ data: compRows }, { data: fixRows }] = await Promise.all([
      supabase.from('competitions').select('id,name').in('id', ids_),
      supabase
        .from('fixtures')
        .select('id,competition_id,home_team_id,away_team_id,starts_at,home_score,away_score,status')
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .in('competition_id', ids_)
        .order('starts_at', { ascending: false })
        .limit(30),
    ]);
    for (const c of (compRows ?? []) as { id: string; name: string }[]) compNames.set(c.id, c.name);
    fixtureRows = (fixRows ?? []) as typeof fixtureRows;
  }

  const teamIds = new Set<string>();
  for (const c of challengeList) {
    if (c.opponent_team_id) teamIds.add(c.opponent_team_id);
    if (c.team_id !== teamId) teamIds.add(c.team_id);
  }
  for (const f of fixtureRows) {
    teamIds.add(f.home_team_id === teamId ? f.away_team_id : f.home_team_id);
  }
  teamIds.delete(teamId);
  const teamNames = new Map<string, string>();
  if (teamIds.size > 0) {
    const { data: nameRows } = await supabase
      .from('teams')
      .select('id,name')
      .in('id', [...teamIds]);
    for (const t of (nameRows ?? []) as { id: string; name: string }[]) teamNames.set(t.id, t.name);
  }

  const fixtures: TeamFixture[] = [
    ...challengeList.map((c): TeamFixture => {
      const isHome = c.team_id === teamId;
      const opponentId = isHome ? c.opponent_team_id : c.team_id;
      return {
        kind: 'challenge' as const,
        id: c.id,
        startsAt: c.proposed_starts_at ?? c.window_start,
        competition: null,
        opponentId: opponentId ?? null,
        opponentName: opponentId ? (teamNames.get(opponentId) ?? 'TBD') : 'Open challenge',
        homeScore: null,
        awayScore: null,
        status: c.status,
        isHome,
      };
    }),
    ...fixtureRows.map((f): TeamFixture => {
      const isHome = f.home_team_id === teamId;
      const opponentId = isHome ? f.away_team_id : f.home_team_id;
      return {
        kind: 'fixture' as const,
        id: f.id,
        startsAt: f.starts_at,
        competition: compNames.get(f.competition_id) ?? null,
        opponentId,
        opponentName: teamNames.get(opponentId) ?? 'Unknown',
        homeScore: f.home_score,
        awayScore: f.away_score,
        status: f.status,
        isHome,
      };
    }),
  ].sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''));

  return { team: team.data, myRole, members, fixtures };
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
