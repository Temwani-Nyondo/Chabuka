// Entering a Chabuka race or golf day from WaitApp, without leaving WaitApp.
//
// WaitApp shows the entry form (from entryForm, public) and posts the filled-in details here server-to-server,
// signed with the partner secret (same scheme as WaitApp's webhooks). The entry is made by the same enterRace /
// enterGolfDay code as on Chabuka, so every rule (age per distance, handicap limit, field size, required questions,
// waiver) applies. It is a guest entry: no Chabuka account, the WaitApp customer's email instead. A paid entry comes
// back with a WaitApp checkout URL carrying the entry reference, so the ticket confirms that exact entry.
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ActionError } from './actions.js';
import { enterRace, raceEntryForm } from './races.js';
import { enterGolfDay, golfEntryForm } from './golfDays.js';

async function kindOf(svc: SupabaseClient, competitionId: string): Promise<'race' | 'golf_day'> {
  const { data } = await svc.from('competitions').select('kind').eq('id', competitionId).maybeSingle();
  const kind = (data as { kind?: string } | null)?.kind;
  if (kind === 'race' || kind === 'golf_day') return kind;
  throw new ActionError(404, 'Nothing to enter here.');
}

export async function entryForm(svc: SupabaseClient, competitionId: string, now = new Date()) {
  const id = z.string().uuid().safeParse(competitionId);
  if (!id.success) throw new ActionError(404, 'Nothing to enter here.');
  return (await kindOf(svc, id.data)) === 'race' ? raceEntryForm(svc, id.data, now) : golfEntryForm(svc, id.data, now);
}

const guestEntrySchema = z.object({
  competitionId: z.string().uuid(),
  /** The WaitApp customer: how the organiser reaches a guest entrant. */
  email: z.string().trim().email('Add an email').max(200),
  /** The entry fields, exactly as Chabuka's own form sends them (enterRaceSchema / enterGolfDaySchema). */
  entry: z.record(z.string(), z.unknown()),
});

export async function guestEntry(svc: SupabaseClient, raw: unknown, deps: { now?: Date } = {}) {
  const input = guestEntrySchema.parse(raw);
  const body = { ...input.entry, competitionId: input.competitionId };
  const kind = await kindOf(svc, input.competitionId);
  const out = kind === 'race'
    ? await enterRace(svc, null, body, { ...deps, guestEmail: input.email })
    : await enterGolfDay(svc, null, body, { ...deps, guestEmail: input.email });
  return { kind, ...out };
}
