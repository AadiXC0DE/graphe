/** Which rows of a long thread are actually in the document.
 *
 * The arithmetic, on its own: rows are not one height here — a turn is a line
 * or a wall of Markdown — so the window has to work from what has been measured
 * and a guess for what has not, and the empty room it leaves above and below
 * has to add up, or the scrollbar lies about how long the conversation is.
 *
 * Heights are held against a row's own id, so what these prove is that a height
 * lands on the row it was measured from and stays there while the list moves
 * under it: a turn arriving at the end, a row inserted in the middle, a row
 * measuring something else the second time.
 */

import { describe, expect, it } from 'vitest';

import { GUESS, OVER, RowHeights, windowOf } from '../src/lib/windowed';

/** Rows nobody has drawn, all worth the same guess — the easy case to reason
 *  about. */
function even(count: number, tall: number): RowHeights {
  const sizes = new RowHeights(tall);
  sizes.sync(Array.from({ length: count }, (_, at) => `row-${String(at)}`));
  return sizes;
}

function keys(howMany: number, from = 0): string[] {
  return Array.from({ length: howMany }, (_, at) => `row-${String(from + at)}`);
}

/** What the drawn rows cover, in pixels from the top of the list. */
function covered(sizes: RowHeights, span: { first: number; last: number }): { top: number; bottom: number } {
  return { top: sizes.offsetOf(span.first), bottom: sizes.offsetOf(span.last) };
}

describe('the slice on screen', () => {
  it('is the rows the visible area crosses, plus a few either side', () => {
    const sizes = even(1000, 100);
    const span = windowOf({ sizes, top: 5000, height: 800 });
    // Rows 50..57 are on screen; `over` keeps six more each way.
    expect(span.first).toBe(50 - OVER);
    expect(span.last).toBe(58 + OVER);
  });

  it('never asks for a row that is not there', () => {
    const span = windowOf({ sizes: even(20, 100), top: 0, height: 4000 });
    expect(span.first).toBe(0);
    expect(span.last).toBe(20);
    expect(span.before).toBe(0);
    expect(span.after).toBe(0);
  });

  it('holds an empty thread without drawing anything', () => {
    expect(windowOf({ sizes: new RowHeights(), top: 0, height: 800 })).toEqual({
      first: 0,
      last: 0,
      before: 0,
      after: 0,
    });
  });

  it('draws what is on screen and nothing above or below it', () => {
    // Every row a different height, measured, so nothing is a guess.
    const sizes = new RowHeights();
    sizes.sync(keys(400));
    keys(400).forEach((key, at) => sizes.measure(key, 40 + ((at * 37) % 260)));

    const top = 12_000;
    const height = 700;
    const span = windowOf({ sizes, top, height });
    const drawn = covered(sizes, span);
    // What is drawn covers the whole visible band...
    expect(drawn.top).toBeLessThanOrEqual(top);
    expect(drawn.bottom).toBeGreaterThanOrEqual(top + height);
    // ...and, without the overscan, no more than the band plus one row either end.
    const tight = windowOf({ sizes, top, height, over: 0 });
    const bare = covered(sizes, tight);
    expect(sizes.offsetOf(tight.first - 1)).toBeLessThanOrEqual(top);
    expect(sizes.offsetOf(tight.last + 1)).toBeGreaterThanOrEqual(top + height);
    expect(bare.top).toBeLessThanOrEqual(top);
    expect(bare.bottom).toBeGreaterThanOrEqual(top + height);
  });
});

describe('the room left for the rows that are not drawn', () => {
  it('adds up to the whole conversation, so the scrollbar tells the truth', () => {
    const sizes = even(1000, 100);
    const span = windowOf({ sizes, top: 5000, height: 800 });
    expect(span.before + sizes.offsetOf(span.last) - sizes.offsetOf(span.first) + span.after).toBe(
      100_000,
    );
    expect(span.before + span.after + (span.last - span.first) * 100).toBe(100_000);
  });

  it('holds together when the rows are all different heights', () => {
    const sizes = new RowHeights();
    sizes.sync(keys(400));
    let total = 0;
    keys(400).forEach((key, at) => {
      const tall = 40 + ((at * 37) % 260);
      total += tall;
      sizes.measure(key, tall);
    });
    const span = windowOf({ sizes, top: 12_000, height: 700 });
    const drawn = covered(sizes, span);
    expect(span.before + (drawn.bottom - drawn.top) + span.after).toBe(total);
    expect(span.first).toBeLessThan(span.last);
  });
});

