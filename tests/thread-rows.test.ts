/** The conversation in the document is only the part somebody can see.
 *
 * What a long thread costs is the document itself: thousands of turns in it,
 * laid out again for every token that arrives. So the rows on screen are drawn
 * and the rest are two blocks of empty room, and what this proves is the four
 * things that make that safe — a screenful and no more, the right screenful as
 * somebody scrolls, the row they were reading put back where it was when five
 * hundred older turns arrive above it, and a row that grows (a reply still
 * being written, a picture that has only just arrived) moving everything below
 * it rather than being measured once and forgotten.
 *
 * React is real and so is its DOM; the layout is a stub, because jsdom has no
 * layout engine. Heights and positions come from a one-dimensional model that
 * is exactly the model the windowing assumes: a drawn row is worth what it
 * measures, a spacer is worth the rows it stands in for, and a rectangle is
 * where the sum of everything before it says it is.
 */

// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { beforeEach, describe, expect, it } from 'vitest';

import { ThreadRows, rowKey } from '../src/components/ThreadRows';
import type { Row } from '../src/lib/steps';
import { said } from '../src/lib/thread';

/** How much of the window the conversation is read through. */
const PANE = 400;
/** What one turn measures. Even, so the arithmetic under test has an answer
 *  that is not itself a measurement. */
const TALL = 120;

/** What each row measures, by the row's own id. */
const sizes = new Map<string, number>();

class StubResize {
  static all: StubResize[] = [];
  readonly #say: (entries: { target: Element }[]) => void;
  constructor(say: (entries: { target: Element }[]) => void) {
    this.#say = say;
    StubResize.all.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  /** Tell every observer about one element, as a resize would. */
  static tell(target: Element): void {
    for (const one of StubResize.all) one.#say([{ target }]);
  }
  static forget(): void {
    StubResize.all = [];
  }
}

/** What one element is worth: a row what it measures, a spacer what it says. */
function heightOf(el: Element): number {
  const id = (el as HTMLElement).dataset['id'];
  if (id !== undefined) return sizes.get(id) ?? 0;
  const said = Number.parseFloat((el as HTMLElement).style.height);
  return Number.isFinite(said) ? said : 0;
}

/** How far into its parent an element starts. */
function offsetIn(el: Element): number {
  let sum = 0;
  for (let before = el.previousElementSibling; before !== null; before = before.previousElementSibling) {
    sum += heightOf(before);
  }
  const up = el.parentElement;
  return sum + (up === null ? 0 : offsetIn(up));
}

type Harness = {
  pane: HTMLElement;
  ids(rows: readonly Row[]): string[];
  scrollTo(top: number): void;
  drawn(): HTMLElement[];
  height(): number;
  show(rows: readonly Row[]): void;
  gone(): void;
};

async function harness(): Promise<Harness> {
  StubResize.forget();
  const globals = globalThis as unknown as { ResizeObserver: unknown; IS_REACT_ACT_ENVIRONMENT: boolean };
  globals.ResizeObserver = StubResize;
  globals.IS_REACT_ACT_ENVIRONMENT = true;

  const box = document.createElement('div');
  document.body.appendChild(box);
  const pane = document.createElement('div');
  box.appendChild(pane);
  // The thread is drawn inside the scroller, which is what it is measured
  // against — the real window is one page with the conversation as one band.
  const root = createRoot(pane);

  let scrolled = 0;
  Object.defineProperty(pane, 'scrollTop', {
    configurable: true,
    get: () => scrolled,
    set: (next: number) => {
      scrolled = next;
    },
  });
  Object.defineProperty(pane, 'clientHeight', { configurable: true, get: () => PANE });

  /* The one-dimensional layout: every element anywhere in the conversation is
     where the sum of the heights before it says it is. */
  const rects = Element.prototype.getBoundingClientRect;
  const offsetHeights = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return heightOf(this);
    },
  });
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element): DOMRect {
      if (this === pane) return { top: 0, height: PANE } as DOMRect;
      if (!pane.contains(this)) return rects.call(this);
      return { top: offsetIn(this) - scrolled, height: heightOf(this) } as DOMRect;
    },
  });
  Object.defineProperty(pane, 'scrollHeight', {
    configurable: true,
    get: () => {
      const thread = pane.firstElementChild;
      if (thread === null) return 0;
      let total = 0;
      for (const child of Array.from(thread.children)) total += heightOf(child);
      return total;
    },
  });

  const scroller = { current: pane as HTMLElement | null };
  const draw = (row: Row, _at: number, mark: (el: HTMLElement | null) => void): ReactNode =>
    createElement('div', { ref: mark, className: 'row', 'data-id': rowKey(row) });

  const show = (rows: readonly Row[]): void => {
    act(() => {
      root.render(createElement(ThreadRows, { rows, scroller, draw, guess: TALL, over: 6 }));
    });
  };

  return {
    pane,
    ids: (rows) => rows.map(rowKey),
    scrollTo(top) {
      pane.scrollTop = top;
      act(() => {
        pane.dispatchEvent(new Event('scroll'));
      });
    },
    drawn: () => Array.from(pane.querySelectorAll('[data-id]')) as HTMLElement[],
    height: () => pane.scrollHeight,
    show,
    gone() {
      act(() => root.unmount());
      box.remove();
      Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: rects,
      });
      if (offsetHeights !== undefined) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeights);
      }
    },
  };
}

