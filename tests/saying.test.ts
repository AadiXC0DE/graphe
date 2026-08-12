/** Saying it out loud instead of typing it.
 *
 * Two things are tested here and they fail differently. Whether this computer
 * can listen is a yes or a no, and getting it wrong puts a dead button on the
 * screen — the one kind of control this interface is never allowed to show.
 * Where the words land is craft: get it wrong and dictation arrives as a
 * transcript pasted over the middle of somebody's sentence.
 */

import { describe, expect, it } from 'vitest';

import {
  SAYING,
  around,
  canSay,
  earsIn,
  fold,
  gather,
  readSaid,
  wordsFor,
  type Heard,
  type Said,
} from '../src/lib/saying';

/** A stand-in for the thing the browser hands back. */
class Ears {
  lang = '';
  continuous = false;
  interimResults = false;
  start(): void {}
  stop(): void {}
  abort(): void {}
  onresult = null;
  onerror = null;
  onend = null;
}

/** An event shaped the way the browser shapes it: array-like, both levels. */
function said(...pieces: readonly [string, boolean][]): Said {
  return {
    results: pieces.map(([transcript, isFinal]) => {
      const one: ArrayLike<{ transcript?: string }> & { isFinal?: boolean } = {
        length: 1,
        0: { transcript },
        isFinal,
      };
      return one;
    }),
  };
}

/* ========================================================================== */
/* Whether this computer can listen                                            */
/* ========================================================================== */

describe('whether this computer can listen', () => {
  it('finds it under either name', () => {
    expect(canSay({ SpeechRecognition: Ears })).toBe(true);
    expect(canSay({ webkitSpeechRecognition: Ears })).toBe(true);
    expect(earsIn({ webkitSpeechRecognition: Ears })).toBe(Ears);
  });

  it('prefers the plain name where both are there', () => {
    class Other extends Ears {}
    expect(earsIn({ SpeechRecognition: Ears, webkitSpeechRecognition: Other })).toBe(Ears);
  });

  it('says no where there is nothing to say yes to', () => {
    expect(canSay({})).toBe(false);
    expect(canSay(null)).toBe(false);
    expect(canSay(undefined)).toBe(false);
    expect(canSay('window')).toBe(false);
    expect(earsIn({})).toBe(null);
  });

  it('says no to a name that is there but is not something you can start', () => {
    expect(canSay({ webkitSpeechRecognition: true })).toBe(false);
    expect(canSay({ webkitSpeechRecognition: {} })).toBe(false);
    expect(canSay({ SpeechRecognition: undefined, webkitSpeechRecognition: null })).toBe(false);
  });
});

/* ========================================================================== */
/* What was heard                                                              */
/* ========================================================================== */

describe('reading what was heard', () => {
  it('reads settled and still-changing pieces out of one event', () => {
    expect(readSaid(said(['make the header', true], ['a little warmer', false]))).toEqual([
      { transcript: 'make the header', final: true },
      { transcript: 'a little warmer', final: false },
    ]);
  });

  it('survives an event with nothing in it', () => {
    expect(readSaid(null)).toEqual([]);
    expect(readSaid(undefined)).toEqual([]);
    expect(readSaid({ results: [] })).toEqual([]);
    expect(readSaid({} as Said)).toEqual([]);
  });

  it('survives a piece with no words in it', () => {
    const broken = { results: [{ length: 0 }, { length: 1, 0: {}, isFinal: true }] } as Said;
    expect(readSaid(broken)).toEqual([
      { transcript: '', final: false },
      { transcript: '', final: true },
    ]);
  });

  it('puts what is settled first and what is still moving after it', () => {
    const heard: Heard[] = [
      { transcript: 'and give it', final: false },
      { transcript: 'make the header warmer', final: true },
    ];
    expect(gather(heard)).toBe('make the header warmer and give it');
  });

  it('tidies the spacing the pieces arrive with', () => {
    expect(gather([{ transcript: '  make it   warmer  ', final: true }])).toBe('make it warmer');
  });

  it('has nothing to say about nothing', () => {
    expect(gather([])).toBe('');
    expect(gather([{ transcript: '   ', final: false }])).toBe('');
    expect(gather(null)).toBe('');
    expect(gather(undefined)).toBe('');
    expect(gather([null, undefined, { transcript: 12 }] as unknown as readonly Heard[])).toBe('');
  });
});

/* ========================================================================== */
/* Where the words go                                                          */
/* ========================================================================== */

describe('the place the words go', () => {
  it('splits the sentence at the cursor', () => {
    expect(around('make it warmer', 8)).toEqual({ before: 'make it ', after: 'warmer' });
  });

  it('takes the end of the box when nothing says otherwise', () => {
    expect(around('make it warmer')).toEqual({ before: 'make it warmer', after: '' });
    expect(around('make it warmer', undefined, undefined)).toEqual({
      before: 'make it warmer',
      after: '',
    });
  });

  it('replaces what is selected rather than talking over it', () => {
    expect(around('make it warmer', 8, 14)).toEqual({ before: 'make it ', after: '' });
  });

  it('holds up to a cursor in a place that cannot exist', () => {
    expect(around('short', 900)).toEqual({ before: 'short', after: '' });
    expect(around('short', -3)).toEqual({ before: '', after: 'short' });
    expect(around('short', Number.NaN)).toEqual({ before: 'short', after: '' });
    expect(around('short', 4, 1)).toEqual({ before: 'shor', after: 't' });
    expect(around(null as unknown as string, 2)).toEqual({ before: '', after: '' });
  });
});

