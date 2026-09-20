// @vitest-environment jsdom
/** Effects that tell the window above something, and the loop they can start.
 *
 *  A parent passes a fresh arrow function down on every render. An effect in
 *  the child that lists that function among its dependencies therefore runs on
 *  every commit — and if what it does causes the parent to render, the two of
 *  them spin at the speed of the machine. Nothing errors. The window simply
 *  stops being smooth, and in this app each turn of the loop also asked the
 *  shell for the panel again.
 *
 *  Measured before the fix, with a project open and nobody touching anything:
 *  the whole tree rendered 1,481 times in four seconds and the renderer was
 *  99.9% busy. After: nought renders, 0.2%.
 *
 *  The panel is drawn for real here, twice, the second time with a callback
 *  the window above has just made — which is the whole of the repro: under the
 *  old dependencies that second render told it again, and being told asks for
 *  the panel again.
 */

import { act, createElement, useEffect, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import Overview, { type OverviewView } from '../src/components/Overview';
import type { GitSnapshot } from '../src/lib/ipc';

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

const NOTHING = (): void => undefined;

const GIT: GitSnapshot = {
  branch: 'main',
  branches: [],
  dirty: false,
  unstaged: 0,
  staged: 0,
  untracked: 0,
  changedPaths: 0,
  files: [],
  added: 0,
  removed: 0,
  ahead: 0,
  behind: 0,
};

/** A folder holding two projects, which is when the panel has a name to tell
 *  the window above at all. */
const VIEW: OverviewView = {
  now: { step: null, helpers: [], filesRead: 0 },
  git: null,
  repos: [
    { name: 'backend', path: '/p/backend', git: GIT },
    { name: 'frontend', path: '/p/frontend', git: GIT },
  ],
  repoVersions: {},
  research: [],
  references: [],
  versions: [],
  kept: [],
  putBack: null,
  spent: null,
  onAPlan: false,
  ceiling: null,
  busy: false,
  showMe: false,
  artifacts: [],
  swatches: [],
  away: null,
  clock: Date.parse('2026-09-15T12:00:00Z'),
};

const PROPS = {
  view: VIEW,
  onPutBack: NOTHING,
  onName: NOTHING,
  onKeep: NOTHING,
  onDismissPutBack: NOTHING,
  onShowSplit: NOTHING,
  onLimit: NOTHING,
  onSave: NOTHING,
  onOpenGraph: NOTHING,
  onSwitchBranch: NOTHING,
  onCreateBranch: NOTHING,
  onOpenFile: NOTHING,
  onKeepAway: NOTHING,
  onDropAway: NOTHING,
  onAnswerAway: NOTHING,
};

/** One host, drawn into more than once: the second call is an update to the
 *  same tree, which is where a dependency on a callback identity shows up. */
function draw(element: ReactElement): void {
  if (host === null) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => {
    root?.render(element);
  });
}

/** The same shape with the callback among its dependencies — the bug as it
 *  was, so a quiet pass below is a fix rather than a deaf harness. */
function useSpins({ onTell }: { onTell: (name: string | null) => void }): null {
  useEffect(() => {
    onTell(null);
  }, [onTell]);
  return null;
}

describe('the panel tells the window above only when something changed', () => {
  it('would see the loop at all, if the callback were a dependency', () => {
    const first = vi.fn();
    const second = vi.fn();
    draw(createElement(useSpins, { onTell: first }));
    draw(createElement(useSpins, { onTell: second }));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not wake on the identity of the callback it was handed', () => {
    const first = vi.fn();
    draw(createElement(Overview, { ...PROPS, onWhose: first }));
    // The project in front is the first of the two, and the window above is
    // told which one the panel is showing.
    expect(first).toHaveBeenCalledWith('backend');
    expect(first).toHaveBeenCalledTimes(1);

    // The window above renders again — for a keystroke, a clock, anything —
    // and hands down a fresh arrow function, which is what it always does.
    const second = vi.fn();
    draw(createElement(Overview, { ...PROPS, onWhose: second }));

    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });
});
