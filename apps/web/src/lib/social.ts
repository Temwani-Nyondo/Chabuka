import type { Circle, NotifyLevel, ProfileVisibility, Reaction } from '@chabuka/shared';
import { API_BASE } from './api';

// Phase 5 reads: circles as channels, creators, the Following feed, player profiles. Writes go through runAction.

export type ReactionCounts = Record<Reaction, number>;

export interface CircleSummary {
  circle: Circle;
  memberCount: number;
  isMember: boolean;
  /** Set when the viewer runs this circle. */
  role?: 'owner' | 'admin' | null;
  removed: boolean;
  notify: NotifyLevel | null;
  unread: number;
  last: { body: string; at: string; kind: string } | null;
}

export interface CircleView {
  circle: Circle;
  role: 'owner' | 'admin' | null;
  isMember: boolean;
  removed: boolean;
  notify: NotifyLevel;
  memberCount: number;
  admins: { userId: string; role: string; name: string; photo: string | null }[];
  members: { userId: string; name: string; photo: string | null; since: string }[];
  pinnedPostId: string | null;
  games: { id: string; title: string; starts_at: string; status: string; venue_name: string | null; area: string | null }[];
  events: { id: string; name: string; kind: string; starts_on: string; status: string; banner_url: string | null }[];
}

export interface CirclePost {
  id: string;
  kind: string;
  body: string;
  images: string[];
  important: boolean;
  pinned: boolean;
  createdAt: string;
  editedAt: string | null;
  author: { id: string; name: string; photo: string | null } | null;
  mine: boolean;
  reactions: ReactionCounts;
  myReactions: Reaction[];
  poll: { options: string[]; closesAt: string | null; tally: number[]; myVote: number | null } | null;
  link: { type: string; id: string; data: Record<string, unknown> | null } | null;
}

export interface CreatorPostView {
  id: string;
  kind: 'post' | 'article';
  title: string;
  body: string;
  excerpt: string;
  coverUrl: string | null;
  images: string[];
  status: string;
  publishedAt: string | null;
  editedAt: string | null;
  reactions: ReactionCounts;
  myReactions: Reaction[];
  words: number;
}

export interface CreatorView {
  creator: { userId: string; handle: string; displayName: string; bio: string; avatarUrl: string | null; bannerUrl: string | null; sports: string[]; links: string[]; status: string };
  self: boolean;
  followers: number;
  following: boolean;
  posts: CreatorPostView[];
}

export type FeedItem =
  | { type: 'creator_post'; at: string; creator: { handle: string; displayName: string; avatarUrl: string | null }; post: CreatorPostView }
  | { type: 'team_result'; at: string; competitionId: string; home: string; away: string; homeScore: number | null; awayScore: number | null }
  | { type: 'team_fixture'; at: string; competitionId: string; home: string; away: string; homeScore: number | null; awayScore: number | null }
  | { type: 'event_news'; at: string; competitionId: string; kind: string; name: string; text: string }
  | { type: 'race_results'; at: string; competitionId: string; name: string; distance: string };

export interface PlayerView {
  id: string;
  name: string;
  photoUrl: string | null;
  coverUrl: string | null;
  relation: 'self' | 'connection' | 'other';
  visible: boolean;
  blockedByMe: boolean;
  visibility: ProfileVisibility | null;
  sports?: { name: string; level: string | null }[];
  teams?: { id: string; name: string; logo_url: string | null }[];
  record?: { played: number; recent: { id: string; title: string; starts_at: string; home_score: number | null; away_score: number | null }[] };
  stats?: import('./records').MyRecordView;
  races?: { raceId: string; race: string; distance: string; km: number; date: string; seconds: number | null; status: string; position: number | null }[];
}

async function get<T>(path: string, token: string, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Could not reach the Chabuka server.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? fallback);
  return data as T;
}

export const fetchCircleList = (token: string) => get<{ yours: CircleSummary[]; discover: CircleSummary[] }>('/api/circles', token, 'Could not load circles.');
export const fetchCircleView = (token: string, id: string) => get<CircleView>(`/api/circles/${id}`, token, 'Could not load the circle.');
export const fetchCirclePosts = (token: string, id: string, before?: string) =>
  get<{ posts: CirclePost[]; hasMore: boolean }>(`/api/circles/${id}/posts${before ? `?before=${encodeURIComponent(before)}` : ''}`, token, 'Could not load posts.');
export const fetchCreator = (token: string, handle: string) => get<CreatorView>(`/api/creators/${encodeURIComponent(handle)}`, token, 'Creator not found.');
export const fetchCreatorPost = (token: string, id: string) =>
  get<{ creator: { userId: string; handle: string; displayName: string; avatarUrl: string | null }; following: boolean; self: boolean; post: CreatorPostView }>(`/api/creator-posts/${id}`, token, 'Post not found.');
export const fetchMyCreator = (token: string) =>
  get<{ creator: { handle: string; displayName: string; status: string; reviewNote: string | null } | null }>('/api/me/creator', token, 'Could not load.').then((r) => r.creator);
export const fetchFollowing = (token: string) => get<{ items: FeedItem[]; follows: number }>('/api/following', token, 'Could not load your feed.');
export const fetchPlayer = (token: string, id: string) => get<PlayerView>(`/api/players/${id}`, token, 'Player not found.');
export const fetchFollowState = (token: string, type: string, id: string) => get<{ following: boolean; followers: number }>(`/api/follow-state/${type}/${id}`, token, 'Could not load.');
export const fetchCreatorApplications = (token: string, status: string) =>
  get<{ user_id: string; handle: string; display_name: string; bio: string; pitch: string | null; links: string[]; sports: string[]; status: string; review_note: string | null; account_name: string | null; created_at: string }[]>(
    `/api/admin/creators?status=${status}`,
    token,
    'Could not load applications.',
  );

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
