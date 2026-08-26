import { describe, expect, it } from 'vitest';

import {
  frontOf,
  setFrom,
  stripSays,
  variationId,
  type VariationRequest,
} from '../src/preview/variations';

describe('the shape of a variation set', () => {
  it('derives a readable id from a designed name', () => {
    expect(variationId('Minimal and clean')).toBe('minimal-and-clean');
    expect(variationId('Dark & Technical!')).toBe('dark-technical');
    expect(variationId('   ')).toBe('variation');
    expect(variationId('Playful — with “strong” colors!')).toBe('playful-with-strong-colors');
  });

  it('turns a request into a set, in the order asked, with the first in front', () => {
    const requested: readonly VariationRequest[] = [
      { name: 'Minimal and clean', brief: 'see the structure' },
      { name: 'More editorial', brief: 'big type' },
    ];
    const set = setFrom('the landing page', requested);
    expect(set.subject).toBe('the landing page');
    expect(set.variations.map((one) => one.name)).toEqual(['Minimal and clean', 'More editorial']);
    expect(set.inFront).toBe(set.variations[0]?.id ?? null);
    // None are ready until a folder has been served for them.
    expect(set.variations.every((one) => one.address === null)).toBe(true);
  });

  it('keeps ids unique when two names would collide', () => {
    const set = setFrom('a card', [
      { name: 'Dark', brief: '' },
      { name: 'Dark', brief: 'darker' },
    ]);
    const ids = set.variations.map((one) => one.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('dark');
  });

  it('puts a known variation in front and lets an unknown one go', () => {
    const start = setFrom('x', [{ name: 'Editorial', brief: '' }, { name: 'Playful', brief: '' }]);
    const second = start.variations[1]?.id ?? '';
    const moved = frontOf(start, second);
    expect(moved.inFront).toBe(second);
    expect(frontOf(start, 'nope').inFront).toBe(start.inFront);
    expect(frontOf(start, null).inFront).toBe(null);
  });

  it('says how many and which is open, in one line', () => {
    const empty = setFrom('x', []);
    expect(stripSays(empty)).toBe('Nothing to compare yet.');
    const set = setFrom('x', [{ name: 'Editorial', brief: '' }, { name: 'Playful', brief: '' }]);
    expect(stripSays(set)).toBe('Editorial, one of 2.');
  });
});
