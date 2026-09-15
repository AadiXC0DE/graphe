// @vitest-environment jsdom
/** The add-ons screen, drawn: what it offers before a press, and where it says
 *  it cannot.
 *
 * Rendering it is the point rather than reading it. Three decisions on this
 * screen are about what is *there* — a Stop beside a change that is running and
 * only where this copy of the app can end one, the npm line and its two ways
 * out before anybody presses Add, and one row per add-on in the state it is
 * actually in. A source-level assertion would pass with every one of them
 * drawn in the wrong place.
 */

import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import AddMore, { SAYS } from '../src/components/AddMore';
import type { AddonSetup, ExtensionHere, Stopping } from '../src/lib/ipc';

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

const PACK = {
  id: 'pi-lens',
  name: 'Lens',
  kind: 'extension' as const,
  summary: 'Symbols for the file you are in.',
  downloads: null,
  version: '1.4.2',
  installed: false,
  curated: true,
};

function draw(props: Record<string, unknown>): void {
  const element = createElement(AddMore, {
    open: true,
    packs: [PACK],
    vouchedFor: {},
    busy: null,
    warning: 'Somebody else wrote this.',
    onClose: NOTHING,
    onSearch: NOTHING,
    onAdd: NOTHING,
    onRemove: NOTHING,
    reaches: [],
    ...props,
  }) as ReactElement;
  if (host === null) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => {
    root?.render(element);
  });
}

/** Every button and link on screen, by their words. */
function words(): readonly string[] {
  return [...(host?.querySelectorAll('button, a') ?? [])].map(
    (one) => one.textContent ?? '',
  );
}

