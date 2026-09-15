// @vitest-environment jsdom
/** Where a tab sits is the person's to decide.
 *
 * The row is spatial memory, which is why the selected tab is never brought to
 * the front. It also has to be arrangeable, or the order is whatever order the
 * conversations happened to be opened in and nobody can put the two they are
 * working between next to each other.
 *
 * The rearrangement is proved twice over: on the desk, where the order lives,
 * and on the row itself, which is drawn here and dragged with the events a hand
 * would send. jsdom has no pointer, but it has the elements and the events.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Tabs, { type Tab } from '../src/components/Tabs';
import { moveThread, noDesks, openDesk, showThread, threadsIn, type Desks } from '../src/lib/projects';
import { NOTHING_SAID } from '../src/state/conversations';

const project = '/work/site';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const NOTHING = (): void => undefined;

/** The three conversations the desk above opens, as the strip receives them. */
const OPEN: readonly Tab[] = [
  { id: 'a', title: 'the hero', project: 'site', projectPath: project, state: 'idle' },
  { id: 'b', title: 'the footer', project: 'site', projectPath: project, state: 'idle' },
  { id: 'c', title: 'the nav', project: 'site', projectPath: project, state: 'idle' },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** The strip, drawn for real. Drawn again, it is a change of props. */
function strip(over: { onReorder?: (id: string, to: number) => void }): HTMLDivElement {
  if (host === null) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => {
    root?.render(
      createElement(Tabs, {
        tabs: OPEN,
        at: 'a',
        onOpen: NOTHING,
        onClose: NOTHING,
        onNew: NOTHING,
        ...over,
      }),
    );
  });
  return host;
}

/** The tab wrappers, in the order the row draws them. The drag lives on the
 *  wrapper; the button inside it is what a press opens. */
const tabsIn = (where: HTMLElement): HTMLElement[] => [
  ...where.querySelectorAll<HTMLElement>('.tabs__tab'),
];

/** What each tab is called, in the order the row draws them. */
const row = (where: HTMLElement): (string | null)[] =>
  tabsIn(where).map((one) => one.querySelector('[role="tab"]')?.getAttribute('aria-label') ?? null);

/** A drag, as the browser sends one: the payload rides on the event, and jsdom
 *  has no DragEvent of its own to lend it one. */
const carried: { effectAllowed: string; dropEffect: string; setData: () => void } = {
  effectAllowed: '',
  dropEffect: '',
  setData: NOTHING,
};

function fire(node: Element, kind: 'dragstart' | 'dragover' | 'drop'): void {
  const one = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(one, 'dataTransfer', { value: carried });
  act(() => {
    node.dispatchEvent(one);
  });
}

/** A project with three conversations open, in the order they were opened. */
function three(): Desks {
  const held = openDesk(noDesks, { path: project, name: 'site' });
  const desk = held.byPath[project];
  if (desk === undefined) throw new Error('no desk');
  return {
    ...held,
    byPath: {
      ...held.byPath,
      [project]: {
        ...desk,
        address: '/a',
        conversations: {
          '/a': { ...NOTHING_SAID },
          '/b': { ...NOTHING_SAID },
          '/c': { ...NOTHING_SAID },
        },
        order: ['/a', '/b', '/c'],
      },
    },
  };
}

const order = (held: Desks): readonly string[] =>
  threadsIn(held.byPath[project]!).map((one) => one.address);

describe('rearranging the row', () => {
  it('moves one tab to the front', () => {
    expect(order(moveThread(three(), project, '/c', 0))).toEqual(['/c', '/a', '/b']);
  });

  it('moves one tab to the end', () => {
    expect(order(moveThread(three(), project, '/a', 2))).toEqual(['/b', '/c', '/a']);
  });

  it('leaves the row alone when nothing moved', () => {
    const before = three();
    expect(moveThread(before, project, '/b', 1)).toBe(before);
  });

  /* A drag that ends off the end of the strip means the end of the strip. */
  it('clamps rather than losing the tab off either end', () => {
    expect(order(moveThread(three(), project, '/a', 99))).toEqual(['/b', '/c', '/a']);
    expect(order(moveThread(three(), project, '/c', -4))).toEqual(['/c', '/a', '/b']);
  });

  it('says nothing about a conversation this project does not have', () => {
    const before = three();
    expect(moveThread(before, project, '/gone', 0)).toBe(before);
  });

  it('keeps the conversation in front where it was', () => {
    const moved = moveThread(three(), project, '/c', 0);
    expect(moved.byPath[project]?.address).toBe('/a');
    expect(order(showThread(moved, project, '/b'))).toEqual(['/c', '/a', '/b']);
  });
});

describe('the row itself', () => {
  it('is draggable only where there is somewhere for a tab to go', () => {
    const movable = strip({ onReorder: NOTHING });
    expect(tabsIn(movable).map((one) => one.draggable)).toEqual([true, true, true]);

    // A row nothing can be rearranged in: no tab offers a drag, and one that
    // started anyway lands nowhere.
    const fixed = strip({});
    expect(tabsIn(fixed).some((one) => one.draggable)).toBe(false);
    fire(tabsIn(fixed)[0]!, 'dragstart');
    fire(tabsIn(fixed)[2]!, 'dragover');
    expect(fixed.querySelectorAll('.tabs__tab--landing')).toHaveLength(0);
  });

  it('draws the place a tab would land rather than shuffling under the pointer', () => {
    const moved: [string, number][] = [];
    const where = strip({
      onReorder: (id: string, to: number) => {
        moved.push([id, to]);
      },
    });
    carried.dropEffect = '';

    fire(tabsIn(where)[0]!, 'dragstart');
    fire(tabsIn(where)[2]!, 'dragover');

    // The place is drawn; the row has not moved a tab to make it.
    expect(tabsIn(where)[2]?.className).toContain('tabs__tab--landing');
    expect(row(where)).toEqual(['the hero', 'the footer', 'the nav']);
    expect(moved).toEqual([]);
    expect(carried.dropEffect).toBe('move');

    fire(tabsIn(where)[2]!, 'drop');
    expect(moved).toEqual([['a', 2]]);
  });
});
