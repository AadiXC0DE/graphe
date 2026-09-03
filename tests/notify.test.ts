/** Being told, and the dock.
 *
 * The shell does the telling; what is worth telling somebody about is decided
 * in `work/notify.ts`, which is the half that can be run without a dock under
 * it. What is guarded here is the two rules that are easy to get backwards: a
 * finished run never interrupts somebody already watching it, and a badge is
 * never a count of nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  TELLINGS,
  asTelling,
  badgeFor,
  howToTell,
  makesASound,
  notifyWords,
  type Telling,
} from '../src/work/notify';

const asked = (some: Partial<Parameters<typeof howToTell>[1]> = {}) => ({
  finished: 'system' as Telling,
  needsYou: 'system' as Telling,
  inFront: false,
  ...some,
});

describe('the three answers', () => {
  it('are offered in the order the row draws them', () => {
    expect(TELLINGS.map((one) => one.id)).toEqual(['system', 'bounce', 'nothing']);
    expect(TELLINGS.map((one) => one.says)).toEqual([
      notifyWords.system,
      notifyWords.bounce,
      notifyWords.nothing,
    ]);
  });

  it('read a saved answer back, and leave the default standing for anything else', () => {
    expect(asTelling('bounce')).toBe('bounce');
    expect(asTelling('nothing')).toBe('nothing');
    expect(asTelling('yes please')).toBe('system');
    expect(asTelling(undefined)).toBe('system');
    expect(asTelling(null, 'nothing')).toBe('nothing');
  });
});

describe('a run that finished', () => {
  it('says nothing to somebody who is already looking at it', () => {
    expect(howToTell('finished', asked({ inFront: true }))).toBe('nothing');
  });

  it('is told the way they asked once the window is behind something', () => {
    expect(howToTell('finished', asked({ finished: 'bounce' }))).toBe('bounce');
    expect(howToTell('finished', asked({ finished: 'nothing' }))).toBe('nothing');
    expect(howToTell('finished', asked({ finished: 'system' }))).toBe('system');
  });
});

describe('something that needs an answer', () => {
  /* Not gated on the window: nothing else moves until it is answered, and the
     window it is waiting in may be behind three others. */
  it('is told whether or not the window is in front', () => {
    expect(howToTell('needs-you', asked({ needsYou: 'system', inFront: true }))).toBe('system');
    expect(howToTell('needs-you', asked({ needsYou: 'bounce', inFront: false }))).toBe('bounce');
  });

  it('is silent where somebody asked for nothing', () => {
    expect(howToTell('needs-you', asked({ needsYou: 'nothing' }))).toBe('nothing');
  });
});

describe('the sound', () => {
  it('is off unless it was asked for', () => {
    expect(makesASound('system', false)).toBe(false);
    expect(makesASound('system', true)).toBe(true);
    expect(makesASound('bounce', true)).toBe(true);
  });

  it('never plays for the answer that does nothing', () => {
    expect(makesASound('nothing', true)).toBe(false);
  });
});

describe('the dock badge', () => {
  it('says how many are waiting', () => {
    expect(badgeFor(3, true)).toBe('3');
  });

  it('is empty at nothing waiting, so a badge never means zero', () => {
    expect(badgeFor(0, true)).toBe('');
    expect(badgeFor(-2, true)).toBe('');
  });

  it('is empty where nobody asked for one', () => {
    expect(badgeFor(9, false)).toBe('');
  });

  it('survives a number that is not one', () => {
    expect(badgeFor(Number.NaN, true)).toBe('');
    expect(badgeFor(2.7, true)).toBe('2');
  });
});
