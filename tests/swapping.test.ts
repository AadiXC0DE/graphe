/** What the model list says a swap would cost you.
 *
 * The failure this guards: switching model used to flatten how hard it thinks
 * without a word — the remembered depth is not on the new model, so it falls
 * back to whatever that model has, and you find out by watching it answer
 * differently. The list has to say so before the press, and it has to stay
 * quiet on every row that is not actually worse, or it becomes a wall of
 * labels nobody reads.
 */

import { describe, expect, it } from 'vitest';

import { SWAP_WORDS, whatItGivesUp } from '../src/components/ThinkingWith';

const deep = { thinking: ['off', 'low', 'high'] as const, takesImages: true };
const flat = { thinking: ['off'] as const, takesImages: true };
const blind = { thinking: ['off', 'low', 'high'] as const, takesImages: false };
const worse = { thinking: ['off'] as const, takesImages: false };

describe('what a model would give up', () => {
  it('says nothing when there is nothing to give up', () => {
    expect(whatItGivesUp(deep, deep)).toBeNull();
    expect(whatItGivesUp(flat, deep)).toBeNull();
    expect(whatItGivesUp(blind, deep)).toBeNull();
  });

  it('names a model that only answers straight away', () => {
    expect(whatItGivesUp(deep, flat)).toBe(SWAP_WORDS.losesDepth);
  });

  it('names a model that reads no pictures', () => {
    expect(whatItGivesUp(deep, blind)).toBe(SWAP_WORDS.losesPictures);
  });

  it('says both in one line rather than two', () => {
    expect(whatItGivesUp(deep, worse)).toBe(SWAP_WORDS.losesBoth);
  });

  /** Not knowing and knowing it cannot are different claims — a catalogue that
   *  is silent about pictures must not be reported as refusing them. */
  it('says nothing when the catalogue does not say', () => {
    expect(whatItGivesUp(deep, { thinking: deep.thinking, takesImages: null })).toBeNull();
    expect(whatItGivesUp({ thinking: deep.thinking, takesImages: null }, blind)).toBeNull();
  });

  it('says nothing before anything is chosen', () => {
    expect(whatItGivesUp(null, worse)).toBeNull();
  });

  it('never names the machinery', () => {
    for (const said of Object.values(SWAP_WORDS)) {
      expect(said).not.toMatch(/token|thinking level|capability|API|model id/i);
    }
  });
});
