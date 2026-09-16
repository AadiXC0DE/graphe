// @vitest-environment jsdom
/** What the 9.1 fixtures cost, with no window and no build.
 *
 * The budget table in 9.1 names a 10k-message transcript, twenty open chats
 * with two active, and a 100k-file repository. A cold-launch time, RSS and a
 * real twenty-session window cannot be measured here; what can is the two
 * things those fixtures are *for* — that the document stays near the visible
 * window rather than the length of the conversation, and that a walk or a strip
 * is capped by what is open rather than by what exists.
 *
 * `tests/windowed.test.ts` proves the arithmetic and `tests/thread-rows.test.ts`
 * proves the render draws exactly `windowOf`'s slice for a thousand turns; this
 * is that bound at the size 9.1 actually names, plus the strip.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import Tabs, { type Tab } from '../../src/components/Tabs';
import { GUESS, OVER, RowHeights, windowOf } from '../../src/lib/windowed';
import { DEEPEST, everythingIn, MOST, type Found } from '../../src/files/listing';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/* ========================================================================== */
/* A conversation that has been going for a long time                          */
/* ========================================================================== */

/** Ten thousand turns, each a hundred and twenty pixels until measured. */
function longThread(count: number): RowHeights {
  const sizes = new RowHeights(GUESS);
  sizes.sync(Array.from({ length: count }, (_, at) => `turn-${String(at)}`));
  return sizes;
}

describe('a ten-thousand turn conversation', () => {
  const PANE = 800;

  it('puts a screenful in the document, not ten thousand rows', () => {
    const sizes = longThread(10_000);
    const span = windowOf({ sizes, top: 0, height: PANE });

    // What `ThreadRows` draws is `rows.slice(first, last)`, so this is the DOM
    // row count: the visible window plus the overscan either side.
    const drawn = span.last - span.first;
    const visible = Math.ceil(PANE / GUESS);
    expect(drawn).toBeLessThan(visible + 2 * OVER + 1);
    expect(drawn).toBeLessThan(40);
  });

  it('costs the same in the middle of the conversation as at the top', () => {
    const sizes = longThread(10_000);
    const at = windowOf({ sizes, top: 5_000 * GUESS, height: PANE });
    const end = windowOf({ sizes, top: 10_000 * GUESS, height: PANE });
    expect(at.last - at.first).toBeLessThan(40);
    expect(end.last - end.first).toBeLessThan(40);
  });

  it('leaves the rest of the conversation as room the browser does not lay out', () => {
    const sizes = longThread(10_000);
    const span = windowOf({ sizes, top: 0, height: PANE });
    // Two spacer blocks stand in for everything not drawn, and together with
    // what is drawn they are the whole list — the scrollbar stays honest.
    expect(span.before + span.after + (span.last - span.first) * GUESS).toBe(sizes.total());
  });

  it('scrolling a thousand times rebuilds nothing', () => {
    const sizes = longThread(10_000);
    const before = sizes.rebuilds();
    for (let at = 0; at < 1_000; at += 1) windowOf({ sizes, top: at * 97, height: PANE });
    // The heights are keyed by the row's own id, so moving down a list is a
    // prefix sum rather than a rebuild of the list.
    expect(sizes.rebuilds()).toBe(before);
  });

  it('does not draw more rows because one of them is enormous', () => {
    const sizes = longThread(10_000);
    // A tool result of five megabytes is one row, and one row is one row.
    sizes.measure('turn-5000', 5 * 1024 * 1024);
    const span = windowOf({ sizes, top: 4_999 * GUESS, height: PANE });
    expect(span.last - span.first).toBeLessThan(40);
  });
});

/* ========================================================================== */
/* Twenty open chats                                                           */
/* ========================================================================== */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const NOTHING = (): void => undefined;

/** Twenty conversations, which is the 9.1 fixture. */
function twenty(): readonly Tab[] {
  return Array.from({ length: 20 }, (_, at) => ({
    id: `c${String(at + 1)}`,
    title: `conversation ${String(at + 1)}`,
    project: 'paper-street',
    projectPath: '/tmp/paper-street',
    kind: 'chat' as const,
    state: 'idle' as const,
  }));
}

function drawn(tabs: readonly Tab[]): HTMLDivElement {
  if (host === null) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => {
    root?.render(
      createElement(Tabs, { tabs, at: tabs[0]?.id ?? null, onOpen: NOTHING, onClose: NOTHING, onNew: NOTHING } as never),
    );
  });
  return host;
}

describe('twenty open chats', () => {
  it('are twenty rows, one per chat that is open', () => {
    const at = drawn(twenty());
    // Proportional to what is open — which is bounded by what a person opened,
    // not by how many conversations the project has ever had.
    expect(at.querySelectorAll('[role="tab"]')).toHaveLength(20);
  });

  it('do not multiply when the same chats are drawn again', () => {
    const tabs = twenty();
    drawn(tabs);
    const once = host!.querySelectorAll('*').length;
    drawn(tabs);
    expect(host!.querySelectorAll('[role="tab"]')).toHaveLength(20);
    expect(host!.querySelectorAll('*').length).toBe(once);
  });
});

/* ========================================================================== */
/* A hundred thousand files                                                    */
/* ========================================================================== */

describe('a folder with more files than anybody wants walked', () => {
  it('stops at the cap instead of reading all of it', async () => {
    let asked = 0;
    // One hundred folders, each holding a thousand files: a hundred thousand
    // entries, answered without touching a disk.
    const fake: (path: string) => Promise<readonly Found[]> = async (path) => {
      asked += 1;
      const depth = path.split('/').filter((part) => part !== '').length;
      if (depth >= 2) {
        return Array.from({ length: 1_000 }, (_, at) => ({
          name: `file-${String(at)}.ts`,
          kind: 'file' as const,
          size: 10,
        }));
      }
      return Array.from({ length: 100 }, (_, at) => ({
        name: `folder-${String(at)}`,
        kind: 'folder' as const,
        size: 0,
      }));
    };

    const walk = await everythingIn('/root', fake);
    expect(walk.files).toHaveLength(MOST);
    expect(walk.stopped).toBe(true);
    expect(asked).toBeLessThan(20);
  });

  it('does not go deeper than it says it will', async () => {
    const deep = (path: string): Promise<readonly Found[]> =>
      Promise.resolve([{ name: path.endsWith('last') ? 'file.ts' : 'down', kind: 'folder', size: 0 }]);
    const walk = await everythingIn('/root', deep);
    // A folder tree that never ends is stopped by depth, not by hanging.
    expect(walk.files).toEqual([]);
    expect(DEEPEST).toBeGreaterThan(0);
  });
});

afterAll(() => {
  act(() => root?.unmount());
});
