/** The shelf's arithmetic: what a page row has to say, what a typed word keeps,
 *  which day a conversation falls under, and the order the parts come out in. */

import { describe, expect, it } from 'vitest';

import {
  byDay,
  cleanPageName,
  markOf,
  matching,
  needsDayLabels,
  needsSearch,
  partsInOrder,
  SEARCH_APPEARS_AT,
  type Part,
  type ShelfPage,
} from '../src/lib/shelf';

const page = (extra: Partial<ShelfPage> = {}): ShelfPage => ({
  route: '/pricing',
  file: 'src/pages/pricing.tsx',
  name: 'Pricing',
  ...extra,
});

/** Midday, so a test never straddles a midnight. */
const NOON = new Date(2026, 7, 12, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

let counter = 0;
const said = (title: string, at: number) => {
  counter += 1;
  return { id: `c${counter}`, path: `/c/${counter}`, title, at, messages: 2 };
};

/* ========================================================================== */
/* What a page row says about itself                                           */
/* ========================================================================== */

describe('what a page row has to show', () => {
  it('shows nothing extra when it was told nothing extra', () => {
    expect(markOf(page())).toEqual({
      showing: false,
      changed: false,
      problems: 0,
      says: null,
    });
  });

  it('marks the one the preview is pointed at', () => {
    const mark = markOf(page({ showing: true }));
    expect(mark.showing).toBe(true);
    expect(mark.says).toBe('Open in the preview');
  });

  it('marks one that moved in the newest version', () => {
    expect(markOf(page({ changed: true })).says).toBe('Changed in the newest version');
  });

  it('counts one thing to fix as one thing, not one things', () => {
    expect(markOf(page({ problems: 1 })).says).toBe('1 thing to fix');
    expect(markOf(page({ problems: 4 })).says).toBe('4 things to fix');
  });

  it('says all of it, in the order the row draws it', () => {
    expect(markOf(page({ showing: true, changed: true, problems: 2 })).says).toBe(
      'Open in the preview, Changed in the newest version, 2 things to fix',
    );
  });

  it('treats no problems and nonsense problems the same way', () => {
    expect(markOf(page({ problems: 0 })).problems).toBe(0);
    expect(markOf(page({ problems: -3 })).problems).toBe(0);
    expect(markOf(page({ problems: Number.NaN })).problems).toBe(0);
    expect(markOf(page({ problems: 2.7 })).problems).toBe(2);
    expect(markOf(page({ problems: 0 })).says).toBeNull();
  });
});

/* ========================================================================== */
/* Naming a page that does not exist yet                                       */
/* ========================================================================== */

describe('the name somebody types for a new page', () => {
  it('keeps what they meant and drops the rest', () => {
    expect(cleanPageName('  About us  ')).toBe('About us');
    expect(cleanPageName('About    us')).toBe('About us');
    expect(cleanPageName('About\nus')).toBe('About us');
  });

  it('reads a typed address as the name inside it', () => {
    expect(cleanPageName('/pricing')).toBe('pricing');
    expect(cleanPageName('///pricing///')).toBe('pricing');
    expect(cleanPageName('\\pricing')).toBe('pricing');
    expect(cleanPageName('blog/first-post')).toBe('blog/first-post');
  });

  it('is nothing when they typed nothing worth asking for', () => {
    expect(cleanPageName('')).toBeNull();
    expect(cleanPageName('   ')).toBeNull();
    expect(cleanPageName('/')).toBeNull();
    expect(cleanPageName(' / / ')).toBeNull();
  });

  it('will not take a paragraph as a name', () => {
    expect(cleanPageName('x'.repeat(200))).toHaveLength(60);
  });
});

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

/* ========================================================================== */
/* What the project is made of                                                 */
/* ========================================================================== */

describe('the pieces a project is built from', () => {
  const parts: readonly Part[] = [
    { id: 'card', name: 'Card', uses: 4 },
    { id: 'button', name: 'Button', uses: 12 },
    { id: 'field', name: 'Text field' },
    { id: 'badge', name: 'Badge', uses: 4 },
  ];

  it('has nothing to draw when there is nothing there', () => {
    expect(partsInOrder([])).toEqual([]);
  });

  it('puts the most used first, then settles ties by name', () => {
    expect(partsInOrder(parts).map((one) => one.name)).toEqual([
      'Button',
      'Badge',
      'Card',
      'Text field',
    ]);
  });

  it('draws one row per piece however many times it was handed over', () => {
    const twice = [...parts, { id: 'card', name: 'Card again', uses: 99 }];
    const order = partsInOrder(twice);
    expect(order).toHaveLength(4);
    expect(order.map((one) => one.name)).not.toContain('Card again');
  });

  it('leaves a piece nobody counted at the bottom rather than guessing', () => {
    const order = partsInOrder([
      { id: 'field', name: 'Text field' },
      { id: 'button', name: 'Button', uses: 1 },
    ]);
    expect(order.map((one) => one.name)).toEqual(['Button', 'Text field']);
  });
});
