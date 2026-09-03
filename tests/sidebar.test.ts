// @vitest-environment jsdom
/** The shelf's two states draw one list.
 *
 * They were two hand-written lists in two orders, and the strip had no way to
 * reach finished work at all, so somebody with three pieces waiting had to
 * unfold the shelf to find out.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Sidebar from '../src/components/Sidebar';

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

function draw(over: Record<string, unknown> = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(Sidebar, {
        projects: [],
        openPath: null,
        onOpen: NOTHING,
        onBrowse: NOTHING,
        pinned: [],
        conversations: [],
        openConversation: null,
        onOpenConversation: NOTHING,
        onNewConversation: NOTHING,
        open: true,
        onToggle: NOTHING,
        onAsk: NOTHING,
        onDesign: NOTHING,
        onCanvas: NOTHING,
        onHistory: NOTHING,
        onReviews: NOTHING,
        onReviewQueue: NOTHING,
        onSkills: NOTHING,
        onAddMore: NOTHING,
        onFiles: NOTHING,
        onSettings: NOTHING,
        reviewsWaiting: 3,
        ...over,
      } as never),
    );
  });
  return host;
}

/** What each state calls its places, in the order it draws them. The open
 *  shelf says it in a `title`, the strip in the tooltip it draws itself. */
function placesIn(where: HTMLElement, selector: string, from: 'tip' | 'label'): readonly string[] {
  const attribute = from === 'label' ? 'aria-label' : selector === '.shelf__act' ? 'data-tip' : 'title';
  return [...where.querySelectorAll(selector)].map((one) => one.getAttribute(attribute) ?? '');
}

describe('the places the shelf can go', () => {
  it('are the same, in the same order, folded or not', () => {
    const open = placesIn(draw({ open: true }), '.shelf__more', 'tip');
    act(() => root?.unmount());
    host?.remove();
    const shut = placesIn(draw({ open: false }), '.shelf__act', 'tip').slice(1);
    expect(open.length).toBeGreaterThan(5);
    expect(shut).toEqual(open);
  });

  it('name the same thing in both, so a tooltip and a label agree', () => {
    const open = [...draw({ open: true }).querySelectorAll('.shelf__more .shelf__rowname')].map(
      (one) => one.textContent,
    );
    act(() => root?.unmount());
    host?.remove();
    expect(placesIn(draw({ open: false }), '.shelf__act', 'label').slice(1)).toEqual(open);
  });

  it('puts Settings last in both', () => {
    expect(placesIn(draw({ open: true }), '.shelf__more', 'tip').at(-1)).toBe('Settings');
    act(() => root?.unmount());
    host?.remove();
    expect(placesIn(draw({ open: false }), '.shelf__act', 'tip').at(-1)).toBe('Settings');
  });

  it('leaves out a place with nowhere to go, in both', () => {
    expect(placesIn(draw({ open: true, onCanvas: undefined }), '.shelf__more', 'tip')).not.toContain('Canvas');
    act(() => root?.unmount());
    host?.remove();
    expect(placesIn(draw({ open: false, onCanvas: undefined }), '.shelf__act', 'tip')).not.toContain('Canvas');
  });
});

describe('what is waiting', () => {
  it('is on the row when the shelf is open', () => {
    expect(draw({ open: true }).querySelector('.shelf__count')?.textContent).toBe('3');
  });

  /* The whole reason for one list: the strip had no review row at all, so
     three pieces waiting were unreachable without unfolding. */
  it('is a badge on the mark when it is folded', () => {
    expect(draw({ open: false }).querySelector('.shelf__actcount')?.textContent).toBe('3');
  });

  it('is drawn nowhere when nothing waits', () => {
    expect(draw({ open: true, reviewsWaiting: 0 }).querySelector('.shelf__count')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    expect(draw({ open: false, reviewsWaiting: 0 }).querySelector('.shelf__actcount')).toBeNull();
  });
});

describe('the one control that folds it', () => {
  it('is the same glyph and the same words in both states', () => {
    expect(draw({ open: true }).querySelector('.shelf__collapse')?.getAttribute('title')).toBe(
      'Hide sidebar ⌘B',
    );
    act(() => root?.unmount());
    host?.remove();
    expect(draw({ open: false }).querySelector('.shelf__mark')?.getAttribute('data-tip')).toBe(
      'Show sidebar ⌘B',
    );
  });
});
