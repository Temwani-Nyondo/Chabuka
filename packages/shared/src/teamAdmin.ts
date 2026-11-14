import { z } from 'zod';

// --- Team administration, availability, lineups and rule books (Phase 2) ---

export const JOIN_POLICIES = ['invite', 'request', 'open'] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];
export const JOIN_POLICY_LABELS: Record<JoinPolicy, string> = {
  invite: 'Invite only',
  request: 'Players can ask to join',
  open: 'Anyone can join',
};

export const LINEUP_SUBJECTS = ['fixture', 'match'] as const;
export type LineupSubject = (typeof LINEUP_SUBJECTS)[number];

export const AVAILABILITY = ['in', 'maybe', 'out'] as const;
export type Availability = (typeof AVAILABILITY)[number];

// --- Formations ---------------------------------------------------------------
// Coordinates are percentages on a portrait half/pitch where the team attacks
// upwards: x 0..100 left to right, y 0 = the opponent's goal end, 100 = own goal.

export interface FormationSlot {
  role: string;
  x: number;
  y: number;
}

export interface Formation {
  key: string;
  label: string;
  slots: FormationSlot[];
}

const GK = (y = 92): FormationSlot => ({ role: 'GK', x: 50, y });
const row = (role: string, y: number, xs: number[]): FormationSlot[] => xs.map((x) => ({ role, x, y }));

const FOOTBALL_11: Formation[] = [
  { key: '4-4-2', label: '4-4-2', slots: [GK(), ...row('DEF', 74, [14, 38, 62, 86]), ...row('MID', 48, [14, 38, 62, 86]), ...row('FWD', 20, [36, 64])] },
  { key: '4-3-3', label: '4-3-3', slots: [GK(), ...row('DEF', 74, [14, 38, 62, 86]), ...row('MID', 50, [26, 50, 74]), ...row('FWD', 20, [18, 50, 82])] },
  { key: '3-5-2', label: '3-5-2', slots: [GK(), ...row('DEF', 76, [24, 50, 76]), ...row('MID', 50, [10, 30, 50, 70, 90]), ...row('FWD', 20, [36, 64])] },
  { key: '4-2-3-1', label: '4-2-3-1', slots: [GK(), ...row('DEF', 76, [14, 38, 62, 86]), ...row('MID', 58, [36, 64]), ...row('MID', 38, [18, 50, 82]), ...row('FWD', 16, [50])] },
];

const FOOTBALL_7: Formation[] = [
  { key: '2-3-1', label: '2-3-1', slots: [GK(), ...row('DEF', 70, [30, 70]), ...row('MID', 45, [18, 50, 82]), ...row('FWD', 18, [50])] },
  { key: '3-2-1', label: '3-2-1', slots: [GK(), ...row('DEF', 70, [20, 50, 80]), ...row('MID', 45, [32, 68]), ...row('FWD', 18, [50])] },
  { key: '2-2-2', label: '2-2-2', slots: [GK(), ...row('DEF', 70, [30, 70]), ...row('MID', 46, [30, 70]), ...row('FWD', 20, [30, 70])] },
];

const FOOTBALL_5: Formation[] = [
  { key: '2-1-1', label: '2-1-1', slots: [GK(), ...row('DEF', 66, [27, 73]), ...row('MID', 42, [50]), ...row('FWD', 18, [50])] },
  { key: '1-2-1', label: '1-2-1', slots: [GK(), ...row('DEF', 66, [50]), ...row('MID', 42, [22, 78]), ...row('FWD', 18, [50])] },
  { key: '2-2', label: '2-2', slots: [GK(), ...row('DEF', 62, [27, 73]), ...row('FWD', 26, [27, 73])] },
];

const BASKETBALL: Formation[] = [
  {
    key: 'standard',
    label: 'Standard',
    slots: [
      { role: 'PG', x: 50, y: 70 },
      { role: 'SG', x: 20, y: 52 },
      { role: 'SF', x: 80, y: 52 },
      { role: 'PF', x: 30, y: 26 },
      { role: 'C', x: 70, y: 26 },
    ],
  },
  {
    key: 'zone-2-3',
    label: '2-3 zone',
    slots: [
      { role: 'G', x: 32, y: 40 },
      { role: 'G', x: 68, y: 40 },
      { role: 'F', x: 16, y: 72 },
      { role: 'C', x: 50, y: 78 },
      { role: 'F', x: 84, y: 72 },
    ],
  },
];

const NETBALL: Formation[] = [
  {
    key: 'standard',
    label: 'Standard',
    slots: [
      { role: 'GS', x: 50, y: 10 },
      { role: 'GA', x: 30, y: 26 },
      { role: 'WA', x: 72, y: 36 },
      { role: 'C', x: 50, y: 50 },
      { role: 'WD', x: 28, y: 64 },
      { role: 'GD', x: 70, y: 74 },
      { role: 'GK', x: 50, y: 90 },
    ],
  },
];