/** A conversation of `count` turns, each of them the same height. */
function conversation(count: number, prefix = ''): Row[] {
  const rows: Row[] = [];
  for (let at = 0; at < count; at += 1) {
    const turn = said('you', `${prefix}${String(at)}`);
    sizes.set(turn.id, TALL);
    rows.push({ kind: 'one', turn });
  }
  return rows;
}

const idOf = (rows: readonly Row[], at: number): string => rowKey(rows[at] as Row);

beforeEach(() => {
  sizes.clear();
  document.body.replaceChildren();
});

describe('a long conversation in the document', () => {
  it('draws a screenful and a little either side, not the whole sitting', async () => {
    const rows = conversation(1000);
    const on = await harness();
    on.show(rows);

    const drawn = on.drawn();
    expect(drawn.length).toBeGreaterThan(5);
    expect(drawn.length).toBeLessThan(40);
    // A thousand turns, and the end of them is not in the document at all.
    expect(on.ids(rows)).toContain(drawn[0]?.dataset['id'] ?? '');
    expect(drawn.some((el) => el.dataset['id'] === idOf(rows, 999))).toBe(false);
    on.gone();
  });

  it('draws the rows somebody has scrolled to', async () => {
    const rows = conversation(1000);
    const on = await harness();
    on.show(rows);

    on.scrollTo(300 * TALL);

    const ids = on.drawn().map((el) => el.dataset['id']);
    expect(ids).toContain(idOf(rows, 300));
    expect(ids).not.toContain(idOf(rows, 0));
    // The row the pane's top is standing on is at the pane's top or above it.
    const standing = on.drawn().find((el) => el.dataset['id'] === idOf(rows, 300));
    expect(standing?.getBoundingClientRect().top).toBeLessThanOrEqual(0);
    on.gone();
  });

  it('keeps the row somebody was reading where it was when older turns arrive', async () => {
    const rows = conversation(1000);
    const on = await harness();
    on.show(rows);

    on.scrollTo(400 * TALL);
    const before = on
      .drawn()
      .find((el) => el.dataset['id'] === idOf(rows, 400))
      ?.getBoundingClientRect().top;
    expect(before).toBeDefined();

    // Five hundred turns appear above the reader, which is what pressing
    // "show earlier turns" does.
    const older = conversation(500, 'older-');
    on.show([...older, ...rows]);

    const after = on
      .drawn()
      .find((el) => el.dataset['id'] === idOf(rows, 400))
      ?.getBoundingClientRect().top;
    // The same turn, in the same place on the screen...
    expect(after).toBeDefined();
    expect(Math.abs((after ?? 0) - (before ?? 0))).toBeLessThanOrEqual(1);
    // ...and still drawn, rather than left above the window.
    expect(on.drawn().some((el) => el.dataset['id'] === idOf(rows, 400))).toBe(true);
    on.gone();
  });

  it('follows a row that grows, so the rows below it move and the length is honest', async () => {
    const rows = conversation(200);
    const on = await harness();
    on.show(rows);

    const was = on.height();
    const second = on.drawn()[1];
    expect(second).toBeDefined();
    const id = second?.dataset['id'] ?? '';
    sizes.set(id, TALL + 120);
    act(() => {
      StubResize.tell(second as Element);
    });

    // The response grew on screen, so the conversation is that much longer.
    expect(on.height()).toBe(was + 120);
    on.gone();
  });
});
