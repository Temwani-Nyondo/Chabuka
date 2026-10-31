import { describe, expect, it } from 'vitest';
import { ageBand, buildIcs, circleEligibility, googleCalendarUrl, venueSupportsSport } from './index.js';

describe('venueSupportsSport', () => {
  it('matches declared courts loosely and refuses the rest', () => {
    expect(venueSupportsSport(['Football', 'tennis'], 'tennis')).toBe(true);
    expect(venueSupportsSport(['Football'], 'TENNIS')).toBe(false);
    expect(venueSupportsSport([], 'Football')).toBe(false);
  });
});

describe('ageBand', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  it('bands by birth year and hides unknown', () => {
    expect(ageBand(2012, now)).toBe('Under 18');
    expect(ageBand(2000, now)).toBe('25–34');
    expect(ageBand(1970, now)).toBe('45+');
    expect(ageBand(null, now)).toBeNull();
  });
});

describe('circleEligibility', () => {
  it('opens when no prerequisites set', () => {
    expect(circleEligibility({ birthYear: null, gender: null, ageBands: [], genders: [] })).toBeNull();
  });
  it('asks for missing profile facts', () => {
    expect(circleEligibility({ birthYear: null, gender: null, ageBands: ['18–24'], genders: [] })).toMatch(/year of birth/);
    expect(circleEligibility({ birthYear: 2000, gender: null, ageBands: [], genders: ['women'] })).toMatch(/gender/);
  });
  it('refuses outside the band or group', () => {
    expect(circleEligibility({ birthYear: 1990, gender: 'man', ageBands: ['18–24'], genders: [] })).toMatch(/18–24/);
    expect(circleEligibility({ birthYear: 2000, gender: 'Man', ageBands: [], genders: ['women'] })).toMatch(/women/);
    expect(circleEligibility({ birthYear: 2000, gender: 'Woman', ageBands: ['25–34'], genders: ['women'] })).toBeNull();
  });
});

describe('calendar helpers', () => {
  it('builds a valid ICS envelope', () => {
    const ics = buildIcs({ id: 'm1', title: '5v5, Woodlands; Sat', startsAt: '2026-11-07T08:00:00.000Z', location: 'Woodlands' });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART:20261107T080000Z');
    expect(ics).toContain('SUMMARY:5v5\\, Woodlands\\; Sat');
    expect(ics).toContain('END:VCALENDAR');
  });
  it('builds a Google Calendar template URL', () => {
    const url = googleCalendarUrl({ title: '5v5', startsAt: '2026-11-07T08:00:00.000Z' });
    expect(url).toContain('calendar.google.com/calendar/render');
    expect(url).toContain('action=TEMPLATE');
  });
});
