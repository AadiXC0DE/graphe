/** A shelf that names every day it has ever seen is a shelf of headings. */

import { describe, expect, it } from 'vitest';

import { EARLIER, EARLIER_AFTER_DAYS, byDay, foldOlder } from '../src/lib/shelf';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 2, 12);

const one = (id: string, daysAgo: number) => ({ id, at: now - daysAgo * DAY, title: id });

describe('folding the old ones away', () => {
  it('leaves a shelf with nothing old on it alone', () => {
    const days = byDay([one('a', 0), one('b', 2)], now);
    expect(foldOlder(days, now)).toEqual(days);
  });

  it('gathers everything past a month under one heading, last', () => {
    const folded = foldOlder(byDay([one('a', 0), one('b', 40), one('c', 200)], now), now);
    expect(folded.at(-1)?.label).toBe(EARLIER.label);
    expect(folded.at(-1)?.items.map((item) => item.id)).toEqual(['b', 'c']);
    expect(folded.slice(0, -1).flatMap((day) => day.items.map((item) => item.id))).toEqual(['a']);
  });

  it('loses nothing: every conversation is still on the shelf once', () => {
    const items = [one('a', 0), one('b', 1), one('c', 31), one('d', 400)];
    const folded = foldOlder(byDay(items, now), now);
    const ids = folded.flatMap((day) => day.items.map((item) => item.id)).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops a day that had nothing but old ones on it', () => {
    const folded = foldOlder(byDay([one('a', 90), one('b', 91)], now), now);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.key).toBe(EARLIER.key);
  });

  it('cuts at a month, and a day either side of the line falls the right way', () => {
    const items = [one('recent', EARLIER_AFTER_DAYS - 1), one('old', EARLIER_AFTER_DAYS + 1)];
    const folded = foldOlder(byDay(items, now), now);
    expect(folded.at(-1)?.items.map((item) => item.id)).toEqual(['old']);
    expect(folded).toHaveLength(2);
  });
});
