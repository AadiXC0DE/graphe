/** Which rows of a long thread are actually in the document.
 *
 * The arithmetic, on its own: rows are not one height here — a turn is a line
 * or a wall of Markdown — so the window has to work from what has been measured
 * and a guess for what has not, and the empty room it leaves above and below
 * has to add up, or the scrollbar lies about how long the conversation is.
 */

import { describe, expect, it } from 'vitest';

import { GUESS, OVER, windowOf } from '../src/lib/windowed';

/** Rows all the same height, which is the easy case to reason about. */
const even = (count: number, tall: number) => Array.from({ length: count }, () => tall);

describe('the slice on screen', () => {
  it('is the rows the visible area crosses, plus a few either side', () => {
    const span = windowOf({ heights: even(1000, 100), count: 1000, top: 5000, height: 800 });
    // Rows 50..57 are on screen; `over` keeps six more each way.
    expect(span.first).toBe(50 - OVER);
    expect(span.last).toBe(58 + OVER);
  });

  it('never asks for a row that is not there', () => {
    const span = windowOf({ heights: even(20, 100), count: 20, top: 0, height: 4000 });
    expect(span.first).toBe(0);
    expect(span.last).toBe(20);
    expect(span.before).toBe(0);
    expect(span.after).toBe(0);
  });

  it('holds an empty thread without drawing anything', () => {
    expect(windowOf({ heights: [], count: 0, top: 0, height: 800 })).toEqual({
      first: 0,
      last: 0,
      before: 0,
      after: 0,
    });
  });
});

describe('the room left for the rows that are not drawn', () => {
  it('adds up to the whole conversation, so the scrollbar tells the truth', () => {
    const heights = even(1000, 100);
    const span = windowOf({ heights, count: 1000, top: 5000, height: 800 });
    const drawn = heights.slice(span.first, span.last).reduce((sum, one) => sum + one, 0);
    expect(span.before + drawn + span.after).toBe(100_000);
  });

  it('holds together when the rows are all different heights', () => {
    const heights = Array.from({ length: 400 }, (_, at) => 40 + ((at * 37) % 260));
    const total = heights.reduce((sum, one) => sum + one, 0);
    const span = windowOf({ heights, count: 400, top: 12_000, height: 700 });
    const drawn = heights.slice(span.first, span.last).reduce((sum, one) => sum + one, 0);
    expect(span.before + drawn + span.after).toBe(total);
    expect(span.first).toBeLessThan(span.last);
  });
});

describe('rows nobody has drawn yet', () => {
  it('are guessed at rather than counted as nothing', () => {
    // A zero-height row would put the whole thread at the top of the scroller.
    const span = windowOf({ heights: [], count: 1000, top: 0, height: 800 });
    expect(span.after).toBe((1000 - span.last) * GUESS);
  });

  it('take the measurement the moment there is one', () => {
    const heights = even(1000, 400);
    const span = windowOf({ heights, count: 1000, top: 0, height: 800 });
    expect(span.after).toBe((1000 - span.last) * 400);
  });

  it('can be guessed at by the caller, for a thread of one-liners', () => {
    const span = windowOf({ heights: [], count: 500, top: 0, height: 800, guess: 24 });
    expect(span.after).toBe((500 - span.last) * 24);
  });
});

describe('scrolled past the end', () => {
  it('still draws the last rows rather than nothing at all', () => {
    const span = windowOf({ heights: even(50, 100), count: 50, top: 9000, height: 800 });
    expect(span.last).toBe(50);
    expect(span.first).toBeLessThan(50);
  });
});
