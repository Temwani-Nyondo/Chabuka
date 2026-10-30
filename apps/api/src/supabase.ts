import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (API server environment).`);
  return value;
}

// Every write acts as the signed-in user, so Row Level Security does the
// permission check. The service role key stays out of player actions.
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(readEnv('SUPABASE_URL'), readEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
