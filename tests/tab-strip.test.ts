// @vitest-environment jsdom
/** The strip draws what is open, and the keyboard can reach all of it.
 *
 * The row used to draw three tabs and forget the rest, so a conversation opened
 * later was not in the strip at all. These check the rendered row: every tab
 * exists, the one in front is marked in place, and the arrows, Home and End go
 * where they say they go.
 */

import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Tabs, { type Tab } from '../src/components/Tabs';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const NOTHING = (): void => undefined;

/** Twenty conversations, with two title collisions and three marks. */
function twenty(): readonly Tab[] {
  const states = ['idle', 'idle', 'working', 'asking', 'finished'] as const;
  return Array.from({ length: 20 }, (_, index) => ({
    id: `c${String(index + 1)}`,
    title: index === 5 || index === 12 ? 'the hero, tighter' : `conversation ${String(index + 1)}`,
    project: index % 2 === 0 ? 'paper-street' : 'atlas-studio',
    projectPath: index % 2 === 0 ? '/a' : '/b',
    state: states[index] ?? 'idle',
  }));
}

/** One root per test, reused so a second render is a change of props. */
function mounted(): HTMLDivElement {
  if (host === null) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  return host;
}

function show(tabs: readonly Tab[], at: string | null, over: Record<string, unknown> = {}): HTMLDivElement {
  const where = mounted();
  act(() => {
    root?.render(
      createElement(Tabs, {
        tabs,
        at,
        onOpen: NOTHING,
        onClose: NOTHING,
        onNew: NOTHING,
        ...over,
      } as never),
    );
  });
  return where;
}

/** A row that answers a close the way the app does: the tab goes, and the
 *  selection moves on. */
function Strip({ opening }: { opening: readonly Tab[] }): ReactElement {
  const [tabs, setTabs] = useState<readonly Tab[]>(opening);
  const [at, setAt] = useState<string | null>(opening[0]?.id ?? null);
  return createElement(Tabs, {
    tabs,
    at,
    onOpen: setAt,
    onClose: (id: string) => {
      const rest = tabs.filter((one) => one.id !== id);
      setTabs(rest);
      if (at === id) setAt(rest[0]?.id ?? null);
    },
    onNew: NOTHING,
  });
}

function live(opening: readonly Tab[]): HTMLDivElement {
  const where = mounted();
  act(() => {
    root?.render(createElement(Strip, { opening }));
  });
  return where;
}

const tabsIn = (where: HTMLElement): HTMLButtonElement[] => [
  ...where.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
];

/** jsdom has no scrollIntoView, so a test lends the element one. */
type Scrollable = { scrollIntoView?: (options?: boolean | ScrollIntoViewOptions) => void };
const elementPrototype = Element.prototype as Scrollable;

const press = (node: Element, key: string, over: KeyboardEventInit = {}): void => {
  act(() => {
    node.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...over }),
    );
  });
};

describe('what the strip draws', () => {
  it('is every tab there is, not the first three', () => {
    const where = show(twenty(), 'c1');
    expect(tabsIn(where)).toHaveLength(20);
    expect(tabsIn(where).at(-1)?.textContent).toContain('conversation 20');
  });

  it('is as wide as the tabs in it, not as wide as three of them', () => {
    const few = show(twenty().slice(0, 2), 'c1');
    expect((few.querySelector('.tabs') as HTMLElement).style.width).toBe('368px');
    const many = show(twenty(), 'c1');
    expect((many.querySelector('.tabs') as HTMLElement).style.width).toBe('520px');
  });

  it('marks the one in front, in place', () => {
    const where = show(twenty(), 'c14');
    const here = tabsIn(where).filter((one) => one.getAttribute('aria-selected') === 'true');
    expect(here).toHaveLength(1);
    expect(here[0]?.textContent).toContain('conversation 14');
    expect(where.querySelectorAll('.tabs__tab--here')).toHaveLength(1);
  });

  it('gives working, asking and finished a mark each and idle none', () => {
    const where = show(twenty(), 'c1');
    const marks = [...where.querySelectorAll('.tabs__mark')];
    expect(marks.map((one) => one.className)).toEqual([
      'tabs__mark tabs__mark--working',
      'tabs__mark tabs__mark--asking',
      'tabs__mark',
    ]);
  });

  it('names the project in the accessible name only when two titles collide', () => {
    const where = show(twenty(), 'c1');
    const labels = tabsIn(where).map((one) => one.getAttribute('aria-label'));
    expect(labels).toContain('conversation 1');
    expect(labels.filter((one) => one?.startsWith('the hero, tighter ('))).toHaveLength(2);
    const closes = [...where.querySelectorAll('.tabs__close')].map((one) =>
      one.getAttribute('aria-label'),
    );
    expect(closes).toContain('Close the hero, tighter (paper-street)');
  });
});

