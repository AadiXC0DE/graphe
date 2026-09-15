// @vitest-environment jsdom
/** Everything that was quietly ending a helper.
 *
 * Reported over and over as "the helpers stop without saying anything". It was
 * never one thing:
 *
 *  - Every helper on this machine had no way out to the internet at all. They
 *    were pointed at a door on loopback and the boundary built around that door
 *    permitted the door and nothing else — but the runtime a helper runs in
 *    reads no proxy setting, so it walked past the door into a wall. Every
 *    helper of a fan-out failed at the same instant and none could say why.
 *  - A helper's own retry could never run: the engine reports a failure and
 *    settles immediately, and the settling ended the helper one callback before
 *    the waiting could start.
 *  - A helper that did wait said nothing while waiting, and the one above kills
 *    a helper that has said nothing for five minutes — so waiting was fatal.
 *  - And Escape, pressed to close a popover in the composer row, stopped the
 *    run behind it.
 *
 *  Source text, not behaviour: the window's panel list and the helper's own reports; no behavioural test can reach them — App's wiring, and a child process.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import HowToWork from '../src/components/HowToWork';
import ThinkingWith from '../src/components/ThinkingWith';
import { HELPER_WAITS_MS, WAITS_MS } from '../src/agent/pi/transient';
import type { ConnectionState } from '../src/lib/ipc';

/* Relative to the repository, not to this module: under jsdom `import.meta.url`
   is an http address and resolves nothing on disk. */
const read = (where: string): string => readFileSync(join(process.cwd(), where), 'utf8');

const tools = read('src/agent/pi/tools.ts');
const runner = read('src/agent/pi/subagent-runner.ts');
const app = read('src/App.tsx');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** One account, so the picker has something to open on rather than being sent
 *  straight to the connect screen. */
const CONNECTED: ConnectionState = {
  chosen: { providerId: 'anthropic', modelId: 'haiku' },
  chosenThinking: 'off',
  providers: [
    {
      providerId: 'anthropic',
      name: 'Anthropic',
      methods: [],
      oauthLabel: null,
      apiKeyLabel: null,
      connected: true,
      available: true,
      subscription: false,
      models: [
        {
          id: 'haiku',
          label: 'Haiku',
          available: true,
          rates: { input: 0.8, output: 4 },
          contextWindow: null,
          takesImages: true,
          thinking: ['off', 'low', 'high'],
        },
      ],
    },
  ],
};

/** Open a popover and press Escape from inside it, with a listener on the
 *  window standing in for the one that stops the run. */
function escapeFromInside(
  draw: () => ReactElement,
  chip: string,
): { opened: boolean; closed: boolean; travelsOn: boolean; reached: boolean } {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(draw());
  });
  const button = host.querySelector<HTMLButtonElement>(chip);
  if (button === null) throw new Error(`${chip} is not drawn`);
  act(() => {
    button.click();
  });
  const opened = button.getAttribute('aria-expanded') === 'true';

  /** Whether a press from inside the popover reaches the window. */
  const pressed = (key: string): boolean => {
    let heard = false;
    const note = (): void => {
      heard = true;
    };
    window.addEventListener('keydown', note);
    act(() => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
    window.removeEventListener('keydown', note);
    return heard;
  };

  const travelsOn = pressed('a');
  const reached = pressed('Escape');
  const closed = button.getAttribute('aria-expanded') === 'false';

  act(() => {
    root.unmount();
  });
  host.remove();
  return { opened, closed, travelsOn, reached };
}

describe('a helper can reach the internet', () => {
  it('is not sent through a door its runtime cannot use', () => {
    const at = tools.indexOf('async function doorForHelpers(');
    expect(at).toBeGreaterThan(-1);
    const body = tools.slice(at, tools.indexOf('\n}', at));
    expect(body).toContain('return null;');
    expect(body).not.toContain('openDoorway(');
  });

  it('so the boundary around it never names a door and forbids the rest', () => {
    // `through` is what makes the profile permit loopback and nothing else.
    const at = tools.indexOf('const gate = await doorForHelpers()');
    expect(at).toBeGreaterThan(-1);
    const body = tools.slice(at, at + 400);
    expect(body).toContain('gate !== null && gate.open ? gate.port : undefined');
  });
});

