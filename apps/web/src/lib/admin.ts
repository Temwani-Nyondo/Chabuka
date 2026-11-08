import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { API_BASE } from './api';

// Platform admin helpers. The server decides who is an admin (platform_admins
// table); the web app only asks, so hiding a link here is convenience, never
// the security boundary.

export interface ReviewVenueRow {
  id: string;
  name: string;
  area: string | null;
  sports: string[];
  facility_types: string[];
  contact: string | null;
  lat: number | null;
  lng: number | null;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  owner_name: string | null;
}

async function adminCall<T>(path: string, method: string, token: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Could not reach the Chabuka server. Is the API running?');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? 'Something went wrong. Try again.');
  return data as T;
}

export async function fetchVenuesForReview(
  token: string,
  status: 'pending' | 'approved' | 'rejected',
): Promise<ReviewVenueRow[]> {
  return (await adminCall<{ venues: ReviewVenueRow[] }>(`/api/admin/venues?status=${status}`, 'GET', token)).venues;
}

export async function reviewVenueAction(
  token: string,
  venueId: string,
  decision: 'approve' | 'reject',
  note?: string,
): Promise<void> {
  await adminCall(`/api/admin/venues/${venueId}/review`, 'POST', token, { decision, ...(note ? { note } : {}) });
}

export function useIsAdmin(): boolean {
  const { session } = useAuth();
  const token = session?.access_token;
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (!token) {
      setAdmin(false);
      return;
    }
    let cancelled = false;
    adminCall<{ admin: boolean }>('/api/admin/me', 'GET', token)
      .then((r) => {
        if (!cancelled) setAdmin(r.admin);
      })
      .catch(() => {
        if (!cancelled) setAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return admin;
}