describe('the keyboard on the strip', () => {
  it('keeps a single tab stop, so Tab leaves the strip', () => {
    const stops = tabsIn(show(twenty(), 'c7')).filter((one) => one.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.textContent).toContain('conversation 7');
  });

  it('moves with the arrows and jumps with Home and End', () => {
    const opened: string[] = [];
    const where = show(twenty(), 'c1', { onOpen: (id: string) => opened.push(id) });
    const tabs = tabsIn(where);
    act(() => tabs[0]?.focus());

    press(tabs[0]!, 'ArrowRight');
    expect(opened).toEqual(['c2']);
    expect(document.activeElement).toBe(tabs[1]);

    press(tabs[1]!, 'End');
    expect(opened.at(-1)).toBe('c20');
    expect(document.activeElement).toBe(tabs[19]);

    press(tabs[19]!, 'Home');
    expect(opened.at(-1)).toBe('c1');

    press(tabs[0]!, 'ArrowLeft');
    expect(opened.at(-1)).toBe('c20');
  });

  it('rearranges with Option and the arrows, where the row can be rearranged', () => {
    const moved: [string, number][] = [];
    const opened: string[] = [];
    const where = show(twenty(), 'c1', {
      onOpen: (id: string) => opened.push(id),
      onReorder: (id: string, to: number) => moved.push([id, to]),
    });
    const tabs = tabsIn(where);
    act(() => tabs[2]?.focus());

    press(tabs[2]!, 'ArrowRight', { altKey: true });
    expect(moved).toEqual([['c3', 3]]);
    expect(opened).toEqual([]);

    press(tabs[2]!, 'ArrowRight');
    expect(opened).toEqual(['c4']);
    expect(moved).toEqual([['c3', 3]]);

    press(tabs[0]!, 'ArrowLeft', { altKey: true });
    expect(moved.at(-1)).toEqual(['c1', 0]);
  });
});

describe('keeping the tab in front in sight', () => {
  it('scrolls it into view when it changes, and takes no focus', () => {
    const seen: unknown[] = [];
    const original = elementPrototype.scrollIntoView;
    elementPrototype.scrollIntoView = (options) => {
      seen.push(options);
    };
    try {
      show(twenty(), 'c1');
      show(twenty(), 'c20');
    } finally {
      elementPrototype.scrollIntoView = original;
    }
    expect(seen.at(-1)).toEqual({ block: 'nearest', inline: 'nearest' });
    expect(document.activeElement).toBe(document.body);
  });
});

describe('closing a tab', () => {
  it('puts focus on the tab beside it', () => {
    const where = live(twenty().slice(0, 4));
    const first = where.querySelector('.tabs__close') as HTMLButtonElement;
    act(() => first.click());
    const now = tabsIn(where);
    expect(now).toHaveLength(3);
    expect(document.activeElement).toBe(now[0]);
    expect(now[0]?.textContent).toContain('conversation 2');
  });

  it('puts focus on the button that starts the next one when the row empties', () => {
    const where = live(twenty().slice(0, 1));
    act(() => (where.querySelector('.tabs__close') as HTMLButtonElement).click());
    expect(tabsIn(where)).toHaveLength(0);
    expect(document.activeElement?.textContent).toContain('New conversation');
  });
});