describe('stopping a change that is running', () => {
  const CANNOT: Stopping = {
    canStop: false,
    says: 'This copy of the app cannot end an install once it has started. It will finish and say what it did.',
  };

  it('offers nothing to press where the app cannot end it, and says why', () => {
    draw({ busy: 'pi-lens', stopping: CANNOT });
    expect(words()).not.toContain(SAYS.stop);
    // The shelf's own sentence, on screen, rather than a press that fails.
    expect(host?.textContent).toContain(CANNOT.says);
  });

  it('offers Stop on the row whose change is running, and presses it', () => {
    const onStop = vi.fn();
    draw({ busy: 'pi-lens', stopping: { canStop: true, says: '' } as Stopping, onStop });
    const stop = [...(host?.querySelectorAll('button') ?? [])].find(
      (one) => one.textContent === SAYS.stop,
    );
    expect(stop).toBeDefined();
    act(() => stop?.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to stop when nothing is being changed', () => {
    draw({ busy: null, stopping: { canStop: true, says: '' } as Stopping, onStop: NOTHING });
    // Adding is what the row offers; stopping is not a thing here yet.
    expect(words()).not.toContain(SAYS.stop);
    expect(words()).toContain(SAYS.add);
  });

  it('says what the last stop left on disk, in the shelf\u2019s own words', () => {
    draw({ stoppedSays: 'Stopped adding Lens. Lens 1.9.0 is on disk.' });
    expect(host?.textContent).toContain('Stopped adding Lens. Lens 1.9.0 is on disk.');
  });
});

describe('the npm line, before anybody presses Add', () => {
  const NEEDED: AddonSetup = {
    needed: true,
    line: 'Add-ons are installed with npm, and this Mac does not have it. Install Node, then reopen Graphe so it is found.',
    download: 'https://nodejs.org/en/download',
    command: null,
  };

  it('says what is missing, and opens the page that installs Node', () => {
    draw({ setup: NEEDED });
    expect(host?.textContent).toContain(NEEDED.line);
    const link = [...(host?.querySelectorAll('a') ?? [])].find(
      (one) => one.textContent === SAYS.getNode,
    );
    expect(link?.getAttribute('href')).toBe('https://nodejs.org/en/download');
  });

  it('offers the one command only where there is a brew to run it with', () => {
    draw({ setup: NEEDED });
    expect(words()).not.toContain('Copy brew install node');

    draw({ setup: { ...NEEDED, command: 'brew install node' } });
    expect(words()).toContain('Copy brew install node');
  });

  it('says nothing at all when npm is here', () => {
    draw({ setup: { ...NEEDED, needed: false, line: '' } });
    expect(host?.textContent).not.toContain('npm');
    expect(words()).not.toContain(SAYS.getNode);
  });
});

describe('what is here, in the state it is in', () => {
  function row(overrides: Partial<ExtensionHere>): ExtensionHere {
    return {
      id: 'pi-lens',
      version: '1.4.2',
      where: '/Users/you/.pi/agent/npm/node_modules/pi-lens/extensions/lens.ts',
      origin: 'Added',
      scope: 'Every project',
      state: 'installed',
      says: 'Added. Not loaded in this chat yet.',
      activeIn: [],
      commands: [],
      limits: [],
      problem: null,
      logs: [],
      ...overrides,
    };
  }

  it('draws each of the eight states, with what it is and what it does here', () => {
    const states: readonly ExtensionHere['state'][] = [
      'discovered',
      'needs trust',
      'installed',
      'active here',
      'activation pending',
      'disabled',
      'incompatible',
      'failed',
    ];
    draw({
      here: states.map((state, at) =>
        row({
          state,
          version: '1.4.2',
          origin: 'Added',
          scope: 'Every project',
          where: `/Users/you/.pi/agent/npm/node_modules/one-${String(at)}/extensions/index.ts`,
        }),
      ),
    });
    const drawn = host?.textContent ?? '';
    for (const state of states) {
      const word = state.charAt(0).toUpperCase() + state.slice(1);
      expect(drawn).toContain(word);
    }
    expect(drawn).toContain('Added · Every project');
    expect(drawn).toContain('1.4.2');
  });

  it('names the chats an add-on is running in, and the commands it offers', () => {
    draw({
      here: [
        row({
          state: 'active here',
          says: 'Running in 2 chats.',
          activeIn: ['the one about type', 'the second look'],
          commands: ['lens', 'lens-symbols'],
        }),
      ],
    });
    const drawn = host?.textContent ?? '';
    expect(drawn).toContain('Running in 2 chats.');
    expect(drawn).toContain('/lens /lens-symbols');
    // A count says how many; the row says which, because that is the question
    // somebody asks before taking an add-on off.
    expect(drawn).toContain('Loaded in the one about type, the second look');
  });

  it('says nothing about chats when nothing has it loaded', () => {
    draw({ here: [row({ state: 'installed' })] });
    expect(host?.textContent).not.toContain(SAYS.inChats);
  });

  it('draws the limits that apply here, and nothing where there are none', () => {
    const said = 'It keeps one advisor setting for this whole computer.';
    draw({ here: [row({ id: 'pi-advisor-flow', limits: [said] })] });
    expect(host?.textContent).toContain(said);

    draw({ here: [row({ id: 'pi-advisor-flow', limits: [] })] });
    expect(host?.textContent).not.toContain(said);
  });

  it('keeps the loader\u2019s own reason behind a press', () => {
    draw({
      here: [
        row({
          state: 'failed',
          says: 'It did not load when this chat was opened.',
          problem: 'It did not load when this chat was opened.',
          logs: ['boom: no such export'],
        }),
      ],
    });
    const folded = host?.querySelector('details');
    expect(folded?.textContent).toContain('boom: no such export');
  });

  /* A failed add-on with nowhere to read the reason is the shrug the plan
     names: the row has to carry both the one sentence and the raw text behind
     it, folded. */
  it('draws a failed add-on\u2019s error and its logs together', () => {
    draw({
      here: [
        row({
          id: 'pi-lens',
          state: 'failed',
          says: "Cannot find module 'fast-glob'",
          problem: "Cannot find module 'fast-glob'",
          logs: ["Cannot find module 'fast-glob'", 'Require stack:', ' - /Users/you/.pi/...'],
          activeIn: [],
        }),
      ],
    });
    expect(host?.textContent).toContain("Cannot find module 'fast-glob'");
    const folded = host?.querySelector('details');
    expect(folded?.tagName).toBe('DETAILS');
    expect(folded?.textContent).toContain('Require stack');
  });
});
