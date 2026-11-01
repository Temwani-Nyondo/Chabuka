import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { profileSchema } from '@chabuka/shared';
import type { Profile } from '@chabuka/shared';
import { supabase } from '../lib/supabase';

interface AuthValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  sportsCount: number;
  needsOnboarding: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithOAuth: (provider: 'facebook' | 'google') => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

async function fetchProfile(userId: string): Promise<{ profile: Profile | null; sportsCount: number }> {
  if (!supabase) return { profile: null, sportsCount: 0 };
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  let profile: Profile | null = null;
  if (data) {
    const parsed = profileSchema.safeParse(data);
    if (parsed.success) profile = parsed.data;
  }
  const { count } = await supabase
    .from('user_sports')
    .select('sport_id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return { profile, sportsCount: count ?? 0 };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sportsCount, setSportsCount] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async (s: Session | null) => {
      setSession(s);
      if (s?.user) {
        const { profile: p, sportsCount: n } = await fetchProfile(s.user.id);
        if (cancelled) return;
        setProfile(p);
        setSportsCount(n);
      } else {
        setProfile(null);
        setSportsCount(0);
      }
      if (!cancelled) setLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => {
      void load(data.session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      void load(s);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = async () => {
    if (!session?.user) return;
    const { profile: p, sportsCount: n } = await fetchProfile(session.user.id);
    setProfile(p);
    setSportsCount(n);
  };

  // Social sign-in through Supabase Auth's built-in providers. No custom
  // OAuth code anywhere: the App ID/secret live in Supabase settings.
  // Password sign-in sends no email, so Supabase's email rate limits
  // never apply. This is the scalable path for real users.
  const signInWithPassword = async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signInWithOAuth = async (provider: 'facebook' | 'google') => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const user = session?.user ?? null;
  const needsOnboarding =
    user !== null && (!profile || !profile.name || !profile.area || sportsCount === 0);

  return (
    <AuthContext.Provider
      value={{ loading, session, user, profile, sportsCount, needsOnboarding, signInWithPassword, signInWithOAuth, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}
