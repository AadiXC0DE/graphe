/** Only the rows anybody can see.
 *
 * A three-thousand-turn conversation puts three thousand rows in the document,
 * and every token that lands asks the browser to lay all of them out again.
 * This works out which slice is actually on screen and how much empty room to
 * leave above and below it, so the scrollbar stays honest.
 *
 * Rows here are not one height — a turn is a line or a wall of Markdown — so
 * heights are measured as they are drawn and estimated until then. They are
 * held against the row's own id rather than against its place in the list: one
 * row inserted in the middle moves every row after it, and a height handed to
 * the wrong row is a long change that crawls for the rest of the sitting. The
 * running totals are kept in a Fenwick tree over those heights, so measuring
 * one row and asking where one starts both cost a logarithm rather than a walk
 * down the list, and scrolling rebuilds nothing.
 *
 * `windowOf` is the whole of the arithmetic and knows nothing about React.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** A row nobody has drawn yet, until it can be measured. */
export const GUESS = 120;
/** Rows kept either side of what is visible, so a flick of the wheel lands on
 *  something already drawn rather than on a gap. */
export const OVER = 6;
/** Near enough to the foot of the list that the newest thing is being read. A
 *  keyed list keeps a reader's place, and somebody already at the newest thing
 *  wants the newest thing rather than the row they were on. */
const STILL_THE_END = 40;

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

/** The window of an empty list. */
export const NOTHING: Span = { first: 0, last: 0, before: 0, after: 0 };

/**
 * What each row measures, by the row's own id.
 *
 * A row nobody has drawn is worth the guess; drawing it replaces the guess with
 * the truth and moves every row below it by the difference. That edit, and an
 * insert anywhere, both have to be cheap: a conversation arriving a token at a
 * time asks where things are on every frame.
 *
 * So the heights sit in an array indexed the way the rows are drawn, the id →
 * place mapping is a map, and the running totals sit above both in a Fenwick
 * tree — one entry per row holding a partial sum. An update touches the log of
 * the rows, a prefix sum reads the log of them, and the whole tree is only ever
 * built again when the list of ids is not the list it was.
 */
export class RowHeights {
  /** The rows, in the order they are drawn. */
  #keys: string[] = [];
  /** A row's id → its place in `#keys`. */
  #at = new Map<string, number>();
  /** What each row measures: the guess until somebody has drawn it. */
  #tall: number[] = [];
  /** The running totals, one node per row, one-based. */
  #sums: number[] = [0];
  #total = 0;
  readonly #guess: number;
  #rebuilds = 0;

  constructor(guess: number = GUESS) {
    this.#guess = guess;
  }

  get count(): number {
    return this.#keys.length;
  }

  get guess(): number {
    return this.#guess;
  }

  /** How many times the totals were built afresh. The scroll path must never
   *  add to this: scrolling asks where things are, it changes nothing. */
  rebuilds(): number {
    return this.#rebuilds;
  }

