import { describe, expect, it } from 'vitest';
import {
  availableActions,
  createMatchSchema,
  didFillMatch,
  forYouScore,
  formatEventLocation,
  levelSchema,
  matchSlot,
  onboardingSchema,
  requestBookingSchema,
  slotKey,
  timeBandForHour,
  venueListSchema,
  venueSchema,
} from './index';

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

describe('createMatchSchema', () => {
  const base = {
    sportId: SPORT_ID,
    title: 'Saturday football',
    startsAt: '2026-10-31T13:00:00.000Z',
    area: 'Woodlands',
    capacity: 10,
    level: 'intermediate' as const,
  };

  it('accepts a valid match and defaults visibility to public', () => {
    const result = createMatchSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.visibility).toBe('public');
  });

  it('rejects capacity under 2', () => {
    expect(createMatchSchema.safeParse({ ...base, capacity: 1 }).success).toBe(false);
  });

  it('rejects a vague start time', () => {
    expect(createMatchSchema.safeParse({ ...base, startsAt: 'Saturday' }).success).toBe(false);
  });
});

describe('venueSchema', () => {
  const venue = {
    id: SPORT_ID,
    name: 'Woodlands Community Pitch',
    area: 'Woodlands',
    lat: -15.43,
    lng: 28.35,
    sports: ['Football'],
    facility_types: ['grass pitch'],
    price_note: 'Free',
    photos: [],
  };

  it('accepts a listed venue and defaults facility photos', () => {
    const result = venueSchema.safeParse(venue);
    expect(result.success).toBe(true);
  });

  it('parses a venue list, dropping nothing valid', () => {
    expect(venueListSchema.safeParse([venue, venue]).success).toBe(true);
  });

  it('rejects coordinates off the map', () => {
    expect(venueSchema.safeParse({ ...venue, lat: -200 }).success).toBe(false);
  });
});

describe('createMatchSchema venue input', () => {
  it('accepts a venue id with its pin', () => {
    const result = createMatchSchema.safeParse({
      sportId: SPORT_ID,
      title: 'Saturday football',
      startsAt: '2026-10-31T13:00:00.000Z',
      venueId: SPORT_ID,
      lat: -15.43,
      lng: 28.35,
      area: 'Woodlands',
      capacity: 10,
      level: 'intermediate',
    });
    expect(result.success).toBe(true);
  });
});

describe('requestBookingSchema', () => {
  it('accepts a slot booking with no payment fields', () => {
    const result = requestBookingSchema.safeParse({ venueId: SPORT_ID, slotId: SPORT_ID });
    expect(result.success).toBe(true);
  });

  it('rejects a booking with neither slot nor time', () => {
    expect(requestBookingSchema.safeParse({ venueId: SPORT_ID }).success).toBe(false);
  });
});

describe('availableActions', () => {
  it('offers join to a stranger when there is room', () => {
    expect(
      availableActions({ status: 'open', kind: 'players', isOrganiser: false, isParticipant: false, joinedCount: 3, capacity: 10 }),
    ).toEqual(['join']);
  });

  it('offers nothing when the match is full', () => {
    expect(
      availableActions({ status: 'full', kind: 'players', isOrganiser: false, isParticipant: false, joinedCount: 10, capacity: 10 }),
    ).toEqual([]);
  });

  it('offers withdraw and directions to a joined player', () => {
    expect(
      availableActions({ status: 'open', kind: 'players', isOrganiser: false, isParticipant: true, joinedCount: 3, capacity: 10 }),
    ).toEqual(['withdraw', 'directions']);
  });

  it('never offers join on a team-vs-team game', () => {
    expect(
      availableActions({ status: 'open', kind: 'team-vs-team', isOrganiser: false, isParticipant: false, joinedCount: 3, capacity: 10 }),
    ).toEqual([]);
  });

  it('still offers withdraw to a team-vs-team participant', () => {
    expect(
      availableActions({ status: 'open', kind: 'team-vs-team', isOrganiser: false, isParticipant: true, joinedCount: 3, capacity: 10 }),
    ).toEqual(['withdraw', 'directions']);
  });

  it('offers nothing once the match has started', () => {
    expect(
      availableActions({ status: 'game_on', kind: 'players', isOrganiser: false, isParticipant: true, joinedCount: 3, capacity: 10 }),
    ).toEqual([]);
  });
});

describe('didFillMatch', () => {
  it('fires when a join takes the last seat', () => {
    expect(didFillMatch(9, 10, 10)).toBe(true);
  });

  it('stays quiet on a normal join and on rejoin when full', () => {
    expect(didFillMatch(3, 4, 10)).toBe(false);
    expect(didFillMatch(10, 10, 10)).toBe(false);
  });
});

describe('timeBandForHour', () => {
  it('bands the day at 5, 12 and 17', () => {
    expect(timeBandForHour(4)).toBe('evening');
    expect(timeBandForHour(9)).toBe('morning');
    expect(timeBandForHour(12)).toBe('afternoon');
    expect(timeBandForHour(19)).toBe('evening');
  });

  it('keys a match to its weekday slot', () => {
    const d = new Date(2026, 10, 4, 18, 30); // a Wednesday evening
    expect(d.getDay()).toBe(3);
    expect(matchSlot(d)).toEqual({ day: 3, timeBand: 'evening' });
    expect(slotKey(3, 'evening')).toBe('3-evening');
  });
});

describe('forYouScore', () => {
  it('weighs sport and slot above area', () => {
    expect(forYouScore({ sportMatch: true, slotMatch: true, areaMatch: false })).toBe(4);
    expect(forYouScore({ sportMatch: false, slotMatch: false, areaMatch: true })).toBe(1);
    expect(forYouScore({ sportMatch: true, slotMatch: false, areaMatch: false })).toBe(2);
  });
});

describe('formatEventLocation', () => {
  it('combines name, area and coordinates', () => {
    expect(
      formatEventLocation({ name: 'Showgrounds', area: 'Lusaka', lat: -15.4167, lng: 28.2833 }),
    ).toBe('Showgrounds, Lusaka, -15.41670, 28.28330');
  });

  it('skips a duplicate area and missing parts', () => {
    expect(formatEventLocation({ name: 'Avondale', area: 'Avondale' })).toBe('Avondale');
    expect(formatEventLocation({})).toBeNull();
  });
});
