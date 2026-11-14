import { describe, expect, it } from 'vitest';
import { formationsFor, ruleTemplateFor, saveRuleBookSchema, sideSizeFor, validateLineup } from './teamAdmin.js';

const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('sideSizeFor', () => {
  it('reads the format first, then falls back per sport', () => {
    expect(sideSizeFor('football', '5v5')).toBe(5);
    expect(sideSizeFor('football', '7-a-side')).toBe(7);
    expect(sideSizeFor('football', null)).toBe(11);
    expect(sideSizeFor('basketball', '3v3')).toBe(5);
    expect(sideSizeFor('netball')).toBe(7);
    expect(sideSizeFor('futsal')).toBe(5);
    expect(sideSizeFor('tennis')).toBeNull();
  });
});

describe('formationsFor', () => {
  it('offers shapes whose slot count matches the side size', () => {
    for (const [sport, format, size] of [
      ['football', '11v11', 11],
      ['football', '7v7', 7],
      ['football', '5v5', 5],
      ['futsal', null, 5],
      ['basketball', null, 5],
      ['netball', null, 7],
    ] as const) {
      const shapes = formationsFor(sport, format);
      expect(shapes.length).toBeGreaterThan(0);
      for (const f of shapes) expect(f.slots).toHaveLength(size);
    }
  });

  it('spreads odd sizes evenly and keeps every slot on the pitch', () => {
    const [f] = formationsFor('football', '9v9');
    expect(f?.slots).toHaveLength(9);
    for (const s of f?.slots ?? []) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(100);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(100);
    }
  });

  it('has no lineup for racket sports', () => {
    expect(formationsFor('tennis')).toEqual([]);
  });
});

describe('validateLineup', () => {
  const shapes = formationsFor('football', '5v5');
  const slots = (ids: (string | null)[]) => (shapes[0]?.slots ?? []).map((s, i) => ({ ...s, userId: ids[i] ?? null }));
  const squad = new Set([P(1), P(2), P(3), P(4), P(5), P(6)]);

  it('accepts a full, eligible lineup with a bench', () => {
    expect(validateLineup({ formation: '2-1-1', slots: slots([P(1), P(2), P(3), P(4), P(5)]), bench: [P(6)] }, squad, shapes)).toBeNull();
  });

  it('allows empty positions while the captain is still picking', () => {
    expect(validateLineup({ formation: '2-1-1', slots: slots([P(1), null, null, null, null]), bench: [] }, squad, shapes)).toBeNull();
  });

  it('refuses duplicates, outsiders, unknown shapes and wrong slot counts', () => {
    expect(validateLineup({ formation: '2-1-1', slots: slots([P(1), P(1)]), bench: [] }, squad, shapes)).toMatch(/twice/);
    expect(validateLineup({ formation: '2-1-1', slots: slots([P(1)]), bench: [P(1)] }, squad, shapes)).toMatch(/twice/);
    expect(validateLineup({ formation: '2-1-1', slots: slots([P(9)]), bench: [] }, squad, shapes)).toMatch(/squad/);
    expect(validateLineup({ formation: '4-4-2', slots: slots([]), bench: [] }, squad, shapes)).toMatch(/formations/);
    expect(validateLineup({ formation: '2-1-1', slots: slots([]).slice(0, 3), bench: [] }, squad, shapes)).toMatch(/positions/);
  });
});

describe('rule books', () => {
  it('picks a template by sport and format', () => {
    expect(ruleTemplateFor('football', '5v5').title).toMatch(/Futsal/);
    expect(ruleTemplateFor('football', '11v11').title).toBe('Football rules');
    expect(ruleTemplateFor('netball').rules.length).toBeGreaterThan(3);
    expect(ruleTemplateFor('chess').title).toBe('House rules');
  });

  it('needs a title and at least one rule', () => {
    const target = { type: 'match' as const, id: P(1) };
    expect(saveRuleBookSchema.safeParse({ target, title: '', rules: [{ title: 'a', body: '' }] }).success).toBe(false);
    expect(saveRuleBookSchema.safeParse({ target, title: 'House', rules: [] }).success).toBe(false);
    expect(saveRuleBookSchema.safeParse({ target, title: 'House', rules: [{ title: 'Kick-off', body: 'On time' }] }).success).toBe(true);
  });
});
