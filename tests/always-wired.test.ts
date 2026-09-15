// @vitest-environment jsdom
/** Things a project always does, wired end to end.
 *
 *  The pure half is tested next door. This is the tripwire: the three moments
 *  really are hung on, only what the Guard allows outright ever runs, and the
 *  file being unreadable is said out loud rather than silently running none.
 *
 *  Source text, not behaviour: the moments the adapter runs the always list at, the shell's IPC handlers and frames, and the window's use of the preview stream; no behavioural test can reach them — the wiring is inside createSession, electron/main.ts and App.tsx.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Composer from '../src/components/Composer';
import type { Workflow } from '../src/lib/ipc';

/* jsdom gives `import.meta.url` an http scheme, so the sources are read from
   the repo root the way the other jsdom files do it. */
const ADAPTER = readFileSync(join(process.cwd(), 'src/agent/pi/adapter.ts'), 'utf8');
const MAIN = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');
const SETTINGS = readFileSync(join(process.cwd(), 'src/components/Settings.tsx'), 'utf8');

describe('what runs without being asked', () => {
  it('is read once when the sitting opens, beside the project’s rules', () => {
    expect(ADAPTER).toContain('alwaysFrom(');
    expect(ADAPTER).toContain('alwaysFile(options.projectRoot');
  });

  it('runs at each of the three moments', () => {
    expect(ADAPTER).toContain("runAlways('afterEachChange', touched)");
    expect(ADAPTER).toContain("runAlways('whenItFinishes', [])");
    expect(ADAPTER).toContain("runAlways('whenItOpens', [])");
  });

  /** Nobody is there to be asked, so only what would not have been asked
   *  about may run. */
  it('runs only what the Guard allows outright', () => {
    const at = ADAPTER.indexOf('async function runAlways');
    expect(at).toBeGreaterThan(-1);
    const block = ADAPTER.slice(at, at + 1600);
    expect(block).toContain("name: 'bash'");
    expect(block).toContain("allowed.kind !== 'allow'");
    expect(block).toContain('ALWAYS_WORDS.refused(one.name)');
  });

  it('says once when the file itself will not read', () => {
    expect(ADAPTER).toContain('always.trouble === null ? [] : [always.trouble]');
  });

  it('lets the window write the whole list back, atomically', () => {
    const at = MAIN.indexOf('handle<AlwaysDoes>(CHANNEL.alwaysWrite');
    expect(at).toBeGreaterThan(-1);
    const block = MAIN.slice(at, at + 600);
    expect(block).toContain('rowsAsGiven(args[0])');
    expect(block).toContain('writeAtomically(file, alwaysText(rows))');
  });

  it('lets the window read them, fresh each time', () => {
    const at = MAIN.indexOf('handle<AlwaysDoes>(CHANNEL.alwaysDoes');
    expect(at).toBeGreaterThan(-1);
    const block = MAIN.slice(at, at + 900);
    expect(block).toContain('alwaysFrom(text).trouble');
    expect(SETTINGS).toContain("onGo('always')");
  });
});

describe('watching the browser, minded', () => {
  const APP = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const MAIN = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');

  /** The window is served from a file, and a socket opened there is refused by
   *  anything on this machine before it carries a frame — so the shell takes
   *  the pictures and hands them over. */
  it('has the shell take the pictures, not the window', () => {
    expect(APP).toContain('bridge.onBrowserFrame(');
    expect(MAIN).toContain('CHANNEL.browserFrame');
  });

  it('takes the next one only once the last has arrived', () => {
    const at = MAIN.indexOf('function watchTheBrowser');
    expect(at).toBeGreaterThan(-1);
    // The whole function, up to the next one, rather than a fixed window: how
    // long the comments inside it are is not what this is about.
    const after = MAIN.indexOf('\nfunction ', at + 1);
    const block = MAIN.slice(at, after === -1 ? undefined : after);
    expect(block).toContain('while (!mine.stop)');
    expect(block).toContain('await browserFrame(');
  });

  /** By the time somebody has switched project, the one that started the
   *  watching is no longer the one in front — so the stream belongs to the
   *  project rather than to whatever is in front, and it is the registry that
   *  stops the one it started. */
  it('stops watching on the project that started it', () => {
    const LIVE = readFileSync(join(process.cwd(), 'src/preview/live.ts'), 'utf8');
    expect(APP).toContain('live.subscribe(');
    expect(APP).toContain('live.deliver(frame)');
    expect(LIVE).toContain('options.watch(project, false)');
  });
});

/* The one thing on this file that is the window's own behaviour rather than a
   wire between two files, so it is asked of the box rather than read out of its
   markup. */
describe('a way of working, offered as it is typed', () => {
  const open: { host: HTMLElement; root: Root }[] = [];

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  afterEach(() => {
    for (const one of open.splice(0)) {
      act(() => {
        one.root.unmount();
      });
      one.host.remove();
    }
  });

  const REVIEW: Workflow = {
    command: '/review',
    name: 'review',
    description: 'Look over what changed',
    hint: null,
    source: 'project',
  };

  function draw(): { host: HTMLElement; root: Root } {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(createElement(Composer, { onSend: () => undefined, workflows: [REVIEW] }));
    });
    const held = { host, root };
    open.push(held);
    return held;
  }

  function boxIn(host: HTMLElement): HTMLTextAreaElement {
    const field = host.querySelector('textarea');
    if (field === null) throw new Error('the composer drew no box');
    return field;
  }

  /** Typing, the way React hears it. */
  function type(field: HTMLTextAreaElement, text: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter === undefined) throw new Error('no value setter on a textarea');
    act(() => {
      setter.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('offers them on a slash at the start of a message, and only there', () => {
    const { host } = draw();
    const box = boxIn(host);

    // A slash inside a sentence is a slash — somebody writing a path.
    type(box, 'look over src/lib/');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);

    type(box, '/');
    const offered = [...host.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(offered).toHaveLength(1);
    expect(offered[0]?.textContent).toContain('review');

    // Offered and usable: the row puts the command in the box.
    act(() => offered[0]?.click());
    expect(boxIn(host).value).toBe('/review ');
  });
});
