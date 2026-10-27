import { describe, expect, it } from 'vitest';
import { levelSchema, onboardingSchema } from './index';

const SPORT_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('levelSchema', () => {
  it('accepts the three fixed levels', () => {
    expect(levelSchema.safeParse('recreational').success).toBe(true);
    expect(levelSchema.safeParse('intermediate').success).toBe(true);
    expect(levelSchema.safeParse('competitive').success).toBe(true);
  });

  it('rejects anything else', () => {
    expect(levelSchema.safeParse('pro').success).toBe(false);
    expect(levelSchema.safeParse('').success).toBe(false);
  });
});

describe('onboardingSchema', () => {
  it('accepts a complete onboarding form', () => {
    const result = onboardingSchema.safeParse({
      name: 'Demo Captain',
      area: 'Woodlands',
      photoUrl: 'https://example.com/photo.jpg',
      sportIds: [SPORT_ID],
      level: 'intermediate',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a form without a photo', () => {
    const result = onboardingSchema.safeParse({
      name: 'Demo Captain',
      area: 'Woodlands',
      sportIds: [SPORT_ID],
      level: 'recreational',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = onboardingSchema.safeParse({
      name: '   ',
      area: 'Woodlands',
      sportIds: [SPORT_ID],
      level: 'recreational',
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero sports', () => {
    const result = onboardingSchema.safeParse({
      name: 'Demo Captain',
      area: 'Woodlands',
      sportIds: [],
      level: 'recreational',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a bad level', () => {
    const result = onboardingSchema.safeParse({
      name: 'Demo Captain',
      area: 'Woodlands',
      sportIds: [SPORT_ID],
      level: 'pro',
    });
    expect(result.success).toBe(false);
  });
});