  /**
   * The heights for these rows, keeping what was measured for every id that is
   * still here and guessing at the rest. False when the list is the one already
   * held, which is the ordinary answer while a reply is being written.
   */
  sync(keys: readonly string[]): boolean {
    const was = this.#keys;
    let shared = 0;
    while (shared < was.length && shared < keys.length && was[shared] === keys[shared]) {
      shared += 1;
    }
    if (shared === was.length && shared === keys.length) return false;

    // A turn arriving at the end of the list is the common case by far, and it
    // costs a logarithm rather than a rebuild. `was` is the array itself and
    // this loop grows it, so the place the new rows start is read off first.
    const from = was.length;
    if (shared === from) {
      for (let at = from; at < keys.length; at += 1) {
        const key = keys[at];
        if (key === undefined) continue;
        this.#keys.push(key);
        this.#at.set(key, at);
        this.#tall.push(this.#guess);
        // A new Fenwick node also owns older rows in its covered range.
        // Starting at zero loses those rows at every power-of-two boundary.
        const node = at + 1;
        const start = node - (node & -node);
        this.#sums.push(this.#prefix(at) - this.#prefix(start) + this.#guess);
        this.#total += this.#guess;
      }
      return true;
    }

    const measured = new Map<string, number>();
    for (let at = 0; at < from; at += 1) {
      const key = was[at];
      const tall = this.#tall[at];
      if (key !== undefined && tall !== undefined) measured.set(key, tall);
    }
    this.#keys = [];
    this.#at.clear();
    this.#tall = [];
    for (const key of keys) {
      // An id twice over is a bug upstream; the first place stands.
      if (this.#at.has(key)) continue;
      this.#at.set(key, this.#keys.length);
      this.#keys.push(key);
      this.#tall.push(measured.get(key) ?? this.#guess);
    }
    this.#build();
    return true;
  }

  /**
   * What one row measures, once it has been drawn. False when nothing moved —
   * most measurements, since a row is drawn the same height twice in a row.
   */
  measure(key: string, height: number): boolean {
    const at = this.#at.get(key);
    if (at === undefined || !(height > 0)) return false;
    const was = this.#tall[at] ?? this.#guess;
    if (was === height) return false;
    this.#tall[at] = height;
    this.#add(at, height - was);
    this.#total += height - was;
    return true;
  }

  /** What one row is laid out with: its measurement, or the guess. */
  heightAt(index: number): number {
    return this.#tall[index] ?? this.#guess;
  }

  /** The id of the row at a place in the list, so a scroll can name what it is
   *  standing on. */
  keyAt(index: number): string | undefined {
    return this.#keys[index];
  }

  /** Where a row sits in the list, or null when it is not one of them. */
  indexOf(key: string): number | null {
    return this.#at.get(key) ?? null;
  }

  /** Everything, measured or guessed. Constant time: kept as rows move. */
  total(): number {
    return this.#total;
  }

  /** The pixels above row `index`. A logarithm, which is the point of the tree. */
  offsetOf(index: number): number {
    return this.#prefix(index);
  }

  /** The pixels above the row with this id, or null when it is gone. */
  offsetOfKey(key: string): number | null {
    const at = this.#at.get(key);
    return at === undefined ? null : this.#prefix(at);
  }

  /** How many rows end at or above `offset`. */
  rowsAbove(offset: number): number {
    if (!(offset > 0)) return 0;
    return this.#lowerBound(offset, false);
  }

  /** How many rows begin above `offset` — one past the last row on screen.
   *  The bound below counts rows that *end* before it, so the row that begins
   *  inside the offset is the one this adds back. */
  startsBefore(offset: number): number {
    if (!(offset > 0)) return 0;
    return Math.min(this.#keys.length, this.#lowerBound(offset, true) + 1);
  }

  /** The row the top of a visible area is standing on, and how far into it. */
  standing(offset: number): { at: number; into: number } {
    const at = this.rowsAbove(offset);
    return { at, into: Math.max(0, offset - this.offsetOf(at)) };
  }

  /* ------------------------------------------------------------------------ */
  /* The tree                                                                  */
  /* ------------------------------------------------------------------------ */

  /** Add to the totals above `index`. */
  #add(index: number, delta: number): void {
    for (let node = index + 1; node < this.#sums.length; node += node & -node) {
      this.#sums[node] = (this.#sums[node] ?? 0) + delta;
    }
  }

  /** The pixels above the first `rows` rows. */
  #prefix(rows: number): number {
    let sum = 0;
    for (
      let node = Math.max(0, Math.min(this.#keys.length, rows));
      node > 0;
      node -= node & -node
    ) {
      sum += this.#sums[node] ?? 0;
    }
    return sum;
  }

  /** How many rows have their foot at or above `pixels` — or, when `strict`,
   *  their head above it. Which of the two is the difference between a row
   *  that ends at the foot of the visible area and one that begins there. */
  #lowerBound(pixels: number, strict: boolean): number {
    let at = 0;
    let sum = 0;
    let step = 1;
    while (step * 2 <= this.#keys.length) step *= 2;
    for (; step > 0; step = Math.floor(step / 2)) {
      const next = at + step;
      if (next > this.#keys.length) continue;
      const grown = sum + (this.#sums[next] ?? 0);
      if (strict ? grown < pixels : grown <= pixels) {
        at = next;
        sum = grown;
      }
    }
    return at;
  }

  /** Build the tree from the heights. Only ever after the ids themselves moved. */
  #build(): void {
    this.#rebuilds += 1;
    const count = this.#keys.length;
    this.#sums = new Array<number>(count + 1).fill(0);
    for (let at = 0; at < count; at += 1) {
      const tall = this.#tall[at] ?? this.#guess;
      this.#sums[at + 1] = (this.#sums[at + 1] ?? 0) + tall;
      const above = at + 1 + ((at + 1) & -(at + 1));
      if (above <= count) this.#sums[above] = (this.#sums[above] ?? 0) + (this.#sums[at + 1] ?? 0);
    }
    this.#total = this.#prefix(count);
  }
}

export function windowOf(input: {
  /** What each row measures, by id. */
  sizes: RowHeights;
  /** How far the top of the list is above the top of the visible area. */
  top: number;
  /** How much of the scroller is visible. */
  height: number;
  over?: number;
}): Span {
  const { sizes, top, height } = input;
  const over = input.over ?? OVER;
  const count = sizes.count;
  if (count === 0) return NOTHING;

  const first = Math.min(count, sizes.rowsAbove(top));
  const last = Math.min(count, sizes.startsBefore(top + height));
  const from = Math.max(0, first - over);
  const to = Math.min(count, last + over);
  return {
    first: from,
    last: to,
    before: sizes.offsetOf(from),
    after: sizes.total() - sizes.offsetOf(to),
  };
}

/**
 * The window, kept up to date as the reader scrolls.
 *
 * `measure` goes on each drawn row, keyed by the row's id; everything else
 * follows from it. The list is measured against the scroller it sits in rather
 * than against the page, because the thread is one band inside a window with
 * its own header.
 *
 * A row is watched rather than read once, because rows grow: a reply arriving a
 * token at a time, a picture that was not there when the row was drawn. And the
 * reader's place is kept across an insert of any size — somebody who presses
 * "show earlier turns" is looking at one turn, not at an offset.
 */
export function useWindowed(
  keys: readonly string[],
  where: {
    scroller: RefObject<HTMLElement | null>;
    list: RefObject<HTMLElement | null>;
    guess?: number;
    over?: number;
  },
): Span & {
  measure: (key: string, el: HTMLElement | null) => void;
  sizes: RowHeights;
} {
  const { scroller, list, guess, over } = where;
  const held = useRef<RowHeights | null>(null);
  held.current ??= new RowHeights(guess ?? GUESS);
  const sizes = held.current;
  const [span, setSpan] = useState<Span>(NOTHING);

  /** The reader's place: the row their eye is on, how far into it, and the
   *  element it was drawn as — a row is put back by its own box rather than by
   *  arithmetic when the browser still has it. */
  const place = useRef<{
    key: string;
    into: number;
    el: HTMLElement | null;
    top: number;
  } | null>(null);
  /** Whether the newest thing was on screen, in which case it still should be. */
  const atEnd = useRef(false);
  /** Set for the one render after the ids moved: `null` means "do not keep a
   *  place", a row means "keep this one". */
  const moved = useRef<typeof place.current | undefined>(undefined);
  /** Which element drew which row, so a resize can be attributed. */
  const drawn = useRef(new Map<HTMLElement, string>());
  const watch = useRef<ResizeObserver | null>(null);
  /** The space the list puts between two rows, read once per list. */
  const spaced = useRef<{ list: HTMLElement | null; gap: number }>({ list: null, gap: 0 });

  if (sizes.sync(keys)) moved.current = atEnd.current ? null : place.current;

  /* Where row zero starts, and how far the top of the visible area is below it.
     Taken from a row that is actually drawn rather than from the element holding
     them, because what sits above the first row — the press that reaches the
     rest of the conversation — is not a row and must not be counted twice. The
     row's own rectangle is where the model says it is, so taking the rows above
     it back off puts row zero where the arithmetic expects it. */
  const geometry = useCallback(() => {
    const pane = scroller.current;
    const band = list.current;
    if (pane === null || band === null) return null;
    const paneAt = pane.getBoundingClientRect();
    let from = -1;
    let origin = band.getBoundingClientRect().top;
    for (const [el, key] of drawn.current) {
      // A row React has just let go of is still in this map until the browser
      // has been told: a detached element has no rectangle, and believing one
      // would put row zero at the top of the window. Swept here, where the
      // elements that are really drawn are the ones being read.
      if (!el.isConnected) {
        drawn.current.delete(el);
        watch.current?.unobserve(el);
        continue;
      }
      const at = sizes.indexOf(key);
      if (at === null) continue;
      if (from === -1 || at < from) {
        from = at;
        origin = el.getBoundingClientRect().top - sizes.offsetOf(at);
      }
    }
    // `origin` is row zero's own place on screen and `paneTop` is the top of
    // what somebody can see; `top` is how far apart those are, in row pixels.
    return {
      pane,
      origin,
      paneTop: paneAt.top,
      top: paneAt.top - origin,
      height: paneAt.height,
    };
  }, [list, scroller, sizes]);

  const settle = useCallback(() => {
    const found = geometry();
    if (found === null) return;
    const { pane, top } = found;
    const next = windowOf({
      sizes,
      top,
      height: found.height,
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

    atEnd.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= STILL_THE_END;
    const standing = sizes.standing(top);
    const key = sizes.keyAt(standing.at);
    if (key === undefined) {
      place.current = null;
      return;
    }
    let el: HTMLElement | null = null;
    for (const [candidate, drawnKey] of drawn.current) {
      if (drawnKey !== key) continue;
      el = candidate;
      break;
    }
    place.current = {
      key,
      into: standing.into,
      el,
      top: el === null ? 0 : el.getBoundingClientRect().top,
    };
  }, [geometry, over, sizes]);

  /* What one row is worth to the arithmetic: its own height plus the space the
     list keeps under it. A row measures only its own box, so without the gap a
     window slides by one row and the content under the reader jumps by sixteen
     pixels every time. */
  const strideOf = useCallback(
    (el: HTMLElement): number => {
      const band = list.current;
      if (band !== null && spaced.current.list !== band) {
        const said = Number.parseFloat(getComputedStyle(band).rowGap);
        spaced.current = { list: band, gap: Number.isFinite(said) && said > 0 ? said : 0 };
      }
      return el.offsetHeight + spaced.current.gap;
    },
    [list],
  );

  const measure = useCallback(
    (key: string, el: HTMLElement | null) => {
      if (el === null) return;
      drawn.current.set(el, key);
      watch.current?.observe(el);
      if (sizes.measure(key, strideOf(el))) settle();
    },
    [settle, sizes, strideOf],
  );

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      let moved = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = drawn.current.get(el);
        if (key === undefined) continue;
        if (sizes.measure(key, strideOf(el))) moved = true;
      }
      if (moved) settle();
    });
    watch.current = observer;
    for (const el of drawn.current.keys()) observer.observe(el);
    return () => {
      observer.disconnect();
      watch.current = null;
    };
  }, [settle, sizes, strideOf]);

  /* An insert above the reader moves every row below it down the document. The
     row they were on goes back where it was on screen, which is a difference in
     its own box while the browser still has it and arithmetic when it does not. */
  useLayoutEffect(() => {
    if (moved.current === undefined) return;
    const keep = moved.current;
    moved.current = undefined;
    const found = geometry();
    if (keep !== null && found !== null) {
      if (keep.el !== null && keep.el.isConnected) {
        found.pane.scrollTop += keep.el.getBoundingClientRect().top - keep.top;
      } else {
        const offset = sizes.offsetOfKey(keep.key);
        if (offset !== null) {
          // Row zero's own place in the list, plus where the row is from there.
          const zero = found.origin - found.paneTop + found.pane.scrollTop;
          found.pane.scrollTop = zero + offset + keep.into;
        }
      }
    }
    settle();
  });

  useEffect(() => {
    const pane = scroller.current;
    if (pane === null) return;
    pane.addEventListener('scroll', settle, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(settle);
    resize?.observe(pane);
    settle();
    return () => {
      pane.removeEventListener('scroll', settle);
      resize?.disconnect();
    };
  }, [settle, scroller]);

  return { ...span, measure, sizes };
}
