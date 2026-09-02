/** Only the rows anybody can see.
 *
 * A three-thousand-turn conversation puts three thousand rows in the document,
 * and every token that lands asks the browser to lay all of them out again.
 * This works out which slice is actually on screen and how much empty room to
 * leave above and below it, so the scrollbar stays honest.
 *
 * Rows here are not one height — a turn is a line or a wall of Markdown — so
 * heights are measured as they are drawn and estimated until then. `windowOf`
 * is the whole of the arithmetic and knows nothing about React.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** A row nobody has drawn yet, until it can be measured. */
export const GUESS = 120;
/** Rows kept either side of what is visible, so a flick of the wheel lands on
 *  something already drawn rather than on a gap. */
export const OVER = 6;

/** Which rows to draw, and the room the rest of them need. */
export type Span = {
  first: number;
  /** One past the last row to draw, so `slice(first, last)` is the window. */
  last: number;
  /** Pixels of nothing above the window. */
  before: number;
  /** Pixels of nothing below it. */
  after: number;
};

export function windowOf(input: {
  /** Measured heights by row. A missing or zero entry has not been drawn yet. */
  heights: readonly number[];
  count: number;
  /** How far the top of the list is above the top of the visible area. */
  top: number;
  /** How much of the scroller is visible. */
  height: number;
  guess?: number;
  over?: number;
}): Span {
  const { heights, count, top, height } = input;
  const guess = input.guess ?? GUESS;
  const over = input.over ?? OVER;
  if (count === 0) return { first: 0, last: 0, before: 0, after: 0 };

  const tall = (at: number): number => {
    const measured = heights[at];
    return measured === undefined || measured <= 0 ? guess : measured;
  };

  const bottom = top + height;
  let running = 0;
  let first = 0;
  while (first < count && running + tall(first) <= top) {
    running += tall(first);
    first += 1;
  }
  let last = first;
  let below = running;
  while (last < count && below < bottom) {
    below += tall(last);
    last += 1;
  }

  const from = Math.max(0, first - over);
  const to = Math.min(count, last + over);
  let before = 0;
  for (let at = 0; at < from; at += 1) before += tall(at);
  let after = 0;
  for (let at = to; at < count; at += 1) after += tall(at);
  return { first: from, last: to, before, after };
}

/**
 * The window, kept up to date as the reader scrolls.
 *
 * `measure` goes on each drawn row; everything else follows from it. The list
 * is measured against the scroller it sits in rather than against the page,
 * because the thread is one band inside a window with its own header.
 */
export function useWindowed(
  count: number,
  where: {
    scroller: RefObject<HTMLElement | null>;
    list: RefObject<HTMLElement | null>;
    guess?: number;
    over?: number;
  },
): Span & { measure: (at: number, el: HTMLElement | null) => void } {
  const { scroller, list, guess, over } = where;
  const heights = useRef<number[]>([]);
  const [span, setSpan] = useState<Span>({ first: 0, last: count, before: 0, after: 0 });

  const settle = useCallback(() => {
    const pane = scroller.current;
    const band = list.current;
    if (pane === null || band === null) return;
    const paneAt = pane.getBoundingClientRect();
    const bandAt = band.getBoundingClientRect();
    const next = windowOf({
      heights: heights.current,
      count,
      top: Math.max(0, paneAt.top - bandAt.top),
      height: paneAt.height,
      ...(guess === undefined ? {} : { guess }),
      ...(over === undefined ? {} : { over }),
    });
    setSpan((was) =>
      was.first === next.first &&
      was.last === next.last &&
      was.before === next.before &&
      was.after === next.after
        ? was
        : next,
    );
  }, [count, guess, over, scroller, list]);

  const measure = useCallback(
    (at: number, el: HTMLElement | null) => {
      if (el === null) return;
      const tall = el.offsetHeight;
      if (tall <= 0 || heights.current[at] === tall) return;
      heights.current[at] = tall;
      settle();
    },
    [settle],
  );

  useEffect(() => {
    const pane = scroller.current;
    if (pane === null) return;
    pane.addEventListener('scroll', settle, { passive: true });
    const watch =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { settle(); });
    watch?.observe(pane);
    settle();
    return () => {
      pane.removeEventListener('scroll', settle);
      watch?.disconnect();
    };
  }, [settle, scroller]);

  return { ...span, measure };
}
