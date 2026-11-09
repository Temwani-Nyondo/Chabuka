import { describe, expect, it } from 'vitest';
import { ENDPOINT_MS, classifyEnder, endpointDelay, speechSegments, splitSentences } from './index';

const base = { pitch: 1.1, rate: 0.95 };

describe('speechSegments', () => {
  it('speaks a leading hmm on its own, slower and lower, then the rest normally', () => {
    const segs = speechSegments('Hmm, that depends on the day.', base);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ text: 'Hmm', pitch: 0.85, rate: 0.7 });
    expect(segs[0]?.pauseAfterMs).toBeGreaterThan(0);
    expect(segs[1]).toMatchObject({ text: 'that depends on the day.', pitch: 1.1, rate: 0.95, pauseAfterMs: 0 });
  });

  it('handles stretched reactions: ohhh, woah, wow', () => {
    expect(speechSegments('Ohhhh, nice one.', base)[0]).toMatchObject({ text: 'Ohhh', pitch: 1.3 });
    expect(speechSegments('Woah, that is a lot of sports!', base)[0]).toMatchObject({ text: 'Whoa' });
    expect(speechSegments('Wow! Thirty-one and still playing.', base)[0]).toMatchObject({ text: 'Wow', pitch: 1.35 });
  });

  it('turns written laughter into spoken laughter', () => {
    expect(speechSegments('Haha, fair enough.', base)[0]).toMatchObject({ text: 'Ha ha ha' });
    expect(speechSegments('Hahaha that is good.', base)[0]).toMatchObject({ text: 'Ha ha ha' });
  });

  it('leaves ordinary replies as one segment, including words that merely start with a reaction', () => {
    expect(speechSegments('What level should I put for basketball?', base)).toEqual([
      { text: 'What level should I put for basketball?', pitch: 1.1, rate: 0.95, pauseAfterMs: 0 },
    ]);
    expect(speechSegments('Hampton is a great area.', base)).toHaveLength(1);
    expect(speechSegments('Ohio is far.', base)).toHaveLength(1);
  });

  it('a reaction on its own has no trailing pause', () => {
    const segs = speechSegments('Wow!', base);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.pauseAfterMs).toBe(0);
  });

  it('returns nothing for an empty reply', () => {
    expect(speechSegments('   ', base)).toEqual([]);
  });
});

describe('splitSentences', () => {
  it('returns finished sentences and keeps the unfinished tail', () => {
    expect(splitSentences('Wow, five sports. What level do you play at')).toEqual({
      complete: ['Wow, five sports.'],
      rest: 'What level do you play at',
    });
  });

  it('waits for whitespace after the punctuation, so a stream cut mid-sentence is not split early', () => {
    expect(splitSentences('That is brilliant.')).toEqual({ complete: [], rest: 'That is brilliant.' });
    expect(splitSentences('That is brilliant. ')).toEqual({ complete: ['That is brilliant.'], rest: '' });
  });

  it('does not split decimals or inside words', () => {
    expect(splitSentences('You rated it 3.5 stars and said e.g.so. Next')).toEqual({
      complete: ['You rated it 3.5 stars and said e.g.so.'],
      rest: 'Next',
    });
  });

  it('handles several sentences, questions, ellipses and quotes', () => {
    expect(splitSentences('Haha, nice. Which area? Hmm... Quick one. Ok')).toEqual({
      complete: ['Haha, nice.', 'Which area?', 'Hmm...', 'Quick one.'],
      rest: 'Ok',
    });
    expect(splitSentences('He said "go." Then left. ')).toEqual({ complete: ['He said "go."', 'Then left.'], rest: '' });
  });

  it('splits at line breaks and returns nothing for an empty buffer', () => {
    expect(splitSentences('First line\nSecond')).toEqual({ complete: ['First line'], rest: 'Second' });
    expect(splitSentences('')).toEqual({ complete: [], rest: '' });
  });

  it('feeding text in pieces gives the same sentences as feeding it whole', () => {
    const text = 'Wow, five sports. What level would you say you are? Recreational, intermediate or competitive.';
    let buffer = '';
    const spoken: string[] = [];
    for (const piece of text.match(/.{1,7}/g) ?? []) {
      buffer += piece;
      const { complete, rest } = splitSentences(buffer);
      spoken.push(...complete);
      buffer = rest;
    }
    if (buffer.trim()) spoken.push(buffer.trim());
    expect(spoken).toEqual(['Wow, five sports.', 'What level would you say you are?', 'Recreational, intermediate or competitive.']);
  });
});

describe('endpointDelay', () => {
  it('ends quickly after a short, complete answer', () => {
    expect(endpointDelay('competitive')).toBe(ENDPOINT_MS.answer);
    expect(endpointDelay('Kabulonga')).toBe(ENDPOINT_MS.answer);
    expect(endpointDelay('I play basketball on Saturdays')).toBe(ENDPOINT_MS.answer);
  });

  it('ends fastest when the transcript has final punctuation', () => {
    expect(endpointDelay('I am thirty one.')).toBe(ENDPOINT_MS.complete);
    expect(endpointDelay('What level should I pick?')).toBe(ENDPOINT_MS.complete);
  });

  it('waits longer when the player is clearly mid-thought', () => {
    expect(endpointDelay('I play football and')).toBe(ENDPOINT_MS.trailing);
    expect(endpointDelay('so um')).toBe(ENDPOINT_MS.trailing);
    expect(endpointDelay('I work in the')).toBe(ENDPOINT_MS.trailing);
    expect(endpointDelay('I stay in Avondale,')).toBe(ENDPOINT_MS.trailing);
    expect(endpointDelay('well\u2026')).toBe(ENDPOINT_MS.trailing);
  });

  it('uses a middle pause when there is no live transcript to go on', () => {
    expect(endpointDelay('')).toBe(ENDPOINT_MS.unknown);
    expect(endpointDelay('   ')).toBe(ENDPOINT_MS.unknown);
  });

  it('keeps the waits in a sensible order', () => {
    expect(ENDPOINT_MS.complete).toBeLessThan(ENDPOINT_MS.answer);
    expect(ENDPOINT_MS.answer).toBeLessThan(ENDPOINT_MS.unknown);
    expect(ENDPOINT_MS.unknown).toBeLessThan(ENDPOINT_MS.trailing);
  });
});

describe('classifyEnder', () => {
  it('recognises a clear goodbye', () => {
    for (const s of ['Bye', 'bye bye', 'Goodbye!', 'ok bye thanks', 'See you later', 'talk to you later, Gaffer', 'Catch you later', 'ttyl', 'right, gotta go', 'stop listening']) {
      expect(classifyEnder(s), s).toBe('hard');
    }
  });

  it('recognises "that is all" as a soft ending, so Gaffer can still answer in context', () => {
    for (const s of ["That's all", "nah that's all, thanks", "No, that's it", "I'm good", "we're done", 'nothing else thanks', "ok that's everything"]) {
      expect(classifyEnder(s), s).toBe('soft');
    }
  });

  it('does not treat ordinary sentences as endings', () => {
    for (const s of [
      'I gotta go play football',
      'say bye to my friend',
      "that's all the sports I play and I work in finance on weekdays",
      'What does goodbye mean',
      'I am good at basketball',
      'See the games on Saturday',
      'recreational',
      '',
    ]) {
      expect(classifyEnder(s), s).toBeNull();
    }
  });
});
