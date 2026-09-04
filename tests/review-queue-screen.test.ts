// @vitest-environment jsdom
/** The review screen, drawn.
 *
 * What a person can reach without being told it exists: the four decisions, a
 * decision on every file, Land, a pull request, and the switch back to the old
 * behaviour. The precise way a landing arrives lives behind Land itself rather
 * than in a settings screen, which is the thing this checks.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import ReviewQueue from '../src/components/ReviewQueue';
import { landingWords, reviewWords } from '../src/work/reviewqueue';
import type { ReviewEntry } from '../src/lib/ipc';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

type Props = Parameters<typeof ReviewQueue>[0];

const ENTRY: ReviewEntry = {
  id: 'a1',
  from: 'conversation',
  title: 'Make the header sticky',
  address: 'a1',
  branch: 'graphe/conversation-2',
  mirror: false,
  files: [
    { path: 'src/Header.tsx', added: 12, removed: 3 },
    { path: 'src/Header.css', added: 4, removed: 0 },
  ],
  at: Date.now(),
  read: false,
};

function draw(over: Partial<Props> = {}): { where: HTMLDivElement; props: Props } {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const props: Props = {
    entries: [ENTRY],
    chosen: 'a1',
    diff: '',
    busy: false,
    onChoose: vi.fn(),
    onFile: vi.fn(),
    onDecide: vi.fn(),
    onLand: vi.fn(),
    onOpenPr: vi.fn(),
    onMirror: vi.fn(),
    onRefresh: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  act(() => root?.render(createElement(ReviewQueue, props)));
  return { where: host, props };
}

function named(where: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...where.querySelectorAll<HTMLButtonElement>('button')].find(
    (one) => one.textContent?.trim() === text,
  );
}

describe('nothing waiting', () => {
  it('says so, and says what would arrive here', () => {
    const { where } = draw({ entries: [], chosen: null });
    expect(where.textContent).toContain(reviewWords.nothing);
    expect(where.textContent).toContain(reviewWords.nothingDetail);
  });
});

describe('the width the code gets', () => {
  /* A column holding one card, beside a reading that already names it, is
     260px taken off the diff. */
  it('draws no list of entries when there is only one', () => {
    const { where } = draw();
    expect(where.querySelector('.reviewq__list')).toBeNull();
    // And the reading still names which entry it is.
    expect(where.textContent).toContain(ENTRY.title);
  });

  it('draws the list once there is a second one to choose between', () => {
    const { where } = draw({
      entries: [ENTRY, { ...ENTRY, id: 'a2', title: 'Tidy the footer' }],
    });
    expect(where.querySelector('.reviewq__list')).not.toBeNull();
    expect(where.textContent).toContain('Tidy the footer');
  });

  /* The diff used to be asked for only by pressing a row, so the reading sat
     on "Reading the change" until somebody pressed one, and with a single
     entry there is no row to press. */
  it('asks for the entry it is showing without waiting to be pressed', () => {
    const onChoose = vi.fn();
    draw({ chosen: null, diff: null, onChoose });
    expect(onChoose).toHaveBeenCalledWith('a1');
  });

  it('does not ask again for the entry already chosen', () => {
    const onChoose = vi.fn();
    draw({ chosen: 'a1', onChoose });
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('one entry', () => {
  it('offers all four decisions', () => {
    const { where } = draw();
    for (const word of [reviewWords.take, reviewWords.mine, reviewWords.again, reviewWords.drop]) {
      expect(named(where, word), word).toBeDefined();
    }
  });

  /* One decision, then one press named by it: seven verbs in a row, two of
     them meaning nearly the same thing, is a row nobody reads twice. */
  it('sends the decision back with the entry it belongs to', () => {
    const onDecide = vi.fn();
    const { where } = draw({ onDecide });
    act(() => named(where, reviewWords.mine)?.click());
    act(() => named(where, reviewWords.does['keep mine'])?.click());
    expect(onDecide).toHaveBeenCalledWith('a1', 'keep mine');
  });

  it('names the one press after the decision it was given', () => {
    const { where } = draw();
    expect(named(where, reviewWords.does['take it'])).not.toBeNull();
    act(() => named(where, reviewWords.again)?.click());
    expect(named(where, reviewWords.does['ask again'])).not.toBeNull();
  });

  it('says what throwing away leaves behind, before the press', () => {
    const { where } = draw();
    expect(where.textContent).not.toContain(reviewWords.dropWhy);
    act(() => named(where, reviewWords.drop)?.click());
    expect(where.textContent).toContain(reviewWords.dropWhy);
  });

  it('offers Accept, Take theirs and Keep mine on every file', () => {
    const { where } = draw();
    const picks = where.querySelectorAll('.reviewq__file .reviewq__pick');
    expect(picks).toHaveLength(2);
    const first = [...picks[0]!.querySelectorAll('button')].map((one) => one.textContent);
    expect(first).toEqual(['Accept', reviewWords.takeFile, reviewWords.keepFile]);
  });

  it('clears a file back to following the whole review', () => {
    const onFile = vi.fn();
    const { where } = draw({ onFile });
    const buttons = [...where.querySelectorAll<HTMLButtonElement>('.reviewq__file .reviewq__pickone')];
    act(() => buttons[0]?.click());
    expect(onFile).toHaveBeenCalledWith('a1', 'src/Header.tsx', null);
    act(() => buttons[2]?.click());
    expect(onFile).toHaveBeenLastCalledWith('a1', 'src/Header.tsx', 'keep mine');
  });

  it('lands as one commit unless somebody opens the control and says otherwise', () => {
    const onLand = vi.fn();
    const { where } = draw({ onLand });
    act(() => named(where, reviewWords.land)?.click());
    expect(onLand).toHaveBeenCalledWith('a1', { how: 'squash' });
  });

  it('keeps the precise control behind Land, not somewhere else', () => {
    const onLand = vi.fn();
    const { where } = draw({ onLand });
    expect(where.querySelectorAll('.reviewq__precise')).toHaveLength(0);
    act(() => where.querySelector<HTMLButtonElement>('.reviewq__more')?.click());
    expect(where.textContent).toContain(landingWords.every);
    expect(where.textContent).toContain(landingWords.note);
    act(() => named(where, landingWords.every)?.click());
    act(() => named(where, reviewWords.land)?.click());
    expect(onLand).toHaveBeenCalledWith('a1', { how: 'every-version' });
  });

  it('will not offer every version once a file is held back, and says why', () => {
    const held: ReviewEntry = { ...ENTRY, choices: { 'src/Header.css': 'keep mine' } };
    const { where } = draw({ entries: [held] });
    act(() => where.querySelector<HTMLButtonElement>('.reviewq__more')?.click());
    expect(named(where, landingWords.every)?.disabled).toBe(true);
    expect(where.textContent).toContain(reviewWords.heldBackNote);
  });

  it('will not land an entry with every file kept as yours', () => {
    const none: ReviewEntry = {
      ...ENTRY,
      choices: { 'src/Header.tsx': 'keep mine', 'src/Header.css': 'keep mine' },
    };
    const { where } = draw({ entries: [none] });
    expect(named(where, reviewWords.land)?.disabled).toBe(true);
  });

  it('opens a pull request with a description of what it carries', () => {
    const onOpenPr = vi.fn();
    const { where } = draw({ onOpenPr });
    act(() => named(where, reviewWords.openPr)?.click());
    const said = (onOpenPr.mock.calls[0] as [string, string])[1];
    expect(said).toContain('Make the header sticky');
    expect(said).toContain('src/Header.tsx');
  });

  /* A once-a-project choice, out of the way of the once-an-entry one. */
  it('carries a live mirror switch per card, behind the entry’s own menu', () => {
    const onMirror = vi.fn();
    const { where } = draw({ onMirror });
    expect(where.querySelector('[role="switch"]')).toBeNull();
    act(() => where.querySelector<HTMLButtonElement>('.reviewq__menubtn')?.click());
    const mirror = where.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(mirror?.getAttribute('aria-checked')).toBe('false');
    // The sentence lives on the row in the menu and nowhere else.
    expect(where.textContent).toContain(reviewWords.mirrorWhy);
    act(() => mirror?.click());
    expect(onMirror).toHaveBeenCalledWith('a1', true);
  });

  it('marks what nobody has opened yet, and counts it', () => {
    const { where } = draw({
      entries: [ENTRY, { ...ENTRY, id: 'a2', address: 'a2', title: 'Second', read: true }],
    });
    expect(where.querySelectorAll('.reviewq__dot--new')).toHaveLength(1);
    expect(where.textContent).toContain(reviewWords.badge(1));
  });
});
