import type { GolfDaySettings, GolfHole } from '@chabuka/shared';
import { API_BASE } from './api';

// Golf: course cards (G1). Later parts (tee sheet, golf days, scorecards) add their calls here.

export interface CourseView {
  id: string;
  venueId: string | null;
  name: string;
  holes: 9 | 18;
  teeSet: string | null;
  par: number;
  card: GolfHole[];
  venueName?: string | null;
}

async function call<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}, fallback = 'Something went wrong.'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new Error('Could not reach the Chabuka server.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? fallback);
  return data as T;
}

export const fetchVenueCourses = (token: string, venueId: string) =>
  call<{ courses: CourseView[] }>(`/api/venues/${venueId}/golf-courses`, token, {}, 'Could not load the course.').then((r) => r.courses);

export const fetchPickableCourses = (token: string) =>
  call<{ courses: CourseView[] }>('/api/golf/courses', token, {}, 'Could not load courses.').then((r) => r.courses);

export const saveCourse = (
  token: string,
  input: { courseId?: string; venueId?: string | null; name: string; holes: 9 | 18; teeSet?: string | null; card: GolfHole[] },
) => call<{ course: CourseView }>('/api/golf/courses', token, { method: 'POST', body: input }, 'Could not save the course.').then((r) => r.course);

export const deleteCourse = (token: string, courseId: string) =>
  call<{ state: string }>(`/api/golf/courses/${courseId}`, token, { method: 'DELETE' }, 'Could not remove the course.');

// --- Golf days (G3/G4) -------------------------------------------------------------------------------


export interface GolfDayView {
  golfDay: {
    id: string;
    name: string;
    status: string;
    area: string | null;
    location: string | null;
    description: string | null;
    banner_url: string | null;
    circle_id: string | null;
    host_name: string | null;
    cause_name: string | null;
    registration_closes_at: string | null;
    waitapp_checkout_url: string | null;
    organiser_id: string;
  };
  settings: GolfDaySettings;
  course: CourseView;
  isOrganiser: boolean;
  published: boolean;
  entered: number;
  field: { entryId: string; name: string; handicapIndex: number; playingHcp: number; flightId: string | null }[];
  flights: { id: string; label: string; teeTime: string | null; startHole: number; scorerEntryId: string | null; entryIds: string[] }[];
  leaderboard: {
    entryId: string;
    name: string;
    playingHcp: number;
    position: string;
    thru: number;
    gross: number | null;
    net: number | null;
    points: number;
    toPar: number | null;
    holes: { holeNo: number; gross: number | null; played: boolean; points: number; received: number }[];
  }[];
  sideResults: { type: string; hole: number; winner: string | null; note: string | null }[];
  mine: { entryId: string; name: string; status: string; flightId: string | null; handicapIndex: number }[];
  scorerFlights: string[];
}

export const fetchGolfDay = (token: string, id: string) => call<GolfDayView>(`/api/golf-days/${id}`, token, {}, 'Golf day not found.');
export const fetchGolfEntries = (token: string, id: string) =>
  call<{ entries: { entryId: string; name: string; handicapIndex: number; phone: string | null; status: string; flightId: string | null; paid: boolean }[] }>(
    `/api/golf-days/${id}/entries`,
    token,
    {},
    'Could not load the entries.',
  ).then((r) => r.entries);

export const golfPost = <T = Record<string, unknown>>(token: string, path: string, body: unknown, fallback = 'Something went wrong.') =>
  call<T>(`/api/golf-days${path}`, token, { method: 'POST', body }, fallback);

// --- Rounds and the golf record (G5) -----------------------------------------------------------------------

export interface MyGolf {
  record: { rounds: number; bestGross: number | null; bestNet: number | null; bestPoints: number | null; averageGross: number | null };
  rounds: { id: string; courseName: string; playedOn: string; holes: 9 | 18; gross: number | null; net: number | null; points: number | null; source: 'casual' | 'golf_day' }[];
  golfDays: { id: string; name: string; firstTeeAt: string | null }[];
  teeTimes: { bookingId: string; venueId: string; startsAt: string; players: number | null; status: string }[];
}

export const fetchMyGolf = (token: string) => call<MyGolf>('/api/me/golf', token, {}, 'Could not load your golf.');
export const logRound = (token: string, input: { courseId: string; playedOn: string; handicapIndex?: number | null; scores?: Record<string, number | null>; total?: number | null }) =>
  call<{ state: string; gross: number | null; net: number | null; points: number | null }>('/api/golf/rounds', token, { method: 'POST', body: input }, 'Could not save the round.');
export const deleteRound = (token: string, id: string) => call<{ state: string }>(`/api/golf/rounds/${id}`, token, { method: 'DELETE' }, 'Could not remove the round.');
