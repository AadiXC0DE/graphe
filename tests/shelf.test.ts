/** The shelf's arithmetic: what a typed word keeps, and which day a
 *  conversation falls under. */

import { describe, expect, it } from 'vitest';

import { byDay, matching, needsDayLabels, needsSearch, SEARCH_APPEARS_AT } from '../src/lib/shelf';

/** Midday, so a test never straddles a midnight. */
const NOON = new Date(2026, 7, 12, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

let counter = 0;
const said = (title: string, at: number) => {
  counter += 1;
  return { id: `c${counter}`, path: `/c/${counter}`, title, at, messages: 2 };
};

/* ========================================================================== */
/* When the field for finding one appears                                      */
/* ========================================================================== */

describe('when a column of conversations needs a way through it', () => {
  it('stays away while the list can be read at a glance', () => {
    expect(needsSearch(0)).toBe(false);
    expect(needsSearch(1)).toBe(false);
    expect(needsSearch(SEARCH_APPEARS_AT - 1)).toBe(false);
  });

  it('holds off on the boundary itself and appears one past it', () => {
    expect(SEARCH_APPEARS_AT).toBe(15);
    expect(needsSearch(15)).toBe(false);
    expect(needsSearch(16)).toBe(true);
    expect(needsSearch(400)).toBe(true);
  });
});

/* ========================================================================== */
/* What a typed word keeps                                                     */
/* ========================================================================== */

describe('finding a conversation by its name', () => {
  const all = [
    said('Make the pricing page calmer', NOON),
    said('Hero headline options', NOON),
    said('PRICING table spacing', NOON),
  ];

  it('keeps everything when nothing was typed', () => {
    expect(matching(all, '')).toBe(all);
    expect(matching(all, '   ')).toBe(all);
  });

  it('does not care about case', () => {
    expect(matching(all, 'pricing').map((one) => one.title)).toEqual([
      'Make the pricing page calmer',
      'PRICING table spacing',
    ]);
    expect(matching(all, 'PRICING')).toHaveLength(2);
  });

  it('wants every word, wherever they sit in the name', () => {
    expect(matching(all, 'pricing calmer').map((one) => one.title)).toEqual([
      'Make the pricing page calmer',
    ]);
    expect(matching(all, 'calmer pricing')).toHaveLength(1);
    expect(matching(all, 'pricing hero')).toEqual([]);
  });

  it('keeps the order it was handed rather than sorting the matches', () => {
    const jumbled = [said('Zebra crossing', 3), said('Alphabet', 2), said('Zoo', 1)];
    expect(matching(jumbled, 'z').map((one) => one.title)).toEqual(['Zebra crossing', 'Zoo']);
  });

  it('is empty when nothing matches, and on an empty list', () => {
    expect(matching(all, 'zzzz')).toEqual([]);
    expect(matching([], 'pricing')).toEqual([]);
    expect(matching([], '')).toEqual([]);
  });
});

/* ========================================================================== */
/* Which day they fall under                                                   */
/* ========================================================================== */

describe('conversations, a day at a time', () => {
  it('has no days at all when there is nothing to say', () => {
    expect(byDay([], NOON)).toEqual([]);
    expect(needsDayLabels([])).toBe(false);
  });

  it('says today, yesterday, then the weekday, then the date', () => {
    const days = byDay(
      [
        said('now', NOON),
        said('then', NOON - DAY),
        said('before', NOON - 3 * DAY),
        said('a while back', NOON - 30 * DAY),
      ],
      NOON,
    );
    expect(days.map((day) => day.label)).toEqual(['Today', 'Yesterday', 'Sunday', '13 July']);
  });

  it('gathers a day into one group, newest first inside it', () => {
    const days = byDay(
      [
        said('morning', NOON - 4 * 60 * 60 * 1000),
        said('afternoon', NOON),
        said('yesterday', NOON - DAY),
      ],
      NOON,
    );
    expect(days).toHaveLength(2);
    expect(days[0]?.items.map((one) => one.title)).toEqual(['afternoon', 'morning']);
    expect(days[1]?.items.map((one) => one.title)).toEqual(['yesterday']);
  });

  it('gives each day a key that does not move between renders', () => {
    const once = byDay([said('a', NOON), said('b', NOON - DAY)], NOON);
    const again = byDay([said('a', NOON), said('b', NOON - DAY)], NOON);
    expect(once.map((day) => day.key)).toEqual(again.map((day) => day.key));
    expect(new Set(once.map((day) => day.key)).size).toBe(2);
  });

  it('does not label a day when there is only the one', () => {
    expect(needsDayLabels(byDay([said('a', NOON), said('b', NOON)], NOON))).toBe(false);
    expect(needsDayLabels(byDay([said('a', NOON), said('b', NOON - DAY)], NOON))).toBe(true);
  });
});
