import { z } from 'zod';

// Fixed value sets (brief section 6). Defined once here, reused by the web
// app, API, helper, and MCP server.
export const LEVELS = ['recreational', 'intermediate', 'competitive'] as const;
export const levelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof levelSchema>;

export const LEVEL_LABELS: Record<Level, string> = {
  recreational: 'Recreational',
  intermediate: 'Intermediate',
  competitive: 'Competitive',
};

export const sportSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  formats: z.array(z.string()),
});
export type Sport = z.infer<typeof sportSchema>;

export const sportListSchema = z.array(sportSchema);

export const profileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80).nullable(),
  photo_url: z.string().url().nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  area: z.string().min(1).max(80).nullable(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  bio: z.string().max(280).nullable().optional(),
});
export type Profile = z.infer<typeof profileSchema>;

// Day 1 onboarding: name, photo (optional), area, sports + one level for all.
export const onboardingSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  area: z.string().trim().min(1, 'Area is required').max(80),
  photoUrl: z.string().url().optional(),
  sportIds: z.array(z.string().uuid()).min(1, 'Pick at least one sport'),
  level: levelSchema,
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const userSportSchema = z.object({
  user_id: z.string().uuid(),
  sport_id: z.string().uuid(),
  level: levelSchema,
});
export type UserSport = z.infer<typeof userSportSchema>;