// Players per side on the field, read from the game's format ("5v5", "7-a-side")
// with a sensible default per sport.
export function sideSizeFor(sport: string | null | undefined, format?: string | null): number | null {
  const s = (sport ?? '').toLowerCase();
  const f = (format ?? '').toLowerCase();
  const m = f.match(/(\d{1,2})\s*(?:v|vs|x|-a-side|a side|-side)/);
  const n = m ? Number(m[1]) : null;
  if (s.includes('basket')) return 5;
  if (s.includes('netball')) return 7;
  if (s.includes('futsal')) return 5;
  if (s.includes('football') || s.includes('soccer')) return n && n >= 4 && n <= 11 ? n : 11;
  return n && n >= 2 && n <= 15 ? n : null;
}

// Formations offered for a sport and format. Sizes without a hand-made shape
// get an even spread so any game can still have a lineup.
export function formationsFor(sport: string | null | undefined, format?: string | null): Formation[] {
  const s = (sport ?? '').toLowerCase();
  if (s.includes('basket')) return BASKETBALL;
  if (s.includes('netball')) return NETBALL;
  const size = sideSizeFor(sport, format);
  if (!size) return [];
  if (s.includes('football') || s.includes('futsal') || s.includes('soccer')) {
    if (size === 11) return FOOTBALL_11;
    if (size === 7) return FOOTBALL_7;
    if (size === 5) return FOOTBALL_5;
  }
  return [{ key: 'spread', label: `${size} players`, slots: spread(size) }];
}

function spread(size: number): FormationSlot[] {
  const perRow = Math.ceil(Math.sqrt(size));
  const rows = Math.ceil(size / perRow);
  const slots: FormationSlot[] = [];
  for (let i = 0; i < size; i += 1) {
    const r = Math.floor(i / perRow);
    const inRow = Math.min(perRow, size - r * perRow);
    const c = i % perRow;
    slots.push({ role: 'P', x: Math.round(((c + 1) / (inRow + 1)) * 100), y: Math.round(((r + 1) / (rows + 1)) * 80 + 10) });
  }
  return slots;
}

// --- Inputs ---------------------------------------------------------------------

const uuid = z.string().uuid();

export const availabilityResponseSchema = z.object({
  subjectType: z.enum(LINEUP_SUBJECTS),
  subjectId: uuid,
  status: z.enum(AVAILABILITY),
  note: z.string().trim().max(140).optional(),
});
export type AvailabilityResponseInput = z.infer<typeof availabilityResponseSchema>;

export const lineupSlotSchema = z.object({
  role: z.string().trim().min(1).max(12),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  userId: uuid.nullable(),
});
export type LineupSlot = z.infer<typeof lineupSlotSchema>;

export const saveLineupSchema = z.object({
  subjectType: z.enum(LINEUP_SUBJECTS),
  subjectId: uuid,
  side: z.enum(['home', 'away']),
  formation: z.string().trim().min(1).max(20),
  slots: z.array(lineupSlotSchema).min(1).max(15),
  bench: z.array(uuid).max(30).default([]),
  publish: z.boolean().default(false),
});
export type SaveLineupInput = z.infer<typeof saveLineupSchema>;

export const joinTeamSchema = z.object({ teamId: uuid, message: z.string().trim().max(200).optional() });
export const respondJoinRequestSchema = z.object({ requestId: uuid, decision: z.enum(['accept', 'decline']) });
export const setShirtNumberSchema = z.object({ teamId: uuid, userId: uuid, number: z.number().int().min(1).max(99).nullable() });
export const transferOwnershipSchema = z.object({ teamId: uuid, userId: uuid });
export const teamSettingsSchema = z.object({
  teamId: uuid,
  joinPolicy: z.enum(JOIN_POLICIES).optional(),
  kitColour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour')
    .nullable()
    .optional(),
});

export const ruleItemSchema = z.object({
  title: z.string().trim().min(1, 'Each rule needs a title').max(80),
  body: z.string().trim().max(600),
});
export type RuleItem = z.infer<typeof ruleItemSchema>;

export const RULE_TARGETS = ['match', 'competition', 'team'] as const;
export const saveRuleBookSchema = z.object({
  target: z.object({ type: z.enum(RULE_TARGETS), id: uuid }),
  title: z.string().trim().min(1, 'Give the rule book a name').max(80),
  rules: z.array(ruleItemSchema).min(1, 'Add at least one rule').max(40),
});
export type SaveRuleBookInput = z.infer<typeof saveRuleBookSchema>;