describe('a helper waits out a wobble instead of dying on it', () => {
  it('does not end on the settling that follows the failure', () => {
    const at = runner.indexOf("if (event.type === 'settled')");
    expect(at).toBeGreaterThan(-1);
    const body = runner.slice(at, at + 900);
    expect(body).toContain('if (heldBackTrouble !== null) return;');
    // Before the ending, or it never runs.
    const guard = body.indexOf('heldBackTrouble !== null');
    const ends = body.indexOf('finish(');
    expect(guard).toBeGreaterThan(-1);
    expect(ends).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(ends);
  });

  it('waits a length that fits inside the patience it is measured against', () => {
    // Five minutes of silence is how long the one above waits.
    const PATIENCE_MS = 5 * 60_000;
    for (const wait of HELPER_WAITS_MS) expect(wait).toBeLessThan(PATIENCE_MS);
    expect(HELPER_WAITS_MS.length).toBeGreaterThan(1);
    // Each one longer than the last, so a real outage is not hammered.
    for (let at = 1; at < HELPER_WAITS_MS.length; at += 1) {
      expect(HELPER_WAITS_MS[at]!).toBeGreaterThan(HELPER_WAITS_MS[at - 1]!);
    }
  });

  it('is a shorter ladder than a conversation gets, on purpose', () => {
    const helper = HELPER_WAITS_MS.reduce((sum, one) => sum + one, 0);
    const conversation = WAITS_MS.reduce((sum, one) => sum + one, 0);
    expect(helper).toBeLessThan(conversation);
  });

  it('says it is still there while it waits, so it is not killed for waiting', () => {
    expect(runner).toContain("report({ type: 'waiting' });");
    const at = runner.indexOf('async function waitOut(');
    expect(at).toBeGreaterThan(-1);
    // Speaks more often than the patience above it, whatever the wait length.
    expect(runner.slice(at, at + 320)).toContain('Math.min(20_000');
    expect(runner).toContain('await waitOut(HELPER_WAITS_MS[attempt] ?? 0);');
  });

  it('is a line the one above knows how to ignore', () => {
    expect(tools).toContain("| { type: 'waiting' }");
  });
});

describe('a press that closes something does not stop the run', () => {
  /** Every panel that can be in front of the conversation. Escape belongs to
   *  whichever is up; only with none of them up does it reach the run. */
  it('counts every panel, including the ones that defend themselves', () => {
    const at = app.indexOf('const overlayUp = (): boolean =>');
    const list = app.slice(at, app.indexOf(';', at));
    for (const panel of [
      'settingsOpen',
      'usageOpen',
      'skillsOpen',
      'connectedOpen',
      'addMore',
      'worktreeOpen',
      'addonAsk',
      'paletteOpen',
      'graphOpen',
      'reviewsOpen',
      'reviewQueueOpen',
      'clashPath',
      'changesOpen',
      'asking',
      'helpersAt',
    ]) {
      expect(list, panel).toContain(panel);
    }
  });

  /* The composer row is the most-pressed surface in the app, and these two sit
     in it. Neither said the press was theirs, so it travelled on. */
  it('is kept by the popovers in the composer row', () => {
    const ways = escapeFromInside(
      () => createElement(HowToWork, { plans: 'auto', onPlans: () => {} }),
      '.ways__chip',
    );
    const thinking = escapeFromInside(
      () =>
        createElement(ThinkingWith, {
          state: CONNECTED,
          onSelect: () => {},
          onConnect: () => {},
        }),
      '.thinking__chip',
    );

    for (const [which, one] of [
      ['HowToWork', ways],
      ['ThinkingWith', thinking],
    ] as const) {
      // It really opened, and a press it has no opinion about still reaches the
      // window — so Escape not reaching it is the popover's doing.
      expect(one.opened, which).toBe(true);
      expect(one.travelsOn, which).toBe(true);
      expect(one.closed, which).toBe(true);
      expect(one.reached, which).toBe(false);
    }
  });

  it('is kept by the panels that answer it in the page itself', () => {
    for (const [where, mark] of [
      ['src/components/CostMeter.tsx', 'setOpen(false)'],
      ['src/components/Board.tsx', 'setSaying(false)'],
      ['src/components/History.tsx', 'setNaming(false)'],
    ] as const) {
      const source = read(where);
      const at = source.indexOf("if (event.key === 'Escape') {");
      expect(at, where).toBeGreaterThan(-1);
      const body = source.slice(at, at + 340);
      expect(body, where).toContain('event.preventDefault();');
      expect(body, where).toContain(mark);
    }
  });
});