describe('a height lands on the row it was measured from', () => {
  it('keeps every row its own measurement as the list grows', () => {
    const sizes = new RowHeights();
    sizes.sync(['first', 'second']);
    expect(sizes.measure('second', 500)).toBe(true);
    expect(sizes.total()).toBe(500 + GUESS);
    expect(sizes.offsetOfKey('second')).toBe(GUESS);

    // A turn arriving at the end moves nothing.
    sizes.sync(['first', 'second', 'third']);
    expect(sizes.offsetOfKey('second')).toBe(GUESS);
    expect(sizes.total()).toBe(500 + GUESS + GUESS);
  });

  it('does not hand a measured height to the row that replaced it', () => {
    const sizes = new RowHeights();
    sizes.sync(['a', 'b', 'c']);
    sizes.measure('a', 300);
    sizes.measure('c', 900);

    // Something is inserted between them, which moves b and c along.
    sizes.sync(['a', 'new', 'b', 'c']);
    expect(sizes.offsetOfKey('b')).toBe(300 + GUESS);
    expect(sizes.offsetOfKey('c')).toBe(300 + 2 * GUESS);
    expect(sizes.total()).toBe(300 + 2 * GUESS + 900);

    // The window follows the ids, not the places they used to hold.
    const span = windowOf({ sizes, top: 300 + 2 * GUESS, height: 900, over: 0 });
    expect(span.first).toBe(3);
    expect(span.last).toBe(4);
    expect(span.before).toBe(300 + 2 * GUESS);
    expect(span.after).toBe(0);
  });

  it('moves the totals when a row measures something else', () => {
    const sizes = new RowHeights();
    sizes.sync(['a', 'b', 'c']);
    sizes.measure('a', 40);
    sizes.measure('b', 400);
    expect(sizes.offsetOf(1)).toBe(40);
    expect(sizes.offsetOfKey('c')).toBe(440);

    // A row that grew — a reply arriving a token at a time.
    sizes.measure('b', 700);
    expect(sizes.offsetOfKey('c')).toBe(740);
    expect(sizes.total()).toBe(740 + GUESS);
    // Measuring the same height twice is not a change.
    expect(sizes.measure('b', 700)).toBe(false);
  });

  it('ignores a measurement for a row it does not have, and a height of none', () => {
    const sizes = new RowHeights();
    sizes.sync(['a', 'b']);
    expect(sizes.measure('gone', 400)).toBe(false);
    expect(sizes.measure('a', 0)).toBe(false);
    expect(sizes.total()).toBe(2 * GUESS);
  });

  it('says which row a page-top is standing on, and how far into it', () => {
    const sizes = new RowHeights();
    sizes.sync(keys(10));
    keys(10).forEach((key) => sizes.measure(key, 100));
    expect(sizes.standing(250)).toEqual({ at: 2, into: 50 });
    expect(sizes.standing(0)).toEqual({ at: 0, into: 0 });
    // Past the foot of the list, there is no row left to stand on.
    expect(sizes.standing(2000)).toEqual({ at: 10, into: 1000 });
  });
});

describe('scrolling asks a question, it does not rebuild', () => {
  it('leaves the totals alone however often it is asked', () => {
    const sizes = even(5000, 120);
    const built = sizes.rebuilds();
    for (let step = 0; step < 2000; step += 1) windowOf({ sizes, top: step * 37, height: 800 });
    expect(sizes.rebuilds()).toBe(built);
    // A row arriving at the end is added to the totals rather than rebuilt.
    sizes.sync(keys(5001));
    expect(sizes.rebuilds()).toBe(built);
    expect(sizes.measure('row-4999', 260)).toBe(true);
    expect(sizes.rebuilds()).toBe(built);
  });

  it('rebuilds only when the ids themselves moved', () => {
    const sizes = even(4, 100);
    expect(sizes.sync(keys(4))).toBe(false);
    // Rearranging them is the one thing that cannot be added to.
    expect(sizes.sync([...keys(4)].reverse())).toBe(true);
    expect(sizes.rebuilds()).toBe(1);
  });
});

describe('rows nobody has drawn yet', () => {
  it('are guessed at rather than counted as nothing', () => {
    // A zero-height row would put the whole thread at the top of the scroller.
    const span = windowOf({ sizes: new RowHeights(), top: 0, height: 800 });
    expect(span.after).toBe(0);
    const guessed = windowOf({ sizes: even(1000, GUESS), top: 0, height: 800 });
    expect(guessed.after).toBe((1000 - guessed.last) * GUESS);
  });

  it('take the measurement the moment there is one', () => {
    const span = windowOf({ sizes: even(1000, 400), top: 0, height: 800 });
    expect(span.after).toBe((1000 - span.last) * 400);
  });

  it('can be guessed at by the caller, for a thread of one-liners', () => {
    const span = windowOf({ sizes: even(500, 24), top: 0, height: 800 });
    expect(span.after).toBe((500 - span.last) * 24);
  });
});

describe('scrolled past the end', () => {
  it('still draws the last rows rather than nothing at all', () => {
    const span = windowOf({ sizes: even(50, 100), top: 9000, height: 800 });
    expect(span.last).toBe(50);
    expect(span.first).toBeLessThan(50);
  });
});
