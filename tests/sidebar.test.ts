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

import Sidebar, { CONTEXT_WORDS } from '../src/components/Sidebar';

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

  /* A place is drawn only where it has somewhere to go, and the retired
     designer screens have nowhere at all — so their names must not be in the
     list at any width. */
  it('leaves out a place with nowhere to go, in both', () => {
    expect(placesIn(draw({ open: true, onHistory: undefined }), '.shelf__more', 'tip')).not.toContain('History');
    act(() => root?.unmount());
    host?.remove();
    expect(placesIn(draw({ open: false, onHistory: undefined }), '.shelf__act', 'tip')).not.toContain('History');
  });

  it('offers no name for a screen that was retired', () => {
    const tips = [...placesIn(draw({ open: true }), '.shelf__more', 'tip')];
    expect(tips).not.toContain('Design');
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

/** Pressing, the way React hears it. */
function press(node: Element | null): void {
  if (node === null) throw new Error('nothing to press');
  act(() => {
    (node as HTMLElement).click();
  });
}

describe('whose context each thing is', () => {
  const MINE = [{ id: 'r1', kind: 'image' as const, name: 'the mock.png', note: 'PNG' }];
  const SHARED = [{ id: 'p1', name: 'the brief.pdf', note: 'what the site is for' }];

  function band(where: HTMLElement): HTMLElement | null {
    return where.querySelector<HTMLElement>('.shelf__band:not(.shelf__band--scroll)');
  }

  function scopes(where: HTMLElement): readonly string[] {
    return [...where.querySelectorAll('.shelf__scope')].map((one) => one.textContent ?? '');
  }

  function pressIn(where: HTMLElement, label: string): HTMLButtonElement | null {
    return (
      [...where.querySelectorAll<HTMLButtonElement>('.shelf__share')].find((one) =>
        (one.textContent ?? '').includes(label),
      ) ?? null
    );
  }

  it('draws what this chat was given to work from, under its own scope', () => {
    const where = draw({ pinned: MINE });
    const here = band(where);
    expect(here?.querySelector('.shelf__caption')?.textContent).toBe(CONTEXT_WORDS.title);
    expect(scopes(where)).toEqual([CONTEXT_WORDS.mine]);
    expect(
      [...here!.querySelectorAll('.shelf__pin .shelf__rowname')].map((one) => one.textContent),
    ).toEqual(['the mock.png']);
  });

  it('draws what the project offers every chat, labelled and apart', () => {
    const where = draw({ pinned: MINE, shared: SHARED });
    expect(scopes(where)).toEqual([CONTEXT_WORDS.mine, CONTEXT_WORDS.project]);
    expect(
      [...where.querySelectorAll('.shelf__scope ~ .shelf__list .shelf__pin .shelf__rowname')].map(
        (one) => one.textContent,
      ),
    ).toContain('the brief.pdf');
  });

  it('draws no band at all when there is nothing to say', () => {
    expect(band(draw({ pinned: [] }))).toBeNull();
    expect(band(draw({ pinned: [], shared: [] }))).toBeNull();
  });

  /* The press this replaces said a reference had been given to the project
     while nothing carried it there. Both are now real: sharing writes the
     project's own list, which every new chat is then given, and the chat it
     came from keeps what it was given. */
  it('hands one of this chat’s own to the project when asked', () => {
    const handed: string[] = [];
    const where = draw({ pinned: MINE, onShare: (one: { id: string }) => handed.push(one.id) });
    const share = pressIn(where, CONTEXT_WORDS.share);
    expect(share).not.toBeNull();
    press(share);
    expect(handed).toEqual(['r1']);
  });

  it('takes one off the project’s list when asked', () => {
    const stopped: string[] = [];
    const where = draw({ shared: SHARED, onStopSharing: (id: string) => stopped.push(id) });
    const stop = pressIn(where, CONTEXT_WORDS.unshare);
    expect(stop).not.toBeNull();
    press(stop);
    expect(stopped).toEqual(['p1']);
  });

  /* A shelf with nowhere to put a shared item is a list rather than a control:
     a press that cannot do anything is worse than no press. */
  it('offers no press where the shelf cannot act on one', () => {
    expect(pressIn(draw({ pinned: MINE }), CONTEXT_WORDS.share)).toBeNull();
    expect(pressIn(draw({ shared: SHARED }), CONTEXT_WORDS.unshare)).toBeNull();
  });
});
