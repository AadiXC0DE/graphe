// @vitest-environment jsdom
/** Compare attempts, drawn: several goes at one job against the base they all
 *  started from.
 *
 * The screen already existed and lined the diffs up file by file. What it could
 * not say was what they were all held against, which is the difference between
 * three answers to one question and three unrelated patches. So this asserts
 * the base reaches the screen, and that taking one goes through `pickOne` —
 * the function that says what is landed and what goes with the decision — and
 * never through a second opinion of its own.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import Against from '../src/components/Against';
import type { Side } from '../src/lib/against';
import { compare, compareWords, saysComparison, type Attempt } from '../src/work/compare';

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

function patch(path: string, was: string, now: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    `-${was}`,
    `+${now}`,
    '',
  ].join('\n');
}

type SideOfWork = Side & { base?: string | null };

function side(over: Partial<SideOfWork> = {}): SideOfWork {
  return {
    id: 'way-1',
    name: 'Way 1 of 2',
    state: 'done',
    diff: patch('src/Header.tsx', 'red', 'blue'),
    picture: null,
    spent: null,
    folder: null,
    base: 'main',
    ...over,
  };
}

const TWO: readonly SideOfWork[] = [
  side(),
  side({
    id: 'way-2',
    name: 'Way 2 of 2',
    diff: `${patch('src/Header.tsx', 'red', 'green')}${patch('src/App.css', 'a', 'b')}`,
  }),
];

function draw(over: Record<string, unknown> = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      createElement(Against, {
        open: true,
        sides: TWO,
        onClose: vi.fn(),
        onKeep: vi.fn(),
        ...over,
      }),
    ),
  );
  return host;
}

/* -------------------------------------------------------------------------- */
/* The line under the heading                                                  */
/* -------------------------------------------------------------------------- */

function attempt(over: Partial<Attempt> = {}): Attempt {
  return { id: 'a', name: 'Way 1', state: 'done', diff: '', ...over };
}

describe('what the sheet says about attempts that have not got anywhere yet', () => {
  it('says nothing has started rather than that nothing changed', () => {
    const all = [attempt({ state: 'waiting' }), attempt({ id: 'b', state: 'waiting' })];
    expect(saysComparison(all, compare(all, 'main'))).toBe(compareWords.waitingToStart);
  });

  it('says none of them has finished while they are all still going', () => {
    const all = [attempt({ state: 'running' }), attempt({ id: 'b', state: 'waiting' })];
    expect(saysComparison(all, compare(all, 'main'))).toBe(compareWords.noneFinished);
  });

  it('counts the files once one of them has finished', () => {
    const all = [
      attempt({ state: 'done', diff: patch('one.txt', 'a', 'b') }),
      attempt({ id: 'b', state: 'running' }),
    ];
    const comparison = compare(all, 'main');
    expect(saysComparison(all, comparison)).toBe(comparison.says);
    expect(saysComparison(all, comparison)).toContain('1 file to decide about');
  });

  it('says there is nothing at all when there are no attempts', () => {
    expect(saysComparison([], compare([], 'main'))).toBe(compareWords.nothing);
  });
});

/* -------------------------------------------------------------------------- */
/* The sheet                                                                   */
/* -------------------------------------------------------------------------- */

describe('the sheet, drawn', () => {
  it('names what every column is held against', () => {
    expect(draw().textContent).toContain(compareWords.against('main'));
  });

  it('leaves the base line out when nobody said what it was', () => {
    const where = draw({ sides: TWO.map((one) => ({ ...one, base: null })) });
    expect(where.querySelector('.against__base')).toBeNull();
  });

  it('draws a column for every go, with what it came to', () => {
    const where = draw();
    const names = [...where.querySelectorAll('.against__name')].map((one) => one.textContent);
    expect(names).toEqual(['Way 1 of 2', 'Way 2 of 2']);
    const lines = [...where.querySelectorAll('.against__total')].map((one) => one.textContent);
    expect(lines[0]).toContain(compareWords.total(1, 1, 1));
    expect(lines[1]).toContain(compareWords.total(2, 2, 2));
  });

  it('says out loud what taking one of them costs the others', () => {
    const where = draw();
    const press = [...where.querySelectorAll('button')].filter(
      (one) => one.textContent?.trim() === compareWords.keep,
    );
    expect(press).toHaveLength(2);
    expect(press[0]?.title).toBe(compareWords.insteadOf('Way 1 of 2', ['Way 2 of 2']));
  });

  /* Through `pickOne`, so the caller and the sentence can never disagree about
     which one is being landed. */
  it('takes the one that was pressed', () => {
    const onKeep = vi.fn();
    const where = draw({ onKeep });
    const press = [...where.querySelectorAll('button')].filter(
      (one) => one.textContent?.trim() === compareWords.keep,
    );
    act(() => press[1]?.click());
    expect(onKeep).toHaveBeenCalledWith('way-2');
  });

  it('offers nothing to take on a go that is still running', () => {
    const where = draw({
      sides: [side({ state: 'running' }), side({ id: 'way-2', name: 'Way 2 of 2' })],
    });
    const press = [...where.querySelectorAll('button')].filter(
      (one) => one.textContent?.trim() === compareWords.keep,
    );
    expect(press).toHaveLength(1);
  });

  it('opens the change itself on the file both of them touched', () => {
    const where = draw();
    expect(where.querySelector('.against__reading')).toBeNull();
    const row = [...where.querySelectorAll<HTMLButtonElement>('.against__about')].find((one) =>
      one.textContent?.includes('src/Header.tsx'),
    );
    act(() => row?.click());
    const reading = where.querySelector('.against__reading');
    expect(reading).not.toBeNull();
    const shown = [...where.querySelectorAll('.against__readingname')].map((one) => one.textContent);
    expect(shown).toEqual(['Way 1 of 2', 'Way 2 of 2']);
    expect(reading?.textContent).toContain('green');
  });

  it('says once, at the end, what came out the same in all of them', () => {
    const same = patch('src/Header.tsx', 'red', 'blue');
    const where = draw({
      sides: [
        side({ diff: same }),
        side({ id: 'way-2', name: 'Way 2 of 2', diff: same }),
      ],
    });
    expect(where.querySelector('.against__samepaths')?.textContent).toBe('src/Header.tsx');
    // Nothing to decide about, so there is no row to decide in.
    expect(where.querySelectorAll('.against__file')).toHaveLength(0);
  });
});
