// @vitest-environment jsdom
/** Closing a tab closes a view, and Stop is the press that ends a run.
 *
 * What the plan asks for is that the two stopped being one action: closing used
 * to settle the sitting up and put the runtime down, so the small x on a tab
 * ended a turn somebody was paying for. The handler is a closure inside
 * `register()` in `electron/main.ts` and cannot be called from here, so what it
 * does is read off that source the way `close-keeps-worktree.test.ts` reads it,
 * and the decision it takes is exercised against the real session states.
 *
 * The shelf is the surface that has to keep saying a turn is in flight after
 * the tab has gone, so it is driven for real below.
 *
 *  Source text, not behaviour: the close, stop and interrupted-run handlers, closures inside register() in electron/main.ts; the decision they take is run for real against the session states below.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { inFlight, Sessions } from '../src/domain/conversations';
import { newConversationId } from '../src/domain/identity';
import Sidebar from '../src/components/Sidebar';

// jsdom has no file URL for this file, so the shell's source is read by path.
const MAIN = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');

/** One handler's own body, from the channel it answers to its closing `});`. */
function handlerFor(channel: string): string {
  const at = MAIN.indexOf(`handle<null>(CHANNEL.${channel},`);
  expect(at, `${channel} is no longer in electron/main.ts`).toBeGreaterThan(-1);
  const ends = MAIN.indexOf('\n  });', at);
  expect(ends).toBeGreaterThan(at);
  return MAIN.slice(at, ends);
}

describe('closing a conversation', () => {
  const close = handlerFor('closeConversation');

  it('does not settle the sitting up on the way out', () => {
    // Settling up sends the one model call nobody asked for. Closing a view is
    // not a reason to spend it.
    expect(close).not.toContain('settleUp');
  });

  it('leaves a conversation with a run in flight exactly where it is', () => {
    // The in-flight guard comes first, and returns before anything is put down
    // or any add-on's question is withdrawn.
    const guard = close.indexOf('inFlight(states.stateOf(named(found.path)))');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(close.indexOf('putDown('));
    expect(guard).toBeLessThan(close.indexOf('withdrawAsks('));
  });

  it('puts down the runtime of one that is quiet', () => {
    expect(close).toContain('putDown(open.held, found.path)');
  });
});

describe('the decision the close handler takes', () => {
  it('is the same one that protects a conversation from being evicted', () => {
    const states = new Sessions();
    const working = newConversationId();
    const quiet = newConversationId();
    states.move(working, 'opening', 1);
    states.move(working, 'idle', 2);
    states.move(working, 'running', 3);
    states.move(quiet, 'opening', 1);
    states.move(quiet, 'idle', 2);

    // A run is going, so closing the view keeps it: nothing is disposed, and
    // the conversation stays where it can be found again.
    expect(inFlight(states.stateOf(working))).toBe(true);
    // Nothing is going, so the runtime is put down. Nothing ends either way.
    expect(inFlight(states.stateOf(quiet))).toBe(false);
  });
});

describe('stopping a run', () => {
  const stop = handlerFor('stop');

  it('says so before the run ends, and takes the conversation back to idle', () => {
    const says = stop.indexOf("states.move(named(found.path), 'stopping'");
    expect(says).toBeGreaterThan(-1);
    expect(says).toBeLessThan(stop.indexOf('await found.held.stop()'));
    expect(stop.indexOf("states.move(named(found.path), 'idle'")).toBeGreaterThan(says);
  });

  it('ends the run the caller named rather than whichever is in front', () => {
    // A Stop from the shelf names a conversation whose tab may be gone; the
    // one in front would be somebody else's.
    expect(stop).toContain('conversationAt(open.held, where)');
  });
});

describe('the launch', () => {
  it('reads what was running before anything can open', () => {
    const ready = MAIN.indexOf('void app.whenReady()');
    const read = MAIN.indexOf('readWhatWasRunning();', ready);
    expect(read).toBeGreaterThan(ready);
    expect(read).toBeLessThan(MAIN.indexOf('register();', ready));
  });

  it('reads it back as interrupted, and starts nothing', () => {
    const read = MAIN.slice(
      MAIN.indexOf('function readWhatWasRunning'),
      MAIN.indexOf('function projectAt('),
    );
    expect(read).toContain('states.recovered(conversation)');
    expect(read).toContain('tookRunNoteAway');
    // The one thing a launch must not do with a run that was cut off.
    expect(read).not.toContain('startConversation');
  });

  it('says what it found over the conversation it belongs to', () => {
    const started = MAIN.slice(
      MAIN.indexOf('async function startConversationUnlocked'),
      MAIN.indexOf('function withNote('),
    );
    expect(started).toContain('tookInterruptedNote(address)');
  });
});

/* -------------------------------------------------------------------------- */
/* The shelf says what the shell knows                                         */
/* -------------------------------------------------------------------------- */

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const AT = 1_700_000_000_000;

function shelf(props: { state?: 'running' | 'idle'; onStop?: (path: string) => void }): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  act(() => {
    createRoot(host).render(
      createElement(Sidebar, {
        projects: [],
        openPath: '/work/atlas',
        onOpen: () => {},
        onBrowse: () => {},
        pinned: [],
        conversations: [
          {
            id: 'c1',
            path: '/chats/one.jsonl',
            title: 'Make the pricing page work on a phone',
            at: AT,
            messages: 12,
            ...(props.state === undefined ? {} : { state: props.state }),
          },
        ],
        openConversation: null,
        onOpenConversation: () => {},
        onNewConversation: () => {},
        onContinueConversation: () => {},
        onForkConversation: () => {},
        onArchiveConversation: () => {},
        ...(props.onStop === undefined ? {} : { onStopConversation: props.onStop }),
        open: true,
        onToggle: () => {},
        now: AT,
      }),
    );
  });
  return host;
}

function press(host: HTMLElement, label: string): void {
  const button = [...host.querySelectorAll('button')].find(
    (one) => one.getAttribute('aria-label') === label,
  );
  expect(button, `no button labelled ${label}`).toBeDefined();
  act(() => (button as HTMLElement).click());
}

function textOf(host: HTMLElement, className: string): string {
  return host.querySelector(`.${className}`)?.textContent ?? '';
}

describe('a conversation the shell says is still working', () => {
  it('says so on its row even though its tab has gone', () => {
    const host = shelf({ state: 'running' });
    expect(textOf(host, 'shelf__rowsub')).toBe('Still working');
  });

  it('offers Stop, which ends that conversation and not another', () => {
    const stopped: string[] = [];
    const host = shelf({ state: 'running', onStop: (path) => stopped.push(path) });
    press(host, 'More for “Make the pricing page work on a phone”');
    press(host, 'Stop Make the pricing page work on a phone');
    expect(stopped).toEqual(['/chats/one.jsonl']);
  });

  it('shows when it happened, and no Stop, once nothing is running', () => {
    const stopped = vi.fn();
    const host = shelf({ state: 'idle', onStop: stopped });
    expect(textOf(host, 'shelf__rowsub')).not.toBe('Still working');
    press(host, 'More for “Make the pricing page work on a phone”');
    expect(
      [...host.querySelectorAll('button')].some((one) =>
        (one.getAttribute('aria-label') ?? '').startsWith('Stop'),
      ),
    ).toBe(false);
    expect(stopped).not.toHaveBeenCalled();
  });
});