// A lineup is valid when every placed or benched player is eligible, nobody is
// listed twice, and the shape matches the formation the captain picked.
export function validateLineup(
  input: Pick<SaveLineupInput, 'slots' | 'bench' | 'formation'>,
  eligible: ReadonlySet<string>,
  formations: Formation[],
): string | null {
  const shape = formations.find((f) => f.key === input.formation);
  if (formations.length > 0 && !shape) return 'Pick one of the formations offered for this game.';
  if (shape && shape.slots.length !== input.slots.length) return `This formation has ${shape.slots.length} positions.`;
  const seen = new Set<string>();
  for (const id of [...input.slots.map((s) => s.userId).filter((x): x is string => !!x), ...input.bench]) {
    if (seen.has(id)) return 'A player is listed twice.';
    if (!eligible.has(id)) return 'Only players in this squad can be picked.';
    seen.add(id);
  }
  return null;
}

// --- Rule book templates --------------------------------------------------------
// Starting points an organiser edits; nothing here is enforced by code.

const FOOTBALL_RULES: RuleItem[] = [
  { title: 'Match length', body: '2 × 35 minutes with a 10 minute half-time. The referee adds stoppage time.' },
  { title: 'Substitutions', body: 'Rolling substitutions at the halfway line, with the referee’s nod.' },
  { title: 'Offside', body: 'Offside applies in the final third only.' },
  { title: 'Fouls and free kicks', body: 'Direct free kick for careless, reckless or excessive challenges. Penalty for fouls in the box.' },
  { title: 'Cards', body: 'Yellow = caution. Two yellows or a straight red = off for the rest of the game; the team plays a player short.' },
  { title: 'Kit', body: 'Shin pads required. No metal studs on astro pitches. Matching shirts or bibs per side.' },
  { title: 'Respect', body: 'Only the captain speaks to the referee. Abuse of officials ends the game for that player.' },
];

const FUTSAL_RULES: RuleItem[] = [
  { title: 'Match length', body: '2 × 20 minutes, 5 minute half-time. The clock stops only for injuries and timeouts.' },
  { title: 'Substitutions', body: 'Rolling and unlimited, made at the halfway line.' },
  { title: 'Restarts', body: 'Kick-ins, not throw-ins. 4 seconds to restart or possession changes.' },
  { title: 'Tackling', body: 'No slide tackles. Direct free kick; repeat offences are a yellow card.' },
  { title: 'Accumulated fouls', body: 'From the 6th team foul in a half, every foul is a direct free kick from the second penalty mark.' },
  { title: 'Goalkeeper', body: 'The keeper has 4 seconds with the ball in their half and cannot throw it over halfway.' },
  { title: 'Draws', body: 'League: a draw stands. Cup: 3 penalties each, then sudden death.' },
];

const BASKETBALL_RULES: RuleItem[] = [
  { title: 'Game length', body: '4 × 10 minute quarters, 2 minutes between quarters and 10 at half-time.' },
  { title: 'Scoring', body: '2 points inside the arc, 3 beyond it, 1 per free throw.' },
  { title: 'Fouls', body: 'Five personal fouls and a player is out. From the 5th team foul in a quarter, every foul gives free throws.' },
  { title: 'Timeouts', body: '2 in the first half, 3 in the second. One minute each.' },
  { title: 'Overtime', body: '5 minute periods until there is a winner.' },
  { title: 'Respect', body: 'Technical foul for arguing with officials; two technicals and the player leaves the game.' },
];

const NETBALL_RULES: RuleItem[] = [
  { title: 'Game length', body: '4 × 15 minute quarters, 3 minutes between quarters and 5 at half-time.' },
  { title: 'Positions', body: 'Seven per side; each position may only play in its own areas of the court.' },
  { title: 'Footwork', body: 'No stepping with the ball. Pass or shoot within 3 seconds.' },
  { title: 'Contact and obstruction', body: 'Stay 0.9 m from the player with the ball. Penalty pass for contact or obstruction.' },
  { title: 'Scoring', body: 'Only the GS and GA can score, from inside the goal circle.' },
  { title: 'Substitutions', body: 'At breaks, or for injury and illness during play.' },
];

const GENERAL_RULES: RuleItem[] = [
  { title: 'Start time', body: 'Games start on time. A side not ready 15 minutes after start forfeits.' },
  { title: 'Fair play', body: 'Play to the spirit of the game. The host or official’s decision is final on the day.' },
  { title: 'Safety', body: 'Stop play straight away for any injury. Water and shade breaks when it is hot.' },
  { title: 'Respect', body: 'No abuse of players, officials or spectators. The host can remove anyone who breaks this.' },
];

export function ruleTemplateFor(sport: string | null | undefined, format?: string | null): { title: string; rules: RuleItem[] } {
  const s = `${sport ?? ''} ${format ?? ''}`.toLowerCase();
  if (/futsal|5.?a.?side|5v5/.test(s)) return { title: 'Futsal and 5-a-side rules', rules: FUTSAL_RULES };
  if (/football|soccer/.test(s)) return { title: 'Football rules', rules: FOOTBALL_RULES };
  if (s.includes('basket')) return { title: 'Basketball rules', rules: BASKETBALL_RULES };
  if (s.includes('netball')) return { title: 'Netball rules', rules: NETBALL_RULES };
  return { title: 'House rules', rules: GENERAL_RULES };
}
