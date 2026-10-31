import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Agent access tokens (brief section 10). Raw tokens look like
// `chb_agent_<32 hex>` and are shown once; only the SHA-256 hex hash is
// stored, and revoked_at ends a token.

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function mintToken(): string {
  return `chb_agent_${randomBytes(16).toString('hex')}`;
}

export async function resolveAgentUser(
  service: SupabaseClient,
  rawToken: string,
): Promise<string | null> {
  const { data, error } = await service
    .from('api_tokens')
    .select('user_id,revoked_at')
    .eq('token_hash', hashToken(rawToken))
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { user_id: string; revoked_at: string | null } | null;
  if (!row || row.revoked_at) return null;
  return row.user_id;
}

export async function createAgentToken(
  db: SupabaseClient,
  userId: string,
  label: string,
): Promise<{ token: string }> {
  const token = mintToken();
  const { error } = await db
    .from('api_tokens')
    .insert({ user_id: userId, token_hash: hashToken(token), label });
  if (error) throw new Error(error.message);
  return { token };
}

export async function listAgentTokens(db: SupabaseClient, userId: string): Promise<unknown[]> {
  const { data, error } = await db
    .from('api_tokens')
    .select('id,label,created_at,revoked_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown[] | null) ?? [];
}

export async function revokeAgentToken(
  db: SupabaseClient,
  userId: string,
  tokenId: string,
): Promise<void> {
  const { error } = await db
    .from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}