describe('folding what was heard into what is already written', () => {
  it('starts an empty box with a capital', () => {
    expect(fold({ before: '', after: '' }, 'make the header warmer')).toEqual({
      text: 'Make the header warmer',
      caret: 22,
    });
  });

  it('carries on mid-sentence without capitalising anything', () => {
    const folded = fold({ before: 'Make the header', after: '' }, 'a little warmer');
    expect(folded.text).toBe('Make the header a little warmer');
    expect(folded.caret).toBe(folded.text.length);
  });

  it('lands in the middle of a sentence with a space on each side', () => {
    const folded = fold({ before: 'Make the ', after: 'a little warmer' }, 'header');
    expect(folded.text).toBe('Make the header a little warmer');
    // The cursor sits after what was just said, ready to carry on typing.
    expect(folded.caret).toBe('Make the header'.length);
    expect(folded.text.slice(folded.caret)).toBe(' a little warmer');
  });

  it('adds no second space where there is already one', () => {
    expect(fold({ before: 'Make the ', after: ' warmer' }, 'header').text).toBe(
      'Make the header warmer',
    );
  });

  it('leaves punctuation sitting where the writer put it', () => {
    expect(fold({ before: 'Make it ', after: ', please' }, 'warmer').text).toBe(
      'Make it warmer, please',
    );
  });

  it('capitalises after a full stop, because that is a new sentence', () => {
    expect(fold({ before: 'Make it warmer. ', after: '' }, 'and give it more air').text).toBe(
      'Make it warmer. And give it more air',
    );
    expect(fold({ before: 'Is it warmer?', after: '' }, 'try again').text).toBe(
      'Is it warmer? Try again',
    );
  });

  it('does not capitalise mid-sentence after a comma', () => {
    expect(fold({ before: 'Make it warmer,', after: '' }, 'and lighter').text).toBe(
      'Make it warmer, and lighter',
    );
  });

  it('keeps landing in the same place as a partial result grows', () => {
    const place = { before: 'Make the ', after: 'and see' };
    const first = fold(place, 'header');
    const second = fold(place, 'header a little');
    const settled = fold(place, 'header a little warmer');
    expect(first.text).toBe('Make the header and see');
    expect(second.text).toBe('Make the header a little and see');
    expect(settled.text).toBe('Make the header a little warmer and see');
    expect(settled.caret).toBe('Make the header a little warmer'.length);
  });

  it('puts the sentence back untouched when nothing was made out', () => {
    expect(fold({ before: 'Make the ', after: 'warmer' }, '   ')).toEqual({
      text: 'Make the warmer',
      caret: 9,
    });
  });

  it('survives a place or a phrase that is not there', () => {
    expect(fold({} as never, 'warmer').text).toBe('Warmer');
    expect(fold({ before: 'Make it ', after: '' }, null as unknown as string).text).toBe(
      'Make it ',
    );
  });
});

/* ========================================================================== */
/* When it stops badly                                                         */
/* ========================================================================== */

describe('when listening stops badly', () => {
  it('says nothing about a stop we asked for ourselves', () => {
    expect(wordsFor('aborted')).toEqual({ because: null, keepOffering: true });
  });

  it('answers a refusal with what would fix it, and keeps offering', () => {
    const said = wordsFor('not-allowed');
    expect(said.because).toBe(SAYING.refused);
    expect(said.because).toMatch(/microphone/i);
    expect(said.keepOffering).toBe(true);
  });

  it('answers silence, and a computer with nothing to listen with', () => {
    expect(wordsFor('no-speech').because).toBe(SAYING.silence);
    expect(wordsFor('audio-capture').because).toBe(SAYING.noEars);
    expect(wordsFor('no-speech').keepOffering).toBe(true);
  });

  it('takes the control away when it will not work here at all', () => {
    for (const trouble of ['network', 'service-not-allowed']) {
      const said = wordsFor(trouble);
      expect(said.because).toBe(SAYING.trouble);
      expect(said.keepOffering).toBe(false);
    }
  });

  it('has an answer for something it has never seen', () => {
    for (const odd of ['bad-grammar', '', null, undefined]) {
      const said = wordsFor(odd);
      expect(said.because).toBe(SAYING.trouble);
      expect(said.keepOffering).toBe(true);
    }
  });
});

/* ========================================================================== */
/* The words                                                                   */
/* ========================================================================== */

describe('the words it says', () => {
  const everything = Object.values(SAYING);

  it('speaks no jargon', () => {
    const jargon =
      /\b(git|commit|session|token|API|upload|MIME|transcription|transcript|speech recognition|recogni[sz]er|dictation|service|server|network|permission denied|error|failed|not-allowed)\b/i;
    for (const sentence of everything) expect(sentence).not.toMatch(jargon);
  });

  it('never blames the person', () => {
    for (const sentence of everything) {
      expect(sentence).not.toMatch(/\byou (?:cannot|can't|must|should|need to|failed)\b/i);
      expect(sentence).not.toMatch(/\b(sorry|oops)\b/i);
    }
  });

  it('says what the control does without naming the machinery', () => {
    expect(SAYING.start).toBe('Say it out loud');
    expect(SAYING.stop).toMatch(/stop/i);
    expect(SAYING.listening).toMatch(/listening/i);
  });

  it('writes the sentences as sentences, and the labels as labels', () => {
    for (const sentence of [SAYING.silence, SAYING.refused, SAYING.noEars, SAYING.trouble]) {
      expect(sentence.charAt(0)).toBe(sentence.charAt(0).toUpperCase());
      expect(sentence).toMatch(/[.!?]$/);
      expect(sentence).toMatch(/\b(will|would|usually|does it|fix that|get there|could not)\b/i);
    }
    for (const label of [SAYING.start, SAYING.stop]) expect(label).not.toMatch(/[.!?]$/);
  });
});
