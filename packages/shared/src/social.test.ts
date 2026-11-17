import { describe, expect, it } from 'vitest';
import { applyCreatorSchema, articleBlocks, canSeeProfile, circlePostSchema, creatorPostSchema, excerpt, handleSchema, inlineParts, notifiesFor } from './social';

describe('privacy', () => {
  it('shows record, teams and sports by visibility and relationship', () => {
    expect(canSeeProfile('connections', 'connection')).toBe(true);
    expect(canSeeProfile('connections', 'other')).toBe(false);
    expect(canSeeProfile(undefined, 'other')).toBe(false);
    expect(canSeeProfile('everyone', 'other')).toBe(true);
    expect(canSeeProfile('private', 'connection')).toBe(false);
    expect(canSeeProfile('private', 'self')).toBe(true);
    expect(canSeeProfile('everyone', 'connection', true)).toBe(false);
  });
  it('notifies members by their level', () => {
    expect(notifiesFor('all', false)).toBe(true);
    expect(notifiesFor('important', false)).toBe(false);
    expect(notifiesFor('important', true)).toBe(true);
    expect(notifiesFor('none', true)).toBe(false);
  });
});

describe('articles', () => {
  it('turns the simple format into blocks', () => {
    const blocks = articleBlocks('## Match report\nKabwata won **3-1**.\nGreat game.\n\n> What a goal\n- Pace\n- Power\n![The winner](https://cdn.example.com/a.jpg)');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'quote', 'list', 'image']);
    const p = blocks[1] as { parts: { text: string; bold?: boolean }[] };
    expect(p.parts).toEqual([{ text: 'Kabwata won ' }, { text: '3-1', bold: true }, { text: '. Great game.' }]);
  });
  it('keeps HTML and unsafe links as plain text', () => {
    const blocks = articleBlocks('<script>alert(1)</script>\n![x](javascript:alert(1))');
    expect(blocks).toEqual([{ type: 'paragraph', parts: [{ text: '<script>alert(1)</script> ![x](javascript:alert(1))' }] }]);
    expect(inlineParts('[bad](http://x.com) and [good](https://x.com)')).toEqual([
      { text: '[bad](http://x.com) and ' },
      { text: 'good', href: 'https://x.com' },
    ]);
  });
  it('makes plain excerpts', () => {
    expect(excerpt('## Title\nSome **bold** text with a [link](https://a.b).', 40)).toBe('Title Some bold text with a link.');
    expect(excerpt('a'.repeat(50), 10)).toHaveLength(10);
  });
});

describe('inputs', () => {
  it('checks creator handles', () => {
    expect(handleSchema.parse('Lusaka_Runner')).toBe('lusaka_runner');
    expect(handleSchema.safeParse('ab').success).toBe(false);
    expect(handleSchema.safeParse('admin').success).toBe(false);
    expect(handleSchema.safeParse('has space').success).toBe(false);
  });
  it('needs content in a circle post, and 2-6 poll options', () => {
    const c = '00000000-0000-4000-8000-000000000001';
    expect(circlePostSchema.safeParse({ circleId: c }).success).toBe(false);
    expect(circlePostSchema.safeParse({ circleId: c, poll: { options: ['Yes'] } }).success).toBe(false);
    expect(circlePostSchema.safeParse({ circleId: c, poll: { options: ['Yes', 'No'] } }).success).toBe(true);
  });
  it('articles need a title; creator applications need a real pitch', () => {
    expect(creatorPostSchema.safeParse({ kind: 'article', body: 'text' }).success).toBe(false);
    expect(creatorPostSchema.safeParse({ kind: 'post', body: 'Saturday run, 6am' }).success).toBe(true);
    expect(applyCreatorSchema.safeParse({ handle: 'coach_k', displayName: 'Coach K', pitch: 'short' }).success).toBe(false);
  });
});
