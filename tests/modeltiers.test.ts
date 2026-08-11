/** Which band a model lands in, and when the banding is worth showing at all.
 *  Prices are the real ones from Pi's catalog, in dollars per million tokens. */

import { describe, expect, it } from 'vitest';
import { byTier, tierOf } from '../src/lib/modeltiers';

const priced = (input: number, output: number) => ({ rates: { input, output } });

describe('which band a model lands in', () => {
  it('puts the small fast models in the cheap band', () => {
    expect(tierOf(priced(0.14, 0.28))).toBe('fast'); // deepseek-v4-flash
    expect(tierOf(priced(0.05, 0.4))).toBe('fast'); // gpt-5-nano
    expect(tierOf(priced(1, 5))).toBe('fast'); // claude-haiku-4-5
  });

  it('puts the everyday workhorses in the middle', () => {
    expect(tierOf(priced(2, 10))).toBe('balanced'); // claude-sonnet-5
    expect(tierOf(priced(1.25, 10))).toBe('balanced'); // gpt-5.1
    expect(tierOf(priced(2, 12))).toBe('balanced'); // gemini-3-pro
  });

  it('puts the flagships at the top', () => {
    expect(tierOf(priced(5, 25))).toBe('best'); // claude-opus-4-5
    expect(tierOf(priced(10, 50))).toBe('best'); // claude-fable-5
    expect(tierOf(priced(15, 120))).toBe('best'); // gpt-5-pro
    expect(tierOf(priced(150, 600))).toBe('best'); // o1-pro
  });

  it('says nothing about a model whose price the provider does not quote', () => {
    expect(tierOf({ rates: null })).toBeNull();
  });
});

describe('whether the banding is worth showing', () => {
  it('groups cheapest band first', () => {
    const grouped = byTier([priced(10, 50), priced(0.14, 0.28), priced(2, 10)]);
    expect(grouped?.map(([tier]) => tier)).toEqual(['fast', 'balanced', 'best']);
  });

  it('keeps the models inside their band', () => {
    const cheap = priced(0.14, 0.28);
    const dear = priced(10, 50);
    expect(byTier([dear, cheap])).toEqual([
      ['fast', [cheap]],
      ['best', [dear]],
    ]);
  });

  it('declines when every model would land in one band', () => {
    expect(byTier([priced(2, 10), priced(1.25, 10)])).toBeNull();
  });

  it('declines when any model has no price, rather than banding it wrongly', () => {
    expect(byTier([priced(0.14, 0.28), { rates: null }, priced(10, 50)])).toBeNull();
  });

  it('declines on an empty list', () => {
    expect(byTier([])).toBeNull();
  });
});
