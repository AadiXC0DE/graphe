// @vitest-environment jsdom
/** Two panels, and whether what is in them can be reached.
 *
 *  Both of these are the kind of thing a passing suite and a screenshot of the
 *  top of the screen will happily agree is fine. The settings panel drew every
 *  row it had; it just put half of them where nobody could scroll to.
 *
 *  Source text, not behaviour: the sheet rules that decide whether the settings panel and the cost meter can be scrolled to the end; jsdom computes no layout, so no render can see them. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Sidebar from '../src/components/Sidebar';

// jsdom has no file URL for this file, so the sheet is read by path.
const read = (name: string): string => readFileSync(join(process.cwd(), 'src/components', name), 'utf8');

describe('settings can be scrolled to the end', () => {
  const css = read('Settings.css');
  const block = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('scrolls the panel rather than squeezing what is in it', () => {
    // `.settings` is a column of flex items over the whole window. A flex item
    // shrinks before its parent scrolls, and a group hides its own overflow —
    // so the rows past the fold were not off-screen, they were gone. The head
    // keeps its height; the band under it is the one that scrolls.
    expect(block('.settings__top')).toContain('flex: none');
    expect(block('.settings__body')).toContain('min-height: 0');
    // Wide, the page scrolls inside its own half and the list of pages does not
    // move at all: sticky held it still only after it had ridden up to the top,
    // which reads as a screen with two scrollbars. Narrow, the two are one
    // column again and the whole band scrolls, which is right.
    expect(block('.settings__body')).toContain('overflow: hidden');
    expect(css).toContain('@container (max-width: 779.98px)');
    expect(block('.settings__page-body')).toContain('overflow-y: auto');
    expect(block('.settings__pages')).toContain('overflow-y: auto');
    /* And nothing on the page gives up height so the page can pretend to fit.
       The page is a flex column: the moment it became a scroller, every card
       inside it shrank rather than overflowing, and a card hides its own
       overflow, so the rows past the fold were clipped away with no scrollbar
       to reach them. This is the same fault as the head above, one level in. */
    expect(block('.settings__page-body > *')).toContain('flex: none');
  });

  it('still clips its own corners, which is why this was ever a problem', () => {
    // The rounded border and the 1px rules between rows are drawn by clipping.
    // Taking that away would fix the reach and lose the shape.
    expect(block('.settings__group')).toContain('overflow: hidden');
  });

  it('lays the bands out against the sheet, not the window', () => {
    // The sheet sits between the shelf and the overview panel, so a window
    // media query would give it columns it has no room for.
    expect(block('.settings__body')).toContain('container-type: inline-size');
    expect(css).not.toContain('@media (min-width');
    expect(css).toContain('@container (min-width: 780px)');
  });

  it('stacks the page list over its page until there is room for both', () => {
    // One column at every width the sheet can be, and the sidebar beside the
    // page only once the container query says the room is there.
    const counts = css
      .split('.settings__inner {')
      .slice(1)
      .map((after) => /grid-template-columns: ([^;]+);/.exec(after.slice(0, after.indexOf('}')))?.[1]);
    expect(counts.filter((one) => one !== undefined)).toEqual([
      'minmax(0, 1fr)',
      '220px minmax(0, 1fr)',
    ]);
  });
});

describe('the money at the foot of the rail keeps its height', () => {
  const css = read('CostMeter.css');
  const block = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('gives a long line an ellipsis rather than a second line', () => {
    // The meter is sticky at the foot of a 328px rail and its figures change on
    // every reading. Left to reflow, "91% a-long-model-name, 9% another" takes
    // two lines at one reading and one at the next, and the whole panel above
    // it moves each time.
    for (const selector of ['.cost-meter__retry', '.cost-meter__model']) {
      expect(block(selector)).toContain('white-space: nowrap');
      expect(block(selector)).toContain('text-overflow: ellipsis');
      expect(block(selector)).toContain('overflow: hidden');
      expect(block(selector)).toContain('min-width: 0');
    }
  });

  it('holds every model on the one row', () => {
    expect(block('.cost-meter__models')).toContain('display: flex');
  });
});

/* ========================================================================== */

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
const NOW = Date.parse('2026-09-15T12:00:00Z');

/** One conversation in the shelf, as the shell hands it over. */
const THE_ROW = {
  id: 'a',
  path: '/sessions/a.jsonl',
  title: 'the pricing page',
  at: NOW - 60_000,
  messages: 4,
};

describe('a conversation in the shelf offers one thing, not two', () => {
  it('can be thrown away, and the press names its own row', () => {
    const deleted: string[] = [];
    const where = document.createElement('div');
    host = where;
    document.body.append(where);
    root = createRoot(where);
    act(() => {
      root?.render(
        createElement(Sidebar, {
          projects: [],
          openPath: '/p',
          onOpen: NOTHING,
          onBrowse: NOTHING,
          pinned: [],
          conversations: [THE_ROW],
          openConversation: null,
          onOpenConversation: NOTHING,
          onNewConversation: NOTHING,
          onDeleteConversation: (path: string) => deleted.push(path),
          open: true,
          onToggle: NOTHING,
          now: NOW,
        }),
      );
    });

    const throwItAway = where.querySelector<HTMLButtonElement>('.shelf__convo .shelf__forget');
    expect(throwItAway).not.toBeNull();
    act(() => {
      throwItAway?.click();
    });
    expect(deleted).toEqual([THE_ROW.path]);
  });
});
