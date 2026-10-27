import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Null until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set; the router
// shows a setup notice instead of crashing.
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
